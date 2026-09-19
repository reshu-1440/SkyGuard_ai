import React, { useState, useEffect, useMemo } from 'react';
import { useStations, useStationHistory } from '../hooks/useStations';
import { useAnomalies } from '../hooks/useAnomalies';
import { WeatherTrendChart, TimeSeriesPoint } from '../components/WeatherTrendChart';
import { MetricTable, ColumnDef } from '../components/MetricTable';
import { AnomalyEventRecord } from '../types/api';
import { SeverityBadge } from '../components/SeverityBadge';
import { formatIsoUtc } from '../utils/formatters';
import { History, Calendar, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const HistoricalAnalysisPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: stations = [] } = useStations();
  const [selectedStationId, setSelectedStationId] = useState<string>('');
  const [timeRange, setTimeRange] = useState<string>('24h');
  const [limit, setLimit] = useState<number>(300);

  // Set default station when stations load if none selected
  useEffect(() => {
    if (!selectedStationId && stations.length > 0) {
      setSelectedStationId(stations[0].station_id);
    }
  }, [stations, selectedStationId]);

  const { data: historyData } = useStationHistory(selectedStationId, { limit, historical: true });
  const { data: anomaliesData, isLoading: isLoadingAnomalies } = useAnomalies({
    stationId: selectedStationId,
    limit: 50,
    historical: true,
  });

  const { tempData, humData, presData } = useMemo(() => {
    const temp: TimeSeriesPoint[] = [];
    const hum: TimeSeriesPoint[] = [];
    const pres: TimeSeriesPoint[] = [];

    if (historyData?.items && historyData.items.length > 0) {
      // Sort chronologically ascending for line charts
      const sorted = [...historyData.items].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      sorted.forEach((obs) => {
        temp.push({
          timestamp: obs.timestamp,
          raw: obs.temperature,
          imputed: null,
        });
        hum.push({
          timestamp: obs.timestamp,
          raw: obs.humidity,
          imputed: null,
        });
        pres.push({
          timestamp: obs.timestamp,
          raw: obs.pressure,
          imputed: null,
        });
      });
    }

    return { tempData: temp, humData: hum, presData: pres };
  }, [historyData]);

  const anomalyColumns: ColumnDef<AnomalyEventRecord>[] = [
    {
      key: 'event_id',
      header: 'Event ID',
      render: (ev) => (
        <span className="font-mono font-semibold text-slate-100">{ev.event_id}</span>
      ),
      sortable: true,
    },
    {
      key: 'timestamp',
      header: 'Timestamp (UTC)',
      render: (ev) => (
        <span className="font-mono text-slate-300">
          {formatIsoUtc(ev.timestamp)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'decision',
      header: 'Decision',
      render: (ev) => <span className="font-mono text-ops-weather font-semibold">{ev.decision}</span>,
      sortable: true,
    },
    {
      key: 'severity',
      header: 'Severity',
      align: 'center',
      render: (ev) => <SeverityBadge severity={ev.severity} />,
      sortable: true,
    },
    {
      key: 'explanation_summary',
      header: 'Summary',
      render: (ev) => (
        <span className="text-data text-slate-300 line-clamp-1 max-w-md">
          {ev.explanation_summary}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (ev) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/anomalies/${ev.event_id}`);
          }}
          className="text-[11px] font-mono text-ops-weather hover:underline"
        >
          Investigate &rarr;
        </button>
      ),
    },
  ];

  const currentStation = stations.find((s) => s.station_id === selectedStationId);

  return (
    <div className="space-y-4">
      {/* Retrospective Historical Mode Distinction Banner */}
      <div
        className="px-3 py-2 flex items-center justify-between font-mono text-[11px]"
        style={{
          background: 'rgba(51, 65, 85, 0.4)',
          border: '1px solid #334155',
          borderLeft: '4px solid #64748B',
          borderRadius: '2px',
        }}
      >
        <div className="flex items-center gap-2 text-slate-300">
          <Database className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-semibold uppercase text-slate-200">HISTORICAL ANALYSIS · RETROSPECTIVE ARCHIVE</span>
          <span className="text-slate-500 hidden md:inline">|</span>
          <span className="text-slate-400 hidden md:inline">
            Static historical dataset window for offline model evaluation and retrospective analysis. Distinct from live operational replay.
          </span>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 uppercase">
          FULL ARCHIVE VIEW
        </span>
      </div>

      {/* Header & Filter Controls */}
      <div className="p-3 border border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3" style={{ borderRadius: '2px' }}>
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-ops-weather" />
          <div>
            <h1 className="text-h1 font-bold font-mono text-slate-100">
              Historical Telemetry & Anomaly Analysis
            </h1>
            <span className="text-[11px] font-mono text-slate-400">
              High-resolution time-series drilldown and historical anomaly correlations
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-data">
            <span className="text-[11px] font-mono text-slate-400">Station:</span>
            <select
              value={selectedStationId}
              onChange={(e) => setSelectedStationId(e.target.value)}
              className="bg-surface-2 border border-border text-slate-200 px-2.5 py-1 text-data font-mono focus:outline-none"
              style={{ borderRadius: '2px' }}
            >
              {stations.map((s) => (
                <option key={s.station_id} value={s.station_id}>
                  {s.station_id} — {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-data">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={timeRange}
              onChange={(e) => {
                setTimeRange(e.target.value);
                setLimit(e.target.value === '24h' ? 200 : e.target.value === '7d' ? 500 : 1000);
              }}
              className="bg-surface-2 border border-border text-slate-200 px-2.5 py-1 text-data font-mono focus:outline-none"
              style={{ borderRadius: '2px' }}
            >
              <option value="24h">Window: Last 24 Hours</option>
              <option value="7d">Window: Last 7 Days</option>
              <option value="30d">Window: Last 30 Days</option>
            </select>
          </div>
        </div>
      </div>

      {/* Synchronized Charts: Full-Width Primary + 2 Secondary */}
      <div className="space-y-3">
        <WeatherTrendChart
          title={`${selectedStationId || 'Station'} (${currentStation?.name || 'AWS'}) — Temperature Sequence`}
          unit="°C"
          data={tempData}
          color="#38BDF8"
          syncId="history-sync"
          height={240}
          emptyMessage={`No temperature records received for ${selectedStationId || 'the station'} in the selected ${timeRange} window.`}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <WeatherTrendChart
            title="Relative Humidity Sequence"
            unit="%"
            data={humData}
            color="#34D399"
            syncId="history-sync"
            height={180}
            emptyMessage={`No humidity records received for ${selectedStationId || 'the station'} in the selected ${timeRange} window.`}
          />

          <WeatherTrendChart
            title="Barometric Pressure Sequence"
            unit="hPa"
            data={presData}
            color="#818CF8"
            syncId="history-sync"
            height={180}
            emptyMessage={`No pressure records received for ${selectedStationId || 'the station'} in the selected ${timeRange} window.`}
          />
        </div>
      </div>

      {/* Historical Anomaly Events Table */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <h2 className="text-h2 font-semibold text-slate-100">
            Detected Anomaly Events in Selected Time Window ({anomaliesData?.pagination.total_count ?? 0})
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            Click row to drill into root cause and explanation
          </span>
        </div>

        <MetricTable
          columns={anomalyColumns}
          data={anomaliesData?.items || []}
          isLoading={isLoadingAnomalies}
          rowIdKey="event_id"
          onRowClick={(row) => navigate(`/anomalies/${row.event_id}`)}
          emptyMessage={`No anomaly events flagged for station ${selectedStationId || ''} in the selected time window.`}
        />
      </div>
    </div>
  );
};
