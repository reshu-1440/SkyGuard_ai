"""Comprehensive Unit Tests for Phase 11B Live Weather Source Connector & Poller.

Tests Scenarios A through V:
A. successful live fetch
B. multiple stations
C. station-specific failure isolation
D. timeout
E. HTTP 500 error
F. HTTP 429 rate limit
G. HTTP 401 authentication failure
H. malformed JSON
I. missing required field
J. invalid timestamp
K. stale observation
L. duplicate observation
M. out-of-order observation
N. retry with exponential backoff
O. bounded retry exhaustion
P. rate-limit handling & metrics
Q. authentication failure with secret protection
R. graceful shutdown
S. source-health transitions
T. real-time engine integration
U. WebSocket propagation
V. multi-station isolation
"""

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from typing import Any, Dict, List, Optional
import pytest
from unittest.mock import AsyncMock, MagicMock, patch



from backend.app.connectors.live_qualification import (
    LiveSourceHealthStatus,
    LiveSourceQualificationGate,
    OpenMeteoQualificationAdapter,
    PressureSemantics,
)
from backend.app.connectors.weather_api import OpenMeteoLiveConnector
from backend.app.core.database import DatabaseRepository
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.ws_manager import WebSocketConnectionManager
from backend.app.ingestion.live_poller import LiveSourcePoller
from backend.app.models.events import EventType
from backend.app.models.observation import ObservationSource, QualityStatus, WeatherObservation
from ml.spatial.topology import SpatialNetworkTopology, StationNode

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "data" / "external" / "live_api"


