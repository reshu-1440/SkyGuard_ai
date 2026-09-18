import { apiClient, ApiError } from './client';
import {
  AnomalyEventRecord,
  ExplanationSummary,
  PaginatedResponse,
} from '../types/api';

export async function fetchAnomalies(params?: {
  stationId?: string;
  decision?: string;
  severity?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<AnomalyEventRecord>> {
  const query = new URLSearchParams();
  if (params?.stationId) query.set('station_id', params.stationId);
  if (params?.decision) query.set('decision', params.decision);
  if (params?.severity) query.set('severity', params.severity);
  if (params?.startTime) query.set('start_time', params.startTime);
  if (params?.endTime) query.set('end_time', params.endTime);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));

  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiClient<PaginatedResponse<AnomalyEventRecord>>(`/anomalies${qs}`);
}

export async function fetchAnomalyDetail(eventId: string): Promise<AnomalyEventRecord> {
  return apiClient<AnomalyEventRecord>(`/anomalies/${eventId}`);
}

export async function fetchAnomalyExplanation(eventId: string): Promise<ExplanationSummary | null> {
  try {
    return await apiClient<ExplanationSummary>(`/anomalies/${eventId}/explanation`);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

