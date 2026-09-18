import React from 'react';
import { HealthComponentScores, ParameterHealth } from '../types/api';
import { formatHealthScore } from '../utils/formatters';

interface HealthTrendProps {
  /** Component scores object using actual backend field names (anomaly_health, etc.) */
  components?: HealthComponentScores;
  /** Dict keyed by parameter name: 'temperature_c', 'relative_humidity', 'sea_level_pressure_hpa' */
  parameterHealth?: Record<string, ParameterHealth>;
  /** Explicit flag if lookback history is insufficient (< 12 observations) */
  isInsufficientHistory?: boolean;
}

export const HealthTrend: React.FC<HealthTrendProps> = ({
  components,
  parameterHealth,
  isInsufficientHistory = false,
}) => {
  // Use actual backend field names from ComponentHealthScores
  const componentItems = [
    { label: 'Anomaly Density', score: components?.anomaly_health },
    { label: 'Data Quality / QC', score: components?.data_quality_health },
    { label: 'Communication Liveness', score: components?.communication_health },
    { label: 'Temporal Stability', score: components?.temporal_stability_health },
    { label: 'Spatial Consistency', score: components?.spatial_consistency_health },
  ];

  const getScoreColor = (score: number) => {
    if (score < 60) return 'bg-red-500';
    if (score < 85) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  // Extract named parameter channels from the keyed dict (backend keys from ParameterHealth.parameter_name)
  // The backend emits keys like 'temperature_c', 'relative_humidity', 'sea_level_pressure_hpa'
  const tempHealth = parameterHealth?.['temperature_c'] ?? parameterHealth?.['temperature'];
  const humidHealth = parameterHealth?.['relative_humidity'] ?? parameterHealth?.['humidity'];
  const pressHealth = parameterHealth?.['sea_level_pressure_hpa'] ?? parameterHealth?.['pressure'];

  const hasAnyParameterHealth = Boolean(tempHealth || humidHealth || pressHealth);

  return (
    <div className="space-y-4">
      <div className="p-4 border bg-surface-1 border-border" style={{ borderRadius: '2px' }}>
        <h4 className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-3">
          5-Component Reliability Breakdown
        </h4>

        {isInsufficientHistory ? (
          <div className="p-3 bg-surface-2 border border-border-subtle text-[11px] font-mono text-slate-400 leading-relaxed" style={{ borderRadius: '2px' }}>
            <span className="text-slate-300 font-semibold block mb-1 uppercase text-[10px]">
              Calibration in Progress
            </span>
            Component scores require at least 12 observations in the evaluation window. Multi-domain scoring will activate as telemetry accumulates.
          </div>
        ) : components ? (
          <div className="space-y-2.5">
            {componentItems.map((item) => {
              const score = item.score ?? null;
              const isAvailable = score !== null && score !== undefined;
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-300">{item.label}</span>
                    {isAvailable ? (
                      <span className="text-slate-200 font-semibold">
                        {formatHealthScore(score)} / 100
                      </span>
                    ) : (
                      <span className="text-slate-500 italic">Unavailable</span>
                    )}
                  </div>
                  <div className="w-full h-1.5 bg-surface-2 overflow-hidden" style={{ borderRadius: '1px' }}>
                    <div
                      className={`h-full ${isAvailable ? getScoreColor(score!) : 'bg-slate-700'} transition-all duration-300`}
                      style={{ width: isAvailable ? `${Math.min(Math.max(score!, 0), 100)}%` : '0%' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] font-mono text-slate-500 italic">
            Component scores not yet available for this station.
          </p>
        )}
      </div>

      {/* Parameter-level health: rendered from Dict<string, ParameterHealth> */}
      <div className="p-4 border bg-surface-1 border-border" style={{ borderRadius: '2px' }}>
        <h4 className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-3">
          Parameter-Level Sensor Status
        </h4>

        {hasAnyParameterHealth ? (
          <div className="grid grid-cols-3 gap-3">
            {/* Temperature */}
            <div className="p-2.5 bg-surface-2 border border-border-subtle text-center" style={{ borderRadius: '2px' }}>
              <span className="text-[10px] font-mono text-slate-400 block">TEMPERATURE</span>
              {tempHealth?.health_score !== null && tempHealth?.health_score !== undefined ? (
                <>
                  <span className="text-h2 font-mono font-semibold text-ops-weather">
                    {formatHealthScore(tempHealth.health_score)}%
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                    {tempHealth.status_band}
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-mono text-slate-500 italic block mt-1">
                  Insufficient data
                </span>
              )}
            </div>

            {/* Humidity */}
            <div className="p-2.5 bg-surface-2 border border-border-subtle text-center" style={{ borderRadius: '2px' }}>
              <span className="text-[10px] font-mono text-slate-400 block">HUMIDITY</span>
              {humidHealth?.health_score !== null && humidHealth?.health_score !== undefined ? (
                <>
                  <span className="text-h2 font-mono font-semibold text-ops-humidity">
                    {formatHealthScore(humidHealth.health_score)}%
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                    {humidHealth.status_band}
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-mono text-slate-500 italic block mt-1">
                  Insufficient data
                </span>
              )}
            </div>

            {/* Pressure */}
            <div className="p-2.5 bg-surface-2 border border-border-subtle text-center" style={{ borderRadius: '2px' }}>
              <span className="text-[10px] font-mono text-slate-400 block">PRESSURE</span>
              {pressHealth?.health_score !== null && pressHealth?.health_score !== undefined ? (
                <>
                  <span className="text-h2 font-mono font-semibold text-ops-pressure">
                    {formatHealthScore(pressHealth.health_score)}%
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 block mt-0.5">
                    {pressHealth.status_band}
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-mono text-slate-500 italic block mt-1">
                  Insufficient data
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[11px] font-mono text-slate-500 italic">
            Parameter-level health data not yet available for this station.
          </p>
        )}
      </div>
    </div>
  );
};
