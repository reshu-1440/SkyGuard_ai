"""Performance, Load, and Latency Benchmark across a 20-Station AWS Network."""

from datetime import datetime, timezone
import time
import numpy as np
import pytest

from backend.app.core.database import DatabaseRepository
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.models.observation import ObservationSource, QualityStatus, WeatherObservation
from ml.spatial.topology import SpatialNetworkTopology, StationNode


@pytest.fixture
def network_20_stations():
    topo = SpatialNetworkTopology()
    # Generate 20 distributed AWS stations across a grid
    for i in range(20):
        lat = 28.0 + (i // 5) * 0.4 + (i % 5) * 0.05
        lon = 76.5 + (i % 5) * 0.4
        s_id = f"AWS_STN_{i:03d}"
        topo.add_station(StationNode(
            station_id=s_id,
            name=f"Network AWS Station {i:03d}",
            latitude=lat,
            longitude=lon,
            elevation_m=200.0 + (i * 10),
        ))
    return topo


from backend.app.db.session import DatabaseSessionManager


def test_20_station_continuous_and_burst_load(network_20_stations):
    session_mgr = DatabaseSessionManager("sqlite:///:memory:")
    repo = DatabaseRepository(topology=network_20_stations, session_manager=session_mgr)
    engine = RealTimeProcessingEngine(repository=repo)

    station_ids = list(network_20_stations.stations.keys())
    assert len(station_ids) == 20

    # 1. Generate 12 cycles of 5-minute intervals (1 hour of continuous multi-station data) = 240 observations
    observations = []
    base_ts = datetime(2026, 9, 17, 0, 0, 0, tzinfo=timezone.utc)

    for step in range(12):
        step_time = datetime.fromtimestamp(base_ts.timestamp() + step * 300, tz=timezone.utc)
        for idx, s_id in enumerate(station_ids):
            node = network_20_stations.stations[s_id]
            # Diurnal temperature curve
            temp = 22.0 + 5.0 * np.sin(step * 0.2) + (idx % 3) * 0.5
            obs = WeatherObservation(
                station_id=s_id,
                station_name=node.name,
                latitude=node.latitude,
                longitude=node.longitude,
                elevation=node.elevation_m,
                timestamp=step_time,
                temperature=round(float(temp), 2),
                dew_point_c=round(float(temp - 7.0), 2),
                humidity=60.0,
                pressure=1013.25,
                source=ObservationSource.SIMULATOR,
                data_quality_status=QualityStatus.VALID,
            )
            observations.append(obs)

    assert len(observations) == 240

    # 2. Benchmark Execution
    t_start = time.perf_counter()
    latencies_ms = []

    for obs in observations:
        res = engine.process_observation(obs)
        latencies_ms.append(res.latency.total_pipeline_latency_ms)

    t_total = time.perf_counter() - t_start
    throughput = len(observations) / max(1e-5, t_total)

    # 3. Statistical Profiling
    p50 = float(np.percentile(latencies_ms, 50))
    p95 = float(np.percentile(latencies_ms, 95))
    p99 = float(np.percentile(latencies_ms, 99))
    mean_lat = float(np.mean(latencies_ms))

    # Assertions
    assert len(latencies_ms) == 240
    # Average latency per observation should be sub-100ms (typically < 15ms without background load)
    assert mean_lat < 100.0
    # Throughput should exceed 20 obs/second on a single CPU core with full persistence
    assert throughput >= 20.0

    # 4. Burst Test: 20 simultaneous observations arriving concurrently at step 13
    burst_time = datetime.fromtimestamp(base_ts.timestamp() + 13 * 300, tz=timezone.utc)
    burst_obs = [
        WeatherObservation(
            station_id=s_id,
            timestamp=burst_time,
            latitude=network_20_stations.stations[s_id].latitude,
            longitude=network_20_stations.stations[s_id].longitude,
            temperature=28.0,
            humidity=55.0,
            pressure=1012.0,
        )
        for s_id in station_ids
    ]

    t_burst_start = time.perf_counter()
    burst_results = [engine.process_observation(o) for o in burst_obs]
    t_burst_total = time.perf_counter() - t_burst_start

    assert len(burst_results) == 20
    assert all(r.status.value == "PROCESSED" for r in burst_results)
    # 20-station burst processed under 2 seconds total
    assert t_burst_total < 2.0
