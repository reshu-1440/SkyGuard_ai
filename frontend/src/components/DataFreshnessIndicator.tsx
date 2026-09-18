import React from 'react';
import { Wifi, WifiOff, Pause } from 'lucide-react';
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

  // Real observation timestamp from provider
  const obsTimestampStr = lastObservationTimestamp
    ? lastObservationTimestamp.toISOString().substring(11, 19) + ' UTC'
    : (lastHeartbeat ? lastHeartbeat.toISOString().substring(11, 19) + ' UTC' : '--:--:--');

  const receiptTimestampStr = lastHeartbeat
    ? lastHeartbeat.toISOString().substring(11, 19) + ' UTC'
    : '--:--:--';

  // Format observation age
  const formatAge = (secs: number) => {
    if (secs < 60) return `${Math.max(0, secs).toFixed(0)}s`;
    const mins = Math.floor(secs / 60);
    const rem = Math.floor(secs % 60);
    return `${mins}m ${rem}s`;
  };

  // Case 1: Historical Analysis
  if (mode === 'HISTORICAL_ANALYSIS') {
    return (
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-slate-700 bg-slate-900 text-slate-300">
        <span className="h-2 w-2 rounded-full bg-slate-400" />
        <span className="font-semibold text-slate-200">HISTORICAL</span>
        <span className="text-slate-400">Not streaming</span>
      </div>
    );
  }

  // Case 2: Disconnected
  if (connectionStatus === 'DISCONNECTED' || connectionStatus === 'ERROR' || !isConnected) {
    return (
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-red-800/80 bg-red-950/60 text-red-300">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
        <span className="font-semibold text-red-400">DISCONNECTED</span>
        <WifiOff className="w-3.5 h-3.5 text-red-400" />
      </div>
    );
  }

  // Case 3: Replay Mode (Synthetic or Historical Replay)
  if (mode === 'SYNTHETIC_REPLAY' || mode === 'HISTORICAL_REPLAY') {
    if (status === 'RUNNING') {
      return (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-indigo-700/70 bg-indigo-950/50 text-indigo-200">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-indigo-400" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
          </span>
          <span className="font-bold text-indigo-300">REPLAYING</span>
          {syntheticTime && (
            <span className="text-indigo-200 hidden sm:inline">
              Sim: <span className="text-indigo-100 font-semibold">{syntheticTime}</span>
            </span>
          )}
          <span className="text-slate-400 text-[10px] hidden md:inline">
            Real: {receiptTimestampStr}
          </span>
          <span className="px-1 py-0.2 rounded bg-indigo-900/80 text-indigo-300 font-semibold text-[10px] border border-indigo-600/40">
            {speed}x
          </span>
        </div>
      );
    } else if (status === 'PAUSED') {
      return (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-amber-700/70 bg-amber-950/50 text-amber-300">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="font-semibold text-amber-300 flex items-center gap-1">
            <Pause className="w-3 h-3" /> PAUSED
          </span>
          <span className="text-slate-400 text-[10px] hidden sm:inline">
            {context?.current_observation_index ?? 0} / {context?.observation_count ?? 0}
          </span>
        </div>
      );
    } else {
      return (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-slate-700 bg-slate-900/80 text-slate-300">
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          <span className="font-semibold text-slate-300">READY</span>
          <span className="text-slate-400 text-[10px] hidden sm:inline">
            Speed: {speed}x
          </span>
        </div>
      );
    }
  }

  // Case 4: Live Open-Meteo Provider
  const isStale = secondsSinceLastUpdate > 900; // 15 mins for standard provider schedule
  if (isStale) {
    return (
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-yellow-700/70 bg-yellow-950/50 text-yellow-300">
        <span className="h-2 w-2 rounded-full bg-yellow-400" />
        <span className="font-bold text-yellow-300">STALE</span>
        <span className="text-yellow-200">Age: {formatAge(secondsSinceLastUpdate)}</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-mono border border-emerald-800/80 bg-emerald-950/40 text-emerald-300">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
      </span>
      <span className="font-bold tracking-wide">LIVE</span>
      <span className="text-slate-300 text-[10px] hidden sm:inline" title={`Provider Observation: ${obsTimestampStr} | Received: ${receiptTimestampStr}`}>
        Obs: <span className="text-slate-100 font-semibold">{obsTimestampStr}</span>
      </span>
      <span className="text-emerald-300 text-[10px] font-semibold">
        Age: {formatAge(secondsSinceLastUpdate)}
      </span>
      {transportMode === 'WEBSOCKET' ? (
        <Wifi className="w-3.5 h-3.5 opacity-80" />
      ) : (
        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-900 border border-emerald-700">
          POLL
        </span>
      )}
    </div>
  );
};
