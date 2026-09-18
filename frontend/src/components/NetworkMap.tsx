import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { StationItem } from '../types/api';
import { useNavigate } from 'react-router-dom';
import { formatTemperature, formatHumidity, formatHealthScore } from '../utils/formatters';

export interface NeighborLink {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  neighborId: string;
  isConsistent?: boolean;
}

interface NetworkMapProps {
  stations: StationItem[];
  selectedStationId?: string;
  onSelectStation?: (stationId: string) => void;
  height?: string;
  neighborLinks?: NeighborLink[];
  showLegend?: boolean;
}

/**
 * Automatically fits map view bounds to encompass all active stations on load
 */
function MapBoundsController({
  stations,
  selectedStationId,
}: {
  stations: StationItem[];
  selectedStationId?: string;
}) {
  const map = useMap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!stations.length) return;

    if (selectedStationId) {
      const selected = stations.find((s) => s.station_id === selectedStationId);
      if (selected) {
        map.setView([selected.latitude, selected.longitude], 8, { animate: true });
        return;
      }
    }

    if (!hasInitialized.current && stations.length > 0) {
      const bounds = L.latLngBounds(stations.map((s) => [s.latitude, s.longitude]));
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 8 });
      hasInitialized.current = true;
    }
  }, [stations, selectedStationId, map]);

  return null;
}

/**
 * Creates custom circular Leaflet divIcon with severity-based semantics and sizing
 */
function createSeverityStationIcon(station: StationItem, isSelected: boolean) {
  const status = station.latest_snapshot?.status || station.status;
  const decision = station.latest_snapshot?.latest_decision || 'NORMAL';
  const score = station.latest_snapshot?.latest_health_score ?? 100;
  const anomCount = station.latest_snapshot?.active_anomaly_count_24h ?? 0;

  let color = '#10B981'; // Green (NORMAL)
  let size = 10;
  let pulseBorder = 'rgba(16, 185, 129, 0.4)';

  if (status === 'OFFLINE' || status === 'DECOMMISSIONED') {
    color = '#64748B'; // Muted Slate (OFFLINE)
    size = 10;
    pulseBorder = 'transparent';
  } else if (decision === 'PROBABLE_SENSOR_ANOMALY' || anomCount > 0 || score < 50) {
    color = '#EF4444'; // Red (CRITICAL)
    size = 18;
    pulseBorder = 'rgba(239, 68, 68, 0.6)';
  } else if (
    decision === 'POSSIBLE_GENUINE_EVENT' ||
    decision === 'PROBABLE_DATA_QUALITY_ISSUE' ||
    score < 80
  ) {
    color = '#F59E0B'; // Amber (WARNING/HIGH)
    size = 14;
    pulseBorder = 'rgba(245, 158, 11, 0.5)';
  }

  const activeSize = isSelected ? size + 4 : size;
  const border = isSelected ? '3px solid #38BDF8' : '1.5px solid #FFFFFF';
  const boxShadow = isSelected
    ? `0 0 12px #38BDF8, 0 0 6px ${color}`
    : `0 0 8px ${pulseBorder}`;

  return L.divIcon({
    className: 'custom-station-pin',
    html: `<div style="
      background-color: ${color};
      width: ${activeSize}px;
      height: ${activeSize}px;
      border-radius: 50%;
      border: ${border};
      box-shadow: ${boxShadow};
      cursor: pointer;
      transition: all 0.2s ease-in-out;
    "></div>`,
    iconSize: [activeSize, activeSize],
    iconAnchor: [activeSize / 2, activeSize / 2],
  });
}

export const NetworkMap: React.FC<NetworkMapProps> = ({
  stations = [],
  selectedStationId,
  onSelectStation,
  height = '400px',
  neighborLinks = [],
  showLegend = true,
}) => {
  const navigate = useNavigate();

  const defaultCenter: [number, number] =
    stations.length > 0
      ? [stations[0].latitude, stations[0].longitude]
      : [23.5937, 78.9629]; // Center of India network

  return (
    <div className="w-full rounded border border-border overflow-hidden relative bg-surface-1 isolate z-0" style={{ height }}>
      <MapContainer
        center={defaultCenter}
        zoom={5}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapBoundsController stations={stations} selectedStationId={selectedStationId} />

        {/* Spatial Neighbor Context Connection Lines (Rendered when in investigation/context mode) */}
        {neighborLinks.map((link, idx) => (
          <Polyline
            key={idx}
            positions={[
              [link.fromLat, link.fromLon],
              [link.toLat, link.toLon],
            ]}
            pathOptions={{
              color: link.isConsistent ? '#10B981' : '#EF4444',
              weight: 2,
              dashArray: link.isConsistent ? '4 4' : '2 2',
              opacity: 0.7,
            }}
          />
        ))}

        {/* Station Markers */}
        {stations.map((stn) => {
          const isSelected = stn.station_id === selectedStationId;
          const status = stn.latest_snapshot?.status || stn.status;
          const icon = createSeverityStationIcon(stn, isSelected);

          return (
            <Marker
              key={stn.station_id}
              position={[stn.latitude, stn.longitude]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  if (onSelectStation) {
                    onSelectStation(stn.station_id);
                  }
                },
              }}
            >
              <Popup>
                <div className="text-left font-sans text-xs min-w-[200px] p-1">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-1 mb-2">
                    <strong className="font-mono text-slate-100 font-semibold">{stn.name}</strong>
                    <span className="text-[10px] font-mono text-slate-400">[{stn.station_id}]</span>
                  </div>

                  <div className="space-y-1 font-mono text-[11px] text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Status:</span>
                      <span className="font-semibold text-slate-200">{status}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">Temp:</span>
                      <span className="font-semibold text-ops-weather">
                        {formatTemperature(stn.latest_snapshot?.latest_temperature_c, 1, true)}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">Humidity:</span>
                      <span className="font-semibold text-ops-humidity">
                        {formatHumidity(stn.latest_snapshot?.latest_humidity_pct, 1, true)}
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">Health Score:</span>
                      <span className="font-semibold text-emerald-400">
                        {formatHealthScore(stn.latest_snapshot?.latest_health_score)}/100
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => navigate(`/stations/${stn.station_id}`)}
                    className="w-full mt-2.5 py-1 px-2 rounded bg-surface-2 hover:bg-surface-hover text-ops-weather border border-border-subtle text-[11px] font-mono text-center font-medium transition-colors"
                  >
                    View Station Details &rarr;
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Map Legend Overlay */}
      {showLegend && (
        <div className="absolute bottom-2 left-2 z-[1000] bg-surface-1/90 border border-border-subtle p-2 rounded text-[10px] font-mono space-y-1 shadow-md backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full bg-red-500 border border-white" />
            <span className="text-slate-300">Critical / Anomaly</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-amber-500 border border-white" />
            <span className="text-slate-300">Warning / Degraded</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white" />
            <span className="text-slate-300">Normal / Healthy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-500 border border-white" />
            <span className="text-slate-300">Offline</span>
          </div>
        </div>
      )}
    </div>
  );
};
