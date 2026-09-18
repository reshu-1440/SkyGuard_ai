"""Real-Time Processing Engine orchestrating single-observation analytical pipelines in SkyGuard AI."""

from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import numpy as np
import pandas as pd

from backend.app.core.database import DatabaseRepository
from backend.app.core.logging import get_logger
from backend.app.core.state import StationStateManager
from backend.app.core.ws_manager import WebSocketConnectionManager, get_ws_manager
from backend.app.models.events import (
    AnomalyCreatedPayload,
    CorrectionCreatedPayload,
    EventType,
    HealthUpdatedPayload,
    ObservationUpdatedPayload,
    StationStatusChangedPayload,
    WebSocketEnvelope,
)
from backend.app.models.observation import QualityStatus, WeatherObservation
from backend.app.models.processing import (
    AnomalyEventRecord,
    ProcessingLatencyBreakdown,
    ProcessingResult,
    ProcessingStatus,
)
from ml.decision.engine import HybridDecisionEngine
from ml.decision.schema import (
    DataQualityEvidence,
    EvidenceState,
    HybridDecision,
    HybridDecisionType,
    MLAnomalyEvidence,
    MultivariateEvidence,
    ObservationEvidence,
    SpatialEvidence,
    TemporalEvidence,
)
from ml.explainability.engine import ExplainabilityEngine
from ml.explainability.schema import ExplanationSummary
from ml.explainability.synthesizer import ExplanationSynthesizer
from ml.health.health_engine import SensorHealthEngine
from ml.health.health_schema import SensorHealthSummary
from ml.imputation.correction_engine import CorrectionRecommendationEngine
from ml.imputation.schema import CorrectionRecommendation
from ml.models.isolation_forest import IsolationForestDetector
from ml.spatial.engine import SpatialContextEngine
from ml.spatial.topology import SpatialNetworkTopology

logger = get_logger("engine")


