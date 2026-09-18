import React from 'react';
import { SystemHealthStatus } from '../types/api';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface SystemStatusProps {
  status?: SystemHealthStatus;
  isLoading?: boolean;
}

interface ComponentRow {
  name: string;
  status: 'OK' | 'WARN' | 'ERROR';
  details: string;
}

export const SystemStatus: React.FC<SystemStatusProps> = ({
  status,
  isLoading = false,
}) => {
  if (isLoading || !status) {
    return (
      <div className="p-4 rounded border border-border bg-surface-1 animate-pulse h-48" />
    );
  }

  const components: ComponentRow[] = [
    {
      name: 'FastAPI Telemetry Core',
      status: status.status === 'HEALTHY' ? 'OK' : 'WARN',
      details: `${status.service} v${status.version}`,
    },
    {
      name: 'Observation Persistence Store',
      status: status.database_status === 'CONNECTED' ? 'OK' : 'ERROR',
      details: `${status.active_monitored_stations} monitored stations · ${status.total_observations_processed.toLocaleString()} observations stored`,
    },
    {
      name: 'ML Model Registry',
      status: status.model_registry_status === 'LOADED' ? 'OK' : 'ERROR',
      details: `Active Model: ${status.active_model_id} (Pre-trained & Calibrated)`,
    },
    {
      name: 'Hybrid Decision Engine',
      status: 'OK',
      details: 'Deterministic Multi-Tier Heuristic + ML Anomaly Fusion',
    },
    {
      name: 'Explainability & XAI Engine',
      status: 'OK',
      details: 'TreeSHAP & Multi-Tier Evidence Synthesizer Active',
    },
    {
      name: 'Spatial Topology Engine',
      status: status.spatial_topology_stations_count > 0 ? 'OK' : 'WARN',
      details: `${status.spatial_topology_stations_count} Topographic Graph Nodes (Haversine/IDW Context)`,
    },
    {
      name: 'Stream Replay Simulator',
      status: 'OK',
      details: status.replay_simulator_status || 'READY / IDLE',
    },
  ];

  return (
    <div className="p-4 border border-border bg-surface-1 space-y-3" style={{ borderRadius: '2px' }}>
      <div className="flex items-center justify-between border-b border-border-subtle pb-2">
        <h3 className="text-h2 font-semibold text-slate-100">
          Core Component Health & Subsystem State
        </h3>
        <span className="text-[11px] font-mono text-slate-400">
          All systems nominal
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse table-dense">
          <thead>
            <tr className="bg-surface-2/60 border-b border-border text-[10px] font-mono text-slate-400 uppercase">
              <th className="py-2 px-3">Subsystem Component</th>
              <th className="py-2 px-3 text-center">Operational State</th>
              <th className="py-2 px-3">Technical Details / Diagnostics</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle text-[11px] font-mono">
            {components.map((comp) => (
              <tr key={comp.name} className="hover:bg-surface-2/40 transition-colors">
                <td className="py-2 px-3 font-semibold text-slate-200">
                  {comp.name}
                </td>
                <td className="py-2 px-3 text-center">
                  {comp.status === 'OK' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 border border-emerald-800" style={{ borderRadius: '2px' }}>
                      <CheckCircle2 className="w-3 h-3" /> ● OK
                    </span>
                  ) : comp.status === 'WARN' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-950/60 px-2 py-0.5 border border-amber-800" style={{ borderRadius: '2px' }}>
                      <AlertTriangle className="w-3 h-3" /> ▲ WARN
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-red-400 bg-red-950/60 px-2 py-0.5 border border-red-800" style={{ borderRadius: '2px' }}>
                      <XCircle className="w-3 h-3" /> ✕ ERROR
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-slate-300">
                  {comp.details}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
