import React from 'react';
import { RunContext } from '../../types/runtime';

interface DatasetInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  context: RunContext | null;
}

export const DatasetInfoDrawer: React.FC<DatasetInfoDrawerProps> = ({
  isOpen,
  onClose,
  context,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden bg-black/60 backdrop-blur-xs">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-slate-900 border-l border-slate-800 text-slate-100 p-6 shadow-2xl space-y-6 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-cyan-400 flex items-center gap-2">
                  <span>📊</span> Dataset & Run Metadata
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Canonical provenance for active observation pipeline
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {context ? (
              <div className="space-y-4 text-xs">
                <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Run ID:</span>
                    <span className="font-mono text-cyan-300 font-bold">{context.run_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Data Source:</span>
                    <span className="font-semibold text-slate-200">{context.source_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Source Type:</span>
                    <span className="font-mono text-purple-300">{context.source_type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Run Mode:</span>
                    <span className="font-mono text-blue-300">{context.mode}</span>
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dataset ID:</span>
                    <span className="font-mono text-slate-300">{context.dataset_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dataset Version:</span>
                    <span className="font-mono text-slate-300">{context.dataset_version}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Active Stations:</span>
                    <span className="font-bold text-slate-200">{context.station_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Observation Count:</span>
                    <span className="font-mono text-slate-200">
                      {context.observation_count ? context.observation_count.toLocaleString() : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Sampling Cadence:</span>
                    <span className="font-semibold text-slate-200">{context.cadence}</span>
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3 rounded-lg border border-slate-700/60 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Ground Truth Labels:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        context.ground_truth_available
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {context.ground_truth_available ? 'AVAILABLE' : 'NOT AVAILABLE'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Transport Layer:</span>
                    <span className="font-mono text-slate-300">{context.transport}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Database Target:</span>
                    <span className="font-mono text-slate-300">{context.database_target}</span>
                  </div>
                </div>

                {context.metadata && Object.keys(context.metadata).length > 0 && (
                  <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/40 space-y-1.5">
                    <span className="text-slate-400 font-semibold block mb-1">
                      Supplementary Provenance:
                    </span>
                    {Object.entries(context.metadata).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-[11px]">
                        <span className="text-slate-400">{key}:</span>
                        <span className="font-mono text-slate-300">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-slate-400 text-xs py-8 text-center">
                No active RunContext loaded.
              </div>
            )}
          </div>

          <div className="border-t border-slate-800 pt-4">
            <button
              onClick={onClose}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-medium transition-colors"
            >
              Close Drawer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
