"""Data Source Control Plane & RunContext Endpoints for SkyGuard AI."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
import shutil
import tempfile
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.app.api.v1.deps import get_engine, get_live_poller, get_replay_engine, get_repository
from backend.app.connectors.provider_registry import ProviderRegistry
from backend.app.core.config import get_settings
from backend.app.core.database import DatabaseRepository
from backend.app.core.deps import get_run_context_manager
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.replay import StreamReplayEngine
from backend.app.core.state import RunContextManager
from backend.app.ingestion.csv_normalizer import CSVDatasetPreview, CSVNormalizer
from backend.app.ingestion.live_poller import LiveSourcePoller
from backend.app.models.run_context import (
    DataSourceType,
    ReplayControlRequest,
    RunContext,
    RunMode,
    RunStatus,
    SourceSelectRequest,
    TransportType,
)

router = APIRouter(prefix="/runtime", tags=["Runtime & Data Source Control Plane"])

# In-memory run history log for audit trail
_RUN_HISTORY: List[Dict[str, Any]] = []


class SpeedChangeRequest(BaseModel):
    speed: float


@router.get("/context", response_model=RunContext)
async def get_active_run_context(
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
    poller: LiveSourcePoller = Depends(get_live_poller),
) -> RunContext:
    """Get canonical active RunContext detailing current data source, run mode, transport, and execution status."""
    ctx = ctx_mgr.get_context()
    settings = get_settings()

    # Synchronize dynamic execution state
    meta = dict(ctx.metadata or {})
    meta["demo_autostart"] = settings.demo_autostart

    if ctx.mode in ("SYNTHETIC_REPLAY", "HISTORICAL_REPLAY"):
        return ctx_mgr.update_context(
            current_observation_index=replay.current_index,
            status=RunStatus.RUNNING if replay.is_running else ctx.status,
            replay_speed=replay.speed_multiplier,
            observation_count=len(replay.observations),
            metadata=meta,
        )
    elif ctx.mode == "LIVE_MONITORING":
        return ctx_mgr.update_context(
            status=RunStatus.RUNNING if poller.is_running else RunStatus.IDLE,
            metadata=meta,
        )
    return ctx_mgr.update_context(metadata=meta)


@router.get("/providers")
async def list_data_source_providers() -> List[Dict[str, Any]]:
    """List available data source providers, configuration state, default modes, and descriptions."""
    return ProviderRegistry.list_providers()


@router.post("/source/select", response_model=RunContext)
async def select_data_source(
    payload: SourceSelectRequest,
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
    poller: LiveSourcePoller = Depends(get_live_poller),
    engine: RealTimeProcessingEngine = Depends(get_engine),
    repo: DatabaseRepository = Depends(get_repository),
) -> RunContext:
    """Switch active data source and run mode.
    
    Resets transient source state, stops existing tasks, generates a fresh run_id, and updates canonical RunContext.
    """
    try:
        current = ctx_mgr.get_context()
        # Record finished run in history if active
        if current.run_id and current.status != RunStatus.IDLE:
            _RUN_HISTORY.append({
                "run_id": current.run_id,
                "source_type": current.source_type,
                "source_name": current.source_name,
                "mode": current.mode,
                "dataset_id": current.dataset_id,
                "station_count": current.station_count,
                "observation_count": current.observation_count,
                "created_at": current.created_at.isoformat(),
                "status": current.status,
            })

        # Stop existing background activities
        if replay.is_running:
            await replay.pause()
        if poller.is_running:
            await poller.stop()

        # Reset transient in-memory station state buffers to prevent cross-mode observation bleed
        repo.clear_run_cache()
        if hasattr(engine, "state_manager") and engine.state_manager is not None:
            engine.state_manager.stations.clear()

        new_ctx = ctx_mgr.select_source(
            source_type=payload.source_type,
            mode=payload.mode,
            dataset_id=payload.dataset_id,
            config=payload.config,
        )

        # Configure underlying engines & dynamic active topology based on selected source & mode
        if payload.source_type == DataSourceType.SYNTHETIC_VALIDATION:
            replay.load_synthetic_benchmark()
            from backend.app.api.v1.deps import get_synthetic_topology
            synth_topo = get_synthetic_topology()
            repo.set_topology(synth_topo)
            if hasattr(engine, "spatial_engine") and engine.spatial_engine is not None:
                engine.spatial_engine.topology = synth_topo
            new_ctx = ctx_mgr.update_context(
                station_count=len(synth_topo.stations),
                observation_count=len(replay.observations),
            )
        elif payload.source_type == DataSourceType.HISTORICAL_CSV:
            replay.load_historical_dataset(payload.dataset_id)
            from ml.spatial.topology import SpatialNetworkTopology
            from backend.app.api.v1.deps import get_default_topology
            hist_topo = SpatialNetworkTopology.from_observations(replay.observations)
            if not hist_topo.stations:
                hist_topo = get_default_topology()
            repo.set_topology(hist_topo)
            if hasattr(engine, "spatial_engine") and engine.spatial_engine is not None:
                engine.spatial_engine.topology = hist_topo
            new_ctx = ctx_mgr.update_context(
                observation_count=len(replay.observations),
                station_count=len(hist_topo.stations),
            )
        elif payload.source_type == DataSourceType.OPEN_METEO:
            from backend.app.api.v1.deps import get_default_topology
            live_topo = get_default_topology()
            repo.set_topology(live_topo)
            if hasattr(engine, "spatial_engine") and engine.spatial_engine is not None:
                engine.spatial_engine.topology = live_topo
            if hasattr(poller, "topology"):
                poller.topology = live_topo
            new_ctx = ctx_mgr.update_context(
                station_count=len(live_topo.stations),
            )
            # When LIVE API is selected, live poller must become active immediately
            if payload.mode == RunMode.LIVE_MONITORING:
                if not poller.is_running:
                    await poller.start()
                new_ctx = ctx_mgr.update_context(status=RunStatus.RUNNING)

        # Broadcast real-time notifications so clients refresh station roster and system status immediately
        from backend.app.core.ws_manager import get_ws_manager
        from backend.app.models.events import EventType, WebSocketEnvelope
        ws_mgr = get_ws_manager()
        ws_mgr.broadcast_sync(WebSocketEnvelope.create(
            event_id=f"STN-CHG-{int(datetime.now(timezone.utc).timestamp())}",
            event_type=EventType.STATION_STATUS_CHANGED,
            station_id="ALL",
            timestamp=datetime.now(timezone.utc),
            payload={"status": "UPDATED", "station_count": len(repo.topology.stations)},
        ))
        ws_mgr.broadcast_sync(WebSocketEnvelope.create(
            event_id=f"SYS-CHG-{int(datetime.now(timezone.utc).timestamp())}",
            event_type=EventType.SYSTEM_STATUS_CHANGED,
            station_id="SYSTEM",
            timestamp=datetime.now(timezone.utc),
            payload={"status": "UPDATED", "source_type": payload.source_type},
        ))

        return new_ctx
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to select data source: {exc}")


@router.post("/run/start", response_model=RunContext)
async def start_active_run(
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
    poller: LiveSourcePoller = Depends(get_live_poller),
    engine: RealTimeProcessingEngine = Depends(get_engine),
) -> RunContext:
    """Start or resume execution of current RunContext."""
    current = ctx_mgr.get_context()

    if current.mode in ("SYNTHETIC_REPLAY", "HISTORICAL_REPLAY"):
        await replay.start(engine=engine, ctx_mgr=ctx_mgr)
        return ctx_mgr.update_context(status=RunStatus.RUNNING)
    elif current.mode == "LIVE_MONITORING":
        if not poller.is_running:
            await poller.start()
        return ctx_mgr.update_context(status=RunStatus.RUNNING)
    else:
        return ctx_mgr.update_context(status=RunStatus.RUNNING)


@router.post("/run/pause", response_model=RunContext)
async def pause_active_run(
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
    poller: LiveSourcePoller = Depends(get_live_poller),
) -> RunContext:
    """Pause execution of current RunContext."""
    current = ctx_mgr.get_context()

    if current.mode in ("SYNTHETIC_REPLAY", "HISTORICAL_REPLAY"):
        await replay.pause()
    elif current.mode == "LIVE_MONITORING":
        if poller.is_running:
            await poller.stop()

    return ctx_mgr.update_context(status=RunStatus.PAUSED)


@router.post("/run/reset", response_model=RunContext)
async def reset_active_run(
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
    poller: LiveSourcePoller = Depends(get_live_poller),
    engine: RealTimeProcessingEngine = Depends(get_engine),
    repo: DatabaseRepository = Depends(get_repository),
) -> RunContext:
    """Reset current RunContext state pointers to initial conditions without destructive database operations."""
    current = ctx_mgr.get_context()
    if current.source_type == DataSourceType.SYNTHETIC_VALIDATION:
        if len(repo.topology.stations) != 20:
            from backend.app.api.v1.deps import get_synthetic_topology
            synth_topo = get_synthetic_topology()
            repo.set_topology(synth_topo)
            if hasattr(engine, "spatial_engine") and engine.spatial_engine is not None:
                engine.spatial_engine.topology = synth_topo

    replay.reset(preserve_db=True)
    repo.clear_run_cache()
    if hasattr(engine, "state_manager") and engine.state_manager is not None:
        engine.state_manager.stations.clear()

    new_run_id = f"RUN-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    return ctx_mgr.update_context(
        run_id=new_run_id,
        status=RunStatus.IDLE,
        current_observation_index=0,
        current_synthetic_time=None,
    )


@router.post("/run/speed", response_model=RunContext)
async def set_replay_speed(
    payload: SpeedChangeRequest,
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> RunContext:
    """Dynamically adjust replay speed multiplier (1x, 10x, 60x, 300x)."""
    new_speed = replay.set_speed(payload.speed)
    return ctx_mgr.update_context(replay_speed=new_speed)


@router.post("/csv/preview", response_model=CSVDatasetPreview)
async def preview_csv_dataset(
    file: UploadFile = File(...),
) -> CSVDatasetPreview:
    """Upload and analyze historical CSV dataset to generate column mapping, missingness, and preview before execution."""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid file format. Only CSV files are supported.")

    try:
        temp_dir = Path(tempfile.gettempdir()) / "skyguard_csv_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_path = temp_dir / file.filename

        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        preview = CSVNormalizer.generate_preview(temp_path)
        return preview
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"CSV Preview Generation failed: {exc}")


@router.get("/history")
async def get_run_history(
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
) -> List[Dict[str, Any]]:
    """Get audit history log of previous execution runs."""
    history = list(_RUN_HISTORY)
    current = ctx_mgr.get_context()
    history.append({
        "run_id": current.run_id,
        "source_type": current.source_type,
        "source_name": current.source_name,
        "mode": current.mode,
        "dataset_id": current.dataset_id,
        "station_count": current.station_count,
        "observation_count": current.observation_count,
        "created_at": current.created_at.isoformat(),
        "status": current.status,
    })
    return history
