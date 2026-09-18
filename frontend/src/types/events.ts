/**
 * WebSocket Event Types and Envelope Definitions for SkyGuard AI
 */

export type EventType =
  | 'observation.updated'
  | 'anomaly.created'
  | 'anomaly.updated'
  | 'health.updated'
  | 'correction.created'
  | 'station.status_changed'
  | 'system.status_changed'
  | 'replay.progress'
  | 'heartbeat.ping'
  | 'heartbeat.pong';

export interface ReplayProgressPayload {
  current_index: number;
  total_observations: number;
  emitted_count: number;
  is_running: boolean;
  speed_multiplier: number;
  current_synthetic_time?: string | null;
  last_station_id?: string | null;
  scenario_id?: string | null;
}


export interface ObservationUpdatedPayload {
  station_id: string;
  station_name?: string;
  timestamp: string;
  temperature?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  dew_point_c?: number | null;
  data_quality_status: string;
  freshness_seconds: number;
}

export interface AnomalyCreatedPayload {
  event_id: string;
  station_id: string;
  station_name?: string;
  timestamp: string;
  decision: string;
  severity: string;
  summary: string;
  reason_codes: string[];
  observed_values: Record<string, number | null>;
  recommended_values: Record<string, number | null>;
}

export interface AnomalyUpdatedPayload {
  event_id: string;
  station_id: string;
  timestamp: string;
  status: string;
  operator_action?: string;
  notes?: string;
}

export interface HealthUpdatedPayload {
  station_id: string;
  timestamp: string;
  health_index: number;
  health_status: string;
  health_trend: string;
  maintenance_recommendation: string;
  parameter_health: Record<string, number>;
  component_scores: Record<string, number>;
}

export interface CorrectionCreatedPayload {
  observation_id: string;
  station_id: string;
  timestamp: string;
  target_variable: string;
  observed_value: number;
  recommended_value: number;
  confidence_lower: number;
  confidence_upper: number;
  status: string;
  method: string;
}

export interface StationStatusChangedPayload {
  station_id: string;
  station_name?: string;
  timestamp: string;
  status: string;
  previous_status?: string;
  reason?: string;
}

export interface SystemStatusChangedPayload {
  component: string;
  status: string;
  timestamp: string;
  details: Record<string, any>;
}

export interface WebSocketEnvelope<T = any> {
  event_id: string;
  event_type: EventType;
  timestamp: string;
  station_id?: string | null;
  payload: T;
  schema_version: string;
}

export type ConnectionStatus =
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'ERROR';
