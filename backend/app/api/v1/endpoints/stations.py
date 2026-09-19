"""Station metadata, live status, history, and health endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.api.v1.deps import get_replay_engine, get_repository, get_run_context_manager
from backend.app.core.database import DatabaseRepository
from backend.app.core.replay import StreamReplayEngine
from backend.app.core.state import RunContextManager
from backend.app.models.observation import WeatherObservation
from backend.app.models.processing import LiveStationSnapshot, PaginatedResponse, PaginationMeta
from backend.app.models.run_context import RunContext, RunMode
from ml.health.health_schema import SensorHealthSummary

router = APIRouter(prefix="/stations", tags=["Stations"])


def _get_replay_cursor_cutoff(
    ctx: RunContext,
    replay: StreamReplayEngine,
    historical: bool = False,
    repo: Optional[DatabaseRepository] = None,
) -> Optional[datetime]:
    """Return max allowed observation timestamp for replay mode, or None if historical / live."""
    if historical:
        return None
    if ctx.mode in (RunMode.SYNTHETIC_REPLAY, RunMode.HISTORICAL_REPLAY):
        if ctx.current_synthetic_time:
            try:
                return datetime.fromisoformat(ctx.current_synthetic_time).astimezone(timezone.utc)
            except Exception:
                pass
        if replay.current_index > 0:
            if replay.observations and replay.current_index <= len(replay.observations):
                return replay.observations[replay.current_index - 1].timestamp.astimezone(timezone.utc)
        try:
            from backend.app.api.v1.deps import get_engine
            engine = get_engine()
            if engine and engine.state_manager and engine.state_manager.stations:
                latest_seen = max(
                    (buf.last_seen_timestamp for buf in engine.state_manager.stations.values() if buf.last_seen_timestamp),
                    default=None,
                )
                if latest_seen:
                    return latest_seen
        except Exception:
            pass
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    return None


@router.get("", response_model=List[Dict[str, Any]])
async def list_stations(
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """List all configured Automatic Weather Stations with coordinates and status."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    ctx = ctx_mgr.get_context()
    max_ts = _get_replay_cursor_cutoff(ctx, replay, historical=False, repo=repo)
    return repo.get_stations(max_timestamp=max_ts)


@router.get("/{station_id}", response_model=Dict[str, Any])
async def get_station(
    station_id: str,
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """Get metadata for a specific station."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    ctx = ctx_mgr.get_context()
    max_ts = _get_replay_cursor_cutoff(ctx, replay, historical=False, repo=repo)
    stn = repo.get_station_by_id(station_id, max_timestamp=max_ts)
    if not stn:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' not found.")
    return stn


@router.get("/{station_id}/latest", response_model=LiveStationSnapshot)
async def get_station_latest(
    station_id: str,
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """Get real-time operational status snapshot for a station."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    ctx = ctx_mgr.get_context()
    max_ts = _get_replay_cursor_cutoff(ctx, replay, historical=False, repo=repo)
    snapshot = repo.get_station_latest(station_id, max_timestamp=max_ts)
    if not snapshot:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' not found.")
    return snapshot


@router.get("/{station_id}/history", response_model=PaginatedResponse[WeatherObservation])
async def get_station_history(
    station_id: str,
    start_time: Optional[datetime] = Query(None, description="ISO start time filter"),
    end_time: Optional[datetime] = Query(None, description="ISO end time filter"),
    limit: int = Query(100, ge=1, le=1000, description="Items per page"),
    offset: int = Query(0, ge=0, description="Page offset"),
    source: Optional[str] = Query(None, description="Data source filter"),
    is_synthetic: Optional[bool] = Query(None, description="Synthetic flag filter"),
    historical: bool = Query(False, description="Allow full historical dataset bypassing active replay cursor"),
    order: str = Query("asc", description="Sort order ('asc' or 'desc')"),
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """Get chronological observation telemetry for a station with filters and pagination."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    ctx = ctx_mgr.get_context()
    eff_source = source if isinstance(source, str) else None
    eff_synthetic = is_synthetic if isinstance(is_synthetic, bool) else None
    eff_start = start_time if isinstance(start_time, datetime) else None
    eff_end = end_time if isinstance(end_time, datetime) else None
    eff_limit = limit if isinstance(limit, int) else 100
    eff_offset = offset if isinstance(offset, int) else 0

    # Automatically enforce data source isolation matching the active RunContext
    if eff_source is None:
        if ctx.mode == RunMode.LIVE_MONITORING:
            eff_source = ctx.source_type.value if hasattr(ctx.source_type, "value") else str(ctx.source_type)
            if eff_synthetic is None:
                eff_synthetic = False
        elif ctx.mode in (RunMode.HISTORICAL_REPLAY, RunMode.HISTORICAL_ANALYSIS):
            eff_source = "HISTORICAL_CSV"
            if eff_synthetic is None:
                eff_synthetic = False
    elif eff_source == "ALL":
        eff_source = None
        eff_synthetic = None

    eff_order = str(order) if isinstance(order, str) else "asc"

    # Enforce progressive observation window bounded by replay cursor
    cutoff = _get_replay_cursor_cutoff(ctx, replay, historical=historical, repo=repo)
    if cutoff is not None:
        if cutoff.year <= 1970:
            return PaginatedResponse(
                items=[],
                pagination=PaginationMeta(
                    total_count=0,
                    limit=eff_limit,
                    offset=eff_offset,
                    has_more=False,
                ),
            )
        eff_end = min(eff_end, cutoff) if eff_end else cutoff

    items, total = repo.get_station_history(
        station_id=station_id,
        start_time=eff_start,
        end_time=eff_end,
        limit=eff_limit,
        offset=eff_offset,
        source=eff_source,
        is_synthetic=eff_synthetic,
        order=eff_order,
    )
    return PaginatedResponse(
        items=items,
        pagination=PaginationMeta(
            total_count=total,
            limit=eff_limit,
            offset=eff_offset,
            has_more=(eff_offset + eff_limit) < total,
        ),
    )


@router.get("/{station_id}/health", response_model=Optional[SensorHealthSummary])
async def get_station_health(
    station_id: str,
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """Get latest continuous 0-100 Sensor Health evaluation for a station."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    ctx = ctx_mgr.get_context()
    cutoff = _get_replay_cursor_cutoff(ctx, replay, historical=False, repo=repo)
    if cutoff is not None and cutoff.year <= 1970:
        raise HTTPException(status_code=404, detail=f"No health records available for station '{station_id}'.")
    health = repo.get_station_health(station_id)
    if not health:
        raise HTTPException(status_code=404, detail=f"No health records available for station '{station_id}'.")
    return health
