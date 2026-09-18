import React from 'react';
import { WifiOff, Pause, Wifi } from 'lucide-react';
import { ConnectionStatus } from '../types/events';
import { RunContext } from '../types/runtime';

interface DataFreshnessIndicatorProps {
  isConnected: boolean;
  secondsSinceLastUpdate: number;
  lastHeartbeat?: Date | null;
  lastObservationTimestamp?: Date | null;
  connectionStatus?: ConnectionStatus;
  transportMode?: 'WEBSOCKET' | 'POLLING';
  context?: RunContext | null;
}

const formatAge = (secs: number) => {
  if (secs < 60) return `${Math.max(0, secs).toFixed(0)}s`;
  const mins = Math.floor(secs / 60);
  const rem = Math.floor(secs % 60);
  return `${mins}m ${rem}s`;
};

const BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '11px',
  fontWeight: 500,
  borderRadius: '2px',
  border: '1px solid',
  whiteSpace: 'nowrap',
};

export const DataFreshnessIndicator: React.FC<DataFreshnessIndicatorProps> = ({
  isConnected,
  secondsSinceLastUpdate,
  lastHeartbeat,
  lastObservationTimestamp,
  connectionStatus = 'CONNECTED',
  transportMode = 'WEBSOCKET',
  context,
}) => {
  const mode = context?.mode || 'SYNTHETIC_REPLAY';
  const status = context?.status || 'IDLE';
  const speed = context?.replay_speed || 60;

  const syntheticTime = context?.current_synthetic_time
    ? new Date(context.current_synthetic_time).toISOString().substring(11, 16) + ' UTC'
    : null;

  const obsTimestampStr = lastObservationTimestamp
    ? lastObservationTimestamp.toISOString().substring(11, 19) + ' UTC'
    : lastHeartbeat
      ? lastHeartbeat.toISOString().substring(11, 19) + ' UTC'
      : '--:--:--';

  const receiptTimestampStr = lastHeartbeat
    ? lastHeartbeat.toISOString().substring(11, 19) + ' UTC'
    : '--:--:--';

  // ── Case 1: Historical Analysis (not streaming) ──────────────────────────────
  if (mode === 'HISTORICAL_ANALYSIS') {
    return (
      <div style={{ ...BASE, background: '#0D1420', borderColor: '#1F2D45', color: '#4A5B78' }}>
        <span className="w-2 h-2 rounded-full" style={{ background: '#1F2D45' }} />
        <span style={{ color: '#7B90B2' }}>HISTORICAL</span>
        <span>Not streaming</span>
      </div>
    );
  }

  // ── Case 2: Disconnected — pulsing dot ONLY because this is an error state ───
  if (connectionStatus === 'DISCONNECTED' || connectionStatus === 'ERROR' || !isConnected) {
    return (
      <div style={{ ...BASE, background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.4)', color: '#FCA5A5' }}>
        {/* Pulsing dot communicates active error / reconnecting state */}
        <span className="w-2 h-2 rounded-full signal-reconnecting" style={{ background: '#EF4444' }} />
        <span style={{ fontWeight: 700, color: '#F87171' }}>DISCONNECTED</span>
        <WifiOff className="w-3.5 h-3.5 text-red-400" />
      </div>
    );
  }

  // ── Case 3: Replay Mode ───────────────────────────────────────────────────────
  if (mode === 'SYNTHETIC_REPLAY' || mode === 'HISTORICAL_REPLAY') {
    if (status === 'RUNNING') {
      return (
        <div style={{ ...BASE, background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.35)', color: '#C4B5FD' }}>
          {/* Streaming dot — animate only when actively streaming */}
          <span className="w-2 h-2 rounded-full signal-streaming" style={{ background: '#818CF8' }} />
          <span style={{ fontWeight: 700, color: '#A78BFA' }}>REPLAYING</span>
          {syntheticTime && (
            <span className="hidden sm:inline" style={{ color: '#8B5CF6' }}>
              Sim: <span style={{ color: '#E8EEF7', fontWeight: 600 }}>{syntheticTime}</span>
            </span>
          )}
          <span className="hidden md:inline" style={{ color: '#4A5B78' }}>
            Real: {receiptTimestampStr}
          </span>
          <span
            style={{
              padding: '1px 6px',
              background: 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              color: '#A78BFA',
              fontWeight: 700,
              borderRadius: '2px',
            }}
          >
            {speed}x
          </span>
        </div>
      );
    }

    if (status === 'PAUSED') {
      return (
        <div style={{ ...BASE, background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)', color: '#FCD34D' }}>
          {/* Static dot — paused state is stable, no animation */}
          <span className="w-2 h-2 rounded-full" style={{ background: '#F59E0B' }} />
          <Pause className="w-3 h-3 text-amber-400" />
          <span style={{ fontWeight: 700, color: '#FBBF24' }}>PAUSED</span>
          <span className="hidden sm:inline" style={{ color: '#78716C' }}>
            {context?.current_observation_index ?? 0} / {context?.observation_count ?? 0}
          </span>
        </div>
      );
    }

    // IDLE / READY
    return (
      <div style={{ ...BASE, background: '#0D1420', borderColor: '#1F2D45', color: '#4A5B78' }}>
        <span className="w-2 h-2 rounded-full" style={{ background: '#334155' }} />
        <span style={{ color: '#94A3B8', fontWeight: 600 }}>READY</span>
        <span>Speed: {speed}x</span>
      </div>
    );
  }

  // ── Case 4: Live provider ─────────────────────────────────────────────────────
  const isStale = secondsSinceLastUpdate > 900; // 15 mins stale threshold

  if (isStale) {
    return (
      <div style={{ ...BASE, background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)', color: '#FCD34D' }}>
        {/* Static dot — stale is a degraded but stable state */}
        <span className="w-2 h-2 rounded-full" style={{ background: '#F59E0B' }} />
        <span style={{ fontWeight: 700, color: '#FBBF24' }}>STALE</span>
        <span>Age: {formatAge(secondsSinceLastUpdate)}</span>
      </div>
    );
  }

  // Live & fresh
  return (
    <div style={{ ...BASE, background: 'rgba(0,201,167,0.07)', borderColor: 'rgba(0,201,167,0.3)', color: '#6EE7B7' }}>
      {/* Steady dot — live connection is stable, not an error or change */}
      <span className="w-2 h-2 rounded-full" style={{ background: '#00C9A7' }} />
      <span style={{ fontWeight: 700, color: '#34D399' }}>LIVE</span>
      <span className="hidden sm:inline" style={{ color: '#4A5B78' }}
        title={`Provider Observation: ${obsTimestampStr} | Received: ${receiptTimestampStr}`}
      >
        Obs: <span style={{ color: '#E8EEF7', fontWeight: 600 }}>{obsTimestampStr}</span>
      </span>
      <span style={{ color: '#10B981', fontWeight: 600 }}>
        {formatAge(secondsSinceLastUpdate)}
      </span>
      {transportMode === 'WEBSOCKET'
        ? <Wifi className="w-3.5 h-3.5 opacity-60" />
        : <span style={{ fontSize: '9px', padding: '1px 4px', background: 'rgba(0,201,167,0.1)', border: '1px solid rgba(0,201,167,0.25)', borderRadius: '2px' }}>POLL</span>
      }
    </div>
  );
};
