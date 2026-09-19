"""Pydantic schemas and contracts for real-time processing, API responses, and telemetry state."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Generic, List, Optional, TypeVar
from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.observation import WeatherObservation
from ml.decision.schema import HybridDecision, HybridDecisionType
from ml.explainability.schema import ExplanationSummary
from ml.health.health_schema import HealthStatusBand, SensorHealthSummary
from ml.imputation.schema import CorrectionRecommendation
from ml.spatial.schema import SpatialContextEvidence


class ProcessingStatus(str, Enum):
    """Execution status of real-time observation processing."""
    PROCESSED = "PROCESSED"
    DUPLICATE_SKIPPED = "DUPLICATE_SKIPPED"
    OUT_OF_ORDER = "OUT_OF_ORDER"
    LATE_ARRIVAL = "LATE_ARRIVAL"
    FUTURE_TIMESTAMP = "FUTURE_TIMESTAMP"
    FAILED_FALLBACK = "FAILED_FALLBACK"


class ProcessingLatencyBreakdown(BaseModel):
    """Sub-millisecond latency profile for each pipeline stage."""
    model_config = ConfigDict(frozen=True)

    ingestion_latency_ms: float = Field(0.0, ge=0.0)
    validation_latency_ms: float = Field(0.0, ge=0.0)
    feature_latency_ms: float = Field(0.0, ge=0.0)
    ml_latency_ms: float = Field(0.0, ge=0.0)
    spatial_latency_ms: float = Field(0.0, ge=0.0)
    decision_latency_ms: float = Field(0.0, ge=0.0)
    explanation_latency_ms: float = Field(0.0, ge=0.0)
    health_latency_ms: float = Field(0.0, ge=0.0)
    correction_latency_ms: float = Field(0.0, ge=0.0)
    persistence_latency_ms: float = Field(0.0, ge=0.0)
    total_pipeline_latency_ms: float = Field(0.0, ge=0.0)


class AnomalyEventRecord(BaseModel):
    """Traceable anomaly event record persisted upon detection."""
    model_config = ConfigDict(frozen=True)

    event_id: str = Field(..., description="Stable unique identifier, e.g. ANOM-20260917-STN001-0001")
    station_id: str = Field(..., description="Station identifier")
    timestamp: str = Field(..., description="ISO 8601 observation timestamp")
    decision: HybridDecisionType = Field(..., description="Hybrid operational decision")
    severity: str = Field(..., description="Alert severity level (INFO, LOW, MEDIUM, HIGH, CRITICAL)")
    reason_codes: List[str] = Field(default_factory=list, description="Triggered reason codes")
    observed_values: Dict[str, Optional[float]] = Field(default_factory=dict, description="Observed parameter readings")
    recommended_values: Dict[str, Optional[float]] = Field(default_factory=dict, description="Recommended repair values")
    explanation_summary: str = Field(..., description="Natural language operator summary")
    run_id: Optional[str] = Field(default=None, description="Active execution run identifier")
    source: Optional[str] = Field(default=None, description="Data source identifier")
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AnomalyStatsSummary(BaseModel):
    """Aggregated anomaly metrics separating active run, 24h operational window, and database persistence."""
    model_config = ConfigDict(frozen=True)

    current_run_anomalies: int = Field(0, ge=0, description="Anomalies detected in current run up to replay cursor")
    active_anomalies_24h: int = Field(0, ge=0, description="Active/unresolved anomalies within current 24h operational window")
    total_persisted_anomalies: int = Field(0, ge=0, description="Total cumulative anomaly records stored in database")
    active_run_id: str = Field(..., description="Active execution run identifier")
    replay_cursor_time: Optional[str] = Field(None, description="Current simulated or operational UTC timestamp cutoff")
    source_type: str = Field(..., description="Active telemetry source type")


class ProcessingResult(BaseModel):
    """Comprehensive, fully traceable output contract of the real-time processing pipeline."""
    model_config = ConfigDict(frozen=True)

    observation: WeatherObservation = Field(..., description="Original immutable observation")
    status: ProcessingStatus = Field(ProcessingStatus.PROCESSED, description="Processing result status")
    event_id: Optional[str] = Field(None, description="Assigned anomaly event ID if anomalous")
    
    # Subsystem evidence & outputs
    features: Dict[str, Any] = Field(default_factory=dict, description="Extracted causal feature vector")
    ml_anomaly_score: Optional[float] = Field(None, description="Normalized ML anomaly score [0, 1]")
    ml_is_anomaly: bool = Field(False, description="True if ML score exceeds threshold")
    ml_model_failed: bool = Field(False, description="True if ML inference threw exception and fell back")
    
    spatial_context: Optional[SpatialContextEvidence] = Field(None, description="Spatial neighborhood context evidence")
    hybrid_decision: Optional[HybridDecision] = Field(None, description="Multi-gate hybrid decision output")
    explanation: Optional[ExplanationSummary] = Field(None, description="Complete explainability package")
    sensor_health: Optional[SensorHealthSummary] = Field(None, description="Updated sensor health snapshot")
    correction_recommendation: Optional[CorrectionRecommendation] = Field(None, description="Advisory correction recommendation")
    
    # Provenance, Metadata & Performance
    provenance: Dict[str, str] = Field(default_factory=dict, description="Model, pipeline, and schema version tags")
    latency: ProcessingLatencyBreakdown = Field(default_factory=ProcessingLatencyBreakdown)
    processed_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LiveStationSnapshot(BaseModel):
    """Real-time operational status snapshot for a single AWS station."""
    model_config = ConfigDict(frozen=True)

    station_id: str
    station_name: str
    latitude: float
    longitude: float
    elevation_m: float
    status: str = "ACTIVE"
    last_seen_timestamp: Optional[str] = None
    latest_temperature_c: Optional[float] = None
    latest_humidity_pct: Optional[float] = None
    latest_pressure_hpa: Optional[float] = None
    latest_decision: str = "NORMAL"
    latest_health_score: Optional[float] = None
    latest_health_band: str = "HEALTHY"
    active_anomaly_count_24h: int = 0


class SystemHealthStatus(BaseModel):
    """End-to-end service status of all core subsystems."""
    model_config = ConfigDict(frozen=True)

    status: str = "HEALTHY"  # "HEALTHY", "DEGRADED", "CRITICAL"
    service: str = "SkyGuard AI Real-Time Processing Engine"
    version: str = "1.0.0"
    database_status: str = "CONNECTED"
    model_registry_status: str = "LOADED"
    active_model_id: str = "isolation_forest_s42"
    spatial_topology_stations_count: int = 0
    active_monitored_stations: int = 0
    total_observations_processed: int = 0
    last_processed_timestamp: Optional[str] = None
    mean_pipeline_latency_ms: float = 0.0
    replay_simulator_status: str = "IDLE"
    uptime_seconds: float = 0.0
    checked_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


T = TypeVar("T")


class PaginationMeta(BaseModel):
    """Metadata for paginated queries."""
    model_config = ConfigDict(frozen=True)

    total_count: int = Field(..., ge=0)
    limit: int = Field(..., ge=1)
    offset: int = Field(..., ge=0)
    has_more: bool = False


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard generic wrapper for paginated API responses."""
    model_config = ConfigDict(frozen=True)

    items: List[T] = Field(default_factory=list)
    pagination: PaginationMeta
