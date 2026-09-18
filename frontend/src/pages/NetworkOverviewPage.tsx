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

export const NetworkOverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: stations = [], isLoading: isLoadingStations } = useStations();
  const { data: anomalyData, isLoading: isLoadingAnomalies } = useAnomalies({ limit: 10 });
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
  const totalStations = stations.length;
  const activeStations = stations.filter(
    (s) => (s.latest_snapshot?.status || s.status) === 'ACTIVE'
  ).length;

  const criticalCount = stations.filter(
    (s) => (s.latest_snapshot?.latest_health_score ?? 100) < 60
  ).length;
  const warningCount = stations.filter(
    (s) => {
      const sc = s.latest_snapshot?.latest_health_score ?? 100;
      return sc >= 60 && sc < 85;
    }
  ).length;

  const meanHealth =
    stations.length > 0
      ? Math.round(
          stations.reduce(
            (acc, s) => acc + (s.latest_snapshot?.latest_health_score ?? 100),
            0
          ) / stations.length
        )
      : 100;

  // Filtered station list for table
  const filteredStations = stations.filter(
    (s) =>
      s.station_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.state && s.state.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const isLiveDisconnected = liveSource?.status === 'AUTH_ERROR' || liveSource?.status === 'CONFIG_ERROR' || liveSource?.status === 'RATE_LIMITED';
  const isDemoActive = (replayStatus?.emitted_count ?? 0) > 0 || replayStatus?.is_running;

  // Source state badge color helper
  const getSourceBadge = (state?: string) => {
    switch (state) {
      case 'HEALTHY':
        return { bg: 'bg-emerald-950 text-emerald-300 border-emerald-800', dot: 'bg-emerald-400', label: 'SOURCE: HEALTHY' };
      case 'DEGRADED':
        return { bg: 'bg-amber-950 text-amber-300 border-amber-800', dot: 'bg-amber-400', label: 'SOURCE: DEGRADED' };
      case 'STALE':
        return { bg: 'bg-yellow-950 text-yellow-300 border-yellow-800', dot: 'bg-yellow-400', label: 'SOURCE: STALE FEED' };
      case 'DISCONNECTED':
        return { bg: 'bg-red-950 text-red-300 border-red-800', dot: 'bg-red-400', label: 'SOURCE: DISCONNECTED' };
      case 'RATE_LIMITED':
        return { bg: 'bg-orange-950 text-orange-300 border-orange-800', dot: 'bg-orange-400', label: 'SOURCE: RATE LIMITED (429)' };
      case 'AUTH_ERROR':
        return { bg: 'bg-red-950 text-red-300 border-red-800', dot: 'bg-red-400', label: 'SOURCE: AUTH ERROR (401/403)' };
      default:
        return { bg: 'bg-slate-800 text-slate-300 border-slate-700', dot: 'bg-slate-400', label: 'SOURCE: UNKNOWN' };
    }
  };

  const sourceBadge = getSourceBadge(liveSource?.source_state || liveSource?.status);

  const handleScenarioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sId = e.target.value;
    setSelectedScenarioId(sId);
    loadScenarioMutation.mutate(sId);
  };

  const columns: ColumnDef<StationItem>[] = [
    {
      key: 'station_id',
      header: 'Station ID',
      render: (stn) => (
        <div>
          <span className="font-mono font-semibold text-slate-100">{stn.station_id}</span>
          <span className="text-[10px] text-slate-400 block truncate">{stn.name}</span>
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
        <span className="text-ops-weather font-mono">
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
        <span className="text-ops-humidity font-mono">
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
        <span className="text-ops-pressure font-mono">
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
        const score = stn.latest_snapshot?.latest_health_score ?? 100;
        const color = score < 60 ? 'text-red-400' : score < 85 ? 'text-amber-400' : 'text-emerald-400';
        return <span className={`font-mono font-medium ${color}`}>{formatHealthScore(score)}/100</span>;
      },
      sortable: true,
    },
    {
      key: 'last_seen',
      header: 'Last Seen (UTC)',
      align: 'right',
      render: (stn) => (
        <span className="text-[11px] font-mono text-slate-400">
          {stn.latest_snapshot?.last_seen_timestamp
            ? formatIsoUtc(stn.latest_snapshot.last_seen_timestamp, true)
            : '--'}
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
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950 text-red-300 border border-red-800 font-bold">
            {count} FLAG
          </span>
        ) : (
          <span className="text-[11px] font-mono text-slate-500">0</span>
        );
      },
      sortable: true,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Live Fallback Warning Banner (If Live API is Unavailable) */}
      {isLiveDisconnected && (
        <div className="p-3 rounded bg-red-950/60 border border-red-800 flex flex-wrap items-center justify-between gap-3 text-red-200">
          <div className="flex items-center gap-2 text-xs">
            <AlertOctagon className="w-5 h-5 text-red-400 flex-shrink-0 animate-pulse" />
            <div>
              <strong className="font-mono text-red-300">LIVE SOURCE UNAVAILABLE</strong>
              <p className="text-slate-300 text-[11px]">
                Cannot connect to live weather telemetry upstream. Switch to deterministic Demo Replay Mode to execute standard evaluation narratives.
              </p>
            </div>
          </div>
          <button
            onClick={() => stepMutation.mutate(8)}
            disabled={stepMutation.isPending}
            className="px-3 py-1 bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 text-xs font-mono font-semibold rounded border border-indigo-700 transition-colors"
          >
            Switch to Demo Replay Mode
          </button>
        </div>
      )}

      {/* 1. Deterministic Demo & Replay Operations Controller */}
      <div className="p-3 rounded border border-indigo-900/60 bg-gradient-to-r from-surface-1 via-indigo-950/20 to-surface-1 flex flex-wrap items-center justify-between gap-3 text-data">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="font-mono font-bold text-slate-200 text-xs uppercase tracking-wider">
              Demo Controller:
            </span>
          </div>

          {/* Scenario Selector */}
          <div className="flex items-center gap-2">
            <select
              value={selectedScenarioId}
              onChange={handleScenarioChange}
              className="bg-surface-2 border border-border text-slate-200 text-xs font-mono rounded px-2.5 py-1 focus:outline-none focus:border-indigo-500"
            >
              {scenarios.map((sc: any, idx: number) => {
                const sId = sc.scenario_id || sc.id || `scenario-${idx}`;
                const sName = sc.scenario_name || sc.name || sId;
                return (
                  <option key={sId} value={sId}>
                    {sName}
                  </option>
                );
              })}
              {scenarios.length === 0 && (
                <option value="flagship_narrative">Flagship Multi-Fault Narrative</option>
              )}
            </select>
          </div>

          {/* Replay State Metrics */}
          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400 border-l border-border-subtle pl-3">
            <span>Progress: <strong className="text-indigo-300">{replayStatus?.current_index ?? 0}</strong> / {replayStatus?.total_queued_observations ?? 384}</span>
            <span className="text-slate-600">|</span>
            <span>Emitted: <strong className="text-slate-200">{replayStatus?.emitted_count ?? 0}</strong></span>
          </div>
        </div>

        {/* Demo Action Buttons */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            onClick={() => stepMutation.mutate(1)}
            disabled={stepMutation.isPending}
            className="px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-hover border border-border text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Step simulation forward by 1 station observation"
          >
            <Play className="w-3 h-3 text-indigo-400" />
            <span>Step 1 AWS</span>
          </button>

          <button
            onClick={() => stepMutation.mutate(8)}
            disabled={stepMutation.isPending}
            className="px-2.5 py-1 rounded bg-indigo-950 hover:bg-indigo-900 border border-indigo-700 text-indigo-200 flex items-center gap-1.5 transition-colors disabled:opacity-50 font-semibold"
            title="Step simulation forward by 1 network cycle (all 8 stations)"
          >
            <FastForward className="w-3.5 h-3.5 text-indigo-400" />
            <span>Step Cycle (8 AWS)</span>
          </button>

          <button
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="px-2.5 py-1 rounded bg-surface-2 hover:bg-red-950/40 border border-border hover:border-red-800 text-slate-300 hover:text-red-300 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Safely reset replay pointer to initial step without mutating production database"
          >
            <RotateCcw className="w-3 h-3 text-slate-400" />
            <span>Reset Demo</span>
          </button>
        </div>
      </div>

      {/* 2. Live Source & Upstream Ingestion Operations Bar */}
      <div className="p-3 rounded border border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3 text-data">
        <div className="flex flex-wrap items-center gap-4">
          {/* Upstream Source Badge */}
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-ops-weather" />
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1.5 font-bold ${sourceBadge.bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sourceBadge.dot}`} />
                {sourceBadge.label}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Provider: <strong className="text-slate-200 uppercase">{liveSource?.provider || 'Open-Meteo'}</strong>
              </span>
            </div>
          </div>

          {/* Station Freshness Layer Breakdown */}
          <div className="flex items-center gap-2 font-mono text-[11px] border-l border-border-subtle pl-4">
            <span className="text-slate-400 text-[10px] uppercase">Telemetry Ingestion:</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800">
              {liveSource?.counts?.live_stations ?? activeStations} LIVE
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800">
              {liveSource?.counts?.stale_stations ?? 0} STALE
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-950 text-red-300 border border-red-800">
              {liveSource?.counts?.offline_stations ?? (totalStations - activeStations)} OFFLINE
            </span>
          </div>

          {/* Latency & Last Update */}
          <div className="hidden lg:flex items-center gap-3 font-mono text-[11px] border-l border-border-subtle pl-4 text-slate-400">
            <div>API Latency: <strong className="text-slate-200">{formatLatency(liveSource?.metrics?.mean_request_latency_ms ?? liveSource?.last_request_latency_ms ?? 45.0)}</strong></div>
            <div>Last Ingestion: <span className="text-slate-300">{liveSource?.metrics?.last_poll_cycle_start ? formatIsoUtc(liveSource.metrics.last_poll_cycle_start, true) : 'Recent'}</span></div>
          </div>
        </div>

        {/* Manual Poll Trigger */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => pollMutation.mutate()}
            disabled={pollMutation.isPending}
            className="px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-hover border border-border text-[11px] font-mono text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Trigger on-demand live poll cycle"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pollMutation.isPending ? 'animate-spin text-ops-weather' : 'text-slate-400'}`} />
            <span>{pollMutation.isPending ? 'Polling...' : 'Poll Now'}</span>
          </button>
        </div>
      </div>

      {/* 3. Compact Network Operational Status Strip */}
      <div className="p-3 rounded border border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3 text-data">
        <div className="flex flex-wrap items-center gap-5">
          {/* Active Network Stations */}
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-ops-weather" />
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase block">Stations Online</span>
              <span className="text-h2 font-mono font-bold text-slate-100">
                {activeStations} <span className="text-slate-500 text-data font-normal">/ {totalStations}</span>
              </span>
            </div>
          </div>

          {/* Active Anomalies Alert Count */}
          <div className="flex items-center gap-2">
            <AlertTriangle className={`w-4 h-4 ${activeAnomalies.length > 0 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`} />
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase block">Active Anomalies</span>
              <span className={`text-h2 font-mono font-bold ${activeAnomalies.length > 0 ? 'text-red-400' : 'text-slate-100'}`}>
                {activeAnomalies.length}
              </span>
            </div>
          </div>

          {/* Critical / Warning Stations Breakdown */}
          <div className="flex items-center gap-3 font-mono text-[11px] border-l border-border-subtle pl-4">
            <div>
              <span className="text-slate-400 text-[10px] uppercase block">Sensor Degradation:</span>
              <span className="font-semibold text-amber-400">{warningCount} WARN</span>
              <span className="text-slate-500 mx-1">·</span>
              <span className="font-semibold text-red-400">{criticalCount} CRIT</span>
            </div>
          </div>

          {/* Network Sensor Health Index */}
          <div className="flex items-center gap-2 border-l border-border-subtle pl-4">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <div>
              <span className="text-[10px] font-mono text-slate-400 uppercase block">Sensor Health Index</span>
              <span className="text-h2 font-mono font-bold text-emerald-400">
                {meanHealth}/100
              </span>
            </div>
          </div>
        </div>

        {/* Pipeline Latency & Refresh Cadence */}
        <div className="text-right text-[11px] font-mono text-slate-400 hidden md:block">
          <div>Pipeline Latency: <strong className="text-slate-300">{formatLatency(systemHealth?.mean_pipeline_latency_ms ?? 5.8)}</strong></div>
          <div>Operating Mode: <span className="text-indigo-400">{isDemoActive ? 'Demo Replay' : 'Live Mode'}</span></div>
        </div>
      </div>

      {/* 4. Middle Row: Spatial Map + Active Alert Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 font-semibold text-slate-100 flex items-center gap-2">
              Automatic Weather Station Topology
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              Interactive Leaflet GIS Layer
            </span>
          </div>
          <NetworkMap
            stations={stations}
            height="380px"
            onSelectStation={(id) => navigate(`/stations/${id}`)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 font-semibold text-slate-100">
              Active Anomaly Stream
            </h2>
            <button
              onClick={() => navigate('/anomalies')}
              className="text-[11px] font-mono text-ops-weather hover:underline"
            >
              View all &rarr;
            </button>
          </div>
          <AlertList anomalies={activeAnomalies} isLoading={isLoadingAnomalies} limit={5} />
        </div>
      </div>

      {/* 5. Bottom Row: High-Density Station Telemetry Matrix */}
      <div className="space-y-2 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h2 font-semibold text-slate-100">
            Network Telemetry Matrix
          </h2>
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search station ID or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-surface-2 border border-border rounded text-data font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-ops-weather"
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
