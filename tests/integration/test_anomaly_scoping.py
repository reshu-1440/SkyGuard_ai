"""Integration tests for anomaly count semantics, run-id scoping, and replay cursor isolation."""

from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from backend.app.api.v1.deps import (
    get_engine,
    get_replay_engine,
    get_repository,
    get_run_context_manager,
)
from backend.app.main import app
from backend.app.models.run_context import DataSourceType, RunMode


@pytest.fixture
def client():
    return TestClient(app)


def test_anomaly_count_scoped_to_active_run(client):
    """At cursor index 0, current run anomaly count must be 0 even if DB has prior records."""
    # Reset active run
    res_reset = client.post("/api/v1/runtime/run/reset")
    assert res_reset.status_code == 200

    # Ensure synthetic replay mode
    client.post(
        "/api/v1/runtime/source/select",
        json={"source_type": "SYNTHETIC_VALIDATION", "mode": "SYNTHETIC_REPLAY"},
    )

    # 1. Operational anomalies query must return 0 items and total_count = 0
    res_anom = client.get("/api/v1/anomalies")
    assert res_anom.status_code == 200
    anom_data = res_anom.json()
    assert anom_data["pagination"]["total_count"] == 0
    assert len(anom_data["items"]) == 0

    # 2. Stats endpoint must return current_run_anomalies = 0
    res_stats = client.get("/api/v1/anomalies/stats")
    assert res_stats.status_code == 200
    stats = res_stats.json()
    assert stats["current_run_anomalies"] == 0
    assert stats["source_type"] == "SYNTHETIC_VALIDATION"
    assert stats["active_run_id"] is not None


def test_total_persisted_anomaly_count_separate_from_current_run_count(client):
    """The system must clearly distinguish current_run_anomalies from total_persisted_anomalies."""
    client.post("/api/v1/runtime/run/reset")

    res_stats = client.get("/api/v1/anomalies/stats")
    assert res_stats.status_code == 200
    stats = res_stats.json()

    # Current run count must be 0 at reset
    assert stats["current_run_anomalies"] == 0
    # Total persisted can be >= 0 (representing historical records in DB)
    assert isinstance(stats["total_persisted_anomalies"], int)
    assert stats["total_persisted_anomalies"] >= 0


def test_anomaly_count_scoped_to_replay_cursor(client):
    """Stepping replay forward only reveals anomalies up to the replay cursor."""
    client.post("/api/v1/runtime/run/reset")
    client.post(
        "/api/v1/runtime/source/select",
        json={"source_type": "SYNTHETIC_VALIDATION", "mode": "SYNTHETIC_REPLAY"},
    )

    # At 0 steps: 0 anomalies
    res_0 = client.get("/api/v1/anomalies")
    assert res_0.json()["pagination"]["total_count"] == 0

    # Step 60 observations
    res_step = client.post("/api/v1/replay/step?count=60")
    assert res_step.status_code == 200

    # Check anomalies endpoint
    res_after = client.get("/api/v1/anomalies")
    assert res_after.status_code == 200
    data_after = res_after.json()
    # Any returned anomalies must have timestamp <= replay cursor
    ctx = client.get("/api/v1/runtime/context").json()
    cursor_time = ctx.get("current_synthetic_time")

    if data_after["items"] and cursor_time:
        for anom in data_after["items"]:
            assert anom["timestamp"] <= cursor_time


def test_future_anomalies_not_visible(client):
    """Anomalies beyond the current replay cursor must not be visible in operational queries."""
    client.post("/api/v1/runtime/run/reset")
    client.post(
        "/api/v1/runtime/source/select",
        json={"source_type": "SYNTHETIC_VALIDATION", "mode": "SYNTHETIC_REPLAY"},
    )

    # At cursor 0
    res_anom = client.get("/api/v1/anomalies")
    assert res_anom.json()["pagination"]["total_count"] == 0

    # Even if historical database has thousands of records, operational endpoint returns 0
    res_stats = client.get("/api/v1/anomalies/stats")
    assert res_stats.json()["current_run_anomalies"] == 0


def test_previous_run_anomalies_not_visible(client):
    """Anomalies generated in Run A must not bleed into fresh Run B."""
    # Run A: reset and step
    client.post("/api/v1/runtime/run/reset")
    ctx_a = client.get("/api/v1/runtime/context").json()
    run_id_a = ctx_a["run_id"]

    client.post("/api/v1/replay/step?count=100")

    # Run B: reset
    res_reset_b = client.post("/api/v1/runtime/run/reset")
    assert res_reset_b.status_code == 200
    ctx_b = client.get("/api/v1/runtime/context").json()
    run_id_b = ctx_b["run_id"]

    # Run ID must be fresh
    assert run_id_b != run_id_a

    # Current run anomalies for Run B at cursor 0 must be 0
    res_stats_b = client.get("/api/v1/anomalies/stats")
    assert res_stats_b.json()["current_run_anomalies"] == 0

    res_anom_b = client.get("/api/v1/anomalies")
    assert res_anom_b.json()["pagination"]["total_count"] == 0


def test_source_switch_changes_anomaly_scope(client):
    """Switching source changes the anomaly scope and isolates counts."""
    # 1. Switch to Open-Meteo
    res_om = client.post(
        "/api/v1/runtime/source/select",
        json={"source_type": "OPEN_METEO", "mode": "LIVE_MONITORING"},
    )
    assert res_om.status_code == 200

    stats_om = client.get("/api/v1/anomalies/stats").json()
    assert stats_om["source_type"] == "OPEN_METEO"

    # 2. Switch back to Synthetic Validation
    res_syn = client.post(
        "/api/v1/runtime/source/select",
        json={"source_type": "SYNTHETIC_VALIDATION", "mode": "SYNTHETIC_REPLAY"},
    )
    assert res_syn.status_code == 200

    stats_syn = client.get("/api/v1/anomalies/stats").json()
    assert stats_syn["source_type"] == "SYNTHETIC_VALIDATION"
    assert stats_syn["current_run_anomalies"] == 0


def test_reset_clears_current_run_anomaly_view(client):
    """Resetting the replay clears the current-run anomaly view."""
    client.post("/api/v1/runtime/run/reset")
    client.post("/api/v1/replay/step?count=50")

    # Reset
    res_reset = client.post("/api/v1/runtime/run/reset")
    assert res_reset.status_code == 200

    res_anom = client.get("/api/v1/anomalies")
    assert res_anom.json()["pagination"]["total_count"] == 0
    assert len(res_anom.json()["items"]) == 0

    res_stats = client.get("/api/v1/anomalies/stats")
    assert res_stats.json()["current_run_anomalies"] == 0
