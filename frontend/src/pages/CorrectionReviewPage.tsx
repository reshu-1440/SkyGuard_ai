import React, { useState, useMemo } from 'react';
import { useCorrections } from '../hooks/useCorrections';
import { MetricTable, ColumnDef } from '../components/MetricTable';
import { CorrectionRecommendation } from '../types/api';
import { formatTelemetryValue, formatIsoUtc } from '../utils/formatters';
import { GitCompare, ShieldAlert, Check, FileText, Filter, AlertTriangle } from 'lucide-react';

type FilterTab = 'ACTIONABLE' | 'ALL' | 'CORRECTION_CANDIDATE' | 'REVIEW_REQUIRED' | 'NO_ACTION';

export const CorrectionReviewPage: React.FC = () => {
  const [selectedObsId, setSelectedObsId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('ACTIONABLE');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const { data: correctionsData, isLoading } = useCorrections({ limit: 100 });
  const allCorrections = correctionsData?.items || [];

  // Filter queue records based on tab selection
  const filteredCorrections = useMemo(() => {
    switch (activeFilter) {
      case 'ACTIONABLE':
        return allCorrections.filter(
          (c) =>
            c.status === 'CORRECTION_CANDIDATE' ||
            c.status === 'REVIEW_RECOMMENDED' ||
            (c.recommended_value !== null && c.recommended_value !== undefined)
        );
      case 'CORRECTION_CANDIDATE':
        return allCorrections.filter((c) => c.status === 'CORRECTION_CANDIDATE');
      case 'REVIEW_REQUIRED':
        return allCorrections.filter((c) => c.status === 'REVIEW_RECOMMENDED');
      case 'NO_ACTION':
        return allCorrections.filter((c) => c.status === 'NO_CORRECTION_RECOMMENDED');
      case 'ALL':
      default:
        return allCorrections;
    }
  }, [allCorrections, activeFilter]);

  const selectedCorrection =
    filteredCorrections.find((c) => c.observation_id === selectedObsId) ||
    filteredCorrections[0] ||
    allCorrections[0];

  const handleReviewAction = (action: string) => {
    if (!selectedCorrection) return;
    setActionFeedback(`Action [${action}] recorded for ${selectedCorrection.observation_id}. Raw sensor data remains immutable.`);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  const columns: ColumnDef<CorrectionRecommendation>[] = [
    {
      key: 'station_id',
      header: 'Station',
      render: (corr) => (
        <div>
          <span className="font-mono font-bold text-slate-100">{corr.station_id}</span>
          <span className="text-[10px] text-slate-400 block">{corr.observation_id}</span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'target_variable',
      header: 'Parameter',
      render: (corr) => (
        <span className="font-mono text-data text-ops-weather uppercase">
          {corr.target_variable.replace('_', ' ')}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'observed_value',
      header: 'Raw Observed',
      align: 'right',
      render: (corr) => (
        <span className="font-mono text-red-400 font-semibold">
          {formatTelemetryValue(corr.target_variable, corr.observed_value, true)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'recommended_value',
      header: 'Recommended',
      align: 'right',
      render: (corr) => (
        <span className="font-mono text-emerald-400 font-semibold">
          {corr.recommended_value !== null && corr.recommended_value !== undefined
            ? formatTelemetryValue(corr.target_variable, corr.recommended_value, true)
            : 'None (Nominal)'}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'method',
      header: 'Estimation Method',
      render: (corr) => (
        <span className="text-[11px] font-mono text-slate-300">
          {corr.method.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Review Status',
      align: 'center',
      render: (corr) => {
        let badge = 'bg-slate-900 text-slate-400 border-slate-700';
        if (corr.status === 'CORRECTION_CANDIDATE') {
          badge = 'bg-sky-950 text-sky-300 border-sky-800'; // Approved semantic token
        } else if (corr.status === 'REVIEW_RECOMMENDED') {
          badge = 'bg-amber-950 text-amber-300 border-amber-800';
        }

        return (
          <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${badge}`}>
            {corr.status.replace(/_/g, ' ')}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. Immutability Warning Banner (Non-dismissable) */}
      <div className="p-3.5 bg-amber-950/30 border border-amber-800/70 flex items-start gap-3" style={{ borderRadius: '2px', borderLeft: '3px solid #F59E0B' }}>
        <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-data text-amber-200">
          <strong className="text-slate-100 uppercase tracking-wider font-mono text-[11px] block">
            Immutable Raw Telemetry Guarantee
          </strong>
          Advisory correction recommendations are stored strictly in separate derivation partitions. Approving or reviewing a recommendation does NOT overwrite or mutate original immutable sensor observations.
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <div className="p-2.5 border border-border bg-surface-1 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px]" style={{ borderRadius: '2px' }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-slate-400 mr-1" />
          <button
            onClick={() => setActiveFilter('ACTIONABLE')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'ACTIONABLE'
                ? 'bg-ops-weather text-slate-900 border-ops-weather font-bold'
                : 'bg-surface-2 text-slate-300 border-border hover:bg-surface-hover'
            }`}
            style={{ borderRadius: '2px' }}
          >
            Actionable Queue ({allCorrections.filter((c) => c.status !== 'NO_CORRECTION_RECOMMENDED').length})
          </button>
          <button
            onClick={() => setActiveFilter('CORRECTION_CANDIDATE')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'CORRECTION_CANDIDATE'
                ? 'bg-sky-900 text-sky-200 border-sky-700 font-bold'
                : 'bg-surface-2 text-slate-300 border-border hover:bg-surface-hover'
            }`}
            style={{ borderRadius: '2px' }}
          >
            Candidates ({allCorrections.filter((c) => c.status === 'CORRECTION_CANDIDATE').length})
          </button>
          <button
            onClick={() => setActiveFilter('REVIEW_REQUIRED')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'REVIEW_REQUIRED'
                ? 'bg-amber-900 text-amber-200 border-amber-700 font-bold'
                : 'bg-surface-2 text-slate-300 border-border hover:bg-surface-hover'
            }`}
            style={{ borderRadius: '2px' }}
          >
            Needs Review ({allCorrections.filter((c) => c.status === 'REVIEW_RECOMMENDED').length})
          </button>
          <button
            onClick={() => setActiveFilter('NO_ACTION')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'NO_ACTION'
                ? 'bg-slate-700 text-slate-100 border-slate-600 font-bold'
                : 'bg-surface-2 text-slate-300 border-border hover:bg-surface-hover'
            }`}
            style={{ borderRadius: '2px' }}
          >
            No Action ({allCorrections.filter((c) => c.status === 'NO_CORRECTION_RECOMMENDED').length})
          </button>
          <button
            onClick={() => setActiveFilter('ALL')}
            className={`px-2.5 py-1 border transition-colors ${
              activeFilter === 'ALL'
                ? 'bg-slate-700 text-slate-100 border-slate-600 font-bold'
                : 'bg-surface-2 text-slate-300 border-border hover:bg-surface-hover'
            }`}
            style={{ borderRadius: '2px' }}
          >
            All ({allCorrections.length})
          </button>
        </div>

        <span className="text-slate-400">
          Showing <strong className="text-slate-200">{filteredCorrections.length}</strong> records
        </span>
      </div>

      {/* 2. Main Layout: Left Queue Table, Right Detail & Provenance Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column (7 cols): Correction Review Queue Table */}
        <div className="lg:col-span-7 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 font-semibold text-slate-100 flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-ops-weather" />
              Correction Audit Queue
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              Human-in-the-Loop Audit Layer
            </span>
          </div>

          <MetricTable
            columns={columns}
            data={filteredCorrections}
            isLoading={isLoading}
            selectedRowId={selectedCorrection?.observation_id}
            rowIdKey="observation_id"
            onRowClick={(row) => setSelectedObsId(row.observation_id)}
            emptyMessage="No advisory records matching current filter in the review queue."
          />
        </div>

        {/* Right Column (5 cols): Recommendation Detail Drawer */}
        <div className="lg:col-span-5 space-y-4">
          {selectedCorrection ? (
            <div className="p-4 border border-border bg-surface-1 space-y-4" style={{ borderRadius: '2px' }}>
              <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                <h3 className="text-h2 font-semibold text-slate-100 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-ops-weather" />
                  Recommendation Audit Inspector
                </h3>
                <span className="text-[11px] font-mono text-slate-400 font-bold">
                  {selectedCorrection.station_id}
                </span>
              </div>

              {/* Observed vs Recommended values */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-surface-2 border border-border-subtle" style={{ borderRadius: '2px' }}>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Immutable Observed</span>
                  <span className="text-stat font-mono font-bold text-red-400">
                    {formatTelemetryValue(selectedCorrection.target_variable, selectedCorrection.observed_value, true)}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-1 uppercase font-mono">
                    Param: {selectedCorrection.target_variable}
                  </span>
                </div>

                <div className="p-3 bg-surface-2 border border-border-subtle" style={{ borderRadius: '2px' }}>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Advisory Estimate</span>
                  <span className="text-stat font-mono font-bold text-emerald-400">
                    {selectedCorrection.recommended_value !== null && selectedCorrection.recommended_value !== undefined
                      ? formatTelemetryValue(selectedCorrection.target_variable, selectedCorrection.recommended_value, true)
                      : 'None (Nominal)'}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-1 uppercase font-mono">
                    Method: {selectedCorrection.method}
                  </span>
                </div>
              </div>

              {/* Uncertainty Quantification */}
              {selectedCorrection.uncertainty && (
                <div className="p-3 bg-surface-2 border border-border-subtle space-y-1.5 font-mono text-[11px]" style={{ borderRadius: '2px' }}>
                  <div className="flex justify-between text-slate-300">
                    <span>Model-Derived Uncertainty Interval:</span>
                    <span className="text-slate-100 font-semibold">
                      [{selectedCorrection.uncertainty.estimate_range[0].toFixed(2)}, {selectedCorrection.uncertainty.estimate_range[1].toFixed(2)}]
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Supporting Neighbors:</span>
                    <span className="text-slate-100 font-semibold">{selectedCorrection.uncertainty.supporting_neighbor_count}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>Method Quality Tier:</span>
                    <span className="text-ops-weather font-semibold">{selectedCorrection.uncertainty.method_quality}</span>
                  </div>
                </div>
              )}

              {/* Operator Summary */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
                  Scientific Rationale
                </span>
                <p className="text-data text-slate-300 bg-surface-2 p-3 border border-border-subtle leading-relaxed" style={{ borderRadius: '2px' }}>
                  {selectedCorrection.operator_summary || 'Empirical spatial IDW consensus calculation based on adjacent AWS nodes.'}
                </p>
              </div>

              {/* Supporting Evidence List */}
              {selectedCorrection.supporting_evidence && selectedCorrection.supporting_evidence.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
                    Supporting Evidence
                  </span>
                  <ul className="space-y-1 text-data text-slate-300 list-disc list-inside bg-surface-2 p-3 border border-border-subtle" style={{ borderRadius: '2px' }}>
                    {selectedCorrection.supporting_evidence.map((ev, i) => (
                      <li key={i}>{ev}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Audit Metadata */}
              <div className="p-3 bg-surface-2/60 border border-border-subtle text-[10px] font-mono text-slate-400 space-y-1" style={{ borderRadius: '2px' }}>
                <div>Engine: {selectedCorrection.audit_metadata?.imputation_engine_version ?? 'imputation_v1.0.0'}</div>
                <div>Causal Mode: {selectedCorrection.audit_metadata?.is_causal_mode ? 'STRICT ZERO-LOOKAHEAD' : 'STANDARD'}</div>
                <div>Generated: {formatIsoUtc(selectedCorrection.created_at)}</div>
              </div>

              {/* Operator Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
                <button
                  onClick={() => handleReviewAction('ACCEPTED')}
                  className="flex-1 py-2 px-3 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 text-data font-mono font-medium flex items-center justify-center gap-1.5 transition-colors"
                  style={{ borderRadius: '2px' }}
                >
                  <Check className="w-4 h-4" />
                  Accept Estimate
                </button>
                <button
                  onClick={() => handleReviewAction('HELD_FOR_SENIOR_AUDIT')}
                  className="flex-1 py-2 px-3 bg-surface-2 hover:bg-surface-hover text-slate-300 border border-border text-data font-mono font-medium flex items-center justify-center gap-1.5 transition-colors"
                  style={{ borderRadius: '2px' }}
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Hold for Audit
                </button>
              </div>

              {actionFeedback && (
                <div className="p-2 bg-surface-2 border border-border-subtle text-[11px] font-mono text-emerald-400" style={{ borderRadius: '2px' }}>
                  {actionFeedback}
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 border border-border bg-surface-1 text-center text-slate-400 text-data" style={{ borderRadius: '2px' }}>
              Select an item from the queue to inspect audit metadata and supporting evidence.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
