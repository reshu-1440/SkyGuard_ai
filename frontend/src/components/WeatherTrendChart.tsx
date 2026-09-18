import React from 'react';
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

export interface TimeSeriesPoint {
  timestamp: string; // ISO or formatted
  raw?: number | null;
  imputed?: number | null;
  neighbor?: number | null;
  isAnomaly?: boolean;
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
}) => {
  const hasData = data && data.length > 0 && data.some((d) => d.raw !== null && d.raw !== undefined);

  return (
    <div className="p-3 rounded border border-border bg-surface-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-slate-300 uppercase tracking-wider font-semibold">
          {title}
        </span>
        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5" style={{ backgroundColor: color }} />
            Raw Sensor
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 border-b border-dashed border-emerald-400" />
            Imputed
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
              margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
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
                contentStyle={{
                  backgroundColor: '#111827',
                  borderColor: '#2D3748',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono',
                  color: '#F8FAFC',
                  padding: '6px 10px',
                }}
                formatter={(value: unknown, name: string) => {
                  const numericVal =
                    typeof value === 'number' ? value.toFixed(2) : String(value ?? '--');
                  const label = name === 'raw' ? 'Raw Sensor' : name === 'imputed' ? 'Imputed' : name;
                  return [`${numericVal} ${unit}`, label];
                }}
                labelFormatter={(label) => `Time: ${formatIsoUtc(label)}`}
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

              {/* Raw Sensor - Solid Line (Strictly real data points, no fake animation) */}
              <Line
                type="linear"
                dataKey="raw"
                stroke={color}
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: color, stroke: '#0B0F17', strokeWidth: 1 }}
                activeDot={{ r: 5, stroke: color, fill: '#0B0F17', strokeWidth: 2 }}
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
