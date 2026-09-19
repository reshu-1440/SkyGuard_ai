import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import { formatIsoUtc } from '../utils/formatters';
import {
  AnomalyMarkerInfo,
  MeteorologicalParameter,
  getAnomalyColor,
} from '../utils/anomalyMarkers';

export interface TimeSeriesPoint {
  timestamp: string; // ISO or formatted
  raw?: number | null;
  imputed?: number | null;
  neighbor?: number | null;
  isAnomaly?: boolean;
  anomaly?: AnomalyMarkerInfo | null;
}

interface WeatherTrendChartProps {
  title: string;
  unit: string;
  data: TimeSeriesPoint[];
  color?: string;
  syncId?: string;
  height?: number;
  anomalyWindow?: [string, string];
  emptyMessage?: string;
  parameter?: MeteorologicalParameter;
  onAnomalyClick?: (eventId: string) => void;
}

export const WeatherTrendChart: React.FC<WeatherTrendChartProps> = ({
  title,
  unit,
  data = [],
  color = '#38BDF8',
  syncId,
  height = 180,
  anomalyWindow,
  emptyMessage = 'No observations available for the selected station/time range.',
  parameter,
  onAnomalyClick,
}) => {
  const navigate = useNavigate();
  const hasData = data && data.length > 0 && data.some((d) => d.raw !== null && d.raw !== undefined);

  // Render high-visibility restrained semantic anomaly markers or minimal normal dots
  const renderCustomDot = (dotProps: any) => {
    const { cx, cy, payload } = dotProps;
    if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) {
      return <g key={`empty-dot-${Math.random()}`} />;
    }

    if (payload?.anomaly) {
      const markerColor = getAnomalyColor(payload.anomaly.decision);
      return (
        <g
          key={`anom-dot-${payload.timestamp}`}
          className="cursor-pointer"
          onClick={() => {
            if (onAnomalyClick) {
              onAnomalyClick(payload.anomaly.eventId);
            } else {
              navigate(`/anomalies/${payload.anomaly.eventId}`);
            }
          }}
        >
          {/* Subtle pulsating halo */}
          <circle
            cx={cx}
            cy={cy}
            r={7}
            fill={markerColor}
            fillOpacity={0.25}
            stroke={markerColor}
            strokeWidth={1}
            className="animate-pulse"
          />
          {/* Primary exact anomaly observation point */}
          <circle
            cx={cx}
            cy={cy}
            r={4.5}
            fill={markerColor}
            stroke="#0B0F17"
            strokeWidth={1.5}
          />
        </g>
      );
    }

    // Normal telemetry observation point
    return (
      <circle
        key={`dot-${payload?.timestamp ?? Math.random()}`}
        cx={cx}
        cy={cy}
        r={2}
        fill={color}
        stroke="#0B0F17"
        strokeWidth={1}
      />
    );
  };

  // Render active hovered dot with prominent indicator
  const renderActiveDot = (dotProps: any) => {
    const { cx, cy, payload } = dotProps;
    if (cx === undefined || cy === undefined || isNaN(cx) || isNaN(cy)) {
      return <g key={`empty-activedot-${Math.random()}`} />;
    }

    const isAnom = Boolean(payload?.anomaly);
    const dotFill = isAnom ? getAnomalyColor(payload.anomaly.decision) : color;

    return (
      <g key={`active-dot-${payload?.timestamp ?? Math.random()}`}>
        <circle
          cx={cx}
          cy={cy}
          r={isAnom ? 8 : 5}
          fill={dotFill}
          fillOpacity={0.3}
          stroke={dotFill}
          strokeWidth={1.5}
        />
        <circle
          cx={cx}
          cy={cy}
          r={isAnom ? 5.5 : 3.5}
          fill={dotFill}
          stroke="#0B0F17"
          strokeWidth={2}
        />
      </g>
    );
  };

  // Custom rich Tooltip for both normal telemetry and detected anomaly events
  const CustomChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const currentPoint = payload[0]?.payload as TimeSeriesPoint | undefined;
    const anomaly = currentPoint?.anomaly;

    if (anomaly) {
      const decisionColor = getAnomalyColor(anomaly.decision);
      const effectiveParam = anomaly.parameter || parameter || 'temperature';
      const paramName =
        effectiveParam === 'temperature'
          ? 'Temperature'
          : effectiveParam === 'humidity'
          ? 'Relative Humidity'
          : 'Sea-Level Pressure';

      const obsVal =
        currentPoint?.raw !== null && currentPoint?.raw !== undefined
          ? currentPoint.raw.toFixed(2)
          : anomaly.observedValue !== null && anomaly.observedValue !== undefined
          ? Number(anomaly.observedValue).toFixed(2)
          : '--';

      return (
        <div className="bg-[#0D1420] border border-[#2D3748] rounded p-2.5 shadow-2xl font-mono text-[11px] max-w-xs space-y-1.5 pointer-events-auto">
          <div className="flex items-center justify-between border-b border-[#1F2D45] pb-1 gap-2">
            <span className="text-slate-300 font-semibold">{formatIsoUtc(anomaly.timestamp)}</span>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${decisionColor}20`,
                color: decisionColor,
                border: `1px solid ${decisionColor}60`,
              }}
            >
              {anomaly.severity}
            </span>
          </div>

          <div className="space-y-0.5">
            <div className="text-slate-200">
              <span className="text-slate-400">{paramName}: </span>
              <span className="font-bold text-white">{obsVal} {unit}</span>
            </div>
            <div className="text-slate-300 flex items-center gap-1.5">
              <span className="text-slate-400">Decision: </span>
              <span className="font-semibold" style={{ color: decisionColor }}>
                {anomaly.decision}
              </span>
            </div>
            <div className="text-slate-400 text-[10px] truncate">
              <span>Event: </span>
              <span className="text-slate-300 font-mono">{anomaly.eventId}</span>
            </div>
          </div>

          {anomaly.explanationSummary && (
            <div className="text-[10px] text-slate-400 line-clamp-2 border-t border-[#1F2D45] pt-1">
              {anomaly.explanationSummary}
            </div>
          )}

          <div className="pt-1 flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (onAnomalyClick) {
                  onAnomalyClick(anomaly.eventId);
                } else {
                  navigate(`/anomalies/${anomaly.eventId}`);
                }
              }}
              className="text-[10px] font-mono font-semibold text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1"
            >
              View anomaly &rarr;
            </button>
          </div>
        </div>
      );
    }

    // Standard observation telemetry tooltip
    return (
      <div className="bg-[#111827] border border-[#2D3748] rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-200 shadow-lg space-y-0.5">
        <div className="text-slate-400 text-[10px] border-b border-slate-700/50 pb-0.5 mb-1">
          Time: {formatIsoUtc(label)}
        </div>
        {payload.map((entry: any, index: number) => {
          const numericVal =
            typeof entry.value === 'number' ? entry.value.toFixed(2) : String(entry.value ?? '--');
          const entryLabel = entry.name === 'raw' ? 'Raw Sensor' : entry.name === 'imputed' ? 'Imputed' : entry.name;
          const entryColor = entry.name === 'raw' ? color : '#34D399';
          return (
            <div key={`entry-${index}`} className="flex items-center justify-between gap-3 text-[10px]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-0.5" style={{ backgroundColor: entryColor }} />
                <span className="text-slate-300">{entryLabel}:</span>
              </span>
              <span className="font-bold text-white">{numericVal} {unit}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-3 rounded border border-border bg-surface-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-slate-300 uppercase tracking-wider font-semibold">
          {title}
        </span>
        {/* Compact, comprehensive legend */}
        <div className="flex flex-wrap items-center gap-2.5 text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5" style={{ backgroundColor: color }} />
            Raw Sensor
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 border-b border-dashed border-emerald-400" />
            Imputed
          </span>
          <span className="flex items-center gap-1" title="PROBABLE_SENSOR_ANOMALY">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            Sensor Anomaly
          </span>
          <span className="flex items-center gap-1" title="PROBABLE_DATA_QUALITY_ISSUE / UNCERTAIN">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            Data Quality
          </span>
          <span className="flex items-center gap-1" title="POSSIBLE_GENUINE_EVENT">
            <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />
            Genuine Event
          </span>
          <span className="text-slate-500 font-normal">[{unit}]</span>
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        {!hasData ? (
          <div className="w-full h-full flex items-center justify-center rounded bg-surface-2/40 border border-border-subtle/50 text-data font-mono text-slate-400 text-center p-4">
            {emptyMessage}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              syncId={syncId}
              margin={{ top: 8, right: 12, left: -20, bottom: 0 }}
            >
              <CartesianGrid stroke="#1F2937" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                stroke="#64748B"
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(val) => {
                  try {
                    const d = new Date(val);
                    return isNaN(d.getTime())
                      ? String(val).substring(11, 16)
                      : d.toISOString().substring(11, 16);
                  } catch {
                    return String(val);
                  }
                }}
                minTickGap={30}
              />
              <YAxis
                stroke="#64748B"
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={<CustomChartTooltip />}
                wrapperStyle={{ pointerEvents: 'auto' }}
              />

              {anomalyWindow && (
                <ReferenceArea
                  x1={anomalyWindow[0]}
                  x2={anomalyWindow[1]}
                  strokeOpacity={0.3}
                  fill="#EF4444"
                  fillOpacity={0.12}
                />
              )}

              {/* Raw Sensor - Linear sequence with exact anomaly marker overlays */}
              <Line
                type="linear"
                dataKey="raw"
                stroke={color}
                strokeWidth={1.5}
                dot={renderCustomDot}
                activeDot={renderActiveDot}
                connectNulls={false}
                isAnimationActive={false}
              />

              {/* Imputed / Model Estimate - Dashed Line */}
              <Line
                type="linear"
                dataKey="imputed"
                stroke="#34D399"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
