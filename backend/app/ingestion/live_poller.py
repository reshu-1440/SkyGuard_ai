"""Live Weather API Asynchronous Polling Service for SkyGuard AI.

Orchestrates periodic multi-station observation retrieval, freshness tracking,
concurrency isolation, and pipeline ingestion into the RealTimeProcessingEngine.
Integrated with the Phase 11C SourceHealthStateMachine for deterministic operational
observability, outage episode tracking, and latency diagnostics.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import time
from typing import Any, Dict, List, Optional, Set

from backend.app.connectors.live_qualification import LiveSourceHealthStatus, PressureSemantics
from backend.app.connectors.weather_api import OpenMeteoLiveConnector
from backend.app.core.config import get_settings
from backend.app.core.database import DatabaseRepository
from backend.app.core.engine import RealTimeProcessingEngine
from backend.app.core.logging import get_logger
from backend.app.core.ws_manager import WebSocketConnectionManager, get_ws_manager
from backend.app.ingestion.source_health import (
    ErrorCategory,
    OutageEpisode,
    SourceHealthState,
    SourceHealthStateMachine,
    SourceHealthTransition,
    StationLiveRecord,
    StationLiveStatus,
)
from backend.app.models.events import EventType, SystemStatusChangedPayload, WebSocketEnvelope
from backend.app.models.observation import QualityStatus, WeatherObservation
from ml.spatial.topology import SpatialNetworkTopology, StationNode

logger = get_logger("live_poller")


class LiveSourcePoller:
    """Async background polling service coordinating multi-station live telemetry ingestion."""

    def __init__(
        self,
        connector: Optional[OpenMeteoLiveConnector] = None,
        engine: Optional[RealTimeProcessingEngine] = None,
        repository: Optional[DatabaseRepository] = None,
        topology: Optional[SpatialNetworkTopology] = None,
        ws_manager: Optional[WebSocketConnectionManager] = None,
        poll_interval_seconds: Optional[int] = None,
        stale_threshold_seconds: Optional[float] = None,
        max_concurrent_requests: int = 5,
        state_machine: Optional[SourceHealthStateMachine] = None,
    ) -> None:
        app_settings = get_settings()
        live_cfg = app_settings.live_source

        self.connector = connector or OpenMeteoLiveConnector()
        self.repository = repository or (engine.repository if engine else DatabaseRepository())
        self.topology = topology or self.repository.topology
        self.engine = engine or RealTimeProcessingEngine(repository=self.repository)
        self.ws_manager = ws_manager or get_ws_manager()

        self.poll_interval_seconds = poll_interval_seconds or live_cfg.poll_interval_seconds
        self.stale_threshold_seconds = stale_threshold_seconds or live_cfg.stale_threshold_seconds
        self.max_concurrent_requests = max_concurrent_requests

        # Operational State Machine
        self.state_machine = state_machine or SourceHealthStateMachine(
            provider=live_cfg.provider or "open_meteo",
            outage_consecutive_failures=live_cfg.outage_consecutive_failures,
            recovery_required_successes=live_cfg.recovery_required_successes,
            stale_threshold_seconds=self.stale_threshold_seconds,
            expected_cadence_seconds=float(self.poll_interval_seconds),
            max_history_records=live_cfg.max_history_records,
            max_outage_episodes=live_cfg.max_outage_episodes,
            repository=self.repository,
        )


        # Pre-seed stations in state machine
        for s_id in self.topology.stations.keys():
            self.state_machine.stations.setdefault(s_id, StationLiveRecord(station_id=s_id))

        # Concurrency & execution state
        self._is_running = False
        self._polling_task: Optional[asyncio.Task] = None
        self._station_locks: Dict[str, asyncio.Lock] = {}

        # Operational Metrics
        self.metrics: Dict[str, Any] = {
            "requests_total": 0,
            "requests_success": 0,
            "requests_failed": 0,
            "observations_ingested": 0,
            "observations_rejected": 0,
            "stale_observations": 0,
            "duplicate_observations": 0,
            "last_poll_cycle_start": None,
            "last_poll_cycle_duration_ms": None,
        }

        # Per-station freshness state dictionary (for backward compatibility)
        self.station_freshness: Dict[str, Dict[str, Any]] = {}

    @property
    def is_running(self) -> bool:
        """Whether the background polling loop is actively executing."""
        return self._is_running

    def get_health(self) -> LiveSourceHealthStatus:
        """Return the current LiveSourceHealthStatus from the underlying connector."""
        return self.connector.health

    def _get_station_lock(self, station_id: str) -> asyncio.Lock:
        """Retrieve or create a mutex for an individual station to prevent overlapping fetches."""
        if station_id not in self._station_locks:
            self._station_locks[station_id] = asyncio.Lock()
        return self._station_locks[station_id]

    async def start(self) -> None:
        """Start the background periodic polling loop."""
        if self._is_running:
            logger.warning("LiveSourcePoller is already running.")
            return

        self._is_running = True
        self.connector.connect()
        self._polling_task = asyncio.create_task(self._run_loop())
        logger.info("LiveSourcePoller started (interval: %ds).", self.poll_interval_seconds)

    async def stop(self) -> None:
        """Gracefully shut down the background polling loop."""
        if not self._is_running:
            return

        self._is_running = False
        if self._polling_task and not self._polling_task.done():
            self._polling_task.cancel()
            try:
                await self._polling_task
            except asyncio.CancelledError:
                pass

        self._polling_task = None
        self.connector.disconnect()
        logger.info("LiveSourcePoller gracefully stopped.")

    @property
    def is_polling(self) -> bool:
        """Alias for is_running."""
        return self._is_running

    async def start_polling(self) -> Optional[asyncio.Task]:
        """Alias for start()."""
        await self.start()
        return self._polling_task

    async def stop_polling(self) -> None:
        """Alias for stop()."""
        await self.stop()

    async def _run_loop(self) -> None:
        """Internal infinite loop polling all stations at configured intervals."""
        while self._is_running:
            try:
                await self.poll_cycle_once()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Unexpected error in live poller cycle: %s", str(e), exc_info=True)

            try:
                await asyncio.sleep(self.poll_interval_seconds)
            except asyncio.CancelledError:
                break

    async def poll_station(
        self, station_id: str, node: StationNode
    ) -> Dict[str, Any]:
        """Poll a single station with lock protection, error isolation, and metrics recording.
        
        Returns a dictionary summarizing station execution details for state machine evaluation.
        """
        lock = self._get_station_lock(station_id)
        if lock.locked():
            logger.debug("Skipping station %s: previous poll request still in flight", station_id)
            return {
                "station_id": station_id,
                "success": False,
                "error_category": ErrorCategory.TIMEOUT,
                "error_message": "Previous poll request still in flight",
                "observation": None,
            }

        async with lock:
            self.metrics["requests_total"] += 1
            t_start = time.perf_counter()

            obs = await self.connector.async_fetch_station_observation(
                station_id=station_id,
                latitude=node.latitude,
                longitude=node.longitude,
                elevation=node.elevation_m,
                station_name=node.name,
            )

            latency_ms = (time.perf_counter() - t_start) * 1000.0

            if obs is None:
                self.metrics["requests_failed"] += 1
                self._update_station_freshness(station_id, obs=None)
                err_msg = self.connector.health.last_error_message or "Unknown fetch failure"
                cat = ErrorCategory.NETWORK_ERROR
                if "429" in err_msg:
                    cat = ErrorCategory.HTTP_429
                elif "401" in err_msg or "403" in err_msg or self.connector.health.authentication_status == "INVALID_CREDENTIALS":
                    cat = ErrorCategory.HTTP_401
                elif "timeout" in err_msg.lower():
                    cat = ErrorCategory.TIMEOUT
                elif "500" in err_msg or "502" in err_msg or "503" in err_msg:
                    cat = ErrorCategory.HTTP_5XX
                elif "malformed" in err_msg.lower():
                    cat = ErrorCategory.PARSE_ERROR
                elif "quality gate" in err_msg.lower():
                    cat = ErrorCategory.SCHEMA_VIOLATION

                return {
                    "station_id": station_id,
                    "success": False,
                    "error_category": cat,
                    "error_message": err_msg,
                    "observation": None,
                    "latency_ms": latency_ms,
                }

            self.metrics["requests_success"] += 1

            # Attach canonical RunContext provenance to live observation
            try:
                from backend.app.api.v1.deps import get_run_context_manager
                ctx_mgr = get_run_context_manager()
                active_ctx = ctx_mgr.get_context()
                obs = obs.model_copy(update={
                    "run_id": active_ctx.run_id,
                    "source_type": active_ctx.source_type.value if hasattr(active_ctx.source_type, "value") else str(active_ctx.source_type),
                    "source_name": active_ctx.source_name,
                    "dataset_id": active_ctx.dataset_id,
                    "dataset_version": active_ctx.dataset_version,
                })
            except Exception as prov_err:
                logger.debug("Could not attach active RunContext provenance: %s", str(prov_err))

            # Freshness Calculation
            delay_seconds = (obs.ingestion_timestamp - obs.timestamp).total_seconds()
            is_stale = delay_seconds > self.stale_threshold_seconds
            if is_stale:
                self.metrics["stale_observations"] += 1
                logger.warning(
                    "Observation for station %s is stale (delay: %.1fs > threshold: %.1fs)",
                    station_id,
                    delay_seconds,
                    self.stale_threshold_seconds,
                )

            self._update_station_freshness(station_id, obs=obs, delay_seconds=delay_seconds, is_stale=is_stale)

            # Ingest into RealTimeProcessingEngine
            is_dup = False
            is_rej = False
            try:
                result = self.engine.process_observation(obs)
                if result.status.value == "PROCESSED":
                    self.metrics["observations_ingested"] += 1
                    try:
                        ctx_mgr.update_context(
                            observation_count=self.metrics["observations_ingested"],
                            current_observation_index=self.metrics["observations_ingested"],
                        )
                    except Exception:
                        pass
                elif result.status.value == "DUPLICATE_SKIPPED":
                    self.metrics["duplicate_observations"] += 1
                    is_dup = True
                else:
                    self.metrics["observations_rejected"] += 1
                    is_rej = True
            except Exception as eng_err:
                logger.error("Engine processing error for live observation %s: %s", station_id, str(eng_err))
                self.metrics["observations_rejected"] += 1
                is_rej = True

            return {
                "station_id": station_id,
                "success": True,
                "observation": obs,
                "observation_timestamp": obs.timestamp,
                "ingestion_timestamp": obs.ingestion_timestamp,
                "delay_seconds": delay_seconds,
                "is_stale": is_stale,
                "is_duplicate": is_dup,
                "is_rejected": is_rej,
                "temperature": obs.temperature,
                "humidity": obs.humidity,
                "pressure": obs.pressure,
                "latency_ms": latency_ms,
            }

    def _update_station_freshness(
        self,
        station_id: str,
        obs: Optional[WeatherObservation],
        delay_seconds: Optional[float] = None,
        is_stale: bool = False,
    ) -> None:
        """Update per-station observability status dictionary (backward compatibility)."""
        prev = self.station_freshness.get(station_id, {})
        if obs is not None:
            self.station_freshness[station_id] = {
                "station_id": station_id,
                "last_observation_timestamp": obs.timestamp.isoformat(),
                "last_ingestion_timestamp": obs.ingestion_timestamp.isoformat(),
                "delay_seconds": round(delay_seconds or 0.0, 1),
                "is_stale": is_stale,
                "status": "STALE" if is_stale else "LIVE",
                "temperature": obs.temperature,
                "humidity": obs.humidity,
                "pressure": obs.pressure,
                "last_fetch_success": True,
            }
        else:
            self.station_freshness[station_id] = {
                "station_id": station_id,
                "last_observation_timestamp": prev.get("last_observation_timestamp"),
                "last_ingestion_timestamp": prev.get("last_ingestion_timestamp"),
                "delay_seconds": prev.get("delay_seconds"),
                "is_stale": True if prev.get("last_observation_timestamp") else False,
                "status": "DEGRADED" if prev.get("last_observation_timestamp") else "DISCONNECTED",
                "temperature": prev.get("temperature"),
                "humidity": prev.get("humidity"),
                "pressure": prev.get("pressure"),
                "last_fetch_success": False,
            }

    async def poll_cycle_once(self) -> List[Optional[WeatherObservation]]:
        """Execute a single multi-station polling cycle concurrently and evaluate state machine."""
        cycle_start = datetime.now(timezone.utc)
        self.metrics["last_poll_cycle_start"] = cycle_start.isoformat()
        t0 = time.perf_counter()

        semaphore = asyncio.Semaphore(self.max_concurrent_requests)

        async def _bounded_poll(s_id: str, node: StationNode) -> Dict[str, Any]:
            async with semaphore:
                return await self.poll_station(s_id, node)

        tasks = [
            _bounded_poll(station_id, node)
            for station_id, node in self.topology.stations.items()
        ]

        station_results_list = await asyncio.gather(*tasks, return_exceptions=False)
        duration_ms = (time.perf_counter() - t0) * 1000.0
        self.metrics["last_poll_cycle_duration_ms"] = round(duration_ms, 2)

        # Feed results into State Machine
        station_results_map: Dict[str, Dict[str, Any]] = {
            res["station_id"]: res for res in station_results_list
        }

        # Check for top-level provider error category
        auth_failed = self.connector.health.authentication_status == "INVALID_CREDENTIALS"
        rate_limited = self.connector.health.rate_limit_remaining == 0

        if auth_failed:
            self.state_machine.record_poll_cycle_failure(
                category=ErrorCategory.HTTP_401,
                error_message="Authentication credentials rejected",
                affected_stations=list(station_results_map.keys()),
                timestamp=cycle_start,
            )
        elif rate_limited:
            self.state_machine.record_poll_cycle_failure(
                category=ErrorCategory.HTTP_429,
                error_message="API Rate limit exhausted",
                affected_stations=list(station_results_map.keys()),
                timestamp=cycle_start,
            )
        else:
            self.state_machine.record_poll_cycle_success(
                latency_ms=duration_ms,
                station_results=station_results_map,
                timestamp=cycle_start,
            )

        observations = [
            res.get("observation") for res in station_results_list
        ]

        logger.info(
            "Completed live poll cycle across %d stations in %.2fms (success: %d, failed: %d, source_state: %s)",
            len(tasks),
            duration_ms,
            sum(1 for r in observations if r is not None),
            sum(1 for r in observations if r is None),
            self.state_machine.current_state.value,
        )

        return observations

    def get_status_summary(self) -> Dict[str, Any]:
        """Return comprehensive operational snapshot for API and dashboards."""
        health = self.get_health()
        sm_summary = self.state_machine.get_summary()

        return {
            "status": sm_summary["source_state"],
            "source_state": sm_summary["source_state"],
            "provider": health.provider,
            "is_polling": self._is_running,
            "poll_interval_seconds": self.poll_interval_seconds,
            "stale_threshold_seconds": self.stale_threshold_seconds,
            "health": health.model_dump(),
            "metrics": {
                **self.metrics,
                **sm_summary["metrics"],
            },
            "stations_configured": len(self.topology.stations),
            "station_freshness": self.station_freshness,
            "station_live_records": sm_summary["stations"],
            "counts": sm_summary["counts"],
            "active_episode": sm_summary["active_episode"],
            "recent_episodes": sm_summary["recent_episodes"],
            "recent_transitions": sm_summary["recent_transitions"],
        }
