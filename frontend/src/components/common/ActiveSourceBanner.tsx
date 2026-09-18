import React from 'react';
import { RunContext } from '../../types/runtime';
import { Play, Pause, RotateCcw, FastForward, ChevronDown, Database, History } from 'lucide-react';

interface ActiveSourceBannerProps {
  context: RunContext | null;
  onOpenSelector: () => void;
  onOpenDrawer: () => void;
  onOpenHistory: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  onSetSpeed?: (speed: number) => void;
}

// Source mode left-stripe color
const SOURCE_STRIPE: Record<string, string> = {
  SYNTHETIC_VALIDATION: '#A78BFA',
  HISTORICAL_CSV:       '#60A5FA',
  OPEN_METEO:           '#00C9A7',
  IMD_AWS:              '#F59E0B',
};

// Status dot color — communicates operational state
const STATUS_COLOR: Record<string, string> = {
  RUNNING:   '#10B981',
  PAUSED:    '#F59E0B',
  COMPLETED: '#60A5FA',
  IDLE:      '#4A5B78',
};

export const ActiveSourceBanner: React.FC<ActiveSourceBannerProps> = ({
  context,
  onOpenSelector,
  onOpenDrawer,
  onOpenHistory,
  onStart,
  onPause,
  onReset,
  onSetSpeed,
}) => {
  const isReplay = context?.mode === 'SYNTHETIC_REPLAY' || context?.mode === 'HISTORICAL_REPLAY';
  const isRunning = context?.status === 'RUNNING';
  const speed = context?.replay_speed || 60;
  const speeds = [1, 10, 60, 300];

  const stripeColor = context ? (SOURCE_STRIPE[context.source_type] ?? '#4A5B78') : '#4A5B78';
  const statusColor = context ? (STATUS_COLOR[context.status] ?? '#4A5B78') : '#4A5B78';

  // Determine mode-specific bottom border class
  const modeClass = !context ? 'mode-idle'
    : context.source_type === 'SYNTHETIC_VALIDATION' ? 'mode-synthetic'
    : context.source_type === 'HISTORICAL_CSV' ? 'mode-historical'
    : context.source_type === 'OPEN_METEO' ? 'mode-live'
    : 'mode-idle';

  if (!context) {
    return (
      <div
        className={`px-4 py-2 flex items-center justify-between border-b text-[11px] font-mono text-slate-500 ${modeClass}`}
        style={{ background: '#0A0F18', borderColor: '#1F2D45' }}
      >
        <span>Initializing SkyGuard Data Source Control Plane...</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-4 border-b ${modeClass}`}
      style={{ background: '#0A0F18', minHeight: '36px' }}
    >
      {/* Left section: source selector + badges + replay controls */}
      <div className="flex items-center flex-wrap gap-2 py-1.5">

        {/* Source selector trigger — left stripe communicates active source type */}
        <button
          onClick={onOpenSelector}
          className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] font-semibold border text-slate-200 hover:text-white transition-colors group"
          style={{
            background: '#0D1420',
            borderColor: '#1F2D45',
            borderLeft: `2px solid ${stripeColor}`,
            borderRadius: '2px',
          }}
          title="Change active observation source"
        >
          <span>DATA SOURCE</span>
          <ChevronDown className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
        </button>

        {/* Source + Mode tags */}
        <div className="flex items-center gap-1.5">
          <span
            className="px-2 py-0.5 font-mono text-[10px] font-semibold border"
            style={{
              background: 'rgba(0,0,0,0.3)',
              borderColor: `${stripeColor}40`,
              color: stripeColor,
              borderRadius: '2px',
            }}
          >
            {context.source_type.replace(/_/g, ' ')}
          </span>

          <span
            className="px-2 py-0.5 font-mono text-[10px] border text-slate-400"
            style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
          >
            {context.mode.replace(/_/g, ' ')}
          </span>

          <span
            className="px-2 py-0.5 font-mono text-[10px] border text-slate-500"
            style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
          >
            {context.transport}
          </span>

          {/* Status indicator — dot color communicates state, no animation unless state demands it */}
          <span
            className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] font-bold border"
            style={{
              background: '#0D1420',
              borderColor: `${statusColor}40`,
              color: statusColor,
              borderRadius: '2px',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: statusColor }}
            />
            {context.status}
          </span>
        </div>

        {/* Replay transport controls — shown only in replay mode */}
        {isReplay && (
          <div
            className="flex items-center gap-1 px-2 py-1 border"
            style={{ background: '#0A0E18', borderColor: '#1F2D45', borderRadius: '2px' }}
          >
            {/* Start / Pause */}
            {isRunning ? (
              <button
                onClick={onPause}
                className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] font-semibold border text-amber-300 hover:bg-amber-950/30 transition-colors"
                style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)', borderRadius: '2px' }}
                title="Pause continuous replay stream"
              >
                <Pause className="w-3 h-3 text-amber-400" />
                PAUSE
              </button>
            ) : (
              <button
                onClick={onStart}
                className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] font-semibold border text-emerald-300 hover:bg-emerald-950/30 transition-colors"
                style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)', borderRadius: '2px' }}
                title="Start continuous replay stream"
              >
                <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                START
              </button>
            )}

            <button
              onClick={onReset}
              className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] border text-slate-400 hover:text-slate-200 hover:bg-surface-hover transition-colors"
              style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
              title="Reset replay simulation pointer"
            >
              <RotateCcw className="w-3 h-3" />
              RESET
            </button>

            {/* Speed selector */}
            <div className="flex items-center gap-0.5 pl-1.5 border-l" style={{ borderColor: '#1F2D45' }}>
              <FastForward className="w-3 h-3 text-slate-600 mr-0.5" />
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => onSetSpeed && onSetSpeed(s)}
                  className="px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors"
                  style={{
                    borderRadius: '2px',
                    background: speed === s ? '#4F46E5' : '#0D1420',
                    color: speed === s ? '#fff' : '#4A5B78',
                    border: speed === s ? '1px solid #6366F1' : '1px solid #1F2D45',
                  }}
                  title={`Set replay speed to ${s}x`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right section: action buttons */}
      <div className="flex items-center gap-1.5 py-1.5">
        <button
          onClick={onOpenDrawer}
          className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] border text-slate-400 hover:text-slate-200 hover:border-border-accent transition-colors"
          style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
          title="View dataset information"
        >
          <Database className="w-3 h-3" />
          DATASET INFO
        </button>

        <button
          onClick={onOpenHistory}
          className="flex items-center gap-1.5 px-2.5 py-1 font-mono text-[11px] border text-slate-400 hover:text-slate-200 hover:border-border-accent transition-colors"
          style={{ background: '#0D1420', borderColor: '#1F2D45', borderRadius: '2px' }}
          title="View run history"
        >
          <History className="w-3 h-3" />
          RUN HISTORY
        </button>
      </div>
    </div>
  );
};
