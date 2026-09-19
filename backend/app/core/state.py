"""Station-level state management and bounded temporal sliding buffers for real-time streaming."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import math
from typing import Any, Deque, Dict, List, Optional, Set, Tuple
import numpy as np
import pandas as pd

from backend.app.models.observation import WeatherObservation
from backend.app.models.processing import ProcessingStatus
from ml.decision.schema import HybridDecision
from ml.health.health_schema import SensorHealthSummary


class StationStateBuffer:
    """Bounded, thread-safe temporal state ring buffer for an individual AWS station."""

    def __init__(
        self,
        station_id: str,
        max_retention: int = 360,
        run_id: Optional[str] = None,
    ) -> None:
        self.station_id = station_id
        self.max_retention = max_retention
        self.run_id = run_id
        
        # Chronologically ordered observation ring buffer (holds up to 360 observations, covering 24h at 5-min cadence)
        self.observations: Deque[WeatherObservation] = deque(maxlen=max_retention)
        self.decisions: Deque[HybridDecision] = deque(maxlen=max_retention)
        self.health_history: Deque[SensorHealthSummary] = deque(maxlen=72)
        
        # Set of seen observation identity keys for fast idempotency & duplicate checks
        self.seen_identity_keys: Set[str] = set()
        self.last_seen_timestamp: Optional[datetime] = None

    def get_identity_key(self, obs: WeatherObservation) -> str:
        """Generate unique idempotent identity string for an incoming packet."""
        src = obs.source if hasattr(obs.source, "value") else str(obs.source)
        t_str = obs.timestamp.astimezone(timezone.utc).isoformat()
        run_id = obs.run_id or ""
        return f"{self.station_id}::{t_str}::{src}::{run_id}"

    def check_temporal_ordering(
        self,
        obs: WeatherObservation,
        check_future_wall_clock: bool = True,
    ) -> Tuple[ProcessingStatus, Optional[str]]:
        """Validate timestamp temporal ordering, duplicates, and out-of-order state."""
        key = self.get_identity_key(obs)
        if key in self.seen_identity_keys:
            return ProcessingStatus.DUPLICATE_SKIPPED, "Duplicate observation packet received."

        obs_time = obs.timestamp.astimezone(timezone.utc)
        now_time = datetime.now(timezone.utc)

        # Check future timestamp relative to server wall clock for live telemetry feeds
        src = obs.source.value if hasattr(obs.source, "value") else str(obs.source)
        if check_future_wall_clock and src in ("WEATHER_API", "MQTT"):
            if (obs_time - now_time).total_seconds() > 300.0:
                return ProcessingStatus.FUTURE_TIMESTAMP, f"Timestamp {obs_time.isoformat()} is in the future relative to server time."

        # Check out-of-order
        if self.last_seen_timestamp is not None:
            if obs_time < self.last_seen_timestamp:
                return ProcessingStatus.OUT_OF_ORDER, f"Timestamp {obs_time.isoformat()} is out-of-order (prior watermark: {self.last_seen_timestamp.isoformat()})."

        return ProcessingStatus.PROCESSED, None

    def append_observation(self, obs: WeatherObservation) -> None:
        """Append observation to state buffer and update watermark."""
        key = self.get_identity_key(obs)
        self.seen_identity_keys.add(key)
        self.observations.append(obs)
        
        obs_time = obs.timestamp.astimezone(timezone.utc)
        if self.last_seen_timestamp is None or obs_time > self.last_seen_timestamp:
            self.last_seen_timestamp = obs_time

    def append_decision(self, decision: HybridDecision) -> None:
        """Append decision output to ring buffer."""
        self.decisions.append(decision)

    def append_health_snapshot(self, health: SensorHealthSummary) -> None:
        """Append health evaluation snapshot."""
        self.health_history.append(health)

    def get_causal_history(
        self,
        before_timestamp: datetime,
        max_points: Optional[int] = None,
    ) -> List[WeatherObservation]:
        """Retrieve chronological history strictly on or before before_timestamp."""
        cutoff = before_timestamp.astimezone(timezone.utc)
        matching = [o for o in self.observations if o.timestamp.astimezone(timezone.utc) <= cutoff]
        if max_points is not None:
            return matching[-max_points:]
        return matching


class StationStateManager:
    """Coordinates independent station state buffers across the AWS network."""

    def __init__(self, max_station_retention: int = 120) -> None:
        self.max_station_retention = max_station_retention
        self.stations: Dict[str, StationStateBuffer] = {}

    def get_or_create_buffer(self, station_id: str, run_id: Optional[str] = None) -> StationStateBuffer:
        """Get existing station buffer or create an isolated new buffer."""
        key = f"{station_id}::{run_id}" if run_id else station_id
        if key not in self.stations:
            self.stations[key] = StationStateBuffer(
                station_id=station_id,
                max_retention=self.max_station_retention,
                run_id=run_id,
            )
        return self.stations[key]

    def get_contemporaneous_neighbor_pool(
        self,
        target_station_id: str,
        target_timestamp: datetime,
        temporal_tolerance_minutes: float = 30.0,
    ) -> List[Dict[str, Any]]:
        """Extract contemporaneous neighbor observations pool respecting strict causal ordering (t <= target_t)."""
        cutoff = target_timestamp.astimezone(timezone.utc)
        tol_seconds = temporal_tolerance_minutes * 60.0
        pool: List[Dict[str, Any]] = []

        for stn_id, buffer in self.stations.items():
            if stn_id == target_station_id:
                continue

            causal_obs = buffer.get_causal_history(before_timestamp=cutoff, max_points=3)
            if not causal_obs:
                continue

            # Pick latest observation <= cutoff
            latest_obs = causal_obs[-1]
            dt = (cutoff - latest_obs.timestamp.astimezone(timezone.utc)).total_seconds()
            if dt <= tol_seconds:
                # Format into neighbor pool dictionary
                pool.append({
                    "station_id": stn_id,
                    "timestamp": latest_obs.timestamp.astimezone(timezone.utc).isoformat(),
                    "temperature_c": latest_obs.temperature,
                    "relative_humidity_pct": latest_obs.humidity,
                    "sea_level_pressure_hpa": latest_obs.pressure,
                    "station_pressure_hpa": latest_obs.station_pressure_hpa,
                    "elevation_m": latest_obs.elevation,
                    "latitude": latest_obs.latitude,
                    "longitude": latest_obs.longitude,
                })

        return pool


class RunContextManager:
    """Singleton manager maintaining active canonical RunContext across the backend."""

    def __init__(self) -> None:
        from backend.app.models.run_context import DataSourceType, RunContext, RunMode, RunStatus, TransportType

        self.active_context: RunContext = RunContext(
            run_id="RUN-DEFAULT-001",
            source_type=DataSourceType.SYNTHETIC_VALIDATION,
            source_name="Synthetic Benchmark Replay",
            mode=RunMode.SYNTHETIC_REPLAY,
            dataset_id="synthetic_validation_v1",
            dataset_version="1.0.0",
            station_count=20,
            observation_count=5760,
            cadence="5 minutes",
            ground_truth_available=True,
            replay_speed=1.0,
            transport=TransportType.WEBSOCKET,
            database_target="isolated_synthetic_db",
            status=RunStatus.IDLE,
            metadata={
                "seed": 42,
                "scenarios": 24,
                "time_range_hours": 24,
            },
        )

    def get_context(self) -> RunContext:
        """Return a copy of the current active RunContext."""
        return self.active_context

    def update_context(self, **kwargs: Any) -> RunContext:
        """Update fields on the active RunContext and return updated instance."""
        updated_dict = self.active_context.model_dump()
        updated_dict.update(kwargs)
        from backend.app.models.run_context import RunContext
        self.active_context = RunContext(**updated_dict)
        return self.active_context

    def select_source(
        self,
        source_type: str,
        mode: str,
        dataset_id: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> RunContext:
        """Switch data source, generating a new run_id and updating execution metadata."""
        from backend.app.connectors.provider_registry import ProviderRegistry
        from backend.app.models.run_context import DataSourceType, RunContext, RunMode, RunStatus, TransportType

        provider_info = ProviderRegistry.get_provider_info(source_type)
        if not provider_info["configured"]:
            raise ValueError(f"Provider '{source_type}' is not configured (Status: COMING SOON)")

        new_run_id = f"RUN-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

        self.active_context = RunContext(
            run_id=new_run_id,
            source_type=DataSourceType(source_type),
            source_name=provider_info["name"],
            mode=RunMode(mode),
            dataset_id=dataset_id or provider_info["dataset_id"],
            dataset_version=provider_info["dataset_version"],
            station_count=provider_info["station_count"],
            observation_count=provider_info["observation_count"],
            cadence=provider_info["cadence"],
            ground_truth_available=provider_info["ground_truth_available"],
            replay_speed=1.0,
            current_synthetic_time=None,
            current_observation_index=0,
            transport=TransportType.WEBSOCKET if mode != "HISTORICAL_ANALYSIS" else TransportType.LOCAL,
            database_target=f"run_{new_run_id.lower()}",
            created_at=datetime.now(timezone.utc),
            status=RunStatus.IDLE,
            metadata=config or {},
        )
        return self.active_context

