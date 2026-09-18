import React from 'react';
import { HybridDecisionType, AlertSeverity } from '../types/api';
import { SeverityBadge } from './SeverityBadge';
import { formatIsoUtc } from '../utils/formatters';
import { ShieldAlert, CheckCircle2, CloudLightning, HelpCircle, AlertTriangle } from 'lucide-react';

interface DecisionBannerProps {
  decision: HybridDecisionType | string;
  severity: AlertSeverity | string;
  reasonCodes?: string[];
  stationId?: string;
  timestamp?: string;
  isDegradedMode?: boolean;
  durationMinutes?: number | null;
  modelVersion?: string;
  engineVersion?: string;
  explanationMethod?: string;
  isSticky?: boolean;
}

export const DecisionBanner: React.FC<DecisionBannerProps> = ({
  decision,
  severity,
  reasonCodes = [],
  stationId,
  timestamp,
  isDegradedMode = false,
  durationMinutes,
  modelVersion = 'isolation_forest_v1',
  engineVersion = 'hybrid_v1.0.0',
  explanationMethod = 'TREE_SHAP',
  isSticky = false,
}) => {
  let title = 'NOMINAL METEOROLOGICAL STATE';
  let bannerBorder = 'border-slate-700 bg-surface-1';
  let Icon = CheckCircle2;
  let iconColor = 'text-emerald-400';
  let leftBorderAccent = 'border-l-4 border-l-emerald-500';

  switch (decision) {
    case 'NORMAL':
      title = 'NOMINAL OBSERVATION — QC PASSED';
      bannerBorder = 'border-emerald-800/60 bg-emerald-950/20';
      Icon = CheckCircle2;
      iconColor = 'text-emerald-400';
      leftBorderAccent = 'border-l-4 border-l-emerald-500';
      break;
    case 'POSSIBLE_GENUINE_EVENT':
      title = 'POSSIBLE GENUINE WEATHER EVENT';
      bannerBorder = 'border-indigo-700/70 bg-indigo-950/30';
      Icon = CloudLightning;
      iconColor = 'text-indigo-400';
      leftBorderAccent = 'border-l-4 border-l-indigo-500';
      break;
    case 'PROBABLE_SENSOR_ANOMALY':
      title = 'PROBABLE SENSOR ANOMALY';
      bannerBorder = 'border-red-800/70 bg-red-950/30';
      Icon = ShieldAlert;
      iconColor = 'text-red-400';
      leftBorderAccent = 'border-l-4 border-l-red-500';
      break;
    case 'PROBABLE_DATA_QUALITY_ISSUE':
      title = 'PROBABLE DATA QUALITY / TRANSMISSION ISSUE';
      bannerBorder = 'border-amber-800/70 bg-amber-950/30';
      Icon = AlertTriangle;
      iconColor = 'text-amber-400';
      leftBorderAccent = 'border-l-4 border-l-amber-500';
      break;
    case 'UNCERTAIN':
      title = 'UNCERTAIN OBSERVATION — OPERATOR REVIEW RECOMMENDED';
      bannerBorder = 'border-fuchsia-800/70 bg-fuchsia-950/30';
      Icon = HelpCircle;
      iconColor = 'text-fuchsia-400';
      leftBorderAccent = 'border-l-4 border-l-fuchsia-500';
      break;
  }

  const stickyClasses = isSticky
    ? 'sticky top-0 z-20 border-b shadow-md bg-surface-1'
    : '';

  return (
    <div className={`p-4 border ${bannerBorder} ${leftBorderAccent} ${stickyClasses} transition-all`} style={{ borderRadius: '2px' }}>
      {/* Row 1 & 2: Primary Operational Decision & Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 bg-surface-2 border border-border-subtle ${iconColor} flex-shrink-0`} style={{ borderRadius: '2px' }}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-h2 font-bold tracking-wide text-slate-100">{title}</span>
              <SeverityBadge severity={severity} />
              {isDegradedMode && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-amber-950 text-amber-300 border border-amber-800" style={{ borderRadius: '2px' }}>
                  Degraded Mode
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-slate-400 flex-wrap">
              {stationId && (
                <span>
                  Station: <strong className="text-slate-200 font-mono">{stationId}</strong>
                </span>
              )}
              {timestamp && (
                <span>
                  Timestamp: <strong className="text-slate-300 font-mono">{formatIsoUtc(timestamp)}</strong>
                </span>
              )}
              {durationMinutes !== undefined && durationMinutes !== null && (
                <span>
                  Duration: <strong className="text-slate-200 font-mono">{durationMinutes.toFixed(0)} min</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Reason Codes / Triggers */}
        {reasonCodes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 max-w-md">
            <span className="text-[10px] text-slate-400 uppercase font-mono mr-1">Triggers:</span>
            {reasonCodes.map((code) => (
              <span
                key={code}
                className="px-1.5 py-0.5 text-[10px] font-mono bg-surface-2 text-slate-300 border border-border"
                style={{ borderRadius: '2px' }}
              >
                {code}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Row 3: Engine Provenance (De-emphasized / Muted) */}
      <div className="mt-2.5 pt-2 border-t border-border-subtle flex flex-wrap items-center justify-between text-[10px] font-mono text-slate-500">
        <div>
          Engine: <span className="text-slate-400">{engineVersion}</span> | Model: <span className="text-slate-400">{modelVersion}</span> | Method: <span className="text-slate-400">{explanationMethod}</span>
        </div>
        <div className="text-slate-500">
          SkyGuard AI Mission Control · Calibrated Anomaly Inference
        </div>
      </div>
    </div>
  );
};