def load_fixture(filename: str) -> Dict[str, Any]:
    with open(FIXTURES_DIR / filename, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def mock_topology() -> SpatialNetworkTopology:
    topo = SpatialNetworkTopology()
    topo.add_station(StationNode(
        station_id="AWS_DELHI_001",
        name="New Delhi Safdarjung",
        latitude=28.585,
        longitude=77.206,
        elevation_m=216.0,
        state="Delhi",
    ))
    topo.add_station(StationNode(
        station_id="AWS_MUMBAI_002",
        name="Mumbai Santacruz",
        latitude=19.117,
        longitude=72.850,
        elevation_m=14.0,
        state="Maharashtra",
    ))
    topo.add_station(StationNode(
        station_id="AWS_PUNE_003",
        name="Pune Central",
        latitude=18.533,
        longitude=73.850,
        elevation_m=560.0,
        state="Maharashtra",
    ))
    return topo


# A. Successful live fetch
def test_scenario_a_successful_fetch():
    fixture_data = load_fixture("01_valid_observation.json")
    
    def fake_fetcher(url: str, timeout: float):
        return 200, fixture_data

    connector = OpenMeteoLiveConnector(http_fetcher=fake_fetcher, retry_limit=0)
    obs = connector.fetch_station_observation(
        station_id="AWS_DELHI_001",
        latitude=28.585,
        longitude=77.206,
        elevation=216.0,
        station_name="New Delhi Safdarjung",
    )

    assert obs is not None
    assert obs.station_id == "AWS_DELHI_001"
    assert obs.temperature == 28.4
    assert obs.humidity == 62.0
    assert obs.pressure == 1012.3
    assert obs.station_pressure_hpa == 988.5
    assert obs.source == ObservationSource.OPEN_METEO
    assert connector.health.is_reachable is True
    assert connector.health.consecutive_failures == 0
    assert connector.health.last_response_latency_ms is not None


# B. Multiple stations concurrent polling
@pytest.mark.anyio
async def test_scenario_b_multiple_stations_polling(mock_topology):
    fixture_data = load_fixture("01_valid_observation.json")
    
    def fake_fetcher(url: str, timeout: float):
        return 200, fixture_data

    connector = OpenMeteoLiveConnector(http_fetcher=fake_fetcher, retry_limit=0)
    repo = DatabaseRepository(topology=mock_topology)
    engine = RealTimeProcessingEngine(repository=repo)
    poller = LiveSourcePoller(
        connector=connector,
        engine=engine,
        repository=repo,
        topology=mock_topology,
    )

    results = await poller.poll_cycle_once()
    assert len(results) == 3
    assert all(r is not None for r in results)
    assert poller.metrics["requests_total"] == 3
    assert poller.metrics["requests_success"] == 3
    assert poller.metrics["observations_ingested"] == 3


# C & V. Station-specific failure isolation & multi-station isolation
@pytest.mark.anyio
async def test_scenario_c_and_v_station_failure_isolation(mock_topology):
    fixture_data = load_fixture("01_valid_observation.json")

    def selective_fetcher(url: str, timeout: float):
        # Fail Mumbai, pass Delhi and Pune
        if "72.85" in url:
            return 500, {"error": True, "reason": "Mumbai sensor gateway down"}
        return 200, fixture_data

    connector = OpenMeteoLiveConnector(http_fetcher=selective_fetcher, retry_limit=0)
    repo = DatabaseRepository(topology=mock_topology)
    engine = RealTimeProcessingEngine(repository=repo)
    poller = LiveSourcePoller(
        connector=connector,
        engine=engine,
        repository=repo,
        topology=mock_topology,
        stale_threshold_seconds=1000000.0,
    )

    results = await poller.poll_cycle_once()
    assert len(results) == 3
    success_count = sum(1 for r in results if r is not None)
    fail_count = sum(1 for r in results if r is None)
    assert success_count == 2
    assert fail_count == 1

    # Verify per-station freshness reflects isolated states
    delhi_freshness = poller.station_freshness["AWS_DELHI_001"]
    mumbai_freshness = poller.station_freshness["AWS_MUMBAI_002"]
    assert delhi_freshness["status"] == "LIVE"
    assert mumbai_freshness["status"] == "DISCONNECTED"


# D. Timeout handling
def test_scenario_d_timeout_handling():
    def timeout_fetcher(url: str, timeout: float):
        raise TimeoutError("Connection timed out after 10.0s")

    connector = OpenMeteoLiveConnector(http_fetcher=timeout_fetcher, retry_limit=1, retry_backoff_base_seconds=0.01)
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert connector.health.consecutive_failures == 1
    assert "timeout" in connector.health.last_error_message.lower()


# E & N. HTTP 500 and exponential backoff retry
def test_scenario_e_and_n_http_500_and_retry():
    calls = []

    def failing_then_recovering_fetcher(url: str, timeout: float):
        calls.append(time.perf_counter())
        if len(calls) < 2:
            return 500, {"error": True, "reason": "Temporary backend blip"}
        return 200, load_fixture("01_valid_observation.json")

    connector = OpenMeteoLiveConnector(
        http_fetcher=failing_then_recovering_fetcher,
        retry_limit=2,
        retry_backoff_base_seconds=0.05,
    )
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is not None
    assert len(calls) == 2
    assert connector.health.consecutive_failures == 0


# F & P. HTTP 429 rate-limit handling & metrics
def test_scenario_f_and_p_rate_limiting():
    def rate_limit_fetcher(url: str, timeout: float):
        return 429, {"error": True, "reason": "Hourly quota exceeded"}

    connector = OpenMeteoLiveConnector(http_fetcher=rate_limit_fetcher, retry_limit=2)
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert connector.health.rate_limit_remaining == 0
    assert "Rate limit exceeded" in connector.health.last_error_message


# G & Q. HTTP 401 auth failure & secret protection
def test_scenario_g_and_q_auth_failure_secret_protection():
    secret_key = "super_secret_token_12345"

    def auth_fail_fetcher(url: str, timeout: float):
        return 401, {"error": True, "reason": "Invalid API key"}

    connector = OpenMeteoLiveConnector(
        api_key=secret_key,
        http_fetcher=auth_fail_fetcher,
        retry_limit=2,
    )
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert connector.health.authentication_status == "INVALID_CREDENTIALS"
    # Verify raw secret is never present in health error message
    assert secret_key not in (connector.health.last_error_message or "")


# H. Malformed JSON
def test_scenario_h_malformed_json():
    def broken_json_fetcher(url: str, timeout: float):
        raise ValueError("Malformed JSON: Unterminated string at line 1")

    connector = OpenMeteoLiveConnector(http_fetcher=broken_json_fetcher, retry_limit=0)
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert connector.health.malformed_response_count == 1


# I. Missing required field (missing coordinates)
def test_scenario_i_missing_required_coordinates():
    def bad_field_fetcher(url: str, timeout: float):
        return 200, load_fixture("18_provider_field_missing.json")

    connector = OpenMeteoLiveConnector(http_fetcher=bad_field_fetcher, retry_limit=0)
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert connector.health.malformed_response_count == 1


# J. Invalid timestamp
def test_scenario_j_invalid_timestamp():
    def bad_ts_fetcher(url: str, timeout: float):
        return 200, load_fixture("07_malformed_timestamp.json")

    connector = OpenMeteoLiveConnector(http_fetcher=bad_ts_fetcher, retry_limit=0)
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert connector.health.malformed_response_count == 1


# K. Stale observation detection
@pytest.mark.anyio
async def test_scenario_k_stale_observation_detection(mock_topology):
    # Stale observation fixture has observation time from 3 hours ago
    stale_fixture = load_fixture("20_stale_observation.json")

    def stale_fetcher(url: str, timeout: float):
        return 200, stale_fixture

    connector = OpenMeteoLiveConnector(http_fetcher=stale_fetcher, retry_limit=0)
    repo = DatabaseRepository(topology=mock_topology)
    engine = RealTimeProcessingEngine(repository=repo)
    poller = LiveSourcePoller(
        connector=connector,
        engine=engine,
        repository=repo,
        topology=mock_topology,
        stale_threshold_seconds=1800.0,  # 30 min threshold
    )

    results = await poller.poll_cycle_once()
    assert poller.metrics["stale_observations"] > 0
    freshness = poller.station_freshness["AWS_DELHI_001"]
    assert freshness["is_stale"] is True
    assert freshness["status"] == "STALE"


# L. Duplicate observation handling
@pytest.mark.anyio
async def test_scenario_l_duplicate_observation_handling(mock_topology):
    fixture_data = load_fixture("01_valid_observation.json")

    def repeat_fetcher(url: str, timeout: float):
        return 200, fixture_data

    connector = OpenMeteoLiveConnector(http_fetcher=repeat_fetcher, retry_limit=0)
    repo = DatabaseRepository(topology=mock_topology)
    engine = RealTimeProcessingEngine(repository=repo)
    poller = LiveSourcePoller(
        connector=connector,
        engine=engine,
        repository=repo,
        topology=mock_topology,
    )

    # First cycle -> ingested
    await poller.poll_cycle_once()
    assert poller.metrics["observations_ingested"] == 3
    assert poller.metrics["duplicate_observations"] == 0

    # Second cycle with same timestamp -> duplicate skipped by engine
    await poller.poll_cycle_once()
    assert poller.metrics["duplicate_observations"] == 3


# M. Out-of-order observation tolerance
def test_scenario_m_out_of_order_tolerance():
    fixture_data = load_fixture("11_out_of_order_observation.json")
    adapter = OpenMeteoQualificationAdapter()
    obs_list = adapter.normalize(fixture_data, station_id="AWS_DELHI_001")

    assert len(obs_list) == 3
    assert obs_list[0].timestamp == datetime(2026, 9, 17, 5, 0, 0, tzinfo=timezone.utc)
    assert obs_list[1].timestamp == datetime(2026, 9, 17, 3, 0, 0, tzinfo=timezone.utc)
    assert obs_list[2].timestamp == datetime(2026, 9, 17, 4, 0, 0, tzinfo=timezone.utc)


# O. Bounded retry exhaustion
def test_scenario_o_retry_exhaustion():
    attempts = 0

    def always_500_fetcher(url: str, timeout: float):
        nonlocal attempts
        attempts += 1
        return 500, {"error": True, "reason": "Persistent outage"}

    connector = OpenMeteoLiveConnector(
        http_fetcher=always_500_fetcher,
        retry_limit=3,
        retry_backoff_base_seconds=0.01,
    )
    obs = connector.fetch_station_observation("AWS_DELHI_001", 28.585, 77.206)

    assert obs is None
    assert attempts == 4  # Initial + 3 retries
    assert connector.health.consecutive_failures == 1


# R. Graceful shutdown
@pytest.mark.anyio
async def test_scenario_r_graceful_shutdown(mock_topology):
    poller = LiveSourcePoller(topology=mock_topology, poll_interval_seconds=10)
    await poller.start()
    assert poller.is_running is True

    await poller.stop()
    assert poller.is_running is False


# S. Source-health transitions
def test_scenario_s_source_health_transitions():
    health = LiveSourceHealthStatus(provider="open_meteo")
    assert health.is_reachable is True

    # 1 failure -> still reachable
    health.record_failure("error 1")
    assert health.consecutive_failures == 1
    assert health.is_reachable is True

    # 2 failures
    health.record_failure("error 2")
    assert health.consecutive_failures == 2
    assert health.is_reachable is True

    # 3 failures -> unreachable
    health.record_failure("error 3")
    assert health.consecutive_failures == 3
    assert health.is_reachable is False

    # Success -> recovers to reachable
    health.record_success(latency_ms=45.0)
    assert health.consecutive_failures == 0
    assert health.is_reachable is True
    assert health.last_response_latency_ms == 45.0


# T & U. Real-time engine integration & WebSocket propagation
@pytest.mark.anyio
async def test_scenario_t_and_u_realtime_engine_and_websocket(mock_topology):
    ws_manager = WebSocketConnectionManager()
    repo = DatabaseRepository(topology=mock_topology)
    engine = RealTimeProcessingEngine(repository=repo, ws_manager=ws_manager)

    fixture_data = load_fixture("01_valid_observation.json")

    def fake_fetcher(url: str, timeout: float):
        return 200, fixture_data

    connector = OpenMeteoLiveConnector(http_fetcher=fake_fetcher, retry_limit=0)
    poller = LiveSourcePoller(
        connector=connector,
        engine=engine,
        repository=repo,
        topology=mock_topology,
        ws_manager=ws_manager,
    )

    # Attach mock WebSocket client
    mock_ws = AsyncMock()
    await ws_manager.connect(mock_ws)


    await poller.poll_cycle_once()

    # Verify messages were broadcast to websocket
    assert mock_ws.send_text.call_count >= 3
    sent_payloads = [json.loads(call.args[0]) for call in mock_ws.send_text.call_args_list]
    event_types = [p.get("event_type") for p in sent_payloads]
    assert EventType.OBSERVATION_UPDATED.value in event_types
    assert EventType.HEALTH_UPDATED.value in event_types

    ws_manager.disconnect(mock_ws)

