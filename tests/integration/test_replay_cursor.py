"""Integration tests for progressive replay cursor enforcement and historical isolation."""

from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from backend.app.api.v1.deps import get_engine, get_replay_engine, get_repository, get_run_context_manager
from backend.app.main import app
from backend.app.models.run_context import DataSourceType, RunMode, RunStatus


@pytest.fixture
def client():
    return TestClient(app)


def test_replay_cursor_progressive_telemetry(client):
    """Test that operational endpoints enforce replay cursor while historical allows full dataset."""
    ctx_mgr = get_run_context_manager()
    replay = get_replay_engine()
    repo = get_repository()
    engine = get_engine()

    # 1. Reset run state to 0
    res_reset = client.post("/api/v1/runtime/run/reset")
    assert res_reset.status_code == 200
    assert ctx_mgr.get_context().current_observation_index == 0

    # Ensure synthetic replay mode is active
    ctx_mgr.update_context(
        mode=RunMode.SYNTHETIC_REPLAY,
        source_type=DataSourceType.SYNTHETIC_VALIDATION,
        status=RunStatus.IDLE,
        current_observation_index=0,
        current_synthetic_time=None,
    )
    replay.reset(preserve_db=True)
    repo.clear_run_cache()

    # Test station ID (e.g. 42182099999 Safdarjung or first station in benchmark)
    test_station_id = replay.observations[0].station_id if replay.observations else "42182099999"

    # 2. At cursor index 0, operational history must return 0 items
    r_hist_0 = client.get(f"/api/v1/stations/{test_station_id}/history")
    assert r_hist_0.status_code == 200
    data_0 = r_hist_0.json()
    assert data_0["pagination"]["total_count"] == 0
    assert len(data_0["items"]) == 0

    # Operational anomalies must return 0 items at cursor 0
    r_anom_0 = client.get("/api/v1/anomalies")
    assert r_anom_0.status_code == 200
    assert r_anom_0.json()["pagination"]["total_count"] == 0

    # 3. But with historical=true, full historical/persisted dataset is accessible
    r_hist_full = client.get(f"/api/v1/stations/{test_station_id}/history?historical=true")
    assert r_hist_full.status_code == 200
    # Historical query does not get blocked by cursor = 0

    # 4. Step replay forward by 5 observations
    results = replay.step(engine=engine, count=5)
    assert len(results) == 5
    assert replay.current_index == 5
    last_obs = results[-1].observation
    last_ts_iso = last_obs.timestamp.astimezone(timezone.utc).isoformat()
    ctx_mgr.update_context(
        current_observation_index=replay.current_index,
        current_synthetic_time=last_ts_iso,
        status=RunStatus.RUNNING,
    )

    # 5. Now operational endpoints must only return observations up to index 5
    r_hist_5 = client.get(f"/api/v1/stations/{last_obs.station_id}/history")
    assert r_hist_5.status_code == 200
    data_5 = r_hist_5.json()
    for item in data_5["items"]:
        item_ts = datetime.fromisoformat(item["timestamp"]).astimezone(timezone.utc)
        assert item_ts <= last_obs.timestamp.astimezone(timezone.utc)

    # 6. Test Reset: when reset is triggered, cursor returns to 0 and operational views reset
    r_reset2 = client.post("/api/v1/runtime/run/reset")
    assert r_reset2.status_code == 200
    assert r_reset2.json()["current_observation_index"] == 0

    r_hist_after_reset = client.get(f"/api/v1/stations/{test_station_id}/history")
    assert r_hist_after_reset.status_code == 200
    assert r_hist_after_reset.json()["pagination"]["total_count"] == 0
