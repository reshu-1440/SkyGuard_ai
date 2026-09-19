import { useQuery } from '@tanstack/react-query';
import {
  fetchAnomalies,
  fetchAnomalyDetail,
  fetchAnomalyExplanation,
} from '../api/anomalies';

export function useAnomalies(params?: {
  stationId?: string;
  decision?: string;
  severity?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
  historical?: boolean;
}) {
  return useQuery({
    queryKey: ['anomalies', params],
    queryFn: () => fetchAnomalies(params),
    refetchInterval: 5000,
  });
}

export function useAnomalyDetail(eventId: string, historical?: boolean) {
  return useQuery({
    queryKey: ['anomaly', eventId, historical],
    queryFn: () => fetchAnomalyDetail(eventId, historical),
    enabled: Boolean(eventId),
  });
}

export function useAnomalyExplanation(eventId: string, historical?: boolean) {
  return useQuery({
    queryKey: ['anomaly', eventId, 'explanation', historical],
    queryFn: () => fetchAnomalyExplanation(eventId, historical),
    enabled: Boolean(eventId),
  });
}
