"""Stream replay simulation control endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.api.v1.deps import get_engine, get_replay_engine, get_run_context_manager
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.replay import StreamReplayEngine
from backend.app.core.state import RunContextManager

router = APIRouter(prefix="/replay", tags=["Replay Simulator"])


class LoadScenarioRequest(BaseModel):
    scenario_id: str


@router.get("/status")
async def get_replay_status(
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> Dict[str, Any]:
    """Get current status of the stream replay simulator."""
    return {
        "mode": "DEMO REPLAY",
        "is_running": replay.is_running,
        "current_scenario_id": replay.current_scenario_id,
        "current_index": replay.current_index,
        "total_queued_observations": len(replay.observations),
        "emitted_count": replay.emitted_count,
        "speed_multiplier": replay.speed_multiplier,
        "registered_injected_anomalies_count": len(replay.injected_anomalies),
    }


@router.get("/scenarios")
async def list_replay_scenarios(
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> List[Dict[str, Any]]:
    """List all available frozen demonstration scenarios."""
    return replay.get_available_scenarios()


@router.post("/load-scenario")
async def load_replay_scenario(
    payload: LoadScenarioRequest,
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> Dict[str, Any]:
    """Load a specific demonstration scenario from the registry."""
    success = replay.load_scenario(payload.scenario_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{payload.scenario_id}' could not be loaded.",
        )
    return {
        "status": "success",
        "loaded_scenario_id": payload.scenario_id,
        "total_observations": len(replay.observations),
        "current_index": replay.current_index,
    }


@router.post("/step")
async def step_replay_simulation(
    count: int = 1,
    replay: StreamReplayEngine = Depends(get_replay_engine),
    engine: RealTimeProcessingEngine = Depends(get_engine),
) -> Dict[str, Any]:
    """Step the replay simulation forward by N observations."""
    if not replay.observations:
        raise HTTPException(
            status_code=400,
            detail="No historical observations loaded in replay engine.",
        )

    results = replay.step(engine=engine, count=count)
    return {
        "mode": "DEMO REPLAY",
        "steps_executed": len(results),
        "current_index": replay.current_index,
        "total_emitted": replay.emitted_count,
        "results_summary": [
            {
                "station_id": r.observation.station_id,
                "timestamp": r.observation.timestamp.isoformat(),
                "status": r.status.value,
                "decision": r.hybrid_decision.decision.value if r.hybrid_decision else None,
                "event_id": r.event_id,
            }
            for r in results
        ],
    }


class SetSpeedRequest(BaseModel):
    speed: float


@router.post("/speed")
async def set_replay_speed(
    payload: SetSpeedRequest,
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> Dict[str, Any]:
    """Dynamically adjust stream replay speed (1x, 10x, 60x, 300x)."""
    new_speed = replay.set_speed(payload.speed)
    return {
        "status": "success",
        "speed_multiplier": new_speed,
        "is_running": replay.is_running,
    }


@router.post("/start")
async def start_replay_simulation(
    replay: StreamReplayEngine = Depends(get_replay_engine),
    engine: RealTimeProcessingEngine = Depends(get_engine),
    ctx_mgr: RunContextManager = Depends(get_run_context_manager),
) -> Dict[str, Any]:
    """Start or resume continuous asynchronous replay stream."""
    await replay.start(engine=engine, ctx_mgr=ctx_mgr)
    return {
        "status": "RUNNING",
        "is_running": True,
        "speed_multiplier": replay.speed_multiplier,
        "current_index": replay.current_index,
        "total_observations": len(replay.observations),
    }


@router.post("/pause")
async def pause_replay_simulation(
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> Dict[str, Any]:
    """Pause continuous asynchronous replay stream."""
    await replay.pause()
    return {
        "status": "PAUSED",
        "is_running": False,
        "current_index": replay.current_index,
    }


@router.post("/reset")
async def reset_replay_simulation(
    replay: StreamReplayEngine = Depends(get_replay_engine),
) -> Dict[str, Any]:
    """Reset transient demo simulation state without destructive database operations."""
    return replay.reset(preserve_db=True)

