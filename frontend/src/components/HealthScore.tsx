import React from 'react';
import { HealthStatusBand } from '../types/api';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface HealthScoreProps {
  score?: number | null;
  band?: HealthStatusBand | string;
  trend?: 'IMPROVING' | 'STABLE' | 'DEGRADING' | 'INSUFFICIENT_HISTORY' | string;
  size?: 'sm' | 'md' | 'lg';
  showDisclaimer?: boolean;
}

export const HealthScore: React.FC<HealthScoreProps> = ({
  score,
  band = 'HEALTHY',
  trend = 'STABLE',
  size = 'md',
  showDisclaimer = false,
}) => {
  const isInsufficient = band === 'INSUFFICIENT_HISTORY' || trend === 'INSUFFICIENT_HISTORY' || score === null || score === undefined;
  const displayScore = !isInsufficient && typeof score === 'number' ? Math.round(score) : '--';

  let badgeColor = 'bg-emerald-950 text-emerald-300 border-emerald-800';

  if (isInsufficient) {
    badgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
  } else if (typeof score === 'number') {
    if (score < 60 || band === 'CRITICAL') {
      badgeColor = 'bg-red-950 text-red-300 border-red-800';
    } else if (score < 85 || band === 'DEGRADED') {
      badgeColor = 'bg-amber-950 text-amber-300 border-amber-800';
    }
  }

  const TrendIcon = isInsufficient ? Minus : trend === 'IMPROVING' ? TrendingUp : trend === 'DEGRADING' ? TrendingDown : Minus;
  const trendColor = isInsufficient ? 'text-slate-500' : trend === 'IMPROVING' ? 'text-emerald-400' : trend === 'DEGRADING' ? 'text-amber-400' : 'text-slate-400';

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-data">
        <span className={`font-semibold ${isInsufficient ? 'text-slate-400' : typeof score === 'number' && score < 60 ? 'text-red-400' : typeof score === 'number' && score < 85 ? 'text-amber-400' : 'text-emerald-400'}`}>
          {displayScore}/100
        </span>
        <span className={`px-1 py-0.2 rounded text-[10px] uppercase border ${badgeColor}`}>
          {band ? band.replace('_', ' ') : 'HEALTHY'}
        </span>
      </span>
    );
  }

  return (
    <div className="p-4 rounded border bg-surface-1 border-border">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
          Sensor Health Index
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase border ${badgeColor}`}>
          {band ? band.replace('_', ' ') : 'HEALTHY'}
        </span>
      </div>

      <div className="flex items-baseline gap-3 mt-2">
        <span className="text-stat font-mono font-bold tracking-tight text-slate-100">
          {displayScore}
          <span className="text-h2 font-normal text-slate-500">/100</span>
        </span>
        <div className={`flex items-center gap-1 text-data font-medium ${trendColor}`}>
          <TrendIcon className="w-4 h-4" />
          <span className="text-[11px] font-mono uppercase">{trend ? trend.replace('_', ' ') : 'STABLE'}</span>
        </div>
      </div>

      {isInsufficient ? (
        <p className="mt-3 text-[11px] text-slate-400 leading-normal border-t border-border-subtle pt-2 font-mono">
          <strong className="text-slate-300">Baseline in Progress:</strong> Minimum 12 observations required in lookback window to calculate statistically calibrated health index.
        </p>
      ) : showDisclaimer ? (
        <p className="mt-3 text-[11px] text-slate-500 leading-normal border-t border-border-subtle pt-2">
          <strong>Scientific Notice:</strong> Health Index is NOT a failure probability. It represents composite empirical scoring across anomaly density, physical consistency, and telemetry stability.
        </p>
      ) : null}
    </div>
  );
};

