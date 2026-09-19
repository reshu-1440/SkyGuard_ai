"""Unit and integration tests for Sensor Health Index data flow, run scoping, and cursor boundaries."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient

from backend.app.core.database import DatabaseRepository
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.replay import StreamReplayEngine
from backend.app.core.state import RunContextManager
from backend.app.main import app
from backend.app.models.observation import ObservationSource, QualityStatus, WeatherObservation
from backend.app.models.run_context import RunContext, RunMode, RunStatus
from ml.decision.schema import HybridDecision, HybridDecisionType
from ml.health.health_schema import HealthStatusBand, SensorHealthSummary
from ml.spatial.topology import StationNode


def _create_observation(
    station_id: str,
    timestamp: datetime,
    temp: float = 25.0,
    source: ObservationSource = ObservationSource.SYNTHETIC_VALIDATION,
) -> WeatherObservation:
    return WeatherObservation(
        station_id=station_id,
        timestamp=timestamp,
        latitude=28.61,
        longitude=77.23,
        elevation=215.0,
        temperature=temp,
        humidity=60.0,
        pressure=1013.25,
        dew_point_c=16.0,
        source=source,
        data_quality_status=QualityStatus.VALID,
    )


def test_health_insufficient_history_when_under_12():
    """Test A: Station with N < 12 observations returns INSUFFICIENT_HISTORY and overall_health_score=None."""
    repo = DatabaseRepository(auto_init_db=True)
    stn_id = "DEL001"
    repo.topology.add_station(StationNode(station_id=stn_id, name="Delhi North", latitude=28.61, longitude=77.23, elevation_m=215.0))
    engine = RealTimeProcessingEngine(repository=repo)
    base_time = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)

    # Ingest 11 observations (< 12)
    for i in range(11):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-TEST-A")

    # Query health from repository
    health = repo.get_station_health(stn_id, run_id="RUN-TEST-A")
    assert health is not None
    assert health.overall_health_score is None
    assert health.status_band == HealthStatusBand.INSUFFICIENT_HISTORY
    assert health.observation_count == 11
    assert health.required_observation_count == 12

    # Verify latest snapshot on repository also shows INSUFFICIENT_HISTORY and score=None
    snapshot = repo.get_station_latest(stn_id, run_id="RUN-TEST-A")
    assert snapshot is not None
    assert snapshot.latest_health_score is None
    assert snapshot.latest_health_band == "INSUFFICIENT_HISTORY"


def test_health_activation_at_12_observations():
    """Test B: Station transitioning from 11 to 12 observations activates numeric score calculation."""
    repo = DatabaseRepository(auto_init_db=True)
    stn_id = "DEL001"
    repo.topology.add_station(StationNode(station_id=stn_id, name="Delhi North", latitude=28.61, longitude=77.23, elevation_m=215.0))
    engine = RealTimeProcessingEngine(repository=repo)
    base_time = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)

    # Ingest 11 observations
    for i in range(11):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-TEST-B")

    h11 = repo.get_station_health(stn_id, run_id="RUN-TEST-B")
    assert h11.overall_health_score is None
    assert h11.status_band == HealthStatusBand.INSUFFICIENT_HISTORY

    # Ingest 12th observation
    obs12 = _create_observation(stn_id, base_time + timedelta(minutes=55))
    engine.process_observation(obs12, run_id="RUN-TEST-B")

    h12 = repo.get_station_health(stn_id, run_id="RUN-TEST-B")
    assert h12 is not None
    assert h12.overall_health_score is not None
    assert 0.0 <= h12.overall_health_score <= 100.0
    assert h12.status_band != HealthStatusBand.INSUFFICIENT_HISTORY
    assert h12.status_band in (HealthStatusBand.HEALTHY, HealthStatusBand.ATTENTION, HealthStatusBand.DEGRADED, HealthStatusBand.CRITICAL)
    assert h12.observation_count == 12
    assert h12.component_scores is not None
    assert h12.parameter_health is not None

    # Latest snapshot reflects calculated score
    snapshot = repo.get_station_latest(stn_id, run_id="RUN-TEST-B")
    assert snapshot.latest_health_score == h12.overall_health_score
    assert snapshot.latest_health_band == h12.status_band.value


def test_endpoint_returns_200_for_insufficient_history():
    """Test API endpoint /stations/{id}/health returns 200 with INSUFFICIENT_HISTORY rather than 404."""
    client = TestClient(app)
    from backend.app.api.v1.deps import get_repository
    repo = get_repository()
    stn_id = next(iter(repo.topology.stations.keys()))

    response = client.get(f"/api/v1/stations/{stn_id}/health")
    assert response.status_code == 200
    data = response.json()
    assert data["station_id"] == stn_id
    assert data["status_band"] == "INSUFFICIENT_HISTORY"
    assert data["overall_health_score"] is None
    assert data["observation_count"] == 0

    # Non-existent station should return 404
    bad_res = client.get("/api/v1/stations/NON_EXISTENT_999/health")
    assert bad_res.status_code == 404


def test_run_scoped_health_isolation():
    """Test D: Snapshots and health calculations are isolated by run_id."""
    repo = DatabaseRepository(auto_init_db=True)
    stn_id = "DEL001"
    repo.topology.add_station(StationNode(station_id=stn_id, name="Delhi North", latitude=28.61, longitude=77.23, elevation_m=215.0))
    engine = RealTimeProcessingEngine(repository=repo)
    base_time = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)

    # Ingest 15 observations in RUN-ALPHA
    for i in range(15):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-ALPHA")

    # Ingest 3 observations in RUN-BETA
    for i in range(3):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-BETA")

    # Query RUN-ALPHA: should have sufficient history
    h_alpha = repo.get_station_health(stn_id, run_id="RUN-ALPHA")
    assert h_alpha.overall_health_score is not None
    assert h_alpha.status_band != HealthStatusBand.INSUFFICIENT_HISTORY

    # Query RUN-BETA: should have insufficient history
    h_beta = repo.get_station_health(stn_id, run_id="RUN-BETA")
    assert h_beta.overall_health_score is None
    assert h_beta.status_band == HealthStatusBand.INSUFFICIENT_HISTORY
    assert h_beta.observation_count == 3


def test_replay_cursor_bounded_evaluation():
    """Test E: Health evaluated with max_timestamp only considers observations up to cursor."""
    repo = DatabaseRepository(auto_init_db=True)
    stn_id = "DEL001"
    repo.topology.add_station(StationNode(station_id=stn_id, name="Delhi North", latitude=28.61, longitude=77.23, elevation_m=215.0))
    engine = RealTimeProcessingEngine(repository=repo)
    base_time = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)

    # Ingest 20 observations
    for i in range(20):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-CURSOR")

    # Cursor at i = 5 (30 minutes in) -> only 6 observations
    cursor_early = base_time + timedelta(minutes=25)
    h_early = repo.get_station_health(stn_id, run_id="RUN-CURSOR", max_timestamp=cursor_early)
    assert h_early.overall_health_score is None
    assert h_early.status_band == HealthStatusBand.INSUFFICIENT_HISTORY

    # Cursor at i = 19 (end) -> 20 observations
    cursor_late = base_time + timedelta(minutes=95)
    h_late = repo.get_station_health(stn_id, run_id="RUN-CURSOR", max_timestamp=cursor_late)
    assert h_late.overall_health_score is not None
    assert h_late.status_band != HealthStatusBand.INSUFFICIENT_HISTORY


def test_station_sidebar_parity():
    """Test G: Sidebar snapshot health score exactly matches get_station_health score."""
    repo = DatabaseRepository(auto_init_db=True)
    stn_id = "DEL002"
    repo.topology.add_station(StationNode(station_id=stn_id, name="Delhi South", latitude=28.50, longitude=77.20, elevation_m=210.0))
    engine = RealTimeProcessingEngine(repository=repo)
    base_time = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)

    # Case 1: Insufficient history
    for i in range(5):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-PARITY")

    snap1 = repo.get_station_latest(stn_id, run_id="RUN-PARITY")
    health1 = repo.get_station_health(stn_id, run_id="RUN-PARITY")
    assert snap1.latest_health_score == health1.overall_health_score
    assert snap1.latest_health_score is None

    # Case 2: Sufficient history
    for i in range(5, 15):
        obs = _create_observation(stn_id, base_time + timedelta(minutes=5 * i))
        engine.process_observation(obs, run_id="RUN-PARITY")

    snap2 = repo.get_station_latest(stn_id, run_id="RUN-PARITY")
    health2 = repo.get_station_health(stn_id, run_id="RUN-PARITY")
    assert snap2.latest_health_score == health2.overall_health_score
    assert snap2.latest_health_score is not None
    assert snap2.latest_health_band == health2.status_band.value
