import React, { useEffect, useState } from 'react';
import { fetchRunHistory } from '../../api/runtime';
import { RunHistoryItem } from '../../types/runtime';

interface RunHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RunHistoryModal: React.FC<RunHistoryModalProps> = ({ isOpen, onClose }) => {
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchRunHistory()
        .then((data) => setHistory(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>📜</span> Data Source Run Audit History
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Traceability record of all active and completed runs
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-xs text-slate-400 animate-pulse">
            Loading run history logs...
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">No previous runs recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px] uppercase font-mono">
                  <th className="py-2.5 px-3">Run ID</th>
                  <th className="py-2.5 px-3">Source</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3">Dataset</th>
                  <th className="py-2.5 px-3">Stations</th>
                  <th className="py-2.5 px-3">Observations</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {history.map((run, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 text-cyan-300 font-bold">{run.run_id}</td>
                    <td className="py-2.5 px-3 text-slate-200">{run.source_name}</td>
                    <td className="py-2.5 px-3 text-purple-300">{run.mode}</td>
                    <td className="py-2.5 px-3 text-slate-400">{run.dataset_id}</td>
                    <td className="py-2.5 px-3 text-slate-300">{run.station_count}</td>
                    <td className="py-2.5 px-3 text-slate-300">
                      {run.observation_count ? run.observation_count.toLocaleString() : 'N/A'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          run.status === 'RUNNING'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : run.status === 'COMPLETED'
                            ? 'bg-sky-950 text-sky-400 border border-sky-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-slate-800 pt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-medium transition-colors"
          >
            Close Audit Trail
          </button>
        </div>
      </div>
    </div>
  );
};
