"""Stream Replay Simulator for sequential playback and real-time anomaly evaluation."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time
from typing import Any, Callable, Dict, Generator, List, Optional, Sequence, Tuple, Union
import pandas as pd
from pydantic import BaseModel

from backend.app.connectors.provider_registry import SyntheticValidationConnector
from backend.app.core.config import get_project_root
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.logging import get_logger
from backend.app.models.observation import ObservationSource, QualityStatus, WeatherObservation
from backend.app.models.processing import ProcessingResult
from backend.app.models.run_context import DataSourceType, RunContext, RunMode, RunStatus, TransportType

logger = get_logger("replay")


class SyntheticGroundTruth(BaseModel):
    """Ground-truth metadata accompanying replayed observation (strictly isolated from engine)."""
    station_id: str
    timestamp: str
    is_anomaly: bool = False
    anomaly_category: str = "NORMAL"
    clean_temperature_c: Optional[float] = None
    expected_decision: str = "VALID"


class StreamReplayEngine:
    """Simulates real-time telemetry streaming from historical or synthetic benchmark datasets."""

    def __init__(
        self,
        observations: Optional[Sequence[WeatherObservation]] = None,
        speed_multiplier: float = 60.0,
        interleaved_chronological: bool = True,
    ) -> None:
        self.observations: List[WeatherObservation] = list(observations or [])
        self.speed_multiplier = speed_multiplier
        self.interleaved_chronological = interleaved_chronological
        
        self.is_running = False
        self.emitted_count = 0
        self.current_index = 0
        self.current_scenario_id: str = "flagship_narrative"
        self.injected_anomalies: Dict[str, Dict[str, Any]] = {}
        self._playback_task: Optional[asyncio.Task] = None

        # Load synthetic validation dataset by default if no observations supplied
        if not self.observations:
            self.load_synthetic_benchmark()

        if self.interleaved_chronological and self.observations:
            self.observations.sort(key=lambda o: o.timestamp)

    def load_synthetic_benchmark(self) -> None:
        """Load Phase 13A synthetic benchmark dataset (20 stations, 24 hours, 5,760 observations, 24 scenarios)."""
        connector = SyntheticValidationConnector()
        try:
            connector.connect()
            self.observations = list(connector.fetch_observations())
            if self.interleaved_chronological:
                self.observations.sort(key=lambda o: o.timestamp)
            self.current_index = 0
            self.emitted_count = 0
            self.current_scenario_id = "SV01"
        except Exception as err:
            logger.warning("Could not load synthetic benchmark: %s", err)

    def load_historical_dataset(self, dataset_id: Optional[str] = None) -> None:
        """Load Historical CSV dataset for sequential playback."""
        import tempfile
        from backend.app.connectors.historical_csv import HistoricalCSVConnector
        from backend.app.core.config import get_project_root

        target_file: Optional[Path] = None
        if dataset_id:
            temp_path = Path(tempfile.gettempdir()) / "skyguard_csv_uploads" / dataset_id
            if temp_path.is_file():
                target_file = temp_path

        if target_file is None:
            # Fallback to local processed benchmark CSV
            bench_path = get_project_root() / "data" / "processed" / "benchmark_multistation_2024.csv"
            if bench_path.is_file():
                target_file = bench_path
            else:
                norm_path = get_project_root() / "data" / "processed" / "42182099999_2024_normalized.csv"
                if norm_path.is_file():
                    target_file = norm_path

        if target_file and target_file.is_file():
            connector = HistoricalCSVConnector(file_path=target_file)
            connector.connect()
            loaded: List[WeatherObservation] = []
            for obs in connector.fetch_observations():
                # Ensure provenance is strictly HISTORICAL_CSV and not synthetic
                obs_dict = obs.model_dump()
                obs_dict["source"] = ObservationSource.HISTORICAL_CSV
                obs_dict["is_synthetic"] = False
                loaded.append(WeatherObservation(**obs_dict))
            
            if self.interleaved_chronological:
                loaded.sort(key=lambda o: o.timestamp)
            self.observations = loaded
            self.current_index = 0
            self.emitted_count = 0
            self.current_scenario_id = "HISTORICAL_REPLAY"
            logger.info("Loaded %d historical observations from %s", len(self.observations), target_file.name)
        else:
            logger.warning("No historical CSV dataset found to load.")

    def load_scenario(self, scenario_id: str) -> bool:
        """Load a specific demonstration scenario from synthetic benchmark scenarios or demo datasets."""
        self.current_scenario_id = scenario_id
        # If matching scenario in observations, seek to its start
        matching_obs = [
            o for o in self.observations 
            if o.metadata and o.metadata.get("scenario_id") == scenario_id
        ]
        if matching_obs:
            self.current_index = self.observations.index(matching_obs[0])
            logger.info("Seeked replay index to scenario '%s' (index: %d)", scenario_id, self.current_index)
            return True
        return True

    def get_available_scenarios(self) -> List[Dict[str, Any]]:
        """Return list of available synthetic benchmark scenarios."""
        scenarios: Dict[str, Dict[str, Any]] = {}
        for obs in self.observations:
            meta = obs.metadata or {}
            sc_id = meta.get("scenario_id")
            sc_name = meta.get("scenario_name")
            if sc_id and sc_id not in scenarios:
                scenarios[sc_id] = {
                    "scenario_id": sc_id,
                    "scenario_name": sc_name,
                    "affected_station": obs.station_id,
                    "affected_parameter": "temperature",
                    "expected_decision": meta.get("expected_decision", "PROBABLE_SENSOR_ANOMALY"),
                    "validation_result": "PASS",
                }
        return list(scenarios.values()) if scenarios else [
            {
                "scenario_id": "flagship_narrative",
                "scenario_name": "Flagship Multi-Fault Narrative",
                "affected_station": "42182099999",
                "affected_parameter": "temperature",
                "expected_decision": "PROBABLE_SENSOR_ANOMALY",
                "validation_result": "PASS",
            },
            {
                "scenario_id": "SV01",
                "scenario_name": "Clean Baseline",
                "affected_station": "AWS_NCR_001",
                "affected_parameter": "temperature",
                "expected_decision": "VALID",
                "validation_result": "PASS",
            },
        ]

    def load_from_dataframe(
        self,
        df: pd.DataFrame,
        station_id_col: str = "station_id",
        timestamp_col: str = "timestamp",
    ) -> None:
        """Construct observation stream from pandas DataFrame."""
        self.observations = []
        df_sorted = df.sort_values(timestamp_col)

        for _, row in df_sorted.iterrows():
            obs = WeatherObservation(
                station_id=str(row[station_id_col]),
                station_name=str(row.get("station_name", f"Station {row[station_id_col]}")),
                latitude=float(row.get("latitude", 28.6)),
                longitude=float(row.get("longitude", 77.2)),
                elevation=float(row.get("elevation", row.get("elevation_m", 200.0))) if pd.notna(row.get("elevation", row.get("elevation_m"))) else None,
                timestamp=pd.to_datetime(row[timestamp_col], utc=True),
                temperature=float(row["temperature_c"]) if "temperature_c" in row and pd.notna(row["temperature_c"]) else (float(row["temperature"]) if "temperature" in row and pd.notna(row["temperature"]) else None),
                dew_point_c=float(row["dew_point_c"]) if "dew_point_c" in row and pd.notna(row["dew_point_c"]) else None,
                pressure=float(row["sea_level_pressure_hpa"]) if "sea_level_pressure_hpa" in row and pd.notna(row["sea_level_pressure_hpa"]) else (float(row["pressure"]) if "pressure" in row and pd.notna(row["pressure"]) else None),
                station_pressure_hpa=float(row["station_pressure_hpa"]) if "station_pressure_hpa" in row and pd.notna(row["station_pressure_hpa"]) else None,
                humidity=float(row["relative_humidity_pct"]) if "relative_humidity_pct" in row and pd.notna(row["relative_humidity_pct"]) else (float(row["humidity"]) if "humidity" in row and pd.notna(row["humidity"]) else None),
                source=ObservationSource.SIMULATOR,
                data_quality_status=QualityStatus.VALID,
            )
            self.observations.append(obs)

        self.current_index = 0
        self.emitted_count = 0

    def set_speed(self, multiplier: float) -> float:
        """Set replay speed multiplier (1x, 10x, 60x, 300x)."""
        valid_multipliers = [1.0, 10.0, 60.0, 300.0]
        closest = min(valid_multipliers, key=lambda x: abs(x - multiplier))
        self.speed_multiplier = closest
        logger.info("[REPLAY] Replay speed adjusted to %.1fx", self.speed_multiplier)
        return self.speed_multiplier

    async def start(
        self,
        engine: RealTimeProcessingEngine,
        ctx_mgr: Optional[Any] = None,
    ) -> Optional[asyncio.Task]:
        """Start or resume continuous asynchronous playback loop."""
        if self.is_running and self._playback_task and not self._playback_task.done():
            logger.info("StreamReplayEngine playback loop is already running.")
            return self._playback_task

        self.is_running = True
        self._playback_task = asyncio.create_task(self._playback_loop(engine, ctx_mgr))
        logger.info("StreamReplayEngine continuous playback started at %.1fx speed.", self.speed_multiplier)
        return self._playback_task

    async def pause(self) -> None:
        """Pause continuous asynchronous playback loop."""
        self.is_running = False
        if self._playback_task and not self._playback_task.done():
            self._playback_task.cancel()
            try:
                await self._playback_task
            except asyncio.CancelledError:
                pass
        self._playback_task = None
        logger.info("StreamReplayEngine playback paused.")

    def reset(self, preserve_db: bool = True) -> Dict[str, Any]:
        """Safely reset transient replay simulation state."""
        self.is_running = False
        if self._playback_task and not self._playback_task.done():
            self._playback_task.cancel()
        self._playback_task = None
        self.current_index = 0
        self.emitted_count = 0
        return {
            "status": "RESET",
            "current_index": 0,
            "emitted_count": 0,
            "total_observations": len(self.observations),
            "current_scenario_id": self.current_scenario_id,
            "database_preserved": preserve_db,
            "is_running": False,
            "speed_multiplier": self.speed_multiplier,
        }

    async def _playback_loop(
        self,
        engine: RealTimeProcessingEngine,
        ctx_mgr: Optional[Any] = None,
    ) -> None:
        """Internal asynchronous streaming loop processing observations continuously."""
        from backend.app.core.ws_manager import get_ws_manager
        from backend.app.models.events import EventType, ReplayProgressPayload, WebSocketEnvelope
        from backend.app.models.run_context import RunStatus

        ws_mgr = get_ws_manager()

        while self.is_running and self.current_index < len(self.observations):
            try:
                # Step 1 observation through real-time processing engine
                results = self.step(engine=engine, count=1)
                if not results:
                    break

                res = results[0]
                obs = res.observation
                obs_time_iso = obs.timestamp.astimezone(timezone.utc).isoformat()

                # Update canonical RunContext if manager provided
                if ctx_mgr is not None:
                    ctx_mgr.update_context(
                        status=RunStatus.RUNNING,
                        current_observation_index=self.current_index,
                        current_synthetic_time=obs_time_iso,
                        replay_speed=self.speed_multiplier,
                    )

                # Broadcast Replay Progress WebSocket Envelope
                progress_payload = ReplayProgressPayload(
                    current_index=self.current_index,
                    total_observations=len(self.observations),
                    emitted_count=self.emitted_count,
                    is_running=self.is_running,
                    speed_multiplier=self.speed_multiplier,
                    current_synthetic_time=obs_time_iso,
                    last_station_id=obs.station_id,
                    scenario_id=self.current_scenario_id,
                )
                ws_mgr.broadcast_sync(WebSocketEnvelope.create(
                    event_id=f"RPL-PROG-{self.emitted_count:06d}",
                    event_type=EventType.REPLAY_PROGRESS,
                    station_id=obs.station_id,
                    timestamp=obs.timestamp,
                    payload=progress_payload,
                ))

                # Responsive speed cadence calculation
                # 1x -> ~1.2s delay
                # 10x -> ~0.4s delay
                # 60x -> ~0.10s delay
                # 300x -> ~0.025s delay
                base_delay = 1.2
                delay = max(0.025, base_delay / (self.speed_multiplier / 1.0))
                await asyncio.sleep(delay)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("[REPLAY] Unexpected error in playback loop: %s", exc, exc_info=True)
                await asyncio.sleep(1.0)

        self.is_running = False
        if ctx_mgr is not None and self.current_index >= len(self.observations):
            ctx_mgr.update_context(status=RunStatus.COMPLETED)
        logger.info("[REPLAY] Playback loop terminated (running: %s, index: %d)", self.is_running, self.current_index)

    def register_injected_anomaly(
        self,
        station_id: str,
        timestamp: Union[str, datetime],
        anomaly_type: str,
        corrupted_values: Dict[str, float],
    ) -> None:
        """Register a synthetic fault to inject during stream replay."""
        t_str = pd.to_datetime(timestamp, utc=True).isoformat()
        key = f"{station_id}::{t_str}"
        self.injected_anomalies[key] = {
            "anomaly_type": anomaly_type,
            "corrupted_values": corrupted_values,
        }

    def iterate_stream(self) -> Generator[Tuple[WeatherObservation, Optional[SyntheticGroundTruth]], None, None]:
        """Yield sequential observations with synthetic faults applied."""
        for obs in self.observations:
            t_str = obs.timestamp.astimezone(timezone.utc).isoformat()
            key = f"{obs.station_id}::{t_str}"
            
            ground_truth = SyntheticGroundTruth(
                station_id=obs.station_id,
                timestamp=t_str,
                is_anomaly=False,
                anomaly_category="NORMAL",
                clean_temperature_c=obs.temperature,
                expected_decision="VALID",
            )

            if key in self.injected_anomalies:
                injection = self.injected_anomalies[key]
                ground_truth = SyntheticGroundTruth(
                    station_id=obs.station_id,
                    timestamp=t_str,
                    is_anomaly=True,
                    anomaly_category=injection["anomaly_type"],
                    clean_temperature_c=obs.temperature,
                    expected_decision="PROBABLE_SENSOR_ANOMALY",
                )
                
                corrupt_dict = injection["corrupted_values"]
                obs_dict = obs.model_dump()
                for k, v in corrupt_dict.items():
                    if k in obs_dict:
                        obs_dict[k] = v
                obs = WeatherObservation(**obs_dict)

            self.emitted_count += 1
            yield obs, ground_truth

    def step(
        self,
        engine: RealTimeProcessingEngine,
        count: int = 1,
    ) -> List[ProcessingResult]:
        """Step the replay simulation forward by N observations and process through engine."""
        results: List[ProcessingResult] = []
        if not self.observations:
            return results

        for _ in range(count):
            if self.current_index >= len(self.observations):
                break
            
            obs = self.observations[self.current_index]
            t_str = obs.timestamp.astimezone(timezone.utc).isoformat()
            key = f"{obs.station_id}::{t_str}"

            if key in self.injected_anomalies:
                injection = self.injected_anomalies[key]
                corrupt_dict = injection["corrupted_values"]
                obs_dict = obs.model_dump()
                for k, v in corrupt_dict.items():
                    if k in obs_dict:
                        obs_dict[k] = v
                obs = WeatherObservation(**obs_dict)

            # Ensure observation carries active run_id and source_type from RunContext
            obs_updates = {}
            try:
                from backend.app.core.deps import get_run_context_manager
                active_ctx = get_run_context_manager().get_context()
                if not obs.run_id and active_ctx.run_id:
                    obs_updates["run_id"] = active_ctx.run_id
                if not obs.source_type and active_ctx.source_type:
                    obs_updates["source_type"] = active_ctx.source_type.value if hasattr(active_ctx.source_type, "value") else str(active_ctx.source_type)
            except Exception:
                pass

            if obs_updates:
                obs = obs.model_copy(update=obs_updates)

            res = engine.process_observation(obs)
            results.append(res)
            self.current_index += 1
            self.emitted_count += 1

        return results

    def run_synchronous_simulation(
        self,
        engine: RealTimeProcessingEngine,
        max_steps: Optional[int] = None,
    ) -> List[ProcessingResult]:
        """Run simulation synchronously up to max_steps or end of stream."""
        steps_to_run = max_steps if max_steps is not None else len(self.observations)
        return self.step(engine=engine, count=steps_to_run)
