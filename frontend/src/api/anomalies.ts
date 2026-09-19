import { apiClient, ApiError } from './client';
import {
  AnomalyEventRecord,
  AnomalyStatsSummary,
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
  historical?: boolean;
  runId?: string;
  source?: string;
}): Promise<PaginatedResponse<AnomalyEventRecord>> {
  const query = new URLSearchParams();
  if (params?.stationId) query.set('station_id', params.stationId);
  if (params?.decision) query.set('decision', params.decision);
  if (params?.severity) query.set('severity', params.severity);
  if (params?.startTime) query.set('start_time', params.startTime);
  if (params?.endTime) query.set('end_time', params.endTime);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.historical !== undefined) query.set('historical', String(params.historical));
  if (params?.runId) query.set('run_id', params.runId);
  if (params?.source) query.set('source', params.source);

  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiClient<PaginatedResponse<AnomalyEventRecord>>(`/anomalies${qs}`);
}

export async function fetchAnomalyStats(): Promise<AnomalyStatsSummary> {
  return apiClient<AnomalyStatsSummary>('/anomalies/stats');
}

export async function fetchAnomalyDetail(eventId: string, historical?: boolean): Promise<AnomalyEventRecord> {
  const qs = historical ? '?historical=true' : '';
  return apiClient<AnomalyEventRecord>(`/anomalies/${eventId}${qs}`);
}

export async function fetchAnomalyExplanation(eventId: string, historical?: boolean): Promise<ExplanationSummary | null> {
  try {
    const qs = historical ? '?historical=true' : '';
    return await apiClient<ExplanationSummary>(`/anomalies/${eventId}/explanation${qs}`);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

