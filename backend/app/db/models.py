"""SQLAlchemy 2.0 Declarative ORM models for SkyGuard AI production persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base declarative class for all SkyGuard ORM models."""
    pass


def utc_now() -> datetime:
    """Return timezone-aware current UTC datetime."""
    return datetime.now(timezone.utc)


class StationModel(Base):
    """Automatic Weather Station registry record."""
    __tablename__ = "stations"

    station_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_m: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    state: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE", nullable=False)
    sampling_interval_seconds: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    installed_sensors: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class WeatherObservationModel(Base):
    """Canonical normalized weather observation (strictly immutable raw telemetry)."""
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    observation_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    station_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    observation_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    ingestion_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperature_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    relative_humidity_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dew_point_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sea_level_pressure_hpa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    station_pressure_hpa: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    elevation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    report_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    data_quality_status: Mapped[str] = mapped_column(String(32), default="VALID", nullable=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    raw_quality_flags: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    metadata_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "station_id", "observation_timestamp", name="uq_obs_source_station_time"),
        Index("ix_obs_station_time", "station_id", "observation_timestamp"),
        Index("ix_obs_source_time", "source", "observation_timestamp"),
    )


class RawSourcePayloadModel(Base):
    """Raw provider response payload with sanitized metadata (no secrets)."""
    __tablename__ = "raw_source_payloads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payload_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    station_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    source_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    retrieval_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    raw_payload_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    headers_metadata: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    normalization_version: Mapped[str] = mapped_column(String(64), default="v1.0.0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_raw_source_retrieval", "source", "retrieval_timestamp"),
    )


class AnomalyEventModel(Base):
    """Detected anomaly event record with decision taxonomy and evidence summary."""
    __tablename__ = "anomaly_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    station_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    decision: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    reason_codes: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    observed_values: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    recommended_values: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    explanation_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    model_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    feature_version: Mapped[str] = mapped_column(String(64), default="v1.0.0", nullable=False)
    decision_engine_version: Mapped[str] = mapped_column(String(64), default="hybrid_v1.0.0", nullable=False)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)

    __table_args__ = (
        Index("ix_anom_station_time", "station_id", "timestamp"),
        Index("ix_anom_run_time", "run_id", "timestamp"),
        Index("ix_anom_source_time", "source", "timestamp"),
    )


class ExplanationModel(Base):
    """Full explainability package containing SHAP attributions, spatial evidence, and SOP recommendations."""
    __tablename__ = "anomaly_explanations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    station_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    feature_attributions: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    spatial_evidence: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    temporal_evidence: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    multivariate_evidence: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    evidence_hierarchy: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    natural_language_explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recommended_sop_steps: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    explanation_version: Mapped[str] = mapped_column(String(64), default="v1.0.0", nullable=False)
    model_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class SourceHealthTransitionModel(Base):
    """Operational source health state transition record."""
    __tablename__ = "source_health_transitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    from_state: Mapped[str] = mapped_column(String(32), nullable=False)
    to_state: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    trigger_category: Mapped[str] = mapped_column(String(64), default="NONE", nullable=False)
    metadata_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    transition_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_source_trans_time", "source", "transition_timestamp"),
    )


class OutageEpisodeModel(Base):
    """Outage episode tracking with loss estimation and resolution tracking."""
    __tablename__ = "outage_episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    episode_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    initial_state: Mapped[str] = mapped_column(String(32), nullable=False)
    current_state: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    affected_stations: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    failure_categories: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    observation_loss_estimate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    assumptions_version: Mapped[str] = mapped_column(String(64), default="v1.0.0", nullable=False)
    is_ongoing: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_outage_source_started", "source", "started_at"),
    )


class SensorHealthSnapshotModel(Base):
    """Sensor health evaluation snapshot with 5-dimensional decomposition."""
    __tablename__ = "sensor_health_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    station_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    overall_health_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status_band: Mapped[str] = mapped_column(String(32), nullable=False)

    trend: Mapped[str] = mapped_column(String(32), default="STABLE", nullable=False)
    maintenance_recommendation: Mapped[str] = mapped_column(String(64), default="NO_ACTION", nullable=False)
    parameter_health: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    component_scores: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    active_anomalies_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    health_engine_version: Mapped[str] = mapped_column(String(64), default="v1.0.0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_health_station_time", "station_id", "timestamp"),
    )


class CorrectionRecommendationModel(Base):
    """Advisory candidate repair recommendations (raw observations remain untouched)."""
    __tablename__ = "correction_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    observation_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    station_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    target_variable: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    observed_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recommended_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    method: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence_lower: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    confidence_upper: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    uncertainty_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    multivariate_consistent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    reason_codes: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    operator_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    correction_engine_version: Mapped[str] = mapped_column(String(64), default="v1.0.0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_corr_station_time", "station_id", "timestamp"),
    )
