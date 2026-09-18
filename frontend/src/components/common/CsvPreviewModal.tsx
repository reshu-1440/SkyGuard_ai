import React, { useState } from 'react';
import { uploadCsvPreview } from '../../api/runtime';
import { CSVDatasetPreview, DataSourceType, RunMode } from '../../types/runtime';

interface CsvPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (sourceType: DataSourceType, mode: RunMode, datasetId?: string) => Promise<any>;
}

export const CsvPreviewModal: React.FC<CsvPreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [preview, setPreview] = useState<CSVDatasetPreview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setError(null);
      try {
        setLoading(true);
        const data = await uploadCsvPreview(file);
        setPreview(data);
      } catch (err: any) {
        setError(err.message || 'Failed to parse CSV file');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRun = async (mode: RunMode) => {
    if (!preview) return;
    try {
      setIsSubmitting(true);
      await onConfirm('HISTORICAL_CSV', mode, preview.file_name);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to start CSV run');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-blue-400 flex items-center gap-2">
              <span>📄</span> Historical CSV Upload & Schema Preview
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Validate column headers, station identifiers, and missingness before running.
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

        {/* File Select */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 block">
            Select Meteorological CSV File:
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="w-full text-xs text-slate-300 bg-slate-800 p-2.5 rounded border border-slate-700 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
          />
        </div>

        {loading && (
          <div className="text-center py-6 text-xs text-slate-400 animate-pulse">
            Analyzing dataset schema, station counts, and missingness...
          </div>
        )}

        {preview && !loading && (
          <div className="space-y-4 text-xs">
            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <div className="bg-amber-950/50 border border-amber-800/60 text-amber-300 p-3 rounded space-y-1">
                <span className="font-bold block">Validation Warnings:</span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  {preview.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Summary Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                <span className="text-slate-400 block text-[10px]">Total Rows</span>
                <span className="font-mono font-bold text-slate-200 text-sm">
                  {preview.row_count.toLocaleString()}
                </span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                <span className="text-slate-400 block text-[10px]">Station Count</span>
                <span className="font-mono font-bold text-slate-200 text-sm">
                  {preview.station_count}
                </span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                <span className="text-slate-400 block text-[10px]">Cadence</span>
                <span className="font-mono font-bold text-slate-200 text-sm">
                  {preview.detected_cadence_minutes} min
                </span>
              </div>
              <div className="bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                <span className="text-slate-400 block text-[10px]">Ground Truth</span>
                <span
                  className={`font-bold text-xs ${
                    preview.has_ground_truth ? 'text-emerald-400' : 'text-slate-400'
                  }`}
                >
                  {preview.has_ground_truth ? 'LABELED' : 'NOT AVAILABLE'}
                </span>
              </div>
            </div>

            {/* Column Mapping Table */}
            <div className="space-y-2">
              <span className="font-semibold text-slate-300 block">Detected Schema Mapping:</span>
              <div className="bg-slate-950 p-3 rounded border border-slate-800 font-mono text-[11px] grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {Object.entries(preview.column_mapping).map(([csvCol, canonical]) => (
                  <div key={csvCol} className="flex justify-between bg-slate-900 px-2 py-1 rounded">
                    <span className="text-blue-300">{csvCol}</span>
                    <span className="text-slate-400">→</span>
                    <span className="text-emerald-300">{canonical}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Missingness Table */}
            <div className="space-y-2">
              <span className="font-semibold text-slate-300 block">Parameter Missingness:</span>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(preview.missingness_pct).map(([param, pct]) => (
                  <div
                    key={param}
                    className="bg-slate-800/40 p-2 rounded border border-slate-700/40 flex justify-between"
                  >
                    <span className="text-slate-400 text-[10px]">{param}</span>
                    <span className="font-mono font-bold text-slate-200">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-medium transition-colors"
          >
            CANCEL
          </button>

          <button
            onClick={() => handleRun('HISTORICAL_ANALYSIS')}
            disabled={!preview || isSubmitting}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold rounded shadow transition-colors disabled:opacity-50"
          >
            RUN HISTORICAL ANALYSIS
          </button>

          <button
            onClick={() => handleRun('HISTORICAL_REPLAY')}
            disabled={!preview || isSubmitting}
            className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded shadow transition-colors disabled:opacity-50"
          >
            RUN HISTORICAL REPLAY
          </button>
        </div>
      </div>
    </div>
  );
};
