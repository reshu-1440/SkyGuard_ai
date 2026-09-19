import React, { useState } from 'react';
import { useStations } from '../hooks/useStations';
import { useAnomalies } from '../hooks/useAnomalies';
import {
  useSystemHealth,
  useLiveSourceHealth,
  useTriggerLivePoll,
  useReplayStatus,
  useReplayScenarios,
  useLoadScenario,
  useStepReplay,
  useResetReplay,
} from '../hooks/useSystem';
import { NetworkMap } from '../components/NetworkMap';
import { AlertList } from '../components/AlertList';
import { MetricTable, ColumnDef } from '../components/MetricTable';
import { StationStatus } from '../components/StationStatus';
import { StationItem } from '../types/api';
import { useNavigate } from 'react-router-dom';
import {
  formatTemperature,
  formatHumidity,
  formatPressure,
  formatHealthScore,
  formatLatency,
  formatIsoUtc,
} from '../utils/formatters';
import { useRunContext } from '../hooks/useRunContext';
import {
  Radio,
  AlertTriangle,
  ShieldCheck,
  Search,
  Globe,
  RefreshCw,
  AlertOctagon,
  Play,
  RotateCcw,
  FastForward,
  Sparkles,
} from 'lucide-react';

// ─── Shared panel style ────────────────────────────────────────────────────────
const PANEL: React.CSSProperties = {
  background: '#0D1420',
  border: '1px solid #1F2D45',
  borderRadius: '2px',
};

// ─── Severity color lookup ─────────────────────────────────────────────────────
const severityBadge = (state?: string) => {
  switch (state) {
    case 'HEALTHY':      return { border: '#10B981', text: '#6EE7B7',  dot: '#10B981', label: 'SOURCE: HEALTHY' };
    case 'DEGRADED':     return { border: '#F59E0B', text: '#FCD34D',  dot: '#F59E0B', label: 'SOURCE: DEGRADED' };
    case 'STALE':        return { border: '#EAB308', text: '#FDE047',  dot: '#EAB308', label: 'SOURCE: STALE FEED' };
    case 'DISCONNECTED': return { border: '#EF4444', text: '#FCA5A5',  dot: '#EF4444', label: 'SOURCE: DISCONNECTED' };
    case 'RATE_LIMITED': return { border: '#F97316', text: '#FDBA74',  dot: '#F97316', label: 'SOURCE: RATE LIMITED (429)' };
    case 'AUTH_ERROR':   return { border: '#EF4444', text: '#FCA5A5',  dot: '#EF4444', label: 'SOURCE: AUTH ERROR (401/403)' };
    default:             return { border: '#1F2D45', text: '#4A5B78',  dot: '#334155', label: 'SOURCE: UNKNOWN' };
  }
};

