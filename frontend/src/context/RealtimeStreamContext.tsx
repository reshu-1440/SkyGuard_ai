import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSystemHealth } from '../hooks/useSystem';
import { useRunContext } from './RunContext';
import {
  ConnectionStatus,
  WebSocketEnvelope,
  ObservationUpdatedPayload,
  HealthUpdatedPayload,
} from '../types/events';
import {
  StationItem,
  LiveStationSnapshot,
  WeatherObservation,
  PaginatedResponse,
} from '../types/api';

export interface StreamState {
  connectionStatus: ConnectionStatus;
  transportMode: 'WEBSOCKET' | 'POLLING';
  isConnected: boolean;
  isDegraded: boolean;
  lastHeartbeat: Date | null;
  lastObservationTimestamp: Date | null;
  secondsSinceLastUpdate: number;
  activeModelId: string;
  reconnectCount: number;
  eventsReceivedCount: number;
  lastEvent: WebSocketEnvelope | null;
}

const MAX_DEDUP_CACHE_SIZE = 1000;
const HEARTBEAT_INTERVAL_MS = 15000;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

const RealtimeStreamContext = createContext<StreamState | null>(null);

export const RealtimeStreamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const { data: systemHealth, isError: isSystemError, dataUpdatedAt } = useSystemHealth();
  const { updateContextFromEvent } = useRunContext();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CONNECTING');
  const [transportMode, setTransportMode] = useState<'WEBSOCKET' | 'POLLING'>('POLLING');
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const [lastObservationTimestamp, setLastObservationTimestamp] = useState<Date | null>(null);
  const [secondsSinceLastUpdate, setSecondsSinceLastUpdate] = useState<number>(0);
  const [reconnectCount, setReconnectCount] = useState<number>(0);
  const [eventsReceivedCount, setEventsReceivedCount] = useState<number>(0);
  const [lastEvent, setLastEvent] = useState<WebSocketEnvelope | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const seenEventIdsListRef = useRef<string[]>([]);
  const stationTimestampsRef = useRef<Map<string, number>>(new Map());
  const isMountedRef = useRef<boolean>(true);
  const hasEverConnectedRef = useRef<boolean>(false);

  // Helper to record seen event_id for deduplication
  const recordEventId = useCallback((eventId: string): boolean => {
    if (seenEventIdsRef.current.has(eventId)) {
      return false; // Duplicate
    }
    seenEventIdsRef.current.add(eventId);
    seenEventIdsListRef.current.push(eventId);
    if (seenEventIdsListRef.current.length > MAX_DEDUP_CACHE_SIZE) {
      const oldest = seenEventIdsListRef.current.shift();
      if (oldest) seenEventIdsRef.current.delete(oldest);
    }
    return true; // New
  }, []);

  // Debounced network refetch to avoid network saturation on fast replays
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerDebouncedStationRefetch = useCallback(() => {
    if (debounceTimerRef.current) return;
    debounceTimerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['stations'] });
      debounceTimerRef.current = null;
    }, 400);
  }, [queryClient]);

  // Check ordering based on station timestamp
  const isChronologicallyValid = useCallback((stationId?: string | null, timestampStr?: string): boolean => {
    if (!stationId || !timestampStr) return true;
    const msgTime = new Date(timestampStr).getTime();
    if (isNaN(msgTime)) return true;

    const lastTime = stationTimestampsRef.current.get(stationId) || 0;
    if (msgTime < lastTime) {
      return false;
    }
    stationTimestampsRef.current.set(stationId, msgTime);
    return true;
  }, []);

  // Reconcile and resync client state on reconnection
  const resyncStateOnReconnect = useCallback(() => {
    stationTimestampsRef.current.clear();
    seenEventIdsRef.current.clear();
    seenEventIdsListRef.current = [];
    queryClient.invalidateQueries({ queryKey: ['stations'] });
    queryClient.invalidateQueries({ queryKey: ['station'] });
    queryClient.invalidateQueries({ queryKey: ['anomalies'] });
    queryClient.invalidateQueries({ queryKey: ['corrections'] });
    queryClient.invalidateQueries({ queryKey: ['system'] });
    queryClient.invalidateQueries({ queryKey: ['replay'] });
  }, [queryClient]);

  // Handle incoming validated WebSocket envelope
  const handleWebSocketMessage = useCallback((envelope: WebSocketEnvelope) => {
    if (!envelope || !envelope.event_id || !envelope.event_type) return;

    // Deduplication Guard
    if (!recordEventId(envelope.event_id)) {
      return;
    }

    // Ordering Guard
    if (!isChronologicallyValid(envelope.station_id, envelope.timestamp)) {
      return;
    }

    setLastHeartbeat(new Date());
    setEventsReceivedCount((prev) => prev + 1);
    setLastEvent(envelope);

    switch (envelope.event_type) {
      case 'observation.updated': {
        const payload = envelope.payload as ObservationUpdatedPayload;
        if (payload.timestamp) {
          const obsTime = new Date(payload.timestamp);
          if (!isNaN(obsTime.getTime())) {
            setLastObservationTimestamp(obsTime);
            setSecondsSinceLastUpdate(Math.max(0, Math.floor((Date.now() - obsTime.getTime()) / 1000)));
          }
        }

        // 1. Immediately update in-memory stations list cache so UI updates with 0 latency
        if (payload.station_id) {
          queryClient.setQueryData<StationItem[]>(['stations'], (old) => {
            if (!old || old.length === 0) return old;
            return old.map((stn) => {
              if (stn.station_id !== payload.station_id) return stn;
              const prevSnap = stn.latest_snapshot;
              const updatedSnap: LiveStationSnapshot = {
                station_id: payload.station_id,
                station_name: payload.station_name || stn.name,
                latitude: stn.latitude,
                longitude: stn.longitude,
                elevation_m: stn.elevation_m,
                status: prevSnap?.status || stn.status || 'ACTIVE',
                last_seen_timestamp: payload.timestamp,
                latest_temperature_c: payload.temperature ?? prevSnap?.latest_temperature_c ?? null,
                latest_humidity_pct: payload.humidity ?? prevSnap?.latest_humidity_pct ?? null,
                latest_pressure_hpa: payload.pressure ?? prevSnap?.latest_pressure_hpa ?? null,
                latest_decision: prevSnap?.latest_decision || 'NORMAL',
                latest_health_score: prevSnap?.latest_health_score ?? null,
                latest_health_band: prevSnap?.latest_health_band || 'HEALTHY',
                active_anomaly_count_24h: prevSnap?.active_anomaly_count_24h ?? 0,
              };
              return {
                ...stn,
                latest_snapshot: updatedSnap,
              };
            });
          });

          // 2. Immediately update single station latest snapshot cache
          queryClient.setQueryData<LiveStationSnapshot>(['station', payload.station_id, 'latest'], (old) => {
            return {
              station_id: payload.station_id,
              station_name: payload.station_name || old?.station_name || `Station ${payload.station_id}`,
              latitude: old?.latitude ?? 0,
              longitude: old?.longitude ?? 0,
              elevation_m: old?.elevation_m ?? 0,
              status: old?.status || 'ACTIVE',
              last_seen_timestamp: payload.timestamp,
              latest_temperature_c: payload.temperature ?? old?.latest_temperature_c ?? null,
              latest_humidity_pct: payload.humidity ?? old?.latest_humidity_pct ?? null,
              latest_pressure_hpa: payload.pressure ?? old?.latest_pressure_hpa ?? null,
              latest_decision: old?.latest_decision || 'NORMAL',
              latest_health_score: old?.latest_health_score ?? null,
              latest_health_band: old?.latest_health_band || 'HEALTHY',
              active_anomaly_count_24h: old?.active_anomaly_count_24h ?? 0,
            };
          });

          // 3. Incrementally append observation to active station history queries
          queryClient.setQueriesData<PaginatedResponse<WeatherObservation>>(
            { queryKey: ['station', payload.station_id, 'history'] },
            (old) => {
              if (!old || !old.items) return old;
              const newObs: WeatherObservation = {
                station_id: payload.station_id,
                timestamp: payload.timestamp,
                temperature: payload.temperature,
                humidity: payload.humidity,
                pressure: payload.pressure,
                latitude: 0,
                longitude: 0,
                source: payload.source_type || 'SYNTHETIC_VALIDATION',
                ingestion_timestamp: payload.received_timestamp || new Date().toISOString(),
              };
              if (old.items.some((o) => o.timestamp === payload.timestamp)) {
                return old;
              }
              const updatedItems = [...old.items, newObs];
              const trimmed = updatedItems.slice(-60);
              return {
                ...old,
                items: trimmed,
                pagination: {
                  ...old.pagination,
                  total_count: (old.pagination?.total_count ?? 0) + 1,
                },
              };
            }
          );
        }

        // 4. Debounce full network refetch to avoid network saturation
        triggerDebouncedStationRefetch();
        break;
      }
      case 'anomaly.created':
      case 'anomaly.updated': {
        queryClient.invalidateQueries({ queryKey: ['anomalies'] });
        queryClient.invalidateQueries({ queryKey: ['stations'] });
        if (envelope.station_id) {
          queryClient.invalidateQueries({ queryKey: ['station', envelope.station_id, 'history'] });
        }
        break;
      }
      case 'health.updated': {
        const payload = envelope.payload as HealthUpdatedPayload;
        if (payload.station_id) {
          queryClient.invalidateQueries({ queryKey: ['station', payload.station_id, 'health'] });
          queryClient.invalidateQueries({ queryKey: ['stations'] });
        }
        break;
      }
      case 'correction.created': {
        queryClient.invalidateQueries({ queryKey: ['corrections'] });
        if (envelope.station_id) {
          queryClient.invalidateQueries({ queryKey: ['station', envelope.station_id, 'history'] });
        }
        break;
      }
      case 'station.status_changed': {
        stationTimestampsRef.current.clear();
        seenEventIdsRef.current.clear();
        seenEventIdsListRef.current = [];
        queryClient.invalidateQueries({ queryKey: ['stations'] });
        queryClient.invalidateQueries({ queryKey: ['station'] });
        break;
      }
      case 'system.status_changed': {
        stationTimestampsRef.current.clear();
        seenEventIdsRef.current.clear();
        seenEventIdsListRef.current = [];
        queryClient.invalidateQueries({ queryKey: ['stations'] });
        queryClient.invalidateQueries({ queryKey: ['station'] });
        queryClient.invalidateQueries({ queryKey: ['system'] });
        break;
      }
      case 'replay.progress': {
        const p = envelope.payload as any;
        if (p) {
          if (p.current_index === 0) {
            stationTimestampsRef.current.clear();
            seenEventIdsRef.current.clear();
            seenEventIdsListRef.current = [];
          }
          updateContextFromEvent({
            current_observation_index: p.current_index,
            current_synthetic_time: p.current_synthetic_time,
            observation_count: p.total_observations,
            replay_speed: p.speed_multiplier,
            status: p.is_running ? 'RUNNING' : 'PAUSED',
          });
        }
        queryClient.invalidateQueries({ queryKey: ['replay'] });
        break;
      }
      case 'heartbeat.pong': {
        break;
      }
      default:
        break;
    }
  }, [queryClient, recordEventId, isChronologicallyValid, updateContextFromEvent]);


  // WebSocket Connection Management (SINGLETON instance in Provider)
  useEffect(() => {
    isMountedRef.current = true;

    const connectWs = () => {
      if (!isMountedRef.current) return;

      const envWsUrl = (import.meta as any).env?.VITE_WS_URL;
      let wsUrl = envWsUrl;
      if (!wsUrl) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws/stream`;
      }

      try {
        setConnectionStatus((prev) => (prev === 'CONNECTED' ? 'CONNECTED' : hasEverConnectedRef.current ? 'RECONNECTING' : 'CONNECTING'));
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMountedRef.current) return;
          setConnectionStatus('CONNECTED');
          setTransportMode('WEBSOCKET');
          setLastHeartbeat(new Date());

          if (hasEverConnectedRef.current) {
            resyncStateOnReconnect();
          }
          hasEverConnectedRef.current = true;
          setReconnectCount(0);

          if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                event_type: 'heartbeat.ping',
                timestamp: new Date().toISOString(),
              }));
            }
          }, HEARTBEAT_INTERVAL_MS);
        };

        ws.onmessage = (event: MessageEvent) => {
          if (!isMountedRef.current) return;
          try {
            const envelope = JSON.parse(event.data) as WebSocketEnvelope;
            handleWebSocketMessage(envelope);
          } catch {
            // Malformed frame ignored safely
          }
        };

        ws.onclose = () => {
          if (!isMountedRef.current) return;
          setConnectionStatus('RECONNECTING');
          setTransportMode('POLLING');
          if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);

          setReconnectCount((prev) => {
            const nextCount = prev + 1;
            const delay = Math.min(
              MAX_RECONNECT_DELAY_MS,
              BASE_RECONNECT_DELAY_MS * Math.pow(1.5, Math.min(nextCount, 8))
            ) + Math.random() * 500;

            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(connectWs, delay);
            return nextCount;
          });
        };

        ws.onerror = () => {
          if (!isMountedRef.current) return;
          setConnectionStatus('ERROR');
          setTransportMode('POLLING');
        };
      } catch {
        setConnectionStatus('ERROR');
        setTransportMode('POLLING');
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      isMountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  }, [handleWebSocketMessage, resyncStateOnReconnect]);

  // Elapsed observation age timer (updates every second based on real observation timestamp)
  useEffect(() => {
    const timer = setInterval(() => {
      const refTime = lastObservationTimestamp
        ? lastObservationTimestamp.getTime()
        : lastHeartbeat
        ? lastHeartbeat.getTime()
        : dataUpdatedAt;
      if (refTime) {
        const elapsed = Math.max(0, Math.floor((Date.now() - refTime) / 1000));
        setSecondsSinceLastUpdate(elapsed);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastObservationTimestamp, lastHeartbeat, dataUpdatedAt]);

  const isConnected = connectionStatus === 'CONNECTED' || (!isSystemError && Boolean(systemHealth));
  const isDegraded = systemHealth?.status === 'DEGRADED';

  const value: StreamState = {
    connectionStatus,
    transportMode,
    isConnected,
    isDegraded,
    lastHeartbeat: lastHeartbeat || (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    lastObservationTimestamp,
    secondsSinceLastUpdate,
    activeModelId: systemHealth?.active_model_id || 'isolation_forest_s42',
    reconnectCount,
    eventsReceivedCount,
    lastEvent,
  };

  return (
    <RealtimeStreamContext.Provider value={value}>
      {children}
    </RealtimeStreamContext.Provider>
  );
};

export function useRealtimeStream(): StreamState {
  const context = useContext(RealtimeStreamContext);
  if (!context) {
    return {
      connectionStatus: 'DISCONNECTED',
      transportMode: 'POLLING',
      isConnected: false,
      isDegraded: false,
      lastHeartbeat: null,
      lastObservationTimestamp: null,
      secondsSinceLastUpdate: 0,
      activeModelId: 'isolation_forest_s42',
      reconnectCount: 0,
      eventsReceivedCount: 0,
      lastEvent: null,
    };
  }
  return context;
}
