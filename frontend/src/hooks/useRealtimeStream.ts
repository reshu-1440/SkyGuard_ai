import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSystemHealth } from './useSystem';
import {
  ConnectionStatus,
  WebSocketEnvelope,
  ObservationUpdatedPayload,
  HealthUpdatedPayload,
} from '../types/events';

export interface StreamState {
  connectionStatus: ConnectionStatus;
  transportMode: 'WEBSOCKET' | 'POLLING';
  isConnected: boolean;
  isDegraded: boolean;
  lastHeartbeat: Date | null;
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

export function useRealtimeStream(): StreamState {
  const queryClient = useQueryClient();
  const { data: systemHealth, isError: isSystemError, dataUpdatedAt } = useSystemHealth();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CONNECTING');
  const [transportMode, setTransportMode] = useState<'WEBSOCKET' | 'POLLING'>('POLLING');
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
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

  // Check ordering based on station timestamp
  const isChronologicallyValid = useCallback((stationId?: string | null, timestampStr?: string): boolean => {
    if (!stationId || !timestampStr) return true;
    const msgTime = new Date(timestampStr).getTime();
    if (isNaN(msgTime)) return true;

    const lastTime = stationTimestampsRef.current.get(stationId) || 0;
    if (msgTime < lastTime) {
      // Out of order stale message
      return false;
    }
    stationTimestampsRef.current.set(stationId, msgTime);
    return true;
  }, []);

  // Reconcile and resync client state on reconnection
  const resyncStateOnReconnect = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stations'] });
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
    setSecondsSinceLastUpdate(0);
    setEventsReceivedCount((prev) => prev + 1);
    setLastEvent(envelope);

    switch (envelope.event_type) {
      case 'observation.updated': {
        const payload = envelope.payload as ObservationUpdatedPayload;
        if (payload.station_id) {
          queryClient.invalidateQueries({ queryKey: ['station', payload.station_id, 'latest'] });
          queryClient.invalidateQueries({ queryKey: ['station', payload.station_id, 'history'] });
          queryClient.invalidateQueries({ queryKey: ['stations'] });
        }
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
        queryClient.invalidateQueries({ queryKey: ['stations'] });
        break;
      }
      case 'system.status_changed': {
        queryClient.invalidateQueries({ queryKey: ['system'] });
        break;
      }
      case 'replay.progress': {
        queryClient.invalidateQueries({ queryKey: ['replay'] });
        queryClient.invalidateQueries({ queryKey: ['runtime'] });
        break;
      }
      case 'heartbeat.pong': {
        // Heartbeat confirmed
        break;
      }
      default:
        break;
    }
  }, [queryClient, recordEventId, isChronologicallyValid]);


  // WebSocket Connection Management
  useEffect(() => {
    isMountedRef.current = true;

    const connectWs = () => {
      if (!isMountedRef.current) return;

      // Determine WebSocket URL: Check explicit VITE_WS_URL first, then reverse-proxy relative origin
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
          setSecondsSinceLastUpdate(0);

          if (hasEverConnectedRef.current) {
            // Reconnected after disconnection -> trigger resync
            resyncStateOnReconnect();
          }
          hasEverConnectedRef.current = true;
          setReconnectCount(0);

          // Setup ping heartbeat
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

          // Exponential backoff reconnect
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

  // Elapsed seconds timer
  useEffect(() => {
    const timer = setInterval(() => {
      const referenceTime = lastHeartbeat ? lastHeartbeat.getTime() : dataUpdatedAt;
      if (referenceTime) {
        const elapsed = Math.floor((Date.now() - referenceTime) / 1000);
        setSecondsSinceLastUpdate(elapsed);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastHeartbeat, dataUpdatedAt]);

  const isConnected = connectionStatus === 'CONNECTED' || (!isSystemError && Boolean(systemHealth));
  const isDegraded = systemHealth?.status === 'DEGRADED';

  return {
    connectionStatus,
    transportMode,
    isConnected,
    isDegraded,
    lastHeartbeat: lastHeartbeat || (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    secondsSinceLastUpdate,
    activeModelId: systemHealth?.active_model_id || 'isolation_forest_s42',
    reconnectCount,
    eventsReceivedCount,
    lastEvent,
  };
}
