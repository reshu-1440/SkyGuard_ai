import React, { useState } from 'react';
import { DataSourceType, RunMode } from '../../types/runtime';

interface DataSourceSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sourceType: DataSourceType, mode: RunMode, datasetId?: string) => Promise<any>;
  onOpenCsvModal: () => void;
}

export const DataSourceSelectorModal: React.FC<DataSourceSelectorModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  onOpenCsvModal,
}) => {
  const [selectedSource, setSelectedSource] = useState<DataSourceType>('SYNTHETIC_VALIDATION');
  const [selectedMode, setSelectedMode] = useState<RunMode>('SYNTHETIC_REPLAY');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSourceChange = (src: DataSourceType) => {
    setSelectedSource(src);
    if (src === 'SYNTHETIC_VALIDATION') {
      setSelectedMode('SYNTHETIC_REPLAY');
    } else if (src === 'HISTORICAL_CSV') {
      setSelectedMode('HISTORICAL_ANALYSIS');
    } else if (src === 'OPEN_METEO') {
      setSelectedMode('LIVE_MONITORING');
    }
  };

  const handleConfirm = async () => {
    if (selectedSource === 'HISTORICAL_CSV') {
      onClose();
      onOpenCsvModal();
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSelect(selectedSource, selectedMode);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to switch data source');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>🛰️</span> Data Source Control Plane
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Select observation provider. Switching sources resets transient state.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-red-950/60 border border-red-800 text-red-300 p-3 rounded text-xs">
            {error}
          </div>
        )}

        {/* Source Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* 1. Synthetic Validation */}
          <div
            onClick={() => handleSourceChange('SYNTHETIC_VALIDATION')}
            className={`p-4 rounded-lg border cursor-pointer transition-all ${
              selectedSource === 'SYNTHETIC_VALIDATION'
                ? 'bg-purple-950/40 border-purple-500 ring-1 ring-purple-500/50'
                : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-purple-300">SYNTHETIC VALIDATION</span>
              <span className="text-xs bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded border border-purple-700/50">
                BENCHMARK
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              20 stations, 24h replay, 5-min cadence, 24 scenarios with ground truth evaluation.
            </p>
          </div>

          {/* 2. Historical CSV */}
          <div
            onClick={() => handleSourceChange('HISTORICAL_CSV')}
            className={`p-4 rounded-lg border cursor-pointer transition-all ${
              selectedSource === 'HISTORICAL_CSV'
                ? 'bg-blue-950/40 border-blue-500 ring-1 ring-blue-500/50'
                : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-blue-300">HISTORICAL CSV</span>
              <span className="text-xs bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
                UPLOAD / FILE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Upload custom CSV or select configured NOAA dataset with column mapping.
            </p>
          </div>

          {/* 3. Live API (Open-Meteo) */}
          <div
            onClick={() => handleSourceChange('OPEN_METEO')}
            className={`p-4 rounded-lg border cursor-pointer transition-all ${
              selectedSource === 'OPEN_METEO'
                ? 'bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500/50'
                : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-emerald-300">LIVE API (Open-Meteo)</span>
              <span className="text-xs bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded border border-emerald-700/50">
                FREE PUBLIC
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Real-time meteorological observation stream for 20 AWS locations (No API key required).
            </p>
          </div>

          {/* 4. Future IMD AWS (Disabled) */}
          <div className="p-4 rounded-lg border bg-slate-900/80 border-slate-800 opacity-60 cursor-not-allowed">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-slate-400">IMD AWS</span>
              <span className="text-[10px] bg-slate-800 text-amber-400 px-2 py-0.5 rounded border border-amber-800/50 font-mono">
                COMING SOON / NOT CONFIGURED
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Architectural slot for future direct India Meteorological Department connector.
            </p>
          </div>
        </div>

        {/* Mode Selector for chosen source */}
        <div className="border-t border-slate-800 pt-4 space-y-2">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
            Run Mode Selection
          </label>
          {selectedSource === 'SYNTHETIC_VALIDATION' && (
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value as RunMode)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded p-2.5"
            >
              <option value="SYNTHETIC_REPLAY">SYNTHETIC_REPLAY — Interactive benchmark playback</option>
            </select>
          )}

          {selectedSource === 'HISTORICAL_CSV' && (
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value as RunMode)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded p-2.5"
            >
              <option value="HISTORICAL_ANALYSIS">HISTORICAL_ANALYSIS — Batch processing & analysis</option>
              <option value="HISTORICAL_REPLAY">HISTORICAL_REPLAY — Real-time stream replay</option>
            </select>
          )}

          {selectedSource === 'OPEN_METEO' && (
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value as RunMode)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded p-2.5"
            >
              <option value="LIVE_MONITORING">LIVE_MONITORING — Continuous live polling</option>
            </select>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-medium transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded shadow transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Switching Source...' : 'Confirm Source Switch'}
          </button>
        </div>
      </div>
    </div>
  );
};
