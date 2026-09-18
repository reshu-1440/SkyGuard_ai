import { useQuery } from '@tanstack/react-query';
import {
  fetchStations,
  fetchStationById,
  fetchStationLatest,
  fetchStationHistory,
  fetchStationHealth,
} from '../api/stations';

export function useStations() {
  return useQuery({
    queryKey: ['stations'],
    queryFn: fetchStations,
    refetchInterval: 5000,
  });
}

export function useStation(stationId: string) {
  return useQuery({
    queryKey: ['station', stationId],
    queryFn: () => fetchStationById(stationId),
    enabled: Boolean(stationId),
  });
}

export function useStationLatest(stationId: string) {
  return useQuery({
    queryKey: ['station', stationId, 'latest'],
    queryFn: () => fetchStationLatest(stationId),
    enabled: Boolean(stationId),
    refetchInterval: 3000,
  });
}

export function useStationHistory(
  stationId: string,
  params?: {
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  }
) {
  return useQuery({
    queryKey: ['station', stationId, 'history', params],
    queryFn: () => fetchStationHistory(stationId, params),
    enabled: Boolean(stationId),
  });
}

export function useStationHealth(stationId: string) {
  return useQuery({
    queryKey: ['station', stationId, 'health'],
    queryFn: () => fetchStationHealth(stationId),
    enabled: Boolean(stationId),
    refetchInterval: 10000,
  });
}
