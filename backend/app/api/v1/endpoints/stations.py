"""Station metadata, live status, history, and health endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.app.api.v1.deps import get_repository, get_run_context_manager
from backend.app.core.database import DatabaseRepository
from backend.app.core.state import RunContextManager
from backend.app.models.observation import WeatherObservation
from backend.app.models.processing import LiveStationSnapshot, PaginatedResponse, PaginationMeta
from backend.app.models.run_context import RunMode
from ml.health.health_schema import SensorHealthSummary

router = APIRouter(prefix="/stations", tags=["Stations"])


@router.get("", response_model=List[Dict[str, Any]])
async def list_stations(
    repo: DatabaseRepository = Depends(get_repository),
):
    """List all configured Automatic Weather Stations with coordinates and status."""
    return repo.get_stations()


@router.get("/{station_id}", response_model=Dict[str, Any])
async def get_station(
    station_id: str,
    repo: DatabaseRepository = Depends(get_repository),
):
    """Get metadata for a specific station."""
    stn = repo.get_station_by_id(station_id)
    if not stn:
        raise HTTPException(status_code=404, detail=f"Station '{station_id}' not found.")
    return stn


@router.get("/{station_id}/latest", response_model=LiveStationSnapshot)
async def get_station_latest(
    station_id: str,
    repo: DatabaseRepository = Depends(get_repository),
):
    """Get real-time operational status snapshot for a station."""
    snapshot = repo.get_station_latest(station_id)
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
    order: str = Query("asc", description="Sort order ('asc' or 'desc')"),
    repo: DatabaseRepository = Depends(get_repository),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
):
    """Get chronological observation telemetry for a station with filters and pagination."""
    if not isinstance(ctx_mgr, RunContextManager):
        ctx_mgr = get_run_context_manager()

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
):
    """Get latest continuous 0-100 Sensor Health evaluation for a station."""
    health = repo.get_station_health(station_id)
    if not health:
        raise HTTPException(status_code=404, detail=f"No health records available for station '{station_id}'.")
    return health
