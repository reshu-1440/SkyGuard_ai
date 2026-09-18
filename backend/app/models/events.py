"""Pydantic v2 Models for SkyGuard AI Real-Time WebSocket Event Envelope and Payloads."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class EventType(str, Enum):
    """Supported real-time event types across the SkyGuard WebSocket stream."""
    OBSERVATION_UPDATED = "observation.updated"
    ANOMALY_CREATED = "anomaly.created"
    ANOMALY_UPDATED = "anomaly.updated"
    HEALTH_UPDATED = "health.updated"
    CORRECTION_CREATED = "correction.created"
    STATION_STATUS_CHANGED = "station.status_changed"
    SYSTEM_STATUS_CHANGED = "system.status_changed"
    REPLAY_PROGRESS = "replay.progress"
    HEARTBEAT_PING = "heartbeat.ping"
    HEARTBEAT_PONG = "heartbeat.pong"


class ReplayProgressPayload(BaseModel):
    """Payload for replay.progress events."""
    current_index: int
    total_observations: int
    emitted_count: int
    is_running: bool
    speed_multiplier: float
    current_synthetic_time: Optional[str] = None
    last_station_id: Optional[str] = None
    scenario_id: Optional[str] = None



class ObservationUpdatedPayload(BaseModel):
    """Payload for observation.updated events."""
    station_id: str
    station_name: Optional[str] = None
    timestamp: str
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    pressure: Optional[float] = None
    dew_point_c: Optional[float] = None
    data_quality_status: str
    freshness_seconds: int = 0
    received_timestamp: Optional[str] = None
    run_id: Optional[str] = None
    source_type: Optional[str] = None
    source_name: Optional[str] = None


class AnomalyCreatedPayload(BaseModel):
    """Payload for anomaly.created events. Contains immediate dashboard summary without bulky arrays."""
    event_id: str
    station_id: str
    station_name: Optional[str] = None
    timestamp: str
    decision: str
    severity: str
    summary: str
    reason_codes: List[str] = Field(default_factory=list)
    observed_values: Dict[str, Optional[float]] = Field(default_factory=dict)
    recommended_values: Dict[str, Optional[float]] = Field(default_factory=dict)


class AnomalyUpdatedPayload(BaseModel):
    """Payload for anomaly.updated events (e.g., status changes or human review acknowledgement)."""
    event_id: str
    station_id: str
    timestamp: str
    status: str
    operator_action: Optional[str] = None
    notes: Optional[str] = None


class HealthUpdatedPayload(BaseModel):
    """Payload for health.updated events."""
    station_id: str
    timestamp: str
    health_index: Optional[float] = None
    health_status: str
    health_trend: str
    maintenance_recommendation: str
    parameter_health: Dict[str, Any] = Field(default_factory=dict)
    component_scores: Dict[str, float] = Field(default_factory=dict)


class CorrectionCreatedPayload(BaseModel):
    """Payload for correction.created events."""
    observation_id: str
    station_id: str
    timestamp: str
    target_variable: str
    observed_value: float
    recommended_value: Optional[float] = None
    confidence_lower: Optional[float] = None
    confidence_upper: Optional[float] = None
    status: str
    method: str


class StationStatusChangedPayload(BaseModel):
    """Payload for station.status_changed events."""
    station_id: str
    station_name: Optional[str] = None
    timestamp: str
    status: str
    previous_status: Optional[str] = None
    reason: Optional[str] = None


class SystemStatusChangedPayload(BaseModel):
    """Payload for system.status_changed events. Never exposes internal stack traces."""
    component: str
    status: str
    timestamp: str
    details: Dict[str, Any] = Field(default_factory=dict)


class WebSocketEnvelope(BaseModel):
    """Standardized stable event envelope for all SkyGuard real-time WebSocket messages."""
    event_id: str
    event_type: EventType
    timestamp: str
    station_id: Optional[str] = None
    payload: Dict[str, Any]
    schema_version: str = "1.0"
    run_id: Optional[str] = None
    source_type: Optional[str] = None
    source_name: Optional[str] = None

    @classmethod
    def create(
        cls,
        event_id: str,
        event_type: EventType,
        payload: Union[BaseModel, Dict[str, Any]],
        station_id: Optional[str] = None,
        timestamp: Optional[Union[str, datetime]] = None,
        run_id: Optional[str] = None,
        source_type: Optional[str] = None,
        source_name: Optional[str] = None,
    ) -> "WebSocketEnvelope":
        """Factory method to construct a validated envelope with current UTC timestamp if omitted."""
        if timestamp is None:
            ts_str = datetime.now(timezone.utc).isoformat()
        elif isinstance(timestamp, datetime):
            ts_str = timestamp.astimezone(timezone.utc).isoformat()
        else:
            ts_str = str(timestamp)

        payload_dict = payload.model_dump() if isinstance(payload, BaseModel) else payload

        return cls(
            event_id=event_id,
            event_type=event_type,
            timestamp=ts_str,
            station_id=station_id,
            payload=payload_dict,
            schema_version="1.0",
            run_id=run_id or payload_dict.get("run_id"),
            source_type=source_type or payload_dict.get("source_type"),
            source_name=source_name or payload_dict.get("source_name"),
        )