export const NetworkOverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { context } = useRunContext();
  const { data: stations = [], isLoading: isLoadingStations } = useStations();
  const { data: anomalyData, isLoading: isLoadingAnomalies } = useAnomalies({ limit: 10, historical: false });
  const { data: systemHealth } = useSystemHealth();
  const { data: liveSource } = useLiveSourceHealth();
  const { data: replayStatus } = useReplayStatus();
  const { data: scenarios = [] } = useReplayScenarios();

  const pollMutation = useTriggerLivePoll();
  const stepMutation = useStepReplay();
  const loadScenarioMutation = useLoadScenario();
  const resetMutation = useResetReplay();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('flagship_narrative');

  const activeAnomalies = anomalyData?.items || [];
  const currentRunAnomalies = anomalyData?.pagination?.total_count ?? 0;
  const totalStations = stations.length;
  const activeStations = stations.filter(
    (s) => (s.latest_snapshot?.status || s.status) === 'ACTIVE'
  ).length;
  const stationsWithHealth = stations.filter(
    (s) => s.latest_snapshot?.latest_health_score !== null && s.latest_snapshot?.latest_health_score !== undefined
  );
  const criticalCount = stations.filter(
    (s) => (s.latest_snapshot?.latest_health_score ?? null) !== null && (s.latest_snapshot?.latest_health_score ?? 100) < 60
  ).length;
  const warningCount = stations.filter((s) => {
    const sc = s.latest_snapshot?.latest_health_score ?? null;
    return sc !== null && sc >= 60 && sc < 85;
  }).length;
  const meanHealth =
    stationsWithHealth.length > 0
      ? Math.round(
          stationsWithHealth.reduce((acc, s) => acc + (s.latest_snapshot!.latest_health_score!), 0) /
            stationsWithHealth.length
        )
      : null;

  const filteredStations = stations.filter(
    (s) =>
      s.station_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.state && s.state.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const isLiveDisconnected =
    context?.source_type === 'OPEN_METEO' &&
    (liveSource?.status === 'AUTH_ERROR' ||
      liveSource?.status === 'CONFIG_ERROR' ||
      liveSource?.status === 'RATE_LIMITED');

  const liveBadge = severityBadge(liveSource?.source_state || liveSource?.status);

  const handleScenarioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sId = e.target.value;
    setSelectedScenarioId(sId);
    loadScenarioMutation.mutate(sId);
  };

  const healthColor = (score: number | null) => {
    if (score === null) return '#4A5B78';
    if (score < 60) return '#EF4444';
    if (score < 85) return '#F59E0B';
    return '#10B981';
  };

  const columns: ColumnDef<StationItem>[] = [
    {
      key: 'station_id',
      header: 'Station ID',
      render: (stn) => (
        <div>
          <span className="font-mono font-semibold" style={{ color: '#E8EEF7' }}>{stn.station_id}</span>
          <span className="font-mono text-[10px] block truncate" style={{ color: '#4A5B78' }}>{stn.name}</span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: (stn) => <StationStatus status={stn.latest_snapshot?.status || stn.status} />,
      sortable: true,
    },
    {
      key: 'temperature',
      header: 'Temp (°C)',
      align: 'right',
      render: (stn) => (
        <span className="font-mono" style={{ color: '#38BDF8' }}>
          {formatTemperature(stn.latest_snapshot?.latest_temperature_c, 1, false)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'humidity',
      header: 'Humidity (%)',
      align: 'right',
      render: (stn) => (
        <span className="font-mono" style={{ color: '#34D399' }}>
          {formatHumidity(stn.latest_snapshot?.latest_humidity_pct, 0, false)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'pressure',
      header: 'Pressure (hPa)',
      align: 'right',
      render: (stn) => (
        <span className="font-mono" style={{ color: '#818CF8' }}>
          {formatPressure(stn.latest_snapshot?.latest_pressure_hpa, 1, false)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'health',
      header: 'Health Index',
      align: 'center',
      render: (stn) => {
        const score = stn.latest_snapshot?.latest_health_score ?? null;
        if (score === null) {
          return (
            <div className="flex flex-col items-center leading-tight">
              <span className="font-mono font-semibold text-slate-400">— / 100</span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
                INSUFFICIENT HISTORY
              </span>
            </div>
          );
        }
        return (
          <span className="font-mono font-semibold" style={{ color: healthColor(score) }}>
            {formatHealthScore(score)} / 100
          </span>
        );
      },
      sortable: true,
    },
    {
      key: 'last_seen',
      header: 'Last Seen (UTC)',
      align: 'right',
      render: (stn) => (
        <span className="font-mono text-[11px]" style={{ color: '#4A5B78' }}>
          {stn.latest_snapshot?.last_seen_timestamp
            ? formatIsoUtc(stn.latest_snapshot.last_seen_timestamp, true)
            : '—'}
        </span>
      ),
    },
    {
      key: 'anomalies',
      header: 'Active 24h',
      align: 'center',
      render: (stn) => {
        const count = stn.latest_snapshot?.active_anomaly_count_24h ?? 0;
        return count > 0 ? (
          <span
            className="font-mono text-[10px] font-bold px-1.5 py-0.5"
            style={{
              background: 'rgba(239,68,68,0.1)',
              color: '#FCA5A5',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '2px',
            }}
          >
            {count} FLAG
          </span>
        ) : (
          <span className="font-mono text-[11px]" style={{ color: '#2A3E60' }}>0</span>
        );
      },
      sortable: true,
    },
  ];

  return (
    <div className="space-y-4">

      {/* ── Live Source Unavailable Warning ────────────────────────────────────── */}
      {isLiveDisconnected && (
        <div
          className="p-3 flex flex-wrap items-center justify-between gap-3"
          style={{
            background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderLeft: '3px solid #EF4444',
            borderRadius: '2px',
          }}
        >
          <div className="flex items-center gap-2 text-xs font-mono">
            <AlertOctagon className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div>
              <strong style={{ color: '#FCA5A5' }}>LIVE SOURCE UNAVAILABLE</strong>
              <p className="mt-0.5" style={{ color: '#7B90B2', fontSize: '11px' }}>
                Cannot connect to live weather telemetry upstream. Displaying last verified provider telemetry.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Synthetic Replay Controller (gated to SYNTHETIC_REPLAY) ────────────── */}
      {context?.mode === 'SYNTHETIC_REPLAY' && (
        <div
          className="p-3 flex flex-wrap items-center justify-between gap-3"
          style={{
            background: 'rgba(167,139,250,0.05)',
            border: '1px solid rgba(167,139,250,0.2)',
            borderLeft: '3px solid #A78BFA',
            borderRadius: '2px',
          }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              <span className="font-mono font-bold text-[11px] uppercase tracking-wider" style={{ color: '#C4B5FD' }}>
                Synthetic Benchmark Controller
              </span>
            </div>

            <select
              value={selectedScenarioId}
              onChange={handleScenarioChange}
              className="font-mono text-[11px] px-2.5 py-1 border"
              style={{ background: '#0D1420', borderColor: '#1F2D45', color: '#C4B5FD', borderRadius: '2px' }}
            >
              {scenarios.map((sc: any, idx: number) => {
                const sId = sc.scenario_id || sc.id || `scenario-${idx}`;
                const sName = sc.scenario_name || sc.name || sId;
                return <option key={sId} value={sId}>{sName}</option>;
              })}
              {scenarios.length === 0 && (
                <option value="flagship_narrative">Flagship Multi-Fault Narrative</option>
              )}
            </select>

            <div className="flex items-center gap-2 font-mono text-[11px] pl-3 border-l" style={{ borderColor: '#1F2D45', color: '#4A5B78' }}>
              <span>Progress: <strong style={{ color: '#A78BFA' }}>{context?.current_observation_index ?? replayStatus?.current_index ?? 0}</strong> / {context?.observation_count ?? replayStatus?.total_queued_observations ?? 384}</span>
              <span style={{ color: '#1F2D45' }}>|</span>
              <span>Emitted: <strong style={{ color: '#E8EEF7' }}>{context?.current_observation_index ?? replayStatus?.emitted_count ?? 0}</strong></span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <button
              onClick={() => stepMutation.mutate(1)}
              disabled={stepMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1 border disabled:opacity-50 transition-colors"
              style={{ background: '#0D1420', borderColor: '#1F2D45', color: '#C4B5FD', borderRadius: '2px' }}
              title="Step simulation forward by 1 observation"
            >
              <Play className="w-3 h-3" />
              Step 1 AWS
            </button>
            <button
              onClick={() => stepMutation.mutate(8)}
              disabled={stepMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1 border font-semibold disabled:opacity-50 transition-colors"
              style={{ background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.3)', color: '#A78BFA', borderRadius: '2px' }}
              title="Step forward by 1 full network cycle (all 8 stations)"
            >
              <FastForward className="w-3.5 h-3.5" />
              Step Cycle (8 AWS)
            </button>
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1 border disabled:opacity-50 transition-colors"
              style={{ background: '#0D1420', borderColor: '#1F2D45', color: '#7B90B2', borderRadius: '2px' }}
              title="Reset replay pointer to initial state"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>
      )}

      {/* ── Live Open-Meteo Operations Bar (gated to OPEN_METEO) ──────────────── */}
      {context?.source_type === 'OPEN_METEO' && (
        <div
          className="p-3 flex flex-wrap items-center justify-between gap-3"
          style={{ ...PANEL }}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" style={{ color: '#38BDF8' }} />
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] font-bold border"
                style={{
                  background: `${liveBadge.border}10`,
                  borderColor: `${liveBadge.border}40`,
                  color: liveBadge.text,
                  borderRadius: '2px',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: liveBadge.dot }} />
                {liveBadge.label}
              </span>
              <span className="font-mono text-[11px]" style={{ color: '#4A5B78' }}>
                Provider: <strong style={{ color: '#E8EEF7' }}>{(liveSource?.provider || 'Open-Meteo').toUpperCase()}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px] pl-4 border-l" style={{ borderColor: '#1F2D45' }}>
              <span className="px-1.5 py-0.5" style={{ background: 'rgba(16,185,129,0.1)', color: '#6EE7B7', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '2px', fontSize: '10px' }}>
                {liveSource?.counts?.live_stations ?? activeStations} LIVE
              </span>
              <span className="px-1.5 py-0.5" style={{ background: 'rgba(245,158,11,0.1)', color: '#FCD34D', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '2px', fontSize: '10px' }}>
                {liveSource?.counts?.stale_stations ?? 0} STALE
              </span>
              <span className="px-1.5 py-0.5" style={{ background: 'rgba(239,68,68,0.1)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '2px', fontSize: '10px' }}>
                {liveSource?.counts?.offline_stations ?? (totalStations - activeStations)} OFFLINE
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-3 font-mono text-[11px] pl-4 border-l" style={{ borderColor: '#1F2D45', color: '#4A5B78' }}>
              <span>Latency: <strong style={{ color: '#E8EEF7' }}>{formatLatency(liveSource?.metrics?.mean_request_latency_ms ?? liveSource?.last_request_latency_ms ?? 45.0)}</strong></span>
              <span>Last ingestion: <span style={{ color: '#7B90B2' }}>{liveSource?.metrics?.last_poll_cycle_start ? formatIsoUtc(liveSource.metrics.last_poll_cycle_start, true) : 'Recent'}</span></span>
            </div>
          </div>

          <button
            onClick={() => pollMutation.mutate()}
            disabled={pollMutation.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] border disabled:opacity-50 transition-colors"
            style={{ background: '#0D1420', borderColor: '#1F2D45', color: '#7B90B2', borderRadius: '2px' }}
            title="Trigger on-demand live poll cycle"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pollMutation.isPending ? 'animate-spin text-ops-weather' : ''}`} />
            {pollMutation.isPending ? 'Polling...' : 'Poll Now'}
          </button>
        </div>
      )}

      {/* ── Historical Dataset Bar (gated to HISTORICAL_CSV) ──────────────────── */}
      {context?.source_type === 'HISTORICAL_CSV' && (
        <div
          className="p-3 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px]"
          style={{
            background: 'rgba(96,165,250,0.05)',
            border: '1px solid rgba(96,165,250,0.2)',
            borderLeft: '3px solid #60A5FA',
            borderRadius: '2px',
          }}
        >
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 font-bold text-[10px]" style={{ background: 'rgba(96,165,250,0.1)', color: '#93C5FD', border: '1px solid rgba(96,165,250,0.3)', borderRadius: '2px' }}>
              HISTORICAL DATASET
            </span>
            <span style={{ color: '#7B90B2' }}>
              Dataset: <strong style={{ color: '#E8EEF7' }}>{context.dataset_id || 'IMD_NCR_2023_HISTORICAL.csv'}</strong>
            </span>
            <span style={{ color: '#4A5B78' }}>
              Observations: <strong style={{ color: '#E8EEF7' }}>{context.observation_count.toLocaleString()}</strong> across <strong style={{ color: '#E8EEF7' }}>{context.station_count}</strong> AWS
            </span>
          </div>
          <span style={{ color: '#4A5B78' }}>
            Mode: <strong style={{ color: '#93C5FD' }}>{context.mode === 'HISTORICAL_REPLAY' ? 'Sequential Replay' : 'Batch Analysis'}</strong>
          </span>
        </div>
      )}

      {/* ── Network Operational Status Strip ─────────────────────────────────── */}
      <div className="p-3 flex flex-wrap items-center justify-between gap-4" style={PANEL}>
        <div className="flex flex-wrap items-center gap-6">
          {/* Stations Online */}
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 flex-shrink-0" style={{ color: '#38BDF8' }} />
            <div>
              <span className="kpi-label block">Stations Online</span>
              <span className="kpi-value" style={{ fontSize: '22px' }}>
                {activeStations}{' '}
                <span style={{ color: '#2A3E60', fontSize: '14px', fontWeight: 400 }}>/ {totalStations}</span>
              </span>
            </div>
          </div>

          {/* Current Run Anomalies */}
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-4 h-4 flex-shrink-0 ${currentRunAnomalies > 0 ? 'text-red-400' : ''}`}
              style={{ color: currentRunAnomalies > 0 ? '#EF4444' : '#2A3E60' }}
            />
            <div>
              <span className="kpi-label block" title="Anomalies detected in active run up to replay cursor">Current Run Anomalies</span>
              <span className="kpi-value" style={{ fontSize: '22px', color: currentRunAnomalies > 0 ? '#EF4444' : '#E8EEF7' }}>
                {currentRunAnomalies}
              </span>
            </div>
          </div>

          {/* Sensor Degradation Summary */}
          <div className="pl-4 border-l" style={{ borderColor: '#1F2D45' }}>
            <span className="kpi-label block">Sensor Degradation</span>
            <div className="flex items-center gap-2 mt-0.5 font-mono text-[12px] font-semibold">
              <span style={{ color: '#F59E0B' }}>{warningCount} WARN</span>
              <span style={{ color: '#1F2D45' }}>·</span>
              <span style={{ color: '#EF4444' }}>{criticalCount} CRIT</span>
            </div>
          </div>

          {/* Mean Health Index */}
          <div className="flex items-center gap-2.5 pl-4 border-l" style={{ borderColor: '#1F2D45' }}>
            <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: meanHealth !== null ? '#10B981' : '#4A5B78' }} />
            <div>
              <span className="kpi-label block">Network Health Index</span>
              {meanHealth !== null ? (
                <span className="kpi-value" style={{ fontSize: '22px', color: healthColor(meanHealth) }}>
                  {meanHealth} <span style={{ color: '#4A5B78', fontSize: '14px', fontWeight: 400 }}>/ 100</span>
                </span>
              ) : (
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="font-mono font-bold text-slate-300" style={{ fontSize: '18px' }}>— / 100</span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">INSUFFICIENT HISTORY</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pipeline metadata */}
        <div className="text-right font-mono text-[11px]" style={{ color: '#2A3E60' }}>
          <div>Pipeline Latency: <strong style={{ color: '#7B90B2' }}>{formatLatency(systemHealth?.mean_pipeline_latency_ms ?? 0)}</strong></div>
          <div>Mode: <span style={{ color: '#A78BFA', fontWeight: 600 }}>{context?.mode ? context.mode.replace(/_/g, ' ') : 'SYNTHETIC REPLAY'}</span></div>
        </div>
      </div>

      {/* ── Map + Anomaly Stream ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Map panel */}
        <div className="lg:col-span-2" style={PANEL}>
          <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b" style={{ borderColor: '#1F2D45' }}>
            <h2 className="font-semibold text-[13px]" style={{ color: '#E8EEF7' }}>
              Automatic Weather Station Topology
            </h2>
            <span className="font-mono text-[10px]" style={{ color: '#2A3E60' }}>
              Interactive GIS · Leaflet
            </span>
          </div>
          <NetworkMap
            stations={stations}
            height="375px"
            onSelectStation={(id) => navigate(`/stations/${id}`)}
          />
        </div>

        {/* Anomaly feed panel */}
        <div style={PANEL}>
          <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b" style={{ borderColor: '#1F2D45' }}>
            <h2 className="font-semibold text-[13px]" style={{ color: '#E8EEF7' }}>
              Active Anomaly Stream
            </h2>
            <button
              onClick={() => navigate('/anomalies')}
              className="font-mono text-[11px] hover:underline transition-colors"
              style={{ color: '#38BDF8' }}
            >
              View all →
            </button>
          </div>
          <AlertList anomalies={activeAnomalies} isLoading={isLoadingAnomalies} limit={5} />
        </div>
      </div>

      {/* ── Network Telemetry Matrix ──────────────────────────────────────────── */}
      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-[13px]" style={{ color: '#E8EEF7' }}>
            Network Telemetry Matrix
          </h2>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: '#4A5B78' }} />
            <input
              type="text"
              placeholder="Search station ID or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 font-mono text-[12px] border"
              style={{ background: '#0D1420', borderColor: '#1F2D45', color: '#E8EEF7', width: '240px', borderRadius: '2px' }}
            />
          </div>
        </div>

        <MetricTable
          columns={columns}
          data={filteredStations}
          isLoading={isLoadingStations}
          rowIdKey="station_id"
          onRowClick={(row) => navigate(`/stations/${row.station_id}`)}
          emptyMessage="No weather stations matched the search query."
        />
      </div>
    </div>
  );
};
