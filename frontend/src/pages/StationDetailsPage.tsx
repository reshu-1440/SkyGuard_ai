import React, { useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStation, useStationHistory, useStationHealth, useStations } from '../hooks/useStations';
import { useAnomalies } from '../hooks/useAnomalies';
import { WeatherTrendChart, TimeSeriesPoint } from '../components/WeatherTrendChart';
import { StationStatus } from '../components/StationStatus';
import { HealthScore } from '../components/HealthScore';
import { HealthTrend } from '../components/HealthTrend';
import { AlertList } from '../components/AlertList';
import { LoadingSkeleton, ErrorState } from '../components/StateFeedback';
import { formatCoordinates, formatDistance, formatIsoUtc } from '../utils/formatters';
import { MapPin, ArrowLeft, Clock, Layers } from 'lucide-react';

export const StationDetailsPage: React.FC = () => {
  const { stationId: rawStationId } = useParams<{ stationId?: string }>();
  const navigate = useNavigate();
  const { data: allStations = [], isLoading: isLoadingAll } = useStations();

  // If no stationId in param, default to first station from loaded list
  const activeStationId = rawStationId || (allStations.length > 0 ? allStations[0].station_id : '');

  useEffect(() => {
    if (!rawStationId && allStations.length > 0) {
      navigate(`/stations/${allStations[0].station_id}`, { replace: true });
    }
  }, [rawStationId, allStations, navigate]);

  const { data: station, isLoading: isLoadingStation, isError } = useStation(activeStationId);
  const { data: historyData } = useStationHistory(activeStationId, { limit: 150, order: 'desc' });
  const { data: healthData } = useStationHealth(activeStationId);
  const { data: anomaliesData } = useAnomalies({ stationId: activeStationId, limit: 5 });

  // Map history to 3 time-series datasets sorted chronologically
  const { tempData, humData, presData } = useMemo(() => {
    const temp: TimeSeriesPoint[] = [];
    const hum: TimeSeriesPoint[] = [];
    const pres: TimeSeriesPoint[] = [];

    if (historyData?.items && historyData.items.length > 0) {
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

  // Compute nearest neighbor stations geometrically
  const nearestNeighbors = useMemo(() => {
    if (!station) return [];
    return allStations
      .filter((s) => s.station_id !== activeStationId)
      .map((s) => {
        const dLat = (s.latitude - station.latitude) * 111;
        const dLon =
          (s.longitude - station.longitude) *
          111 *
          Math.cos((station.latitude * Math.PI) / 180);
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        return { ...s, distanceKm: dist };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 4);
  }, [station, allStations, activeStationId]);

  if (isLoadingAll || (activeStationId && isLoadingStation)) {
    return <LoadingSkeleton rows={8} height="h-16" />;
  }

  if (isError || (!station && activeStationId)) {
    return (
      <ErrorState
        title={`Station ${activeStationId} Not Found`}
        message="Could not load station metadata or telemetry from backend repository."
        onRetry={() => navigate('/network')}
      />
    );
  }

  if (!station) {
    return (
      <div className="p-8 text-center text-data font-mono text-slate-400">
        No Automatic Weather Station selected.
      </div>
    );
  }

  const latest = station.latest_snapshot;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="p-3 border border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3" style={{ borderRadius: '2px' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/network')}
            className="p-1.5 hover:bg-surface-2 text-slate-400 hover:text-slate-100 transition-colors"
            style={{ borderRadius: '2px' }}
            title="Back to Network Overview"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-h1 font-bold font-mono text-slate-100">{station.station_id}</h1>
              <span className="text-data text-slate-400 font-medium">({station.name})</span>
              <StationStatus status={latest?.status || station.status} />
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 mt-0.5 flex-wrap">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 text-ops-weather" />
                {formatCoordinates(station.latitude, station.longitude)} ({Math.round(station.elevation_m)}m)
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                Interval: {station.sampling_interval_seconds}s
              </span>
              {latest?.last_seen_timestamp && (
                <span>Last Updated: {formatIsoUtc(latest.last_seen_timestamp)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Station switcher quick dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">Switch Station:</span>
          <select
            value={station.station_id}
            onChange={(e) => navigate(`/stations/${e.target.value}`)}
            className="bg-surface-2 border border-border text-slate-200 px-2.5 py-1 text-data font-mono focus:outline-none"
            style={{ borderRadius: '2px' }}
          >
            {allStations.map((s) => (
              <option key={s.station_id} value={s.station_id}>
                {s.station_id} — {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 65/35 Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column (65% / 8 cols): 3 Synchronized Recharts */}
        <div className="lg:col-span-8 space-y-3">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
            <span>Chronological Telemetry Stream ({historyData?.pagination.total_count ?? 0} observations)</span>
            <span className="text-ops-weather">Cursors synchronized (syncId)</span>
          </div>

          <WeatherTrendChart
            title="Atmospheric Temperature"
            unit="°C"
            data={tempData}
            color="#38BDF8"
            syncId="station-sync"
            height={190}
            emptyMessage={`No temperature observations received for ${station.station_id}.`}
          />

          <WeatherTrendChart
            title="Relative Humidity"
            unit="%"
            data={humData}
            color="#34D399"
            syncId="station-sync"
            height={190}
            emptyMessage={`No humidity observations received for ${station.station_id}.`}
          />

          <WeatherTrendChart
            title="Barometric Pressure"
            unit="hPa"
            data={presData}
            color="#818CF8"
            syncId="station-sync"
            height={190}
            emptyMessage={`No pressure observations received for ${station.station_id}.`}
          />
        </div>

        {/* Right Column (35% / 4 cols): Health, Neighbors, Metadata, Recent Anomalies */}
        <div className="lg:col-span-4 space-y-4">
          {/* Health Summary */}
          <HealthScore
            score={healthData?.overall_health_score ?? latest?.latest_health_score ?? null}
            band={healthData?.status_band ?? latest?.latest_health_band ?? ((healthData?.overall_health_score === null || healthData?.overall_health_score === undefined) && (latest?.latest_health_score ?? null) === null ? 'INSUFFICIENT_HISTORY' : 'HEALTHY')}
            trend={healthData?.trend ?? 'STABLE'}
            showDisclaimer={true}
          />

          {healthData && (
            <HealthTrend
              components={healthData.component_scores}
              parameterHealth={healthData.parameter_health}
              isInsufficientHistory={healthData.status_band === 'INSUFFICIENT_HISTORY' || (healthData.overall_health_score === null && (latest?.latest_health_score ?? null) === null)}
            />
          )}

          {/* Spatial Neighbors */}
          <div className="p-4 border border-border bg-surface-1" style={{ borderRadius: '2px' }}>
            <h3 className="text-h2 font-semibold text-slate-100 flex items-center gap-1.5 mb-2.5">
              <Layers className="w-4 h-4 text-ops-weather" />
              Nearest Topographic Neighbors
            </h3>
            <div className="space-y-1.5">
              {nearestNeighbors.map((nb) => (
                <div
                  key={nb.station_id}
                  onClick={() => navigate(`/stations/${nb.station_id}`)}
                  className="flex items-center justify-between p-2 bg-surface-2 hover:bg-surface-hover cursor-pointer border border-border-subtle text-[11px] font-mono transition-colors"
                  style={{ borderRadius: '2px' }}
                >
                  <div>
                    <strong className="text-slate-100">{nb.station_id}</strong>
                    <span className="text-slate-400 ml-1.5">({nb.name})</span>
                  </div>
                  <span className="text-ops-weather font-medium">{formatDistance(nb.distanceKm)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Anomalies Feed */}
          <div className="space-y-2">
            <h3 className="text-h2 font-semibold text-slate-100">
              Station Anomaly History
            </h3>
            <AlertList anomalies={anomaliesData?.items || []} limit={3} />
          </div>
        </div>
      </div>
    </div>
  );
};
