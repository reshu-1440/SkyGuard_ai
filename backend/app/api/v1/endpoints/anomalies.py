"""Anomaly detection alerts, event drilldown, and explainability endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.api.v1.deps import get_replay_engine, get_repository, get_run_context_manager
from backend.app.core.database import DatabaseRepository
from backend.app.core.replay import StreamReplayEngine
from backend.app.core.state import RunContextManager
from backend.app.models.processing import AnomalyEventRecord, PaginatedResponse, PaginationMeta
from backend.app.models.run_context import RunMode
from ml.explainability.schema import ExplanationSummary

from backend.app.api.v1.endpoints.stations import _get_replay_cursor_cutoff

router = APIRouter(prefix="/anomalies", tags=["Anomalies & Alerts"])


@router.get("", response_model=PaginatedResponse[AnomalyEventRecord])
async def list_anomalies(
    station_id: Optional[str] = Query(None, description="Filter by station ID"),
    decision: Optional[str] = Query(None, description="Filter by hybrid decision (e.g. PROBABLE_SENSOR_ANOMALY)"),
    severity: Optional[str] = Query(None, description="Filter by severity (e.g. HIGH, CRITICAL)"),
    start_time: Optional[datetime] = Query(None, description="Start timestamp filter"),
    end_time: Optional[datetime] = Query(None, description="End timestamp filter"),
    limit: int = Query(50, ge=1, le=500, description="Items per page"),
    offset: int = Query(0, ge=0, description="Page offset"),
    historical: bool = Query(False, description="Allow full historical dataset bypassing active replay cursor"),
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """List detected anomalies with multi-criteria filtering and pagination, bounded by active replay cursor."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    eff_station_id = station_id if isinstance(station_id, str) else None
    eff_decision = decision if isinstance(decision, str) else None
    eff_severity = severity if isinstance(severity, str) else None
    eff_start = start_time if isinstance(start_time, datetime) else None
    eff_end = end_time if isinstance(end_time, datetime) else None
    eff_limit = limit if isinstance(limit, int) else 50
    eff_offset = offset if isinstance(offset, int) else 0
    eff_historical = historical if isinstance(historical, bool) else False

    ctx = ctx_mgr.get_context()
    cutoff = _get_replay_cursor_cutoff(ctx, replay, historical=eff_historical, repo=repo)
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
        eff_end = min(eff_end.astimezone(timezone.utc), cutoff) if eff_end else cutoff

    items, total = repo.get_anomalies(
        station_id=eff_station_id,
        decision=eff_decision,
        severity=eff_severity,
        start_time=eff_start,
        end_time=eff_end,
        limit=eff_limit,
        offset=eff_offset,
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


@router.get("/{event_id}", response_model=AnomalyEventRecord)
async def get_anomaly_detail(
    event_id: str,
    historical: bool = Query(False, description="Allow query across full historical dataset"),
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """Get single anomaly event record by its unique event ID."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    eff_historical = historical if isinstance(historical, bool) else False

    ev = repo.get_anomaly_by_id(event_id)
    if not ev:
        raise HTTPException(status_code=404, detail=f"Anomaly event '{event_id}' not found.")

    # Guard against premature inspection of future anomaly events in active replay
    ctx = ctx_mgr.get_context()
    cutoff = _get_replay_cursor_cutoff(ctx, replay, historical=eff_historical, repo=repo)
    if cutoff is not None:
        if cutoff.year <= 1970:
            raise HTTPException(status_code=404, detail=f"Anomaly event '{event_id}' has not been reached by active replay cursor.")
        ev_time = datetime.fromisoformat(ev.timestamp).astimezone(timezone.utc)
        if ev_time > cutoff:
            raise HTTPException(status_code=404, detail=f"Anomaly event '{event_id}' has not been reached by active replay cursor.")

    return ev

    return ev


@router.get("/{event_id}/explanation", response_model=ExplanationSummary)
async def get_anomaly_explanation(
    event_id: str,
    historical: bool = Query(False, description="Allow query across full historical dataset"),
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
):
    """Get complete Explainability package (SHAP attributions, neighbor comparison, SOP steps)."""
    if not isinstance(repo, DatabaseRepository):
        repo = get_repository()
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()
    if not isinstance(replay, StreamReplayEngine):
        replay = get_replay_engine()

    eff_historical = historical if isinstance(historical, bool) else False

    # Ensure event detail passes cursor guard
    await get_anomaly_detail(event_id, historical=eff_historical, repo=repo, ctx_mgr=ctx_mgr, replay=replay)

    exp = repo.get_anomaly_explanation(event_id)
    if not exp:
        raise HTTPException(
            status_code=404,
            detail=f"Explanation package for anomaly event '{event_id}' not found.",
        )
    return exp
