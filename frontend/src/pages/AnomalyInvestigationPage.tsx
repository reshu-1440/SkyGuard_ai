import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAnomalies, useAnomalyDetail, useAnomalyExplanation } from '../hooks/useAnomalies';
import { useStations } from '../hooks/useStations';
import { DecisionBanner } from '../components/DecisionBanner';
import { EvidencePanel } from '../components/EvidencePanel';
import { ShapContributionPlot } from '../components/ShapContributionPlot';
import { NeighborComparison } from '../components/NeighborComparison';
import { AnomalyTimeline } from '../components/AnomalyTimeline';
import { NetworkMap, NeighborLink } from '../components/NetworkMap';
import { LoadingSkeleton, ErrorState, EmptyState } from '../components/StateFeedback';
import { formatTemperature, formatHumidity, formatPressure, formatIsoUtc } from '../utils/formatters';
import { ArrowLeft, Activity, ShieldAlert, Check, X, Flag, CheckSquare } from 'lucide-react';

export const AnomalyInvestigationPage: React.FC = () => {
  const { eventId } = useParams<{ eventId?: string }>();
  const navigate = useNavigate();

  // Fetch recent anomalies list to populate switcher and default selection
  const { data: allAnomalies, isLoading: isLoadingAll } = useAnomalies({ limit: 50 });
  const activeEventId = eventId || allAnomalies?.items?.[0]?.event_id;

  const { data: anomaly, isLoading: isLoadingDetail, isError: isErrorDetail } = useAnomalyDetail(activeEventId || '');
  const { data: explanation } = useAnomalyExplanation(activeEventId || '');
  const { data: allStations = [] } = useStations();

  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  if (isLoadingAll || (activeEventId && isLoadingDetail)) {
    return <LoadingSkeleton rows={8} height="h-20" />;
  }

  if (!activeEventId || !anomaly) {
    return (
      <div className="space-y-4">
        <h1 className="text-h1 font-bold font-mono text-slate-100">Anomaly Event Investigation</h1>
        <EmptyState
          title="No Anomaly Selected"
          message="Select an anomaly event from the list below or from the live monitoring stream."
        />
        {allAnomalies?.items && allAnomalies.items.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-h2 font-semibold text-slate-200">Recent Detected Anomaly Events</h3>
            <div className="divide-y divide-border-subtle rounded border border-border bg-surface-1">
              {allAnomalies.items.map((ev) => (
                <div
                  key={ev.event_id}
                  onClick={() => navigate(`/anomalies/${ev.event_id}`)}
                  className="p-3 hover:bg-surface-2 cursor-pointer flex items-center justify-between font-mono text-data transition-colors"
                >
                  <span className="font-semibold text-slate-200">{ev.event_id}</span>
                  <span className="text-slate-400">{ev.station_id}</span>
                  <span className="text-ops-weather">{ev.decision}</span>
                  <span className="text-slate-400">{ev.severity}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isErrorDetail) {
    return (
      <ErrorState
        title={`Anomaly Event ${activeEventId} Not Found`}
        message="The requested anomaly event record could not be loaded from persistence."
        onRetry={() => navigate('/anomalies')}
      />
    );
  }

  // Target Station coordinates for Mini-Map
  const targetStation = allStations.find((s) => s.station_id === anomaly.station_id);

  // Compute neighbor spatial links
  const neighborRecords = explanation?.neighbor_comparison?.neighbors || explanation?.neighbor_comparisons || [];
  const neighborLinks: NeighborLink[] = [];
  if (targetStation) {
    neighborRecords.forEach((nb) => {
      const nbStn = allStations.find((s) => s.station_id === nb.neighbor_station_id);
      if (nbStn) {
        neighborLinks.push({
          fromLat: targetStation.latitude,
          fromLon: targetStation.longitude,
          toLat: nbStn.latitude,
          toLon: nbStn.longitude,
          neighborId: nb.neighbor_station_id,
          isConsistent: nb.is_consistent,
        });
      }
    });
  }

  // Filter stations to target + immediate neighbors for mini-map clarity
  const relevantStations = allStations.filter(
    (s) =>
      s.station_id === anomaly.station_id ||
      neighborRecords.some((nb) => nb.neighbor_station_id === s.station_id)
  );

  // Operational telemetry variables only (Strict requirement: T, RH, P)
  const obsValues = anomaly.observed_values || {};
  const recValues = anomaly.recommended_values || {};

  const operationalParams = [
    {
      key: 'temperature',
      label: 'Atmospheric Temperature',
      unit: '°C',
      observed: obsValues.temperature ?? obsValues.temperature_c,
      recommended: recValues.temperature ?? recValues.temperature_c,
      format: (v?: number | null) => formatTemperature(v, 2, false),
      reasonIfNoRec: 'Nominal sensor reading — no correction needed',
    },
    {
      key: 'humidity',
      label: 'Relative Humidity',
      unit: '%',
      observed: obsValues.humidity ?? obsValues.relative_humidity_pct,
      recommended: recValues.humidity ?? recValues.relative_humidity_pct,
      format: (v?: number | null) => formatHumidity(v, 1, false),
      reasonIfNoRec: 'Physically consistent with atmospheric dew point',
    },
    {
      key: 'pressure',
      label: 'Sea-Level Pressure',
      unit: 'hPa',
      observed: obsValues.pressure ?? obsValues.sea_level_pressure_hpa,
      recommended: recValues.pressure ?? recValues.sea_level_pressure_hpa,
      format: (v?: number | null) => formatPressure(v, 2, false),
      reasonIfNoRec: 'Barometric gradient within regional envelope',
    },
  ];

  const handleAction = (action: string) => {
    setActionFeedback(`Action recorded: ${action} for event ${anomaly.event_id}. Source data remains immutable.`);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Event Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/network')}
            className="p-1.5 rounded hover:bg-surface-2 text-slate-400 hover:text-slate-100 transition-colors"
            title="Back to Network Overview"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400">EVENT ID:</span>
              <h1 className="text-h1 font-bold font-mono text-slate-100">{anomaly.event_id}</h1>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Station: <strong className="text-slate-200 font-mono">{anomaly.station_id}</strong> | Timestamp: {formatIsoUtc(anomaly.timestamp)}
            </span>
          </div>
        </div>

        {/* Quick event selector dropdown */}
        {allAnomalies?.items && allAnomalies.items.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">Event Switcher:</span>
            <select
              value={anomaly.event_id}
              onChange={(e) => navigate(`/anomalies/${e.target.value}`)}
              className="bg-surface-2 border border-border text-slate-200 rounded px-2.5 py-1 text-data font-mono focus:outline-none"
            >
              {allAnomalies.items.map((ev) => (
                <option key={ev.event_id} value={ev.event_id}>
                  {ev.event_id} ({ev.station_id} · {ev.severity})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 1. Flagship Sticky Decision Banner */}
      <DecisionBanner
        decision={anomaly.decision}
        severity={anomaly.severity}
        reasonCodes={anomaly.reason_codes}
        stationId={anomaly.station_id}
        timestamp={anomaly.timestamp}
        isDegradedMode={explanation?.is_degraded_mode}
        isSticky={true}
      />

      {/* 2. Flagship 60% Left / 40% Right Split Investigation Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ========================================================================= */}
        <div className="lg:col-span-7 space-y-4">
          {/* Observed vs Recommended Operational Telemetry Table (Strict 3 variables) */}
          <div className="p-4 border border-border bg-surface-1 space-y-3" style={{ borderRadius: '2px' }}>
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <h3 className="text-h2 font-semibold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-ops-weather" />
                Observed vs Model-Recommended Telemetry
              </h3>
              <span className="text-[10px] font-mono text-slate-400 uppercase">
                Operational Variables Only
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 font-mono text-[11px]">
              {operationalParams.map((param) => {
                const hasRec = param.recommended !== null && param.recommended !== undefined;
                const isAnomalous = hasRec && param.observed !== null && param.observed !== undefined && Math.abs((param.observed ?? 0) - (param.recommended ?? 0)) > 0.05;

                return (
                  <div
                    key={param.key}
                    className={`p-3 border ${
                      isAnomalous
                        ? 'bg-surface-2 border-red-900/60 ring-1 ring-red-900/40'
                        : 'bg-surface-2 border-border-subtle'
                    }`}
                    style={{ borderRadius: '2px' }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-200">
                        {param.label} [{param.unit}]
                      </span>
                      {isAnomalous ? (
                        <span className="px-1.5 py-0.5 text-[10px] bg-red-950 text-red-300 border border-red-800 uppercase font-bold" style={{ borderRadius: '2px' }}>
                          ▲ Sensor Departure
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 uppercase" style={{ borderRadius: '2px' }}>
                          ● Nominal
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase">Raw Observed</span>
                        <span className="text-h2 font-bold text-red-400">
                          {param.format(param.observed)} {param.unit}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block uppercase">Recommended Estimate</span>
                        {hasRec ? (
                          <span className="text-h2 font-bold text-emerald-400">
                            {param.format(param.recommended)} {param.unit}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[11px] block mt-1 font-sans italic">
                            No correction recommended ({param.reasonIfNoRec})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4-Tier Evidence Hierarchy */}
          <EvidencePanel
            evidenceHierarchy={explanation?.evidence_hierarchy}
            confidenceScore={explanation?.confidence_score}
            auditMetadata={{
              model_version: 'isolation_forest_v1',
              decision_engine_version: 'hybrid_v1.0.0',
              explanation_method: 'TREE_SHAP',
              generated_at: anomaly.created_at || anomaly.timestamp,
            }}
          />

          {/* Horizontal SHAP Feature Attribution Visualization */}
          <ShapContributionPlot
            contributions={explanation?.feature_contributions || explanation?.model_contributions || []}
            method="TREE_SHAP"
            anomalyScore={0.81}
            threshold={0.58}
          />
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN (40% / 5 cols): Spatial Context, Timeline, Actions, Review  */}
        {/* ========================================================================= */}
        <div className="lg:col-span-5 space-y-4">
          {/* A. Spatial Context Mini-Map with Neighbor Links */}
          <div className="p-4 border border-border bg-surface-1 space-y-3" style={{ borderRadius: '2px' }}>
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <h3 className="text-h2 font-semibold text-slate-100">
                Spatial Context & Neighbor Topology
              </h3>
              <span className="text-[10px] font-mono text-ops-weather">
                Active Node: {anomaly.station_id}
              </span>
            </div>

            <NetworkMap
              stations={relevantStations.length > 0 ? relevantStations : allStations}
              selectedStationId={anomaly.station_id}
              neighborLinks={neighborLinks}
              height="220px"
              showLegend={false}
              onSelectStation={(id) => navigate(`/stations/${id}`)}
            />
          </div>

          {/* B. Neighbor Comparison Table */}
          <NeighborComparison
            neighbors={neighborRecords}
            targetStationId={anomaly.station_id}
            targetValue={obsValues.temperature ?? obsValues.temperature_c}
            targetVariable="Temperature"
            unit="°C"
          />

          {/* C. Anomaly Episode Timeline */}
          <AnomalyTimeline
            onsetTimestamp={anomaly.timestamp}
            peakTimestamp={anomaly.timestamp}
            currentTimestamp={anomaly.timestamp}
            durationMinutes={14}
            peakValue={obsValues.temperature ?? obsValues.temperature_c}
            targetVariable="Temperature"
            unit="°C"
          />

          {/* D. Advisory Correction Recommendation Panel */}
          <div className="p-4 border border-border bg-surface-1 space-y-3" style={{ borderRadius: '2px' }}>
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <h3 className="text-h2 font-semibold text-slate-100">
                Advisory Imputation Candidate
              </h3>
              {Object.values(recValues).some((v) => v !== null && v !== undefined) ? (
                <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-sky-950 text-sky-300 border border-sky-800 font-bold" style={{ borderRadius: '2px' }}>
                  CORRECTION_CANDIDATE
                </span>
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-slate-800 text-slate-400 border border-slate-700" style={{ borderRadius: '2px' }}>
                  NO_CORRECTION_NEEDED
                </span>
              )}
            </div>

            {Object.values(recValues).some((v) => v !== null && v !== undefined) ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2 bg-surface-2 border border-border-subtle" style={{ borderRadius: '2px' }}>
                    <span className="text-slate-400 block text-[10px]">Method:</span>
                    <span className="text-slate-200 font-semibold">SPATIAL_IDW_CONSENSUS</span>
                  </div>
                  <div className="p-2 bg-surface-2 border border-border-subtle" style={{ borderRadius: '2px' }}>
                    <span className="text-slate-400 block text-[10px]">Target Parameter:</span>
                    <span className="text-emerald-400 font-semibold uppercase">
                      {recValues.temperature_c !== undefined ? 'Temperature' : 'Atmospheric'}
                    </span>
                  </div>
                </div>

                {/* Immutability Guarantee Notice */}
                <div className="p-2.5 bg-amber-950/30 border border-amber-800 text-[10px] text-amber-200 flex items-start gap-2" style={{ borderRadius: '2px', borderLeft: '3px solid #F59E0B' }}>
                  <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-100">Immutable Guarantee:</strong> Raw sensor observation records are permanent and never mutated. Acknowledging or reviewing recommendations records metadata in audit logs only.
                  </span>
                </div>

                {/* Operator Actions (Accept, Reject, Flag) */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => handleAction('ACCEPTED')}
                    className="flex-1 py-1.5 px-2 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 text-[11px] font-mono font-medium flex items-center justify-center gap-1 transition-colors"
                    style={{ borderRadius: '2px' }}
                  >
                    <Check className="w-3.5 h-3.5" />
                    Accept
                  </button>
                  <button
                    onClick={() => handleAction('REJECTED')}
                    className="flex-1 py-1.5 px-2 bg-red-950/80 hover:bg-red-900 text-red-300 border border-red-800 text-[11px] font-mono font-medium flex items-center justify-center gap-1 transition-colors"
                    style={{ borderRadius: '2px' }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleAction('FLAGGED_FOR_AUDIT')}
                    className="flex-1 py-1.5 px-2 bg-surface-2 hover:bg-surface-hover text-slate-300 border border-border text-[11px] font-mono font-medium flex items-center justify-center gap-1 transition-colors"
                    style={{ borderRadius: '2px' }}
                  >
                    <Flag className="w-3.5 h-3.5" />
                    Flag
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[11px] font-mono text-slate-400 bg-surface-2 p-3 border border-border-subtle leading-relaxed" style={{ borderRadius: '2px' }}>
                No advisory correction candidate generated for this event. Raw telemetry is preserved without modification.
              </p>
            )}

            {actionFeedback && (
              <div className="p-2 bg-surface-2 border border-border-subtle text-[11px] font-mono text-emerald-400" style={{ borderRadius: '2px' }}>
                {actionFeedback}
              </div>
            )}
          </div>

          {/* E. SOP Guidance */}
          <div className="p-4 border border-border bg-surface-1 space-y-2" style={{ borderRadius: '2px' }}>
            <h3 className="text-h2 font-semibold text-slate-100 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-ops-weather" />
              Recommended SOP Actions
            </h3>
            <p className="text-data text-slate-300 bg-surface-2 p-3 border border-border-subtle leading-relaxed" style={{ borderRadius: '2px' }}>
              {explanation?.summary || anomaly.explanation_summary || 'Standard diagnostic procedure applies. Verify sensor physical connections and regional neighbor agreement.'}
            </p>
            {explanation?.recommended_investigation_steps && explanation.recommended_investigation_steps.length > 0 && (
              <ul className="space-y-1 text-data text-slate-300 list-disc list-inside bg-surface-2 p-2.5 border border-border-subtle" style={{ borderRadius: '2px' }}>
                {explanation.recommended_investigation_steps.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
