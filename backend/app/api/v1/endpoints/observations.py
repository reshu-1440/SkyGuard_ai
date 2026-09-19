"""Real-time observation ingestion and processing endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, Depends, status

from backend.app.api.v1.deps import get_engine, get_run_context_manager
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.state import RunContextManager
from backend.app.models.observation import WeatherObservation
from backend.app.models.processing import ProcessingResult

router = APIRouter(prefix="/observations", tags=["Observations & Ingestion"])


@router.post("/process", response_model=ProcessingResult, status_code=status.HTTP_200_OK)
async def process_single_observation(
    observation: WeatherObservation,
    engine: RealTimeProcessingEngine = Depends(get_engine),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
):
    """Ingest and process a single WeatherObservation through the full analytical intelligence pipeline."""
    res = engine.process_observation(observation)
    try:
        if not isinstance(ctx_mgr, RunContextManager):
            ctx_mgr = get_run_context_manager()
        ctx = ctx_mgr.get_context()
        cur_ts = ctx.current_synthetic_time
        obs_dt = observation.timestamp.astimezone(timezone.utc)
        cur_dt = cur_ts.astimezone(timezone.utc) if isinstance(cur_ts, datetime) else (datetime.fromisoformat(str(cur_ts)).astimezone(timezone.utc) if cur_ts else None)
        if cur_dt is None or obs_dt > cur_dt:
            ctx_mgr.update_context(
                current_synthetic_time=obs_dt,
                current_observation_index=ctx.current_observation_index + 1,
            )
    except Exception:
        pass
    return res


@router.post("/batch", response_model=List[ProcessingResult], status_code=status.HTTP_200_OK)
async def process_observation_batch(
    observations: List[WeatherObservation],
    engine: RealTimeProcessingEngine = Depends(get_engine),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
):
    """Process a sequential batch of WeatherObservations."""
    results = []
    for obs in observations:
        res = engine.process_observation(obs)
        results.append(res)
    if observations:
        try:
            if not isinstance(ctx_mgr, RunContextManager):
                ctx_mgr = get_run_context_manager()
            ctx = ctx_mgr.get_context()
            cur_ts = ctx.current_synthetic_time
            last_dt = observations[-1].timestamp.astimezone(timezone.utc)
            cur_dt = cur_ts.astimezone(timezone.utc) if isinstance(cur_ts, datetime) else (datetime.fromisoformat(str(cur_ts)).astimezone(timezone.utc) if cur_ts else None)
            if cur_dt is None or last_dt > cur_dt:
                ctx_mgr.update_context(
                    current_synthetic_time=last_dt,
                    current_observation_index=ctx.current_observation_index + len(observations),
                )
        except Exception:
            pass
    return results
