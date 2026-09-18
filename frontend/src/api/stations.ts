import { apiClient } from './client';
import {
  StationItem,
  LiveStationSnapshot,
  WeatherObservation,
  PaginatedResponse,
  SensorHealthSummary,
} from '../types/api';

export async function fetchStations(): Promise<StationItem[]> {
  return apiClient<StationItem[]>('/stations');
}

export async function fetchStationById(stationId: string): Promise<StationItem> {
  return apiClient<StationItem>(`/stations/${stationId}`);
}

export async function fetchStationLatest(stationId: string): Promise<LiveStationSnapshot> {
  return apiClient<LiveStationSnapshot>(`/stations/${stationId}/latest`);
}

export async function fetchStationHistory(
  stationId: string,
  params?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  }
): Promise<PaginatedResponse<WeatherObservation>> {
  const query = new URLSearchParams();
  if (params?.startTime) query.set('start_time', params.startTime);
  if (params?.endTime) query.set('end_time', params.endTime);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  if (params?.order) query.set('order', params.order);

  const qs = query.toString() ? `?${query.toString()}` : '';
  return apiClient<PaginatedResponse<WeatherObservation>>(`/stations/${stationId}/history${qs}`);
}

export async function fetchStationHealth(stationId: string): Promise<SensorHealthSummary> {
  return apiClient<SensorHealthSummary>(`/stations/${stationId}/health`);
}
