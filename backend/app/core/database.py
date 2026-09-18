"""Production persistence repository for SkyGuard AI.

Backs in-memory low-latency state with PostgreSQL (production) or SQLite (testing/local)
using SQLAlchemy 2.0 ORM models, idempotent transactions, and non-destructive immutability.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
import pandas as pd
from sqlalchemy import desc, func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger
from backend.app.db.migrations import init_db_schema, run_db_migrations
from backend.app.db.models import (
    AnomalyEventModel,
    CorrectionRecommendationModel,
    ExplanationModel,
    OutageEpisodeModel,
    RawSourcePayloadModel,
    SensorHealthSnapshotModel,
    SourceHealthTransitionModel,
    StationModel,
    WeatherObservationModel,
)
from backend.app.db.session import DatabaseSessionManager, get_session_manager
from backend.app.ingestion.source_health import (
    ErrorCategory,
    OutageEpisode,
    SourceHealthState,
    SourceHealthTransition,
)
from backend.app.models.observation import QualityStatus, WeatherObservation
from backend.app.models.processing import (
    AnomalyEventRecord,
    LiveStationSnapshot,
    SystemHealthStatus,
)
from ml.decision.schema import HybridDecision, HybridDecisionType
from ml.explainability.schema import ExplanationSummary
from ml.health.health_schema import (
    ComponentHealthScores,
    HealthAuditMetadata,
    HealthReasonCode,
    HealthStatusBand,
    HealthTrend,
    MaintenanceRecommendation,
    ParameterHealth,
    SensorHealthSummary,
)

from ml.imputation.schema import (
    CorrectionAuditMetadata,
    CorrectionRecommendation,
    EstimationMethod,
    RecommendationStatus,
    UncertaintyEstimate,
)

from ml.spatial.topology import SpatialNetworkTopology, StationNode

logger = get_logger("database_repository")


def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure datetime is timezone-aware in UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def ensure_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """Return ISO-8601 string for UTC datetime."""
    u_dt = ensure_utc(dt)
    return u_dt.isoformat() if u_dt else None



class DatabaseRepository:
    """Production repository integrating in-memory caching with relational database persistence."""

    def __init__(
        self,
        topology: Optional[SpatialNetworkTopology] = None,
        session_manager: Optional[DatabaseSessionManager] = None,
        auto_init_db: bool = True,
    ) -> None:
        self.topology = topology or SpatialNetworkTopology()
        self.session_manager = session_manager or get_session_manager()
        self.persistence_degraded = False

        # In-Memory Cache Layers for <10ms streaming reads
        self.observations: Dict[str, WeatherObservation] = {}  # key: station_id::timestamp
        self.observation_order: List[str] = []
        
        self.anomaly_events: Dict[str, AnomalyEventRecord] = {}  # key: event_id
        self.anomaly_order: List[str] = []
        
        self.explanations: Dict[str, ExplanationSummary] = {}  # key: event_id
        self.latest_health_by_station: Dict[str, SensorHealthSummary] = {}
        self.health_history: List[SensorHealthSummary] = []
        self.corrections: Dict[str, CorrectionRecommendation] = {}  # key: observation_id
        self.correction_order: List[str] = []

        # Operational Performance Metrics
        self.startup_time = datetime.now(timezone.utc)
        self.processed_observations_count = 0
        self.last_processed_timestamp: Optional[str] = None
        self.latencies_history_ms: List[float] = []

        if auto_init_db:
            self._initialize_database()

    def _initialize_database(self) -> None:
        """Initialize database schema via SQLAlchemy metadata or migrations."""
        try:
            init_db_schema(self.session_manager.engine)
            self._sync_topology_stations()
            self.persistence_degraded = False
            logger.info("Database schema initialized and stations synchronized.")
        except Exception as e:
            self.persistence_degraded = True
            logger.error("Failed to initialize database schema: %s", str(e), exc_info=True)

    def _sync_topology_stations(self) -> None:
        """Sync stations from spatial network topology into database."""
        if not self.topology.stations:
            return
        try:
            with self.session_manager.session() as session:
                for s_id, node in self.topology.stations.items():
                    existing = session.get(StationModel, s_id)
                    if not existing:
                        stn_m = StationModel(
                            station_id=s_id,
                            name=node.name,
                            latitude=node.latitude,
                            longitude=node.longitude,
                            elevation_m=node.elevation_m,
                            state=node.state,
                            status=node.status,
                            sampling_interval_seconds=node.sampling_interval_seconds,
                        )
                        session.add(stn_m)
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Station topology DB sync warning: %s", str(e))

    def _generate_obs_id(self, source: str, station_id: str, ts: datetime) -> str:
        """Compute deterministic, collision-resistant observation ID."""
        ts_utc = ts.astimezone(timezone.utc).isoformat()
        digest = hashlib.sha256(f"{source}::{station_id}::{ts_utc}".encode("utf-8")).hexdigest()[:16]
        return f"obs_{source.lower()}_{station_id[-6:]}_{digest}"

    # =========================================================================
    # Write Persistence Operations
    # =========================================================================

    def save_observation(
        self,
        obs: WeatherObservation,
        raw_payload: Optional[Dict[str, Any]] = None,
        headers_metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Persist canonical observation record with deterministic idempotency.
        
        Raw sensor values are strictly immutable and never modified or overwritten.
        Returns True if this was a new observation, False if duplicate skipped.
        """
        t_utc = obs.timestamp.astimezone(timezone.utc)
        t_str = t_utc.isoformat()
        cache_key = f"{obs.station_id}::{t_str}"

        is_new = cache_key not in self.observations
        self.observations[cache_key] = obs
        if is_new:
            self.observation_order.append(cache_key)
            self.processed_observations_count += 1
            self.last_processed_timestamp = t_str

        # Persistent Relational Storage
        obs_id = self._generate_obs_id(str(obs.source.value if hasattr(obs.source, "value") else obs.source), obs.station_id, t_utc)

        try:
            with self.session_manager.session() as session:
                # Check for existing record to enforce deterministic idempotency
                existing = session.execute(
                    select(WeatherObservationModel).where(
                        WeatherObservationModel.source == str(obs.source.value if hasattr(obs.source, "value") else obs.source),
                        WeatherObservationModel.station_id == obs.station_id,
                        WeatherObservationModel.observation_timestamp == t_utc,
                    )
                ).scalar_one_or_none()

                if existing is not None:
                    return False

                obs_model = WeatherObservationModel(
                    observation_id=obs_id,
                    station_id=obs.station_id,
                    observation_timestamp=t_utc,
                    ingestion_timestamp=obs.ingestion_timestamp.astimezone(timezone.utc),
                    temperature_c=obs.temperature,
                    relative_humidity_pct=obs.humidity,
                    dew_point_c=obs.dew_point_c,
                    sea_level_pressure_hpa=obs.pressure,
                    station_pressure_hpa=obs.station_pressure_hpa,
                    latitude=obs.latitude,
                    longitude=obs.longitude,
                    elevation=obs.elevation,
                    source=str(obs.source.value if hasattr(obs.source, "value") else obs.source),
                    report_type=obs.report_type,
                    data_quality_status=str(obs.data_quality_status.value if hasattr(obs.data_quality_status, "value") else obs.data_quality_status),
                    is_synthetic=obs.is_synthetic,
                    raw_quality_flags=obs.raw_quality_flags or {},
                    metadata_json=obs.metadata or {},
                )
                session.add(obs_model)

                # Persist raw source payload if provided and configured
                if raw_payload is not None:
                    raw_id = f"raw_{obs.station_id}_{t_utc.strftime('%Y%m%d%H%M%S')}"
                    raw_model = RawSourcePayloadModel(
                        payload_id=raw_id,
                        source=str(obs.source.value if hasattr(obs.source, "value") else obs.source),
                        provider="open_meteo" if "OPEN_METEO" in str(obs.source) else "standard_feed",
                        endpoint="ingestion_pipeline",
                        station_id=obs.station_id,
                        source_timestamp=t_utc,
                        retrieval_timestamp=obs.ingestion_timestamp.astimezone(timezone.utc),
                        raw_payload_json=raw_payload,
                        headers_metadata=headers_metadata or {},
                        normalization_version="v1.0.0",
                    )
                    session.add(raw_model)

            self.persistence_degraded = False
        except IntegrityError:
            # Duplicate conflict during parallel retry: safely ignore
            return False
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Observation DB write failed (operating in memory): %s", str(e))

        return is_new

    def save_anomaly_event(
        self,
        event: AnomalyEventRecord,
        explanation: Optional[ExplanationSummary] = None,
        provenance: Optional[Dict[str, str]] = None,
    ) -> None:
        """Persist detected anomaly event and optional explainability package."""
        if event.event_id not in self.anomaly_events:
            self.anomaly_events[event.event_id] = event
            self.anomaly_order.append(event.event_id)
            
        if explanation is not None:
            self.explanations[event.event_id] = explanation

        prov = provenance or {}
        ev_ts = pd.to_datetime(event.timestamp, utc=True).to_pydatetime()

        try:
            with self.session_manager.session() as session:
                existing = session.execute(
                    select(AnomalyEventModel).where(AnomalyEventModel.event_id == event.event_id)
                ).scalar_one_or_none()

                if existing is None:
                    anom_model = AnomalyEventModel(
                        event_id=event.event_id,
                        station_id=event.station_id,
                        timestamp=ev_ts,
                        decision=str(event.decision.value if hasattr(event.decision, "value") else event.decision),
                        severity=str(event.severity.value if hasattr(event.severity, "value") else event.severity),
                        reason_codes=event.reason_codes or [],
                        observed_values=event.observed_values or {},
                        recommended_values=event.recommended_values or {},
                        explanation_summary=event.explanation_summary,
                        model_id=prov.get("model_id"),
                        model_version=prov.get("model_version"),
                        feature_version=prov.get("feature_version", "v1.0.0"),
                        decision_engine_version=prov.get("decision_engine_version", "hybrid_v1.0.0"),
                    )
                    session.add(anom_model)

                if explanation is not None:
                    existing_exp = session.execute(
                        select(ExplanationModel).where(ExplanationModel.event_id == event.event_id)
                    ).scalar_one_or_none()

                    if existing_exp is None:
                        feat_attr = (
                            [fc.model_dump() if hasattr(fc, "model_dump") else fc for fc in explanation.feature_contributions]
                            if explanation.feature_contributions
                            else {}
                        )
                        spatial_ev = (
                            explanation.spatial_evidence.model_dump()
                            if hasattr(explanation.spatial_evidence, "model_dump")
                            else (explanation.spatial_evidence or {})
                        )
                        temp_ev = (
                            explanation.temporal_evidence.model_dump()
                            if hasattr(explanation.temporal_evidence, "model_dump")
                            else (explanation.temporal_evidence or {})
                        )
                        multi_ev = (
                            explanation.multivariate_evidence.model_dump()
                            if hasattr(explanation.multivariate_evidence, "model_dump")
                            else (explanation.multivariate_evidence or {})
                        )
                        ev_hier = (
                            explanation.evidence_hierarchy.model_dump()
                            if hasattr(explanation.evidence_hierarchy, "model_dump")
                            else (explanation.evidence_hierarchy or {})
                        )
                        sop_steps = getattr(explanation, "recommended_investigation_steps", []) or getattr(explanation, "recommended_sop_steps", [])

                        exp_model = ExplanationModel(
                            event_id=event.event_id,
                            station_id=event.station_id,
                            timestamp=ev_ts,
                            feature_attributions=feat_attr if isinstance(feat_attr, dict) else {"contributions": feat_attr},
                            spatial_evidence=spatial_ev if isinstance(spatial_ev, dict) else {},
                            temporal_evidence=temp_ev if isinstance(temp_ev, dict) else {},
                            multivariate_evidence=multi_ev if isinstance(multi_ev, dict) else {},
                            evidence_hierarchy=ev_hier if isinstance(ev_hier, dict) else {},
                            natural_language_explanation=explanation.summary,
                            recommended_sop_steps=sop_steps if isinstance(sop_steps, list) else [],
                            explanation_version=prov.get("explanation_version", "v1.0.0"),
                            model_id=prov.get("model_id"),
                        )
                        session.add(exp_model)

            self.persistence_degraded = False
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Anomaly event DB write failed: %s", str(e))

    def save_health_snapshot(self, health: SensorHealthSummary) -> None:
        """Persist periodic sensor health evaluation snapshot."""
        self.latest_health_by_station[health.station_id] = health
        self.health_history.append(health)

        h_ts_raw = getattr(health, "timestamp", None) or (health.audit_metadata.generated_at if hasattr(health, "audit_metadata") and health.audit_metadata else None) or datetime.now(timezone.utc)
        h_ts = pd.to_datetime(h_ts_raw, utc=True).to_pydatetime()

        param_health = {
            k: (v.model_dump() if hasattr(v, "model_dump") else v)
            for k, v in (health.parameter_health or {}).items()
        }
        comp_scores = (
            health.component_scores.model_dump()
            if hasattr(health.component_scores, "model_dump")
            else (health.component_scores if isinstance(health.component_scores, dict) else {})
        )

        try:
            with self.session_manager.session() as session:
                h_model = SensorHealthSnapshotModel(
                    station_id=health.station_id,
                    timestamp=h_ts,
                    overall_health_score=health.overall_health_score,
                    status_band=str(health.status_band.value if hasattr(health.status_band, "value") else health.status_band),
                    trend=str(health.trend.value if hasattr(health.trend, "value") else health.trend),
                    maintenance_recommendation=str(health.maintenance_recommendation.value if hasattr(health.maintenance_recommendation, "value") else health.maintenance_recommendation),
                    parameter_health=param_health,
                    component_scores=comp_scores,
                    active_anomalies_count=getattr(health, "active_anomalies_count", 0) or 0,
                    health_engine_version="health_v1.0.0",
                )
                session.add(h_model)
            self.persistence_degraded = False
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Health snapshot DB write failed: %s", str(e))


    def save_correction(self, corr: CorrectionRecommendation) -> None:
        """Persist advisory correction recommendation (raw data untouched)."""
        if corr.observation_id not in self.corrections:
            self.correction_order.append(corr.observation_id)
        self.corrections[corr.observation_id] = corr

        c_ts = pd.to_datetime(corr.timestamp, utc=True).to_pydatetime()
        conf_lower = corr.uncertainty.estimate_range[0] if corr.uncertainty else None
        conf_upper = corr.uncertainty.estimate_range[1] if corr.uncertainty else None
        unc_json = corr.uncertainty.model_dump() if hasattr(corr.uncertainty, "model_dump") else (corr.uncertainty or {})

        try:
            with self.session_manager.session() as session:
                existing = session.execute(
                    select(CorrectionRecommendationModel).where(CorrectionRecommendationModel.observation_id == corr.observation_id)
                ).scalar_one_or_none()

                if existing is None:
                    c_model = CorrectionRecommendationModel(
                        observation_id=corr.observation_id,
                        station_id=corr.station_id,
                        timestamp=c_ts,
                        target_variable=corr.target_variable,
                        observed_value=corr.observed_value,
                        recommended_value=corr.recommended_value,
                        status=str(corr.status.value if hasattr(corr.status, "value") else corr.status),
                        method=str(corr.method.value if hasattr(corr.method, "value") else corr.method),
                        confidence_lower=conf_lower,
                        confidence_upper=conf_upper,
                        uncertainty_json=unc_json if isinstance(unc_json, dict) else {},
                        multivariate_consistent=corr.multivariate_consistent,
                        reason_codes=corr.reason_codes or [],
                        operator_summary=corr.operator_summary,
                        correction_engine_version="imputation_v1.0.0",
                    )
                    session.add(c_model)
            self.persistence_degraded = False
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Correction recommendation DB write failed: %s", str(e))

    def save_source_transition(self, transition: SourceHealthTransition, source: str = "open_meteo") -> None:
        """Persist operational source health state transition."""
        t_ts = pd.to_datetime(transition.timestamp, utc=True).to_pydatetime()
        try:
            with self.session_manager.session() as session:
                trans_m = SourceHealthTransitionModel(
                    source=source,
                    from_state=str(transition.from_state.value if hasattr(transition.from_state, "value") else transition.from_state),
                    to_state=str(transition.to_state.value if hasattr(transition.to_state, "value") else transition.to_state),
                    reason=transition.reason,
                    trigger_category=str(transition.trigger_category.value if hasattr(transition.trigger_category, "value") else transition.trigger_category),
                    metadata_json=transition.metadata or {},
                    transition_timestamp=t_ts,
                )
                session.add(trans_m)
            self.persistence_degraded = False
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Source transition DB write failed: %s", str(e))

    def save_outage_episode(self, episode: OutageEpisode) -> None:
        """Persist or update operational outage episode."""
        start_ts = pd.to_datetime(episode.started_at, utc=True).to_pydatetime()
        res_ts = pd.to_datetime(episode.resolved_at, utc=True).to_pydatetime() if episode.resolved_at else None

        try:
            with self.session_manager.session() as session:
                existing = session.execute(
                    select(OutageEpisodeModel).where(OutageEpisodeModel.episode_id == episode.episode_id)
                ).scalar_one_or_none()

                if existing is not None:
                    existing.current_state = str(episode.current_state.value if hasattr(episode.current_state, "value") else episode.current_state)
                    existing.resolved_at = res_ts
                    existing.duration_seconds = episode.duration_seconds
                    existing.affected_stations = episode.affected_stations
                    existing.failure_categories = episode.failure_categories
                    existing.observation_loss_estimate = episode.observation_loss_estimate
                    existing.is_ongoing = episode.is_ongoing
                else:
                    ep_m = OutageEpisodeModel(
                        episode_id=episode.episode_id,
                        source=episode.source,
                        started_at=start_ts,
                        resolved_at=res_ts,
                        initial_state=str(episode.initial_state.value if hasattr(episode.initial_state, "value") else episode.initial_state),
                        current_state=str(episode.current_state.value if hasattr(episode.current_state, "value") else episode.current_state),
                        duration_seconds=episode.duration_seconds,
                        affected_stations=episode.affected_stations,
                        failure_categories=episode.failure_categories,
                        observation_loss_estimate=episode.observation_loss_estimate,
                        assumptions_version="v1.0.0",
                        is_ongoing=episode.is_ongoing,
                    )
                    session.add(ep_m)
            self.persistence_degraded = False
        except Exception as e:
            self.persistence_degraded = True
            logger.warning("Outage episode DB write failed: %s", str(e))

    def record_latency(self, latency_ms: float) -> None:
        """Record pipeline execution latency for rolling metrics."""
        self.latencies_history_ms.append(latency_ms)
        if len(self.latencies_history_ms) > 1000:
            self.latencies_history_ms.pop(0)

    # =========================================================================
    # Query APIs with Seamless Database & Cache Fallback
    # =========================================================================

    def get_stations(self) -> List[Dict[str, Any]]:
        """List all stations in network topology with latest live telemetry."""
        results: List[Dict[str, Any]] = []
        for s_id, node in self.topology.stations.items():
            latest = self.get_station_latest(s_id)
            results.append({
                "station_id": s_id,
                "name": node.name,
                "latitude": node.latitude,
                "longitude": node.longitude,
                "elevation_m": node.elevation_m,
                "state": node.state,
                "status": node.status,
                "sampling_interval_seconds": node.sampling_interval_seconds,
                "latest_snapshot": latest,
            })
        return results

    def get_station_by_id(self, station_id: str) -> Optional[Dict[str, Any]]:
        """Get single station metadata and latest status."""
        node = self.topology.stations.get(station_id)
        if not node:
            return None
        latest = self.get_station_latest(station_id)
        return {
            "station_id": station_id,
            "name": node.name,
            "latitude": node.latitude,
            "longitude": node.longitude,
            "elevation_m": node.elevation_m,
            "state": node.state,
            "status": node.status,
            "sampling_interval_seconds": node.sampling_interval_seconds,
            "latest_snapshot": latest,
        }

    def get_station_latest(self, station_id: str) -> Optional[LiveStationSnapshot]:
        """Fetch real-time snapshot for a given station from cache or DB."""
        node = self.topology.stations.get(station_id)
        name = node.name if node else f"Station {station_id}"
        lat = node.latitude if node else 0.0
        lon = node.longitude if node else 0.0
        elev = node.elevation_m if node else 0.0

        # 1. Check in-memory state
        stn_keys = [k for k in self.observation_order if k.startswith(f"{station_id}::")]
        health = self.get_station_health(station_id)

        # Count active anomalies in last 24h
        cutoff_24h = (datetime.now(timezone.utc) - pd.Timedelta(hours=24)).isoformat()
        active_anom_count = sum(
            1 for ev in self.anomaly_events.values()
            if ev.station_id == station_id and ev.timestamp >= cutoff_24h
        )

        if stn_keys:
            latest_obs = self.observations[stn_keys[-1]]
            h_score = health.overall_health_score if (health and health.overall_health_score is not None) else None
            h_band = health.status_band.value if (health and hasattr(health.status_band, "value")) else (str(health.status_band) if health else "HEALTHY")
            return LiveStationSnapshot(
                station_id=station_id,
                station_name=name,
                latitude=lat,
                longitude=lon,
                elevation_m=elev,
                last_seen_timestamp=latest_obs.timestamp.astimezone(timezone.utc).isoformat(),
                latest_temperature_c=latest_obs.temperature,
                latest_humidity_pct=latest_obs.humidity,
                latest_pressure_hpa=latest_obs.pressure,
                latest_decision="NORMAL",
                latest_health_score=h_score,
                latest_health_band=h_band,
                active_anomaly_count_24h=active_anom_count,
            )

        # 2. Query from database if in-memory empty (e.g. after backend restart)
        try:
            with self.session_manager.session() as session:
                latest_m = session.execute(
                    select(WeatherObservationModel)
                    .where(WeatherObservationModel.station_id == station_id)
                    .order_by(desc(WeatherObservationModel.observation_timestamp))
                    .limit(1)
                ).scalar_one_or_none()

                if latest_m:
                    h_score = health.overall_health_score if (health and health.overall_health_score is not None) else None
                    h_band = health.status_band.value if (health and hasattr(health.status_band, "value")) else (str(health.status_band) if health else "HEALTHY")
                    return LiveStationSnapshot(
                        station_id=station_id,
                        station_name=name,
                        latitude=lat,
                        longitude=lon,
                        elevation_m=elev,
                        last_seen_timestamp=ensure_utc_iso(latest_m.observation_timestamp),
                        latest_temperature_c=latest_m.temperature_c,
                        latest_humidity_pct=latest_m.relative_humidity_pct,
                        latest_pressure_hpa=latest_m.sea_level_pressure_hpa,
                        latest_decision="NORMAL",
                        latest_health_score=h_score,
                        latest_health_band=h_band,
                        active_anomaly_count_24h=active_anom_count,
                    )
        except Exception as e:
            logger.debug("Database query for latest snapshot failed: %s", str(e))

        return LiveStationSnapshot(
            station_id=station_id,
            station_name=name,
            latitude=lat,
            longitude=lon,
            elevation_m=elev,
        )

    def get_station_history(
        self,
        station_id: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
        source: Optional[str] = None,
        is_synthetic: Optional[bool] = None,
        order: str = "asc",
    ) -> Tuple[List[WeatherObservation], int]:
        """Query chronological observation history with filters, provenance isolation, and pagination."""
        start_dt = ensure_utc(start_time) if isinstance(start_time, datetime) else None
        end_dt = ensure_utc(end_time) if isinstance(end_time, datetime) else None
        lim = limit if isinstance(limit, int) else 100
        off = offset if isinstance(offset, int) else 0
        order_str = str(order).lower() if isinstance(order, str) else "asc"

        # Try database query first for persistence integrity
        try:
            with self.session_manager.session() as session:
                query = select(WeatherObservationModel).where(WeatherObservationModel.station_id == station_id)
                if start_dt:
                    query = query.where(WeatherObservationModel.observation_timestamp >= start_dt)
                if end_dt:
                    query = query.where(WeatherObservationModel.observation_timestamp <= end_dt)
                if source:
                    if source in ("SYNTHETIC_VALIDATION", "SIMULATOR"):
                        query = query.where(WeatherObservationModel.source.in_(["SYNTHETIC_VALIDATION", "SIMULATOR"]))
                    else:
                        query = query.where(WeatherObservationModel.source == source)
                if is_synthetic is not None:
                    query = query.where(WeatherObservationModel.is_synthetic == is_synthetic)

                count_q = select(func.count()).select_from(query.subquery())
                total_count = session.execute(count_q).scalar_one()

                if order_str == "desc":
                    query = query.order_by(WeatherObservationModel.observation_timestamp.desc()).offset(off).limit(lim)
                else:
                    query = query.order_by(WeatherObservationModel.observation_timestamp.asc()).offset(off).limit(lim)

                rows = session.execute(query).scalars().all()

                if total_count > 0:
                    records: List[WeatherObservation] = []
                    for r in rows:
                        obs = WeatherObservation(
                            station_id=r.station_id,
                            timestamp=ensure_utc(r.observation_timestamp),
                            temperature=r.temperature_c,
                            humidity=r.relative_humidity_pct,
                            pressure=r.sea_level_pressure_hpa,
                            station_pressure_hpa=r.station_pressure_hpa,
                            dew_point_c=r.dew_point_c,
                            latitude=r.latitude,
                            longitude=r.longitude,
                            elevation=r.elevation or 0.0,
                            source=r.source,
                            report_type=r.report_type,
                            data_quality_status=r.data_quality_status,
                            is_synthetic=r.is_synthetic,
                            raw_quality_flags=r.raw_quality_flags or {},
                            ingestion_timestamp=ensure_utc(r.ingestion_timestamp),
                            metadata=r.metadata_json or {},
                        )
                        records.append(obs)
                    return records, total_count

        except Exception as e:
            logger.debug("DB query for history failed, falling back to cache: %s", str(e))

        # In-memory fallback
        stn_keys = [k for k in self.observation_order if k.startswith(f"{station_id}::")]
        records_mem: List[WeatherObservation] = []

        for k in stn_keys:
            obs = self.observations[k]
            obs_time = obs.timestamp.astimezone(timezone.utc)
            if start_dt and obs_time < start_dt:
                continue
            if end_dt and obs_time > end_dt:
                continue
            if source:
                obs_src = str(obs.source.value if hasattr(obs.source, "value") else obs.source)
                if source in ("SYNTHETIC_VALIDATION", "SIMULATOR"):
                    if obs_src not in ("SYNTHETIC_VALIDATION", "SIMULATOR"):
                        continue
                elif obs_src != source:
                    continue
            if is_synthetic is not None and obs.is_synthetic != is_synthetic:
                continue
            records_mem.append(obs)

        total_count = len(records_mem)
        if order_str == "desc":
            records_mem = list(reversed(records_mem))
        paginated = records_mem[off : off + lim]
        return paginated, total_count

    def get_station_health(self, station_id: str) -> Optional[SensorHealthSummary]:
        """Fetch latest SensorHealthSummary for a station from memory or database."""
        if station_id in self.latest_health_by_station:
            return self.latest_health_by_station[station_id]

        try:
            with self.session_manager.session() as session:
                h_model = session.execute(
                    select(SensorHealthSnapshotModel)
                    .where(SensorHealthSnapshotModel.station_id == station_id)
                    .order_by(desc(SensorHealthSnapshotModel.timestamp))
                    .limit(1)
                ).scalar_one_or_none()

                if h_model:
                    comp_scores = ComponentHealthScores(**h_model.component_scores) if h_model.component_scores else ComponentHealthScores(anomaly_health=100.0, data_quality_health=100.0, communication_health=100.0, temporal_stability_health=100.0, spatial_consistency_health=100.0)
                    param_health = {
                        k: ParameterHealth(**v) if isinstance(v, dict) else v
                        for k, v in (h_model.parameter_health or {}).items()
                    }
                    summary = SensorHealthSummary(
                        station_id=h_model.station_id,
                        overall_health_score=h_model.overall_health_score,
                        status_band=HealthStatusBand(h_model.status_band),
                        trend=HealthTrend(h_model.trend),
                        component_scores=comp_scores,
                        parameter_health=param_health,
                        maintenance_recommendation=MaintenanceRecommendation(h_model.maintenance_recommendation),
                        summary="Station health retrieved from persistent database.",
                        recommended_action="Follow standard operational maintenance guidelines.",
                        audit_metadata=HealthAuditMetadata(),
                    )
                    self.latest_health_by_station[station_id] = summary
                    return summary

        except Exception as e:
            logger.debug("DB query for station health failed: %s", str(e))

        return None

    def get_anomalies(
        self,
        station_id: Optional[str] = None,
        decision: Optional[str] = None,
        severity: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[AnomalyEventRecord], int]:
        """Query anomalies with multi-field filtering and pagination."""
        stn_filter = station_id.strip() if isinstance(station_id, str) and station_id.strip() else None
        dec_filter = decision.strip() if isinstance(decision, str) and decision.strip() else None
        sev_filter = severity.strip().upper() if isinstance(severity, str) and severity.strip() else None
        start_dt = start_time.astimezone(timezone.utc) if isinstance(start_time, datetime) else None
        end_dt = end_time.astimezone(timezone.utc) if isinstance(end_time, datetime) else None
        lim = limit if isinstance(limit, int) else 50
        off = offset if isinstance(offset, int) else 0

        # Try database query
        try:
            with self.session_manager.session() as session:
                query = select(AnomalyEventModel)
                if stn_filter:
                    query = query.where(AnomalyEventModel.station_id == stn_filter)
                if dec_filter:
                    query = query.where(AnomalyEventModel.decision == dec_filter)
                if sev_filter:
                    query = query.where(AnomalyEventModel.severity == sev_filter)
                if start_dt:
                    query = query.where(AnomalyEventModel.timestamp >= start_dt)
                if end_dt:
                    query = query.where(AnomalyEventModel.timestamp <= end_dt)

                count_q = select(func.count()).select_from(query.subquery())
                total_count = session.execute(count_q).scalar_one()

                query = query.order_by(desc(AnomalyEventModel.timestamp)).offset(off).limit(lim)
                rows = session.execute(query).scalars().all()

                if total_count > 0:
                    records: List[AnomalyEventRecord] = []
                    for r in rows:
                        rec = AnomalyEventRecord(
                            event_id=r.event_id,
                            station_id=r.station_id,
                            timestamp=r.timestamp.astimezone(timezone.utc).isoformat(),
                            decision=HybridDecisionType(r.decision) if r.decision in HybridDecisionType.__members__.values() else r.decision,
                            severity=r.severity,
                            reason_codes=r.reason_codes or [],
                            observed_values=r.observed_values or {},
                            recommended_values=r.recommended_values or {},
                            explanation_summary=r.explanation_summary,
                        )
                        records.append(rec)
                    return records, total_count
        except Exception as e:
            logger.debug("DB query for anomalies failed, falling back to cache: %s", str(e))

        # In-memory fallback
        matched: List[AnomalyEventRecord] = []
        for ev_id in reversed(self.anomaly_order):
            ev = self.anomaly_events[ev_id]
            if stn_filter and ev.station_id != stn_filter:
                continue
            if dec_filter and ev.decision.value != dec_filter and ev.decision != dec_filter:
                continue
            if sev_filter and ev.severity.upper() != sev_filter:
                continue

            ev_time = pd.to_datetime(ev.timestamp, utc=True)
            if start_dt and ev_time < start_dt:
                continue
            if end_dt and ev_time > end_dt:
                continue

            matched.append(ev)

        total_count = len(matched)
        paginated = matched[off : off + lim]
        return paginated, total_count

    def get_anomaly_by_id(self, event_id: str) -> Optional[AnomalyEventRecord]:
        """Get single anomaly event record by unique event ID."""
        if event_id in self.anomaly_events:
            return self.anomaly_events[event_id]

        try:
            with self.session_manager.session() as session:
                r = session.execute(
                    select(AnomalyEventModel).where(AnomalyEventModel.event_id == event_id)
                ).scalar_one_or_none()

                if r:
                    return AnomalyEventRecord(
                        event_id=r.event_id,
                        station_id=r.station_id,
                        timestamp=r.timestamp.astimezone(timezone.utc).isoformat(),
                        decision=HybridDecisionType(r.decision) if r.decision in HybridDecisionType.__members__.values() else r.decision,
                        severity=r.severity,
                        reason_codes=r.reason_codes or [],
                        observed_values=r.observed_values or {},
                        recommended_values=r.recommended_values or {},
                        explanation_summary=r.explanation_summary,
                    )
        except Exception as e:
            logger.debug("DB query for anomaly by ID failed: %s", str(e))

        return None

    def get_anomaly_explanation(self, event_id: str) -> Optional[ExplanationSummary]:
        """Get complete explainability package for an anomaly event."""
        if event_id in self.explanations:
            return self.explanations[event_id]

        try:
            with self.session_manager.session() as session:
                exp_m = session.execute(
                    select(ExplanationModel).where(ExplanationModel.event_id == event_id)
                ).scalar_one_or_none()

                if exp_m:
                    return ExplanationSummary(
                        event_id=exp_m.event_id,
                        timestamp=exp_m.timestamp.astimezone(timezone.utc).isoformat(),
                        station_id=exp_m.station_id,
                        summary=exp_m.natural_language_explanation or "",
                        natural_language_explanation=exp_m.natural_language_explanation or "",
                        feature_attributions=exp_m.feature_attributions or {},
                        spatial_evidence=exp_m.spatial_evidence or {},
                        temporal_evidence=exp_m.temporal_evidence or {},
                        multivariate_evidence=exp_m.multivariate_evidence or {},
                        evidence_hierarchy=exp_m.evidence_hierarchy or {},
                        recommended_sop_steps=exp_m.recommended_sop_steps or [],
                    )
        except Exception as e:
            logger.debug("DB query for explanation failed: %s", str(e))

        return None

    def get_corrections(
        self,
        station_id: Optional[str] = None,
        status: Optional[str] = None,
        target_variable: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[CorrectionRecommendation], int]:
        """Query advisory correction recommendations with filters and pagination."""
        stn_filter = station_id.strip() if isinstance(station_id, str) and station_id.strip() else None
        status_filter = status.strip() if isinstance(status, str) and status.strip() else None
        var_filter = target_variable.strip() if isinstance(target_variable, str) and target_variable.strip() else None
        lim = limit if isinstance(limit, int) else 50
        off = offset if isinstance(offset, int) else 0

        # Try database query
        try:
            with self.session_manager.session() as session:
                query = select(CorrectionRecommendationModel)
                if stn_filter:
                    query = query.where(CorrectionRecommendationModel.station_id == stn_filter)
                if status_filter:
                    query = query.where(CorrectionRecommendationModel.status == status_filter)
                if var_filter:
                    query = query.where(CorrectionRecommendationModel.target_variable == var_filter)

                count_q = select(func.count()).select_from(query.subquery())
                total_count = session.execute(count_q).scalar_one()

                query = query.order_by(desc(CorrectionRecommendationModel.timestamp)).offset(off).limit(lim)
                rows = session.execute(query).scalars().all()

                if total_count > 0:
                    records: List[CorrectionRecommendation] = []
                    for r in rows:
                        unc = UncertaintyEstimate(**r.uncertainty_json) if r.uncertainty_json else None
                        corr = CorrectionRecommendation(
                            observation_id=r.observation_id,
                            station_id=r.station_id,
                            timestamp=r.timestamp.astimezone(timezone.utc).isoformat(),
                            target_variable=r.target_variable,
                            observed_value=r.observed_value,
                            recommended_value=r.recommended_value,
                            status=RecommendationStatus(r.status) if r.status in RecommendationStatus.__members__.values() else r.status,
                            method=EstimationMethod(r.method) if r.method in EstimationMethod.__members__.values() else r.method,
                            decision_type="PROBABLE_SENSOR_ANOMALY",
                            uncertainty=unc,
                            multivariate_consistent=r.multivariate_consistent,
                            reason_codes=r.reason_codes or [],
                            operator_summary=r.operator_summary or "",
                            audit_metadata=CorrectionAuditMetadata(),
                        )
                        records.append(corr)
                    return records, total_count
        except Exception as e:
            logger.debug("DB query for corrections failed, falling back to cache: %s", str(e))

        # In-memory fallback
        matched: List[CorrectionRecommendation] = []
        for obs_id in reversed(self.correction_order):
            corr = self.corrections[obs_id]
            if stn_filter and corr.station_id != stn_filter:
                continue
            if status_filter and corr.status.value != status_filter and corr.status != status_filter:
                continue
            if var_filter and corr.target_variable != var_filter:
                continue
            matched.append(corr)

        total_count = len(matched)
        paginated = matched[off : off + lim]
        return paginated, total_count

    def get_correction_by_id(self, observation_id: str) -> Optional[CorrectionRecommendation]:
        """Get single correction recommendation by observation ID."""
        if observation_id in self.corrections:
            return self.corrections[observation_id]

        try:
            with self.session_manager.session() as session:
                r = session.execute(
                    select(CorrectionRecommendationModel).where(CorrectionRecommendationModel.observation_id == observation_id)
                ).scalar_one_or_none()

                if r:
                    unc = UncertaintyEstimate(**r.uncertainty_json) if r.uncertainty_json else None
                    return CorrectionRecommendation(
                        observation_id=r.observation_id,
                        station_id=r.station_id,
                        timestamp=r.timestamp.astimezone(timezone.utc).isoformat(),
                        target_variable=r.target_variable,
                        observed_value=r.observed_value,
                        recommended_value=r.recommended_value,
                        status=RecommendationStatus(r.status) if r.status in RecommendationStatus.__members__.values() else r.status,
                        method=EstimationMethod(r.method) if r.method in EstimationMethod.__members__.values() else r.method,
                        decision_type="PROBABLE_SENSOR_ANOMALY",
                        uncertainty=unc,
                        multivariate_consistent=r.multivariate_consistent,
                        reason_codes=r.reason_codes or [],
                        operator_summary=r.operator_summary or "",
                        audit_metadata=CorrectionAuditMetadata(),
                    )

        except Exception as e:
            logger.debug("DB query for correction by ID failed: %s", str(e))

        return None

    def get_system_health(self) -> SystemHealthStatus:
        """Compute end-to-end service status of all core subsystems."""
        now = datetime.now(timezone.utc)
        uptime = (now - self.startup_time).total_seconds()
        mean_latency = float(pd.Series(self.latencies_history_ms).mean()) if self.latencies_history_ms else 0.0

        db_conn = self.session_manager.check_connection()
        db_status = "CONNECTED" if db_conn and not self.persistence_degraded else ("DEGRADED" if not self.persistence_degraded else "DISCONNECTED")

        return SystemHealthStatus(
            status="HEALTHY" if db_conn else "DEGRADED",
            service="SkyGuard AI Real-Time Processing Engine",
            version="1.0.0",
            database_status=db_status,
            model_registry_status="LOADED",
            active_model_id="isolation_forest_s42",
            spatial_topology_stations_count=len(self.topology.stations),
            active_monitored_stations=len(self.topology.stations),
            total_observations_processed=self.processed_observations_count,
            last_processed_timestamp=self.last_processed_timestamp,
            mean_pipeline_latency_ms=round(mean_latency, 2),
            replay_simulator_status="READY",
            uptime_seconds=round(uptime, 1),
        )
