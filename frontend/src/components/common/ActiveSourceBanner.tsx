import React from 'react';
import { RunContext } from '../../types/runtime';
import { Play, Pause, RotateCcw, FastForward } from 'lucide-react';


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
  if (!context) {
    return (
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 text-slate-400 text-xs flex items-center justify-between">
        <span>Initializing SkyGuard Data Source Control Plane...</span>
      </div>
    );
  }

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case 'SYNTHETIC_VALIDATION':
        return 'bg-purple-900/60 text-purple-300 border-purple-700/50';
      case 'HISTORICAL_CSV':
        return 'bg-blue-900/60 text-blue-300 border-blue-700/50';
      case 'OPEN_METEO':
        return 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50';
      case 'IMD_AWS':
        return 'bg-amber-900/60 text-amber-300 border-amber-700/50';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      case 'PAUSED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'COMPLETED':
        return 'bg-sky-500/20 text-sky-400 border-sky-500/40';
      default:
        return 'bg-slate-700/40 text-slate-400 border-slate-600/40';
    }
  };

  const isReplay = context.mode === 'SYNTHETIC_REPLAY' || context.mode === 'HISTORICAL_REPLAY';
  const isRunning = context.status === 'RUNNING';
  const speed = context.replay_speed || 60;
  const speeds = [1, 10, 60, 300];

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-1.5 flex flex-wrap items-center justify-between text-xs gap-2 shadow-inner">
      <div className="flex items-center flex-wrap gap-2.5">
        {/* Source selector trigger */}
        <button
          onClick={onOpenSelector}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold border border-slate-700 transition-colors"
          title="Change active observation source"
        >
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>DATA SOURCE</span>
          <span className="text-slate-400 text-[10px]">▼</span>
        </button>

        {/* Display Active Badges */}
        <div className="flex items-center flex-wrap gap-1.5">
          <span
            className={`px-2 py-0.5 rounded font-mono font-medium border ${getSourceBadgeColor(
              context.source_type
            )}`}
          >
            SOURCE: {context.source_type.replace('_', ' ')}
          </span>

          <span className="px-2 py-0.5 rounded font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700">
            MODE: {context.mode.replace('_', ' ')}
          </span>

          <span className="px-2 py-0.5 rounded font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700">
            TRANSPORT: {context.transport}
          </span>

          <span
            className={`px-2 py-0.5 rounded font-mono font-bold border ${getStatusBadgeColor(
              context.status
            )}`}
          >
            {context.status}
          </span>
        </div>

        {/* Replay Controls (When in Replay Mode) */}
        {isReplay && (
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-700/80">
            {isRunning ? (
              <button
                onClick={onPause}
                className="px-2 py-0.5 rounded bg-amber-950/80 hover:bg-amber-900 text-amber-300 font-semibold flex items-center gap-1 border border-amber-700/60 transition-colors"
                title="Pause continuous replay stream"
              >
                <Pause className="w-3 h-3 text-amber-400" />
                <span>PAUSE</span>
              </button>
            ) : (
              <button
                onClick={onStart}
                className="px-2 py-0.5 rounded bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 font-semibold flex items-center gap-1 border border-emerald-700/60 transition-colors"
                title="Start continuous replay stream"
              >
                <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                <span>START</span>
              </button>
            )}

            <button
              onClick={onReset}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 border border-slate-600/60 transition-colors"
              title="Reset replay simulation"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span>RESET</span>
            </button>

            {/* Speed Multiplier Buttons */}
            <div className="flex items-center gap-0.5 ml-1">
              <span className="text-[10px] text-slate-400 mr-1 flex items-center gap-0.5">
                <FastForward className="w-2.5 h-2.5" /> SPEED:
              </span>
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => onSetSpeed && onSetSpeed(s)}
                  className={`px-1.5 py-0.5 text-[10px] font-mono rounded font-semibold transition-colors ${
                    speed === s
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenDrawer}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded font-medium border border-cyan-800/40 transition-colors flex items-center gap-1.5"
        >
          <span>📊</span> DATASET INFO
        </button>

        <button
          onClick={onOpenHistory}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium border border-slate-700 transition-colors flex items-center gap-1.5"
        >
          <span>📜</span> RUN HISTORY
        </button>
      </div>
    </div>
  );
};
