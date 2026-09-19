import React, { useState, useEffect, useMemo } from 'react';
import { useStations, useStationHistory } from '../hooks/useStations';
import { useRunContext } from '../hooks/useRunContext';
import { useRealtimeStream } from '../hooks/useRealtimeStream';
import { MetricTable, ColumnDef } from '../components/MetricTable';
import { StationStatus } from '../components/StationStatus';
import { WeatherTrendChart, TimeSeriesPoint } from '../components/WeatherTrendChart';
import { StationItem } from '../types/api';
import { formatTemperature, formatHumidity, formatPressure, formatHealthScore, formatAge, formatIsoUtc } from '../utils/formatters';
import { Search, Filter, Radio, Clock, PlayCircle, FileSpreadsheet, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const LiveMonitoringPage: React.FC = () => {
  const navigate = useNavigate();
  const { context } = useRunContext();
  const streamState = useRealtimeStream();
  const { data: stations = [], isLoading } = useStations();

  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [healthFilter, setHealthFilter] = useState<string>('ALL');
  const [selectedStationId, setSelectedStationId] = useState<string>('');

  // Default selection to first station or first flagged station
  useEffect(() => {
    if (!selectedStationId && stations.length > 0) {
      const flagged = stations.find(
        (s) =>
          (s.latest_snapshot?.active_anomaly_count_24h ?? 0) > 0 ||
          (s.latest_snapshot?.latest_health_score ?? 100) < 85
      );
      setSelectedStationId(flagged ? flagged.station_id : stations[0].station_id);
    }
  }, [stations, selectedStationId]);

  // Fetch telemetry for sparkline strip for selected station (rolling operational window: latest 60 observations)
  const { data: historyData } = useStationHistory(selectedStationId, { limit: 60, order: 'desc' });

  const sparklineData: TimeSeriesPoint[] = useMemo(() => {
    if (!historyData?.items || historyData.items.length === 0) return [];
    const sorted = [...historyData.items].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return sorted.map((obs) => ({
      timestamp: obs.timestamp,
      raw: obs.temperature,
      imputed: null,
    }));
  }, [historyData]);

  // Filtering
  const filtered = useMemo(() => {
    return stations.filter((s) => {
      const matchSearch =
        s.station_id.toLowerCase().includes(search.toLowerCase()) ||
        s.name.toLowerCase().includes(search.toLowerCase());
      const st = s.latest_snapshot?.status || s.status;
      const matchStatus = statusFilter === 'ALL' || st === statusFilter;
      const score = s.latest_snapshot?.latest_health_score ?? 100;
      let matchHealth = true;
      if (healthFilter === 'DEGRADED') matchHealth = score < 85 && score >= 60;
      if (healthFilter === 'CRITICAL') matchHealth = score < 60;
      if (healthFilter === 'HEALTHY') matchHealth = score >= 85;

      return matchSearch && matchStatus && matchHealth;
    });
  }, [stations, search, statusFilter, healthFilter]);

  const activeStation = stations.find((s) => s.station_id === selectedStationId);

  const columns: ColumnDef<StationItem>[] = [
    {
      key: 'station_id',
      header: 'Station Code',
      render: (stn) => (
        <div>
          <span className="font-mono font-bold text-slate-100">{stn.station_id}</span>
          <span className="text-[10px] text-slate-400 block">{stn.name}</span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'status',
      header: 'Operational Status',
      render: (stn) => <StationStatus status={stn.latest_snapshot?.status || stn.status} />,
      sortable: true,
    },
    {
      key: 'temperature',
      header: 'Temperature',
      align: 'right',
      render: (stn) => (
        <span className="font-mono text-ops-weather font-medium">
          {formatTemperature(stn.latest_snapshot?.latest_temperature_c, 1, true)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'humidity',
      header: 'Relative Humidity',
      align: 'right',
      render: (stn) => (
        <span className="font-mono text-ops-humidity font-medium">
          {formatHumidity(stn.latest_snapshot?.latest_humidity_pct, 1, true)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'pressure',
      header: 'Sea-Level Pressure',
      align: 'right',
      render: (stn) => (
        <span className="font-mono text-ops-pressure font-medium">
          {formatPressure(stn.latest_snapshot?.latest_pressure_hpa, 1, true)}
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
      key: 'anomalies_24h',
      header: '24h Flags',
      align: 'center',
      render: (stn) => {
        const c = stn.latest_snapshot?.active_anomaly_count_24h ?? 0;
        return c > 0 ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-950 text-red-300 border border-red-800">
            {c} FLAG
          </span>
        ) : (
          <span className="text-[11px] font-mono text-slate-500">0</span>
        );
      },
      sortable: true,
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (stn) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/stations/${stn.station_id}`);
          }}
          className="text-[11px] font-mono text-ops-weather hover:underline"
        >
          Details &rarr;
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header & Filter Controls with Polling Indicator */}
      <div className="p-3 flex flex-wrap items-center justify-between gap-3"
        style={{ background: '#0D1420', border: '1px solid #1F2D45', borderRadius: '2px' }}>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filter station ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 font-mono text-[12px] border"
              style={{ background: '#131C2E', borderColor: '#1F2D45', color: '#E8EEF7', borderRadius: '2px' }}
            />
          </div>

          <div className="flex items-center gap-1.5 text-data">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 font-mono text-[11px] border"
              style={{ background: '#131C2E', borderColor: '#1F2D45', color: '#94A3B8', borderRadius: '2px' }}
            >
              <option value="ALL">Status: ALL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DEGRADED">DEGRADED</option>
              <option value="MAINTENANCE">MAINTENANCE</option>
              <option value="OFFLINE">OFFLINE</option>
            </select>

            <select
              value={healthFilter}
              onChange={(e) => setHealthFilter(e.target.value)}
              className="bg-surface-2 border border-border text-slate-300 rounded px-2 py-1 text-data font-mono focus:outline-none"
            >
              <option value="ALL">Health: ALL</option>
              <option value="HEALTHY">HEALTHY (85+)</option>
              <option value="DEGRADED">DEGRADED (60-84)</option>
              <option value="CRITICAL">CRITICAL (&lt;60)</option>
            </select>
          </div>
        </div>

        {/* Dynamic Stream / Mode Cadence Badge */}
        <div className="flex items-center gap-3">
          {context?.mode === 'SYNTHETIC_REPLAY' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-950/60 border border-indigo-700/60 text-[11px] font-mono text-indigo-300">
              <PlayCircle className={`w-3.5 h-3.5 text-indigo-400 ${context?.status === 'RUNNING' ? 'animate-spin' : ''}`} />
              <span>SYNTHETIC REPLAY · {context?.status === 'RUNNING' ? 'STREAMING' : context?.status || 'IDLE'} ({streamState.transportMode})</span>
            </div>
          ) : context?.mode === 'HISTORICAL_REPLAY' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-950/60 border border-blue-700/60 text-[11px] font-mono text-blue-300">
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-400" />
              <span>HISTORICAL REPLAY · {context?.status === 'RUNNING' ? 'STREAMING' : context?.status || 'IDLE'} ({streamState.transportMode})</span>
            </div>
          ) : context?.mode === 'HISTORICAL_ANALYSIS' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono text-slate-300">
              <Database className="w-3.5 h-3.5 text-slate-400" />
              <span>HISTORICAL ANALYSIS · STATIC</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 border border-border text-[11px] font-mono text-emerald-400">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>LIVE STREAM · {streamState.transportMode}</span>
            </div>
          )}
          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
            Showing <strong className="text-slate-200">{filtered.length}</strong> of {stations.length}
          </span>
        </div>
      </div>

      {/* Operational Telemetry Stream Metrics Bar */}
      <div
        className="p-3 grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-[11px]"
        style={{ background: '#0D1420', border: '1px solid #1F2D45', borderRadius: '2px' }}
      >
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Current Replay Time</span>
          <span className="text-ops-weather font-bold truncate block">
            {context?.current_synthetic_time ? formatIsoUtc(context.current_synthetic_time) : (context?.mode === 'LIVE_MONITORING' ? 'LIVE CADENCE' : 'WAITING FOR STREAM')}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Processed</span>
          <span className="text-slate-100 font-bold">
            {(context?.current_observation_index ?? 0).toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Total</span>
          <span className="text-slate-400 font-medium">
            {(context?.observation_count ?? 5760).toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Latest Observation</span>
          <span className="text-slate-200 font-medium truncate block">
            {context?.current_synthetic_time
              ? formatIsoUtc(context.current_synthetic_time, false)
              : (streamState.lastObservationTimestamp ? formatIsoUtc(streamState.lastObservationTimestamp.toISOString(), false) : '--')}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase">Age</span>
          <span className="text-emerald-400 font-bold">
            {context?.status === 'RUNNING' ? formatAge(streamState.secondsSinceLastUpdate) : (context?.status || 'IDLE')}
          </span>
        </div>
      </div>

      {/* Approved Compact Sparkline Strip for Flagged / Selected Station */}
      {selectedStationId ? (
        <div className="p-3"
          style={{ background: '#0D1420', border: '1px solid #1F2D45', borderRadius: '2px' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-300 font-semibold uppercase">
                Station Micro-Trend (3-Hour Cadence):
              </span>
              <span className="text-[11px] font-mono font-bold text-ops-weather">
                {selectedStationId} {activeStation?.name ? `(${activeStation.name})` : ''}
              </span>
            </div>
            <button
              onClick={() => navigate(`/stations/${selectedStationId}`)}
              className="text-[11px] font-mono text-ops-weather hover:underline flex items-center gap-1"
            >
              Full Profile &rarr;
            </button>
          </div>

          <WeatherTrendChart
            title={`${selectedStationId} Telemetry Sequence`}
            unit="°C"
            data={sparklineData}
            height={130}
            emptyMessage={`No recent telemetry recorded for ${selectedStationId}.`}
          />
        </div>
      ) : (
        <div className="p-4 text-center font-mono text-[12px]"
          style={{ background: '#0D1420', border: '1px solid #1F2D45', borderRadius: '2px', color: '#4A5B78' }}>
          <Clock className="w-4 h-4 mx-auto mb-1 text-slate-500" />
          Select a station in the telemetry matrix below to view live sparklines.
        </div>
      )}

      {/* Main Sortable Station Telemetry Table */}
      <MetricTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        selectedRowId={selectedStationId}
        rowIdKey="station_id"
        onRowClick={(row) => setSelectedStationId(row.station_id)}
        emptyMessage="No Automatic Weather Stations matched the operational filter."
      />
    </div>
  );
};