class RealTimeProcessingEngine:
    """Processes incoming WeatherObservations sequentially through the full intelligence stack.
    
    Guarantees:
    1. Offline/Online Parity: Shares exact validation, spatial, hybrid, explainability, health, and repair engines.
    2. Causal Operation: Future timestamps are strictly excluded from sliding windows and neighbor pools.
    3. Resilient Degradation: Catches ML inference exceptions and safely falls back to meteorological physics.
    4. Station Isolation: Errors in one station state do not halt or corrupt other stations.
    5. Non-Destructive Persistence: Persists raw observations and derived outputs without mutating inputs.
    """

    def __init__(
        self,
        repository: Optional[DatabaseRepository] = None,
        state_manager: Optional[StationStateManager] = None,
        spatial_engine: Optional[SpatialContextEngine] = None,
        decision_engine: Optional[HybridDecisionEngine] = None,
        health_engine: Optional[SensorHealthEngine] = None,
        correction_engine: Optional[CorrectionRecommendationEngine] = None,
        ml_model: Optional[IsolationForestDetector] = None,
        models_dir: Union[str, Path] = "models/registry",
        ws_manager: Optional[WebSocketConnectionManager] = None,
    ) -> None:
        self.repository = repository or DatabaseRepository()
        self.state_manager = state_manager or StationStateManager()
        self.spatial_engine = spatial_engine or SpatialContextEngine(topology=self.repository.topology)
        self.decision_engine = decision_engine or HybridDecisionEngine()
        self.explainability_engine = ExplainabilityEngine(model=ml_model)
        self.health_engine = health_engine or SensorHealthEngine()
        self.correction_engine = correction_engine or CorrectionRecommendationEngine(spatial_engine=self.spatial_engine)
        self.ws_manager = ws_manager or get_ws_manager()
        
        self.models_dir = Path(models_dir)
        self.ml_model = ml_model
        self._load_default_model_if_available()

        self.event_counter = 0

    def _load_default_model_if_available(self) -> None:
        """Load default Isolation Forest model from registry if not provided."""
        if self.ml_model is not None:
            return

        weights_path = self.models_dir / "isolation_forest_s42_weights.joblib"
        if weights_path.exists():
            try:
                self.ml_model = IsolationForestDetector.load(weights_path)
                self.explainability_engine.set_model(self.ml_model)
            except Exception:
                self.ml_model = None

    def _generate_event_id(self, station_id: str, timestamp_str: str) -> str:
        """Generate unique, human-readable anomaly event ID."""
        self.event_counter += 1
        clean_date = timestamp_str[:10].replace("-", "")
        return f"ANOM-{clean_date}-{station_id[-6:]}-{self.event_counter:04d}"

    def _extract_causal_features(
        self,
        obs: WeatherObservation,
        history: List[WeatherObservation],
    ) -> Dict[str, float]:
        """Compute rolling means, standard deviations, deltas, and diurnal features causally."""
        t_dt = obs.timestamp.astimezone(timezone.utc)
        
        # Diurnal cyclical features
        hour = t_dt.hour + t_dt.minute / 60.0
        day_of_year = t_dt.timetuple().tm_yday
        
        sin_hour = float(math.sin(2.0 * math.pi * hour / 24.0))
        cos_hour = float(math.cos(2.0 * math.pi * hour / 24.0))
        sin_doy = float(math.sin(2.0 * math.pi * day_of_year / 365.25))
        cos_doy = float(math.cos(2.0 * math.pi * day_of_year / 365.25))

        # Recent valid series including current observation
        all_obs = history + [obs]
        
        # Temperature sliding window (1h / ~12 steps)
        t_vals = [o.temperature for o in all_obs[-12:] if o.temperature is not None]
        rh_vals = [o.humidity for o in all_obs[-12:] if o.humidity is not None]
        slp_vals = [o.pressure for o in all_obs[-12:] if o.pressure is not None]

        t_cur = obs.temperature if obs.temperature is not None else 20.0
        rh_cur = obs.humidity if obs.humidity is not None else 50.0
        slp_cur = obs.pressure if obs.pressure is not None else 1013.25

        t_mean_1h = float(np.mean(t_vals)) if t_vals else t_cur
        t_std_1h = float(np.std(t_vals, ddof=1)) if len(t_vals) > 1 else 0.0

        rh_mean_1h = float(np.mean(rh_vals)) if rh_vals else rh_cur
        rh_std_1h = float(np.std(rh_vals, ddof=1)) if len(rh_vals) > 1 else 0.0

        slp_mean_1h = float(np.mean(slp_vals)) if slp_vals else slp_cur

        # Deltas & Rate of change
        t_delta = 0.0
        t_rate = 0.0
        rh_delta = 0.0
        slp_delta = 0.0
        t_unchanged_min = 0.0

        if len(all_obs) >= 2:
            prev_obs = all_obs[-2]
            dt_min = max(0.1, (obs.timestamp - prev_obs.timestamp).total_seconds() / 60.0)
            if obs.temperature is not None and prev_obs.temperature is not None:
                t_delta = obs.temperature - prev_obs.temperature
                t_rate = t_delta / dt_min
            if obs.humidity is not None and prev_obs.humidity is not None:
                rh_delta = obs.humidity - prev_obs.humidity
            if obs.pressure is not None and prev_obs.pressure is not None:
                slp_delta = obs.pressure - prev_obs.pressure

            # Flatline persistence
            unchanged_cnt = 0
            for k in range(len(all_obs) - 1, 0, -1):
                cur_v = all_obs[k].temperature
                past_v = all_obs[k - 1].temperature
                if cur_v is not None and past_v is not None and abs(cur_v - past_v) < 1e-4:
                    unchanged_cnt += 1
                else:
                    break
            t_unchanged_min = unchanged_cnt * 5.0

        # Physical interaction features
        temp_rh_interaction = t_delta * rh_delta
        temp_slp_interaction = t_delta * slp_delta
        joint_divergence = math.sqrt((t_delta ** 2) + ((rh_delta / 5.0) ** 2) + ((slp_delta / 2.0) ** 2))
        joint_mag = abs(t_delta) + abs(rh_delta / 10.0) + abs(slp_delta / 3.0)

        return {
            "temperature_c": t_cur,
            "relative_humidity_pct": rh_cur,
            "sea_level_pressure_hpa": slp_cur,
            "sin_hour": sin_hour,
            "cos_hour": cos_hour,
            "sin_day_of_year": sin_doy,
            "cos_day_of_year": cos_doy,
            "temperature_c_rolling_mean_1h": t_mean_1h,
            "temperature_c_rolling_std_1h": t_std_1h,
            "temperature_c_delta": t_delta,
            "temperature_c_rate_per_minute": t_rate,
            "temperature_c_duration_unchanged_minutes": t_unchanged_min,
            "relative_humidity_pct_rolling_mean_1h": rh_mean_1h,
            "relative_humidity_pct_rolling_std_1h": rh_std_1h,
            "relative_humidity_pct_delta": rh_delta,
            "sea_level_pressure_hpa_rolling_mean_1h": slp_mean_1h,
            "sea_level_pressure_hpa_delta": slp_delta,
            "temp_rh_delta_interaction": temp_rh_interaction,
            "joint_temp_rh_divergence": joint_divergence,
            "temp_slp_delta_interaction": temp_slp_interaction,
            "joint_standardized_anomaly_magnitude": joint_mag,
        }

    def process_observation(self, observation: WeatherObservation) -> ProcessingResult:
        """Process a single WeatherObservation end-to-end through the analytical pipeline.
        
        Args:
            observation: Canonical normalized WeatherObservation.
            
        Returns:
            Structured `ProcessingResult` with full provenance, decisions, health, and latency.
        """
        t_start = time.perf_counter_ns()
        
        # 1. Ingestion & Temporal Validation
        t_ingest_start = time.perf_counter_ns()
        station_buffer = self.state_manager.get_or_create_buffer(observation.station_id)
        ordering_status, ordering_reason = station_buffer.check_temporal_ordering(observation)
        t_ingest_end = time.perf_counter_ns()

        if ordering_status == ProcessingStatus.DUPLICATE_SKIPPED:
            # Idempotent skip: return skipped result without duplicating state
            total_lat = (time.perf_counter_ns() - t_start) / 1e6
            return ProcessingResult(
                observation=observation,
                status=ProcessingStatus.DUPLICATE_SKIPPED,
                latency=ProcessingLatencyBreakdown(
                    ingestion_latency_ms=(t_ingest_end - t_ingest_start) / 1e6,
                    total_pipeline_latency_ms=total_lat,
                ),
            )

        # 2. Causal Feature Generation
        t_feat_start = time.perf_counter_ns()
        causal_history = station_buffer.get_causal_history(
            before_timestamp=observation.timestamp,
            max_points=24,
        )
        features = self._extract_causal_features(observation, causal_history)
        t_feat_end = time.perf_counter_ns()

        # 3. Resilient ML Inference
        t_ml_start = time.perf_counter_ns()
        ml_score: Optional[float] = None
        ml_is_anom = False
        ml_failed = False
        ml_evidence = MLAnomalyEvidence(evidence_state=EvidenceState.UNAVAILABLE)

        if self.ml_model is not None:
            try:
                # Format features into single-row DataFrame matching model schema
                feat_df = pd.DataFrame([features])
                scores = self.ml_model.score_samples(feat_df)
                ml_score = float(scores[0]) if len(scores) > 0 else 0.0
                
                # Check threshold
                threshold = self.ml_model.calibrated_threshold or 0.58
                ml_is_anom = ml_score >= threshold
                ml_evidence = MLAnomalyEvidence(
                    raw_model_score=ml_score,
                    normalized_anomaly_score=ml_score,
                    ml_is_anomaly=ml_is_anom,
                    model_version=self.ml_model.model_id,
                    evidence_state=EvidenceState.SUPPORTS if ml_is_anom else EvidenceState.NEUTRAL,
                )
            except Exception:
                ml_failed = True
                ml_evidence = MLAnomalyEvidence(
                    raw_model_score=None,
                    normalized_anomaly_score=0.0,
                    ml_is_anomaly=False,
                    model_version="fallback_rule_mode",
                    evidence_state=EvidenceState.UNAVAILABLE,
                )
        t_ml_end = time.perf_counter_ns()

        # 4. Spatial Context Evaluation
        t_spatial_start = time.perf_counter_ns()
        neighbor_pool = self.state_manager.get_contemporaneous_neighbor_pool(
            target_station_id=observation.station_id,
            target_timestamp=observation.timestamp,
            temporal_tolerance_minutes=30.0,
        )
        target_vals = {
            "temperature_c": observation.temperature,
            "relative_humidity_pct": observation.humidity,
            "sea_level_pressure_hpa": observation.pressure,
            "station_pressure_hpa": observation.station_pressure_hpa,
            "elevation_m": observation.elevation,
        }
        spatial_context = self.spatial_engine.evaluate_observation(
            target_station_id=observation.station_id,
            target_timestamp=observation.timestamp,
            target_values=target_vals,
            neighbor_data_pool=neighbor_pool,
        )
        t_spatial_end = time.perf_counter_ns()

        # 5. Hybrid Decision Arbitration
        t_decision_start = time.perf_counter_ns()
        missing_vars = []
        if observation.temperature is None:
            missing_vars.append("temperature_c")
        if observation.humidity is None:
            missing_vars.append("relative_humidity_pct")
        if observation.pressure is None:
            missing_vars.append("sea_level_pressure_hpa")

        is_phys_out = False
        if observation.temperature is not None and (observation.temperature < -50.0 or observation.temperature > 60.0):
            is_phys_out = True
        if observation.humidity is not None and (observation.humidity < 0.0 or observation.humidity > 100.0):
            is_phys_out = True
        if observation.pressure is not None and (observation.pressure < 850.0 or observation.pressure > 1090.0):
            is_phys_out = True

        raw_qs = str(observation.data_quality_status.value if hasattr(observation.data_quality_status, "value") else observation.data_quality_status)
        mapped_qs = "CORRUPTED" if raw_qs == "ERROR" else ("GAP" if raw_qs == "MISSING" else raw_qs)

        data_quality_ev = DataQualityEvidence(
            quality_status=mapped_qs,
            missing_fields=missing_vars,
            is_duplicate=(ordering_status == ProcessingStatus.DUPLICATE_SKIPPED),
            is_out_of_order=(ordering_status in (ProcessingStatus.OUT_OF_ORDER, ProcessingStatus.LATE_ARRIVAL)),
            is_physical_out_of_bounds=is_phys_out,
            evidence_state=EvidenceState.SUPPORTS if (
                raw_qs not in ("VALID", QualityStatus.VALID)
                or len(missing_vars) > 0
                or is_phys_out
            ) else EvidenceState.NEUTRAL,
        )
        temporal_ev = TemporalEvidence(
            temp_rate_per_min=features.get("temperature_c_rate_per_minute"),
            consecutive_unchanged_count=int(features.get("temperature_c_duration_unchanged_minutes", 0.0) / 5.0),
            flatline_duration_minutes=features.get("temperature_c_duration_unchanged_minutes", 0.0),
            evidence_state=EvidenceState.SUPPORTS if features.get("temperature_c_duration_unchanged_minutes", 0.0) >= 30.0 else EvidenceState.NEUTRAL,
        )
        multivariate_ev = MultivariateEvidence(
            dew_point_spread_c=(observation.temperature - observation.dew_point_c) if (observation.temperature is not None and observation.dew_point_c is not None) else None,
            evidence_state=EvidenceState.NEUTRAL,
        )
        spatial_ev = SpatialEvidence(
            configured_neighbor_count=spatial_context.configured_neighbors_count,
            valid_neighbor_count=spatial_context.valid_neighbors_count,
            context_category=spatial_context.context_category,
            temp_consensus_fraction=spatial_context.temperature_consensus.fraction_similar if spatial_context.temperature_consensus else 0.0,
            evidence_state=EvidenceState.SUPPORTS if spatial_context.context_category.value == "REGIONAL_PATTERN" else EvidenceState.NEUTRAL,
        )

        obs_evidence = ObservationEvidence(
            station_id=observation.station_id,
            timestamp=observation.timestamp.astimezone(timezone.utc).isoformat(),
            data_quality=data_quality_ev,
            ml_anomaly=ml_evidence,
            temporal=temporal_ev,
            multivariate=multivariate_ev,
            spatial=spatial_ev,
        )

        decision = self.decision_engine.evaluate(obs_evidence)
        t_decision_end = time.perf_counter_ns()

        # 6. Explainability Synthesis
        t_exp_start = time.perf_counter_ns()
        explanation = self.explainability_engine.explain(
            decision=decision,
            feature_vector=features,
            target_variable="temperature_c",
            target_value=observation.temperature,
            direct_values=target_vals,
        )
        t_exp_end = time.perf_counter_ns()

        # 7. Sensor Health Update
        t_health_start = time.perf_counter_ns()
        past_decisions = list(station_buffer.decisions) + [decision]
        health_summary = self.health_engine.evaluate_station_health(
            station_id=observation.station_id,
            decisions=past_decisions,
        )
        t_health_end = time.perf_counter_ns()

        # 8. Advisory Correction Recommendation
        t_corr_start = time.perf_counter_ns()
        corr_rec: Optional[CorrectionRecommendation] = None
        if observation.temperature is not None:
            corr_rec = self.correction_engine.recommend_for_variable(
                station_id=observation.station_id,
                timestamp=observation.timestamp,
                target_variable="temperature_c",
                observed_value=observation.temperature,
                decision_type=decision.decision,
                reason_codes=[str(r.value if hasattr(r, "value") else r) for r in decision.reason_codes],
                spatial_evidence=spatial_context,
                temporal_history=[o.temperature for o in causal_history if o.temperature is not None],
                sensor_health=health_summary,
            )
        t_corr_end = time.perf_counter_ns()

        # 9. Non-Destructive Persistence & State Updates
        t_persist_start = time.perf_counter_ns()
        station_buffer.append_observation(observation)
        station_buffer.append_decision(decision)
        station_buffer.append_health_snapshot(health_summary)

        self.repository.save_observation(observation)
        self.repository.save_health_snapshot(health_summary)
        if corr_rec is not None:
            self.repository.save_correction(corr_rec)

        assigned_event_id: Optional[str] = None
        is_anomalous = decision.decision in (
            HybridDecisionType.PROBABLE_SENSOR_ANOMALY,
            HybridDecisionType.PROBABLE_DATA_QUALITY_ISSUE,
            HybridDecisionType.UNCERTAIN,
        )

        if is_anomalous:
            assigned_event_id = self._generate_event_id(
                observation.station_id,
                observation.timestamp.astimezone(timezone.utc).isoformat(),
            )
            event_rec = AnomalyEventRecord(
                event_id=assigned_event_id,
                station_id=observation.station_id,
                timestamp=observation.timestamp.astimezone(timezone.utc).isoformat(),
                decision=decision.decision,
                severity=str(decision.severity.value if hasattr(decision.severity, "value") else decision.severity),
                reason_codes=[str(r.value if hasattr(r, "value") else r) for r in decision.reason_codes],
                observed_values=target_vals,
                recommended_values={"temperature_c": corr_rec.recommended_value if corr_rec else None},
                explanation_summary=explanation.summary,
            )

            prov_data = {
                "model_id": self.ml_model.model_id if self.ml_model else "none",
                "model_version": getattr(self.ml_model, "version", "v0.1.0_baseline") if self.ml_model else "none",
                "feature_version": "v1.0.0",
                "decision_engine_version": "hybrid_v1.0.0",
                "explanation_version": "v1.0.0",
            }
            self.repository.save_anomaly_event(event_rec, explanation=explanation, provenance=prov_data)



        t_persist_end = time.perf_counter_ns()
        total_pipeline_ms = (time.perf_counter_ns() - t_start) / 1e6
        self.repository.record_latency(total_pipeline_ms)

        # 10. Broadcast Real-Time WebSocket Events
        if self.ws_manager is not None:
            # 10a. Observation Updated Event
            obs_payload = ObservationUpdatedPayload(
                station_id=observation.station_id,
                station_name=observation.station_name,
                timestamp=observation.timestamp.astimezone(timezone.utc).isoformat(),
                temperature=observation.temperature,
                humidity=observation.humidity,
                pressure=observation.pressure,
                dew_point_c=observation.dew_point_c,
                data_quality_status=str(observation.data_quality_status.value if hasattr(observation.data_quality_status, "value") else observation.data_quality_status),
                freshness_seconds=0,
            )
            self.ws_manager.broadcast_sync(WebSocketEnvelope.create(
                event_id=f"OBS-{observation.station_id[-6:]}-{self.event_counter:04d}",
                event_type=EventType.OBSERVATION_UPDATED,
                station_id=observation.station_id,
                timestamp=observation.timestamp,
                payload=obs_payload,
            ))

            # 10b. Anomaly Created Event (if anomalous)
            if is_anomalous and assigned_event_id is not None:
                anom_payload = AnomalyCreatedPayload(
                    event_id=assigned_event_id,
                    station_id=observation.station_id,
                    station_name=observation.station_name,
                    timestamp=observation.timestamp.astimezone(timezone.utc).isoformat(),
                    decision=str(decision.decision.value if hasattr(decision.decision, "value") else decision.decision),
                    severity=str(decision.severity.value if hasattr(decision.severity, "value") else decision.severity),
                    summary=explanation.summary,
                    reason_codes=[str(r.value if hasattr(r, "value") else r) for r in decision.reason_codes],
                    observed_values=target_vals,
                    recommended_values={"temperature_c": corr_rec.recommended_value if corr_rec else None},
                )
                self.ws_manager.broadcast_sync(WebSocketEnvelope.create(
                    event_id=assigned_event_id,
                    event_type=EventType.ANOMALY_CREATED,
                    station_id=observation.station_id,
                    timestamp=observation.timestamp,
                    payload=anom_payload,
                ))

            # 10c. Health Updated Event
            param_health_dict = {
                k: (v.health_score if hasattr(v, "health_score") else v)
                for k, v in (health_summary.parameter_health or {}).items()
            }
            comp_scores_dict = (
                health_summary.component_scores.model_dump()
                if hasattr(health_summary.component_scores, "model_dump")
                else (health_summary.component_scores if isinstance(health_summary.component_scores, dict) else {})
            )
            health_payload = HealthUpdatedPayload(
                station_id=observation.station_id,
                timestamp=observation.timestamp.astimezone(timezone.utc).isoformat(),
                health_index=health_summary.overall_health_score,
                health_status=str(health_summary.status_band.value if hasattr(health_summary.status_band, "value") else health_summary.status_band),
                health_trend=str(health_summary.trend.value if hasattr(health_summary.trend, "value") else health_summary.trend),
                maintenance_recommendation=str(health_summary.maintenance_recommendation.value if hasattr(health_summary.maintenance_recommendation, "value") else health_summary.maintenance_recommendation),
                parameter_health=param_health_dict,
                component_scores=comp_scores_dict,
            )
            self.ws_manager.broadcast_sync(WebSocketEnvelope.create(
                event_id=f"HLT-{observation.station_id[-6:]}-{self.event_counter:04d}",
                event_type=EventType.HEALTH_UPDATED,
                station_id=observation.station_id,
                timestamp=observation.timestamp,
                payload=health_payload,
            ))

            # 10d. Correction Created Event (if correction generated)
            if corr_rec is not None:
                corr_ts_str = (
                    corr_rec.timestamp.astimezone(timezone.utc).isoformat()
                    if isinstance(corr_rec.timestamp, datetime)
                    else str(corr_rec.timestamp)
                )
                conf_lower = corr_rec.uncertainty.estimate_range[0] if corr_rec.uncertainty else None
                conf_upper = corr_rec.uncertainty.estimate_range[1] if corr_rec.uncertainty else None
                corr_payload = CorrectionCreatedPayload(
                    observation_id=corr_rec.observation_id or f"OBS-{observation.station_id}",
                    station_id=observation.station_id,
                    timestamp=corr_ts_str,
                    target_variable=corr_rec.target_variable,
                    observed_value=corr_rec.observed_value,
                    recommended_value=corr_rec.recommended_value,
                    confidence_lower=conf_lower,
                    confidence_upper=conf_upper,
                    status=str(corr_rec.status.value if hasattr(corr_rec.status, "value") else corr_rec.status),
                    method=str(corr_rec.method.value if hasattr(corr_rec.method, "value") else corr_rec.method),
                )
                self.ws_manager.broadcast_sync(WebSocketEnvelope.create(
                    event_id=f"CORR-{observation.station_id[-6:]}-{self.event_counter:04d}",
                    event_type=EventType.CORRECTION_CREATED,
                    station_id=observation.station_id,
                    timestamp=observation.timestamp,
                    payload=corr_payload,
                ))

        # 11. Terminal Observability Telemetry Logging
        dec_val = decision.decision.value if hasattr(decision.decision, "value") else str(decision.decision)
        qc_val = observation.data_quality_status.value if hasattr(observation.data_quality_status, "value") else str(observation.data_quality_status)
        temp_str = f"{observation.temperature:.1f}°C" if observation.temperature is not None else "N/A"
        rh_str = f"{observation.humidity:.1f}%" if observation.humidity is not None else "N/A"
        pres_str = f"{observation.pressure:.1f}hPa" if observation.pressure is not None else "N/A"

        if is_anomalous:
            logger.warning(
                "[TELEMETRY ALERT] ⚠️ Station: %s | T: %s | RH: %s | P: %s | QC: %s | Decision: %s (%s) | Event: %s | Latency: %.2fms",
                observation.station_id,
                temp_str,
                rh_str,
                pres_str,
                qc_val,
                dec_val,
                str(decision.severity.value if hasattr(decision.severity, "value") else decision.severity),
                assigned_event_id,
                total_pipeline_ms,
            )
        else:
            logger.info(
                "[TELEMETRY] 📡 Station: %s | T: %s | RH: %s | P: %s | QC: %s | Decision: %s | Score: %.3f | Latency: %.2fms",
                observation.station_id,
                temp_str,
                rh_str,
                pres_str,
                qc_val,
                dec_val,
                ml_score or 0.0,
                total_pipeline_ms,
            )

        # Build latency profile
        latency_breakdown = ProcessingLatencyBreakdown(
            ingestion_latency_ms=round((t_ingest_end - t_ingest_start) / 1e6, 3),
            validation_latency_ms=round((t_ingest_end - t_ingest_start) / 1e6, 3),
            feature_latency_ms=round((t_feat_end - t_feat_start) / 1e6, 3),
            ml_latency_ms=round((t_ml_end - t_ml_start) / 1e6, 3),
            spatial_latency_ms=round((t_spatial_end - t_spatial_start) / 1e6, 3),
            decision_latency_ms=round((t_decision_end - t_decision_start) / 1e6, 3),
            explanation_latency_ms=round((t_exp_end - t_exp_start) / 1e6, 3),
            health_latency_ms=round((t_health_end - t_health_start) / 1e6, 3),
            correction_latency_ms=round((t_corr_end - t_corr_start) / 1e6, 3),
            persistence_latency_ms=round((t_persist_end - t_persist_start) / 1e6, 3),
            total_pipeline_latency_ms=round(total_pipeline_ms, 3),
        )

        return ProcessingResult(
            observation=observation,
            status=ordering_status,
            event_id=assigned_event_id,
            features=features,
            ml_anomaly_score=ml_score,
            ml_is_anomaly=ml_is_anom,
            ml_model_failed=ml_failed,
            spatial_context=spatial_context,
            hybrid_decision=decision,
            explanation=explanation,
            sensor_health=health_summary,
            correction_recommendation=corr_rec,
            provenance={
                "model_id": self.ml_model.model_id if self.ml_model else "none",
                "feature_version": "v1.0.0",
                "decision_engine_version": "hybrid_v1.0.0",
                "health_engine_version": "health_v1.0.0",
                "correction_engine_version": "imputation_v1.0.0",
            },
            latency=latency_breakdown,
        )
