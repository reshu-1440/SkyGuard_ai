import React, { useState, useEffect } from 'react';
import { useRealtimeStream } from '../hooks/useRealtimeStream';
import { useAnomalies } from '../hooks/useAnomalies';
import { useRunContext } from '../hooks/useRunContext';
import { useLiveSourceHealth } from '../hooks/useSystem';
import { DataFreshnessIndicator } from '../components/DataFreshnessIndicator';
import { EvidenceAuditModal } from '../components/EvidenceAuditModal';
import { Bell, Clock, BookOpen, PlayCircle, Radio, Activity, Database, FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// SkyGuard shield/radar SVG — no animation, just static identity mark
const SkyGuardMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.5C16.5 22.15 20 17.25 20 12V6l-8-4z"
      fill="none"
      stroke="#38BDF8"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" fill="#38BDF8" opacity="0.9" />
    <path d="M12 9v-3M12 15v3M9 12H6M18 12h-3" stroke="#38BDF8" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
  </svg>
);

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const streamState = useRealtimeStream();
  const { context } = useRunContext();
  const { data: anomalyData } = useAnomalies({ limit: 100 });
  const { data: liveSource } = useLiveSourceHealth();
  const [utcTime, setUtcTime] = useState<string>('');
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState<boolean>(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(now.toISOString().substring(11, 19) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const totalAnomalies = anomalyData?.pagination?.total_count ?? 0;
  const sourceType = context?.source_type || 'SYNTHETIC_VALIDATION';
  const mode = context?.mode || 'SYNTHETIC_REPLAY';
  const isRunning = context?.status === 'RUNNING';

  // Operational mode pill — truthful, no decoration
  const renderModePill = () => {
    if (sourceType === 'SYNTHETIC_VALIDATION') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-semibold border"
          style={{ background: 'rgba(167,139,250,0.08)', borderColor: 'rgba(167,139,250,0.35)', color: '#C4B5FD' }}>
          {/* Spin ONLY when actively running — communicates state */}
          <PlayCircle className={`w-3 h-3 ${isRunning ? 'animate-spin text-violet-400' : 'text-violet-500'}`} />
          SYNTHETIC REPLAY
          {isRunning && <span className="text-violet-400 font-bold leading-none">●</span>}
        </span>
      );
    }

    if (sourceType === 'HISTORICAL_CSV') {
      if (mode === 'HISTORICAL_REPLAY') {
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-semibold border"
            style={{ background: 'rgba(96,165,250,0.08)', borderColor: 'rgba(96,165,250,0.35)', color: '#93C5FD' }}>
            <FileSpreadsheet className="w-3 h-3 text-blue-400" />
            HISTORICAL REPLAY
            {isRunning && <span className="text-blue-400 font-bold leading-none">●</span>}
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-semibold border"
          style={{ background: 'rgba(100,116,139,0.12)', borderColor: 'rgba(100,116,139,0.3)', color: '#94A3B8' }}>
          <Database className="w-3 h-3 text-slate-400" />
          HISTORICAL ANALYSIS
        </span>
      );
    }

    if (sourceType === 'OPEN_METEO') {
      const liveUnavailable = liveSource?.status === 'AUTH_ERROR'
        || liveSource?.status === 'CONFIG_ERROR'
        || liveSource?.status === 'RATE_LIMITED';
      if (liveUnavailable) {
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-semibold border"
            style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.35)', color: '#FCA5A5' }}>
            <Radio className="w-3 h-3 text-red-400" />
            LIVE API UNAVAILABLE
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-semibold border"
          style={{ background: 'rgba(0,201,167,0.08)', borderColor: 'rgba(0,201,167,0.35)', color: '#6EE7B7' }}>
          {/* Steady dot — no animation for steady live state */}
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          LIVE API · OPEN-METEO
        </span>
      );
    }

    if (sourceType === 'IMD_AWS') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-semibold border"
          style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)', color: '#FCD34D' }}>
          <Radio className="w-3 h-3 text-amber-400" />
          IMD AWS · UNCONFIGURED
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] border border-border text-slate-400 bg-surface-2">
        {sourceType}
      </span>
    );
  };

  const processedCount = context?.current_observation_index ?? streamState.eventsReceivedCount;
  const totalCount = context?.observation_count ?? 0;

  const hasActiveAnomalies = totalAnomalies > 0;

  return (
    <>
      <header
        className="h-12 border-b px-4 flex items-center justify-between text-xs select-none z-30 flex-shrink-0"
        style={{
          background: 'linear-gradient(180deg, #0A1018 0%, #0D1420 100%)',
          borderColor: '#1F2D45',
        }}
      >
        {/* Left: Brand identity */}
        <div className="flex items-center gap-4">
          {/* Logo + wordmark */}
          <button
            className="flex items-center gap-2 group"
            onClick={() => navigate('/network')}
            title="SkyGuard AI — Network Overview"
          >
            <SkyGuardMark />
            <span className="font-mono font-bold tracking-widest text-[13px] text-slate-100 group-hover:text-ops-weather transition-colors">
              SKYGUARD AI
            </span>
            <span className="font-mono text-[10px] text-slate-500 bg-surface-2 px-1.5 py-0.5 border border-border hidden sm:inline"
              style={{ borderRadius: '2px' }}>
              NOC v1.0
            </span>
          </button>

          {/* Vertical divider */}
          <span className="hidden md:block w-px h-5 bg-border" />

          {/* Mode pill — state-driven label only */}
          <div className="hidden md:block">{renderModePill()}</div>
        </div>

        {/* Center: Telemetry stream status */}
        <div className="flex items-center gap-3">
          <DataFreshnessIndicator
            isConnected={streamState.isConnected}
            secondsSinceLastUpdate={streamState.secondsSinceLastUpdate}
            lastHeartbeat={streamState.lastHeartbeat}
            lastObservationTimestamp={streamState.lastObservationTimestamp}
            connectionStatus={streamState.connectionStatus}
            transportMode={streamState.transportMode}
            context={context}
          />

          {/* Observations processed counter */}
          <div
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] border"
            style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
          >
            <Activity className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-500">OBS:</span>
            <span className="text-slate-200 font-bold tabular-nums">
              {mode === 'HISTORICAL_ANALYSIS'
                ? totalCount.toLocaleString()
                : processedCount.toLocaleString()}
              {totalCount > 0 && mode !== 'HISTORICAL_ANALYSIS' && (
                <span className="text-slate-500 font-normal"> / {totalCount.toLocaleString()}</span>
              )}
            </span>
          </div>
        </div>

        {/* Right: Evidence, alert counter, UTC clock */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Scientific evidence / provenance trigger */}
          <button
            onClick={() => setIsEvidenceModalOpen(true)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] border text-slate-400 hover:text-slate-200 hover:border-border-accent transition-colors"
            style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
            title="Inspect Benchmark Evidence & Provenance"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>EVIDENCE</span>
          </button>

          {/* Persisted Anomaly Records counter */}
          <button
            onClick={() => navigate('/anomalies')}
            className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] border transition-colors"
            style={{
              borderRadius: '2px',
              background: hasActiveAnomalies ? 'rgba(239,68,68,0.1)' : '#0D1420',
              borderColor: hasActiveAnomalies ? 'rgba(239,68,68,0.4)' : '#1F2D45',
              color: hasActiveAnomalies ? '#FCA5A5' : '#4A5B78',
            }}
            title={`${totalAnomalies.toLocaleString()} persisted anomaly records in database`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span className="tabular-nums font-bold">{totalAnomalies.toLocaleString()}</span>
            <span className="hidden sm:inline">ANOMALIES</span>
          </button>

          {/* UTC clock — static readout, no blinking */}
          <div
            className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400 border"
            style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px', padding: '4px 10px' }}
          >
            <Clock className="w-3.5 h-3.5 text-slate-600" />
            <span className="tabular-nums">{utcTime || '--:--:-- UTC'}</span>
          </div>
        </div>
      </header>

      <EvidenceAuditModal
        isOpen={isEvidenceModalOpen}
        onClose={() => setIsEvidenceModalOpen(false)}
      />
    </>
  );
};
