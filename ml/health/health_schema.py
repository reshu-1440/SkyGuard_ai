"""Schemas and data models for SkyGuard AI Sensor Health & Degradation Monitoring."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class HealthStatusBand(str, Enum):
    """Operational reliability status bands for sensors and stations."""
    HEALTHY = "HEALTHY"                # 90 - 100
    GOOD = "GOOD"                      # 75 - 89
    ATTENTION = "ATTENTION"            # 50 - 74
    DEGRADED = "DEGRADED"              # 25 - 49
    CRITICAL = "CRITICAL"              # 0 - 24
    INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"  # < min observations


class HealthTrend(str, Enum):
    """Direction of health movement relative to preceding observation window."""
    IMPROVING = "IMPROVING"            # delta >= +3.0
    STABLE = "STABLE"                  # -3.0 < delta < +3.0
    DEGRADING = "DEGRADING"            # delta <= -3.0
    INSUFFICIENT_HISTORY = "INSUFFICIENT_HISTORY"


class MaintenanceRecommendation(str, Enum):
    """Interpretable Standard Operating Procedure (SOP) maintenance guidance."""
    NO_ACTION = "NO_ACTION"
    MONITOR = "MONITOR"
    INSPECT = "INSPECT"
    PRIORITY_INSPECTION = "PRIORITY_INSPECTION"


class HealthReasonCode(str, Enum):
    """Standardized reason codes explaining sensor health score deductions."""
    NOMINAL_OPERATION = "NOMINAL_OPERATION"
    REPEATED_ANOMALIES = "REPEATED_ANOMALIES"
    PERSISTENT_ANOMALY = "PERSISTENT_ANOMALY"
    INCREASING_DRIFT = "INCREASING_DRIFT"
    PERSISTENT_FLATLINE = "PERSISTENT_FLATLINE"
    HIGH_MISSING_RATE = "HIGH_MISSING_RATE"
    COMMUNICATION_INSTABILITY = "COMMUNICATION_INSTABILITY"
    REPEATED_LOCAL_SPATIAL_DEVIATION = "REPEATED_LOCAL_SPATIAL_DEVIATION"
    INSUFFICIENT_OBSERVATION_HISTORY = "INSUFFICIENT_OBSERVATION_HISTORY"
    RECENT_RECOVERY_OBSERVED = "RECENT_RECOVERY_OBSERVED"


class ComponentHealthScores(BaseModel):
    """Component reliability indicators across 5 distinct sub-domains (0-100 scale)."""
    model_config = ConfigDict(frozen=True)

    anomaly_health: float = Field(100.0, ge=0.0, le=100.0, description="Health deduced from anomalous event frequency.")
    data_quality_health: float = Field(100.0, ge=0.0, le=100.0, description="Health deduced from missingness and schema validity.")
    communication_health: float = Field(100.0, ge=0.0, le=100.0, description="Health deduced from packet gaps and telemetry latency.")
    temporal_stability_health: float = Field(100.0, ge=0.0, le=100.0, description="Health deduced from flatlines and variance behavior.")
    spatial_consistency_health: float = Field(100.0, ge=0.0, le=100.0, description="Health deduced from isolated spatial disagreements.")


class ParameterHealth(BaseModel):
    """Individual meteorological parameter channel reliability (e.g. Temperature, RH, Pressure)."""
    model_config = ConfigDict(frozen=True)

    parameter_name: str = Field(..., description="Target variable name (e.g. 'temperature_c').")
    health_score: Optional[float] = Field(None, ge=0.0, le=100.0, description="0-100 score, or None if insufficient history.")
    status_band: HealthStatusBand = Field(..., description="Qualitative reliability status band.")
    trend: HealthTrend = Field(HealthTrend.STABLE, description="Health trajectory relative to previous window.")
    component_scores: ComponentHealthScores = Field(default_factory=ComponentHealthScores)
    drift_indicator: Optional[float] = Field(None, description="Quantified baseline drift magnitude.")
    flatline_duration_minutes: float = Field(0.0, ge=0.0, description="Total flatline duration in window.")
    supporting_evidence: List[str] = Field(default_factory=list, description="Diagnostic notes for this parameter.")


class HealthAuditMetadata(BaseModel):
    """Auditability and provenance tracking for health computation."""
    model_config = ConfigDict(frozen=True)

    health_engine_version: str = Field("health_v1.0.0", description="Version of the health calculation engine.")
    decision_engine_version: str = Field("hybrid_v1.0.0", description="Version of the upstream hybrid decision engine.")
    feature_version: str = Field("v1.0.0", description="Feature engineering version.")
    window_name: str = Field("24h", description="Evaluated time window identifier ('24h', '7d', '30d').")
    window_hours: float = Field(24.0, ge=0.0, description="Evaluated window duration in hours.")
    min_observations_required: int = Field(12, ge=1, description="Threshold for low-data determination.")
    total_observations_evaluated: int = Field(0, ge=0, description="Count of observations evaluated in window.")
    generated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="UTC timestamp of health computation."
    )


class SensorHealthSummary(BaseModel):
    """Comprehensive station-level sensor health and degradation assessment."""
    model_config = ConfigDict(frozen=True)

    station_id: str = Field(..., description="Target AWS station identifier.")
    window_name: str = Field("24h", description="Evaluated lookback window ('24h', '7d', '30d').")
    overall_health_score: Optional[float] = Field(None, ge=0.0, le=100.0, description="Composite station health index (0-100).")
    status_band: HealthStatusBand = Field(..., description="Overall qualitative reliability band.")
    trend: HealthTrend = Field(..., description="Health trajectory.")
    health_delta: Optional[float] = Field(None, description="Difference between current and previous window scores.")
    
    # Subsystem scores and channel breakdowns
    component_scores: ComponentHealthScores = Field(..., description="5-dimensional component health breakdown.")
    parameter_health: Dict[str, ParameterHealth] = Field(
        default_factory=dict,
        description="Channel-specific health assessments (e.g. temperature, humidity, pressure)."
    )
    
    # Actionable guidance
    maintenance_recommendation: MaintenanceRecommendation = Field(..., description="Actionable SOP recommendation.")
    reason_codes: List[HealthReasonCode] = Field(default_factory=list, description="Triggered deduction reason codes.")
    summary: str = Field(..., description="Deterministic, operator-readable explanation of health status.")
    supporting_evidence: List[str] = Field(default_factory=list, description="Specific metrics and observations backing evaluation.")
    recommended_action: str = Field(..., description="Detailed maintenance recommendation text.")
    
    # Traceability
    audit_metadata: HealthAuditMetadata = Field(..., description="Provenance metadata for auditing.")

    # Active runtime traceability & explicit contract fields
    run_id: Optional[str] = Field(None, description="Active execution run context ID.")
    source_type: Optional[str] = Field(None, description="Canonical source provider type.")
    observation_count: Optional[int] = Field(None, description="Count of observations evaluated in active run window.")
    required_observation_count: int = Field(12, description="Minimum observation threshold for health calculation.")
    evaluation_window_start: Optional[str] = Field(None, description="ISO timestamp of earliest observation in window.")
    evaluation_window_end: Optional[str] = Field(None, description="ISO timestamp of latest observation in window.")
    replay_cursor_time: Optional[str] = Field(None, description="ISO timestamp of current replay cursor cutoff.")
    health_index: Optional[float] = Field(None, description="Alias for overall_health_score.")
    status: Optional[str] = Field(None, description="Alias for status_band string.")

    @model_validator(mode="after")
    def _sync_contract_aliases(self) -> "SensorHealthSummary":
        updates = {}
        if self.health_index is None and self.overall_health_score is not None:
            updates["health_index"] = self.overall_health_score
        if self.status is None and self.status_band is not None:
            updates["status"] = self.status_band.value if hasattr(self.status_band, "value") else str(self.status_band)
        if self.observation_count is None and self.audit_metadata is not None:
            updates["observation_count"] = self.audit_metadata.total_observations_evaluated
        if self.required_observation_count == 12 and self.audit_metadata is not None:
            updates["required_observation_count"] = self.audit_metadata.min_observations_required

        if updates:
            # model_config frozen=True requires object.__setattr__
            for k, v in updates.items():
                object.__setattr__(self, k, v)
        return self
