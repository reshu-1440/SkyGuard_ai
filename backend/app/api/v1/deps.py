"""Dependency injection providers for FastAPI endpoints."""

from __future__ import annotations

import math
from typing import Optional
from backend.app.core.database import DatabaseRepository
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.replay import StreamReplayEngine
from ml.spatial.topology import SpatialNetworkTopology, StationNode


# Global singleton instances for local backend execution
_repository: Optional[DatabaseRepository] = None
_engine: Optional[RealTimeProcessingEngine] = None
_replay_engine: Optional[StreamReplayEngine] = None


def get_default_topology() -> SpatialNetworkTopology:
    """Initialize standard default spatial topology with baseline AWS stations."""
    topo = SpatialNetworkTopology()
    # Add representative AWS stations across India
    default_stations = [
        ("42182099999", "NEW DELHI / SAFDARJUNG", 28.585, 77.206, 216.0, "DELHI"),
        ("42181099999", "DELHI / PALAM", 28.567, 77.117, 237.0, "DELHI"),
        ("42184099999", "DELHI / LODHI ROAD", 28.583, 77.217, 211.0, "DELHI"),
        ("42139099999", "GURGAON AWS", 28.459, 77.026, 220.0, "HARYANA"),
        ("42187099999", "NOIDA AWS", 28.535, 77.391, 200.0, "UTTAR PRADESH"),
        ("42165099999", "MEERUT AWS", 28.984, 77.706, 222.0, "UTTAR PRADESH"),
        ("42111099999", "ROHTAK AWS", 28.895, 76.606, 220.0, "HARYANA"),
        ("42314099999", "ALWAR AWS", 27.553, 76.634, 270.0, "RAJASTHAN"),
    ]
    for s_id, name, lat, lon, elev, state in default_stations:
        topo.add_station(StationNode(
            station_id=s_id,
            name=name,
            latitude=lat,
            longitude=lon,
            elevation_m=elev,
            state=state,
        ))
    return topo


def get_synthetic_topology() -> SpatialNetworkTopology:
    """Initialize spatial topology from the canonical Phase 13A synthetic benchmark dataset (20 stations)."""
    from backend.app.connectors.provider_registry import SyntheticValidationConnector
    connector = SyntheticValidationConnector()
    try:
        connector.connect()
        observations = list(connector.fetch_observations())
        return SpatialNetworkTopology.from_observations(observations)
    except Exception as err:
        logger.warning("Could not build synthetic topology from dataset: %s, falling back to default.", err)
        return get_default_topology()


def get_repository() -> DatabaseRepository:
    """Get or create singleton DatabaseRepository."""
    global _repository
    if _repository is None:
        try:
            topo = get_synthetic_topology()
        except Exception:
            topo = get_default_topology()
        _repository = DatabaseRepository(topology=topo)
    return _repository


def get_engine() -> RealTimeProcessingEngine:
    """Get or create singleton RealTimeProcessingEngine."""
    global _engine
    if _engine is None:
        repo = get_repository()
        _engine = RealTimeProcessingEngine(repository=repo)
    return _engine


def get_replay_engine() -> StreamReplayEngine:
    """Get or create singleton StreamReplayEngine with canonical synthetic benchmark dataset."""
    global _replay_engine
    if _replay_engine is None:
        _replay_engine = StreamReplayEngine()
        _replay_engine.load_synthetic_benchmark()
    return _replay_engine


_live_connector = None
_live_poller = None


def get_live_connector():
    """Get or create singleton OpenMeteoLiveConnector."""
    global _live_connector
    if _live_connector is None:
        from backend.app.connectors.weather_api import OpenMeteoLiveConnector
        _live_connector = OpenMeteoLiveConnector()
    return _live_connector


def get_live_poller():
    """Get or create singleton LiveSourcePoller."""
    global _live_poller
    if _live_poller is None:
        from backend.app.ingestion.live_poller import LiveSourcePoller
        connector = get_live_connector()
        engine = get_engine()
        repo = get_repository()
        _live_poller = LiveSourcePoller(
            connector=connector,
            engine=engine,
            repository=repo,
            topology=repo.topology,
        )
    return _live_poller


_run_context_manager = None


def get_run_context_manager() -> RunContextManager:
    """Get or create singleton RunContextManager."""
    global _run_context_manager
    if _run_context_manager is None:
        from backend.app.core.state import RunContextManager
        _run_context_manager = RunContextManager()
    return _run_context_manager


