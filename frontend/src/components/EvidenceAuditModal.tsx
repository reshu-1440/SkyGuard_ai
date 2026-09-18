import React from 'react';
import { ShieldCheck, FileText, CheckCircle2, Award, X, Cpu } from 'lucide-react';

interface EvidenceAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EvidenceAuditModal: React.FC<EvidenceAuditModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-surface-1 border border-border rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border bg-surface-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold tracking-wider uppercase font-mono text-slate-100">
              SkyGuard AI — Evidence, Provenance & Scientific Audit
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-3 rounded text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Executive Provenance Banner */}
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded p-3 flex items-start gap-3">
            <Award className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-emerald-200 font-mono">
                Authoritative Reproducibility Guarantee
              </div>
              <p className="text-slate-300 mt-1 leading-relaxed">
                All benchmark claims, anomaly detection evaluations, and performance metrics in SkyGuard AI
                originate from frozen artifacts, deterministic test suites, and verified live API runs.
                No fabricated metrics or unverified assertions are used.
              </p>
            </div>
          </div>

          {/* Frozen Evaluation Claims Table */}
          <div>
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-ops-weather" />
              Verified Performance Claims & Evidence
            </h3>
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-left font-mono">
                <thead className="bg-surface-2 text-slate-400 border-b border-border text-[10px] uppercase">
                  <tr>
                    <th className="p-2">Claim / Metric</th>
                    <th className="p-2">Value</th>
                    <th className="p-2">Evidence Type</th>
                    <th className="p-2">Authoritative Source</th>
                    <th className="p-2">Scope / Limitation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle bg-surface-1">
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Hybrid Pipeline F1 (Observation)</td>
                    <td className="p-2 text-emerald-400 font-bold">0.963</td>
                    <td className="p-2 text-slate-400 text-[10px]">BENCHMARK</td>
                    <td className="p-2 text-slate-300 text-[10px]">FINAL_EVALUATION_REPORT.md §8 (Table 8 Aggregate)</td>
                    <td className="p-2 text-slate-400 text-[10px]">Synthetic + scenario dataset; 8 Indian AWS stations</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Network-Aggregate Precision</td>
                    <td className="p-2 text-emerald-400 font-bold">0.952</td>
                    <td className="p-2 text-slate-400 text-[10px]">BENCHMARK</td>
                    <td className="p-2 text-slate-300 text-[10px]">FINAL_EVALUATION_REPORT.md §8 (Table 8 Aggregate)</td>
                    <td className="p-2 text-slate-400 text-[10px]">Synthetic + scenario dataset; all anomaly classes</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Network-Aggregate Recall</td>
                    <td className="p-2 text-emerald-400 font-bold">0.974</td>
                    <td className="p-2 text-slate-400 text-[10px]">BENCHMARK</td>
                    <td className="p-2 text-slate-300 text-[10px]">FINAL_EVALUATION_REPORT.md §8 (Table 8 Aggregate)</td>
                    <td className="p-2 text-slate-400 text-[10px]">Synthetic + scenario dataset; all anomaly classes</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Regional Event Protection Rate</td>
                    <td className="p-2 text-emerald-400 font-bold">100%</td>
                    <td className="p-2 text-slate-400 text-[10px]">BENCHMARK</td>
                    <td className="p-2 text-slate-300 text-[10px]">final_results.json → hybrid_decision_engine.summary</td>
                    <td className="p-2 text-slate-400 text-[10px]">Scenario-based; regional squalls and heatwaves only</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Clean-Period False Positive Rate</td>
                    <td className="p-2 text-emerald-400 font-bold">0.00%</td>
                    <td className="p-2 text-slate-400 text-[10px]">BENCHMARK</td>
                    <td className="p-2 text-slate-300 text-[10px]">FINAL_EVALUATION_REPORT.md §5 (Baselines Table)</td>
                    <td className="p-2 text-slate-400 text-[10px]">Clean nominal weather test partition; 8 stations</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Live Open-Meteo Ingestion</td>
                    <td className="p-2 text-emerald-400 font-bold">100% Pass</td>
                    <td className="p-2 text-slate-400 text-[10px]">LIVE VALIDATION</td>
                    <td className="p-2 text-slate-300 text-[10px]">docs/LIVE_VALIDATION_REPORT.md</td>
                    <td className="p-2 text-slate-400 text-[10px]">Controlled live polling cycles; not direct IMD AWS</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Automated Test Suite</td>
                    <td className="p-2 text-emerald-400 font-bold">339 Passed</td>
                    <td className="p-2 text-slate-400 text-[10px]">ENGINEERING TEST</td>
                    <td className="p-2 text-slate-300 text-[10px]">pytest tests/ (unit + integration + performance)</td>
                    <td className="p-2 text-slate-400 text-[10px]">Local CI environment; 337 unit+integration, 2 performance</td>
                  </tr>
                  <tr>
                    <td className="p-2 text-slate-200 font-semibold">Pipeline P95 Latency</td>
                    <td className="p-2 text-emerald-400 font-bold">3.42 ms</td>
                    <td className="p-2 text-slate-400 text-[10px]">LOCAL PERFORMANCE</td>
                    <td className="p-2 text-slate-300 text-[10px]">FINAL_EVALUATION_REPORT.md §17 (Pipeline Profiler)</td>
                    <td className="p-2 text-slate-400 text-[10px]">Single-node local execution; not deployed cloud infra</td>
                  </tr>
                </tbody>
              </table>

            </div>
          </div>

          {/* Model & System Architecture Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-border rounded p-3 bg-surface-2">
              <div className="font-mono font-semibold text-slate-200 flex items-center gap-1.5 mb-1.5">
                <Cpu className="w-3.5 h-3.5 text-ops-weather" />
                Active Model Topology
              </div>
              <ul className="space-y-1 text-slate-300 font-mono text-[11px]">
                <li><span className="text-slate-400">Architecture:</span> Hybrid Statistical + TreeSHAP</li>
                <li><span className="text-slate-400">Model Registry:</span> models/registry/v0.1.0_baseline</li>
                <li><span className="text-slate-400">Spatial Topology:</span> Geodesic Haversine + Lapse Rate</li>
                <li><span className="text-slate-400">Deterministic Seed:</span> 42</li>
              </ul>
            </div>

            <div className="border border-border rounded p-3 bg-surface-2">
              <div className="font-mono font-semibold text-slate-200 flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Data Integrity Invariants
              </div>
              <ul className="space-y-1 text-slate-300 text-[11px]">
                <li>• Raw observations are immutable and strictly preserved.</li>
                <li>• Recommended corrections stored as separate advisory overlays.</li>
                <li>• Source outages decoupled from sensor hardware health.</li>
                <li>• 85% spatial consensus required for genuine regional storms.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border bg-surface-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
          <span>SkyGuard Phase 13B Verified Benchmark</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-surface-3 hover:bg-slate-700 text-slate-100 rounded border border-border-subtle transition-colors"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
};
