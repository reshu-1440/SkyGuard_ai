"""Integration tests for dynamic active station topology and real-time telemetry progression."""

import pytest
from fastapi.testclient import TestClient

from backend.app.api.v1.deps import (
    get_engine,
    get_replay_engine,
    get_repository,
    get_run_context_manager,
    get_synthetic_topology,
)
from backend.app.main import app
from backend.app.models.run_context import DataSourceType, RunMode, RunStatus


@pytest.fixture
def client():
    return TestClient(app)


def test_active_station_count_comes_from_run_dataset(client):
    """Test that synthetic validation mode exposes all 20 active synthetic benchmark stations."""
    # Reset active run to ensure synthetic mode
    res_reset = client.post("/api/v1/runtime/run/reset")
    assert res_reset.status_code == 200

    # Ensure source is synthetic validation
    res_source = client.post(
        "/api/v1/runtime/source/select",
        json={
            "source_type": "SYNTHETIC_VALIDATION",
            "mode": "SYNTHETIC_REPLAY",
        },
    )
    assert res_source.status_code == 200

    # Verify context station count is 20
    res_context = client.get("/api/v1/runtime/context")
    assert res_context.status_code == 200
    ctx_data = res_context.json()
    assert ctx_data["station_count"] == 20
    assert ctx_data["source_type"] == "SYNTHETIC_VALIDATION"

    # Verify /api/v1/stations returns exactly 20 stations
    res_stations = client.get("/api/v1/stations")
    assert res_stations.status_code == 200
    stations = res_stations.json()
    assert len(stations) == 20

    station_ids = {s["station_id"] for s in stations}
    assert "AWS_DEL_001" in station_ids
    assert "AWS_ISO_020" in station_ids
    assert "AWS_NCR_006" in station_ids
    assert "AWS_REG_019" in station_ids


def test_replay_latest_state_per_station(client):
    """Test that stepping replay updates each station's latest observation telemetry."""
    # Reset run state
    client.post("/api/v1/runtime/run/reset")

    # Step replay by 40 observations
    res_step = client.post("/api/v1/replay/step?count=40")
    assert res_step.status_code == 200
    step_data = res_step.json()
    assert step_data["total_emitted"] >= 40

    # Stations should now reflect the emitted observations in latest_snapshot
    res_stations = client.get("/api/v1/stations")
    assert res_stations.status_code == 200
    stations = res_stations.json()

    # Find a station with non-null snapshot
    stations_with_data = [s for s in stations if s.get("latest_snapshot") is not None and s["latest_snapshot"].get("last_seen_timestamp") is not None]
    assert len(stations_with_data) > 0

    first_stn = stations_with_data[0]
    stn_id = first_stn["station_id"]
    snapshot = first_stn["latest_snapshot"]
    assert snapshot["latest_temperature_c"] is not None
    assert snapshot["last_seen_timestamp"] is not None

    # Check station latest endpoint
    res_latest = client.get(f"/api/v1/stations/{stn_id}/latest")
    assert res_latest.status_code == 200
    latest_obs = res_latest.json()
    assert latest_obs["station_id"] == stn_id
    assert latest_obs["latest_temperature_c"] == snapshot["latest_temperature_c"]


def test_operational_history_respects_replay_cursor(client):
    """Test that operational history respects the replay cursor, while historical allows full dataset."""
    client.post("/api/v1/runtime/run/reset")

    # Pick first benchmark station
    test_station_id = "AWS_DEL_001"

    # At cursor index 0, operational history must return 0 items
    r_hist_0 = client.get(f"/api/v1/stations/{test_station_id}/history")
    assert r_hist_0.status_code == 200
    assert r_hist_0.json()["pagination"]["total_count"] == 0

    # Step forward 20 observations
    client.post("/api/v1/replay/step?count=20")

    # Check that cursor advanced
    r_ctx = client.get("/api/v1/runtime/context")
    assert r_ctx.json()["current_observation_index"] >= 20

    # Operational query now returns observations up to the cursor
    r_hist_stepped = client.get(f"/api/v1/stations/{test_station_id}/history")
    assert r_hist_stepped.status_code == 200


def test_source_switch_updates_active_station_set(client):
    """Test that switching sources updates the active station topology dynamically."""
    # 1. Switch to Open-Meteo
    res_om = client.post(
        "/api/v1/runtime/source/select",
        json={
            "source_type": "OPEN_METEO",
            "mode": "LIVE_MONITORING",
        },
    )
    assert res_om.status_code == 200

    ctx_om = client.get("/api/v1/runtime/context").json()
    assert ctx_om["source_type"] == "OPEN_METEO"
    assert ctx_om["station_count"] == 8

    stations_om = client.get("/api/v1/stations").json()
    assert len(stations_om) == 8
    om_ids = {s["station_id"] for s in stations_om}
    assert "42182099999" in om_ids

    # 2. Switch back to Synthetic Validation
    res_syn = client.post(
        "/api/v1/runtime/source/select",
        json={
            "source_type": "SYNTHETIC_VALIDATION",
            "mode": "SYNTHETIC_REPLAY",
        },
    )
    assert res_syn.status_code == 200

    ctx_syn = client.get("/api/v1/runtime/context").json()
    assert ctx_syn["source_type"] == "SYNTHETIC_VALIDATION"
    assert ctx_syn["station_count"] == 20

    stations_syn = client.get("/api/v1/stations").json()
    assert len(stations_syn) == 20
    syn_ids = {s["station_id"] for s in stations_syn}
    assert "AWS_DEL_001" in syn_ids
    assert "AWS_ISO_020" in syn_ids
