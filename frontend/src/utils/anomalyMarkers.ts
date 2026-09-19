/**
 * Anomaly Marker contracts, parameter association, semantic colors,
 * and deterministic timestamp matching for SkyGuard AI telemetry graphs.
 */

import { AnomalyEventRecord } from '../types/api';

export type MeteorologicalParameter = 'temperature' | 'humidity' | 'pressure';

export interface AnomalyMarkerInfo {
  eventId: string;
  stationId: string;
  timestamp: string;
  parameter: MeteorologicalParameter;
  observedValue: number | null;
  decision: string;
  severity: string;
  explanationSummary?: string;
}

/**
 * Maps decision types to restrained semantic operational colors.
 * - PROBABLE_SENSOR_ANOMALY -> Red (#EF4444)
 * - PROBABLE_DATA_QUALITY_ISSUE -> Amber/Orange-Red (#F97316)
 * - UNCERTAIN -> Amber (#F59E0B)
 * - POSSIBLE_GENUINE_EVENT -> Cyan/Blue (#06B6D4)
 * - NORMAL / Default -> Line theme (#38BDF8)
 */
export function getAnomalyColor(decision: string): string {
  const norm = (decision || '').toUpperCase();
  if (norm.includes('SENSOR_ANOMALY')) {
    return '#EF4444'; // Red
  }
  if (norm.includes('DATA_QUALITY')) {
    return '#F97316'; // Amber/Orange-Red
  }
  if (norm.includes('UNCERTAIN')) {
    return '#F59E0B'; // Amber
  }
  if (norm.includes('GENUINE_EVENT')) {
    return '#06B6D4'; // Cyan
  }
  return '#EF4444'; // Fallback for anomalous marker
}

/**
 * Normalizes ISO or epoch timestamps to standard epoch seconds
 * to ensure robust matching immune to microsecond or timezone string differences.
 */
export function normalizeTimestampToSeconds(ts: string | number | Date | null | undefined): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  const ms = d.getTime();
  if (isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Determines whether a detected anomaly event is associated with a specific meteorological variable.
 * Inspects reason codes, observed values physical violations, recommended values,
 * and natural language explanation summaries / SHAP features.
 */
export function isAnomalyAssociatedWithParameter(
  event: AnomalyEventRecord,
  parameter: MeteorologicalParameter
): boolean {
  if (!event) return false;

  const reasons = (event.reason_codes || []).map((r) => String(r).toUpperCase());
  const summary = (event.explanation_summary || '').toLowerCase();
  const obsVals = event.observed_values || {};
  const recVals = event.recommended_values || {};

  // 1. Physical boundary violations
  if (reasons.some((r) => r.includes('PHYSICAL') || r.includes('OUT_OF_RANGE'))) {
    if (parameter === 'temperature') {
      const t = obsVals.temperature_c ?? obsVals.temperature;
      if (t !== null && t !== undefined && (t < -50 || t > 60)) return true;
    }
    if (parameter === 'humidity') {
      const rh = obsVals.relative_humidity_pct ?? obsVals.humidity;
      if (rh !== null && rh !== undefined && (rh < 0 || rh > 100)) return true;
    }
    if (parameter === 'pressure') {
      const p = obsVals.sea_level_pressure_hpa ?? obsVals.pressure;
      if (p !== null && p !== undefined && (p < 850 || p > 1090)) return true;
    }
  }

  // 2. Multivariate inconsistencies impact temperature and humidity
  if (reasons.some((r) => r.includes('MULTIVARIATE'))) {
    if (parameter === 'temperature' || parameter === 'humidity') return true;
  }

  // 3. Check recommended values presence
  if (parameter === 'temperature' && (recVals.temperature_c !== undefined || recVals.temperature !== undefined)) {
    if (recVals.temperature_c !== null || recVals.temperature !== null) return true;
  }
  if (parameter === 'humidity' && (recVals.relative_humidity_pct !== undefined || recVals.humidity !== undefined)) {
    if (recVals.relative_humidity_pct !== null || recVals.humidity !== null) return true;
  }
  if (parameter === 'pressure' && (recVals.sea_level_pressure_hpa !== undefined || recVals.pressure !== undefined)) {
    if (recVals.sea_level_pressure_hpa !== null || recVals.pressure !== null) return true;
  }

  // 4. Check explicit reason code keywords
  if (parameter === 'temperature') {
    if (reasons.some((r) => r.includes('TEMP') || r.includes('RATE_OF_CHANGE') || r.includes('PERSISTENT') || r.includes('FLATLINE') || r.includes('SPIKE'))) {
      return true;
    }
  }
  if (parameter === 'humidity') {
    if (reasons.some((r) => r.includes('HUMID') || r.includes('RH'))) {
      return true;
    }
  }
  if (parameter === 'pressure') {
    if (reasons.some((r) => r.includes('PRESS') || r.includes('BARO') || r.includes('SLP'))) {
      return true;
    }
  }

  // 5. Check explanation summary / SHAP attributions
  if (parameter === 'temperature') {
    if (
      summary.includes('temperature') ||
      summary.includes('temp_rate') ||
      summary.includes('°c') ||
      summary.includes('thermal') ||
      summary.includes('cooling') ||
      summary.includes('warming')
    ) {
      return true;
    }
  }
  if (parameter === 'humidity') {
    if (
      summary.includes('humidity') ||
      summary.includes('relative_humidity') ||
      summary.includes('moisture') ||
      summary.includes('rh')
    ) {
      return true;
    }
  }
  if (parameter === 'pressure') {
    if (
      summary.includes('pressure') ||
      summary.includes('sea_level_pressure') ||
      summary.includes('barometric') ||
      summary.includes('hpa') ||
      summary.includes('barometer')
    ) {
      return true;
    }
  }

  // 6. Fallback: If anomaly is a general spatial isolation or ML anomaly without specific variable mentions,
  // Temperature is the primary thermodynamic state variable analyzed in SkyGuard AI
  const hasOtherSpecificMention =
    summary.includes('humidity') ||
    summary.includes('relative_humidity') ||
    summary.includes('pressure') ||
    summary.includes('sea_level_pressure');

  if (parameter === 'temperature' && !hasOtherSpecificMention) {
    return true;
  }

  return false;
}

/**
 * Extracts observed value for specific parameter from anomaly event or observation fallback.
 */
export function extractObservedValue(
  event: AnomalyEventRecord,
  parameter: MeteorologicalParameter,
  fallbackValue?: number | null
): number | null {
  const obs = event.observed_values || {};
  if (parameter === 'temperature') {
    const val = obs.temperature_c ?? obs.temperature ?? obs.temp;
    if (val !== null && val !== undefined) return Number(val);
  } else if (parameter === 'humidity') {
    const val = obs.relative_humidity_pct ?? obs.humidity ?? obs.rh;
    if (val !== null && val !== undefined) return Number(val);
  } else if (parameter === 'pressure') {
    const val = obs.sea_level_pressure_hpa ?? obs.pressure ?? obs.slp;
    if (val !== null && val !== undefined) return Number(val);
  }
  return fallbackValue !== undefined ? fallbackValue : null;
}

/**
 * Builds a fast O(1) lookup map of epoch seconds to AnomalyMarkerInfo
 * ensuring strict isolation to target station and target meteorological variable.
 */
export function buildAnomalyMarkerMap(
  anomalies: AnomalyEventRecord[] | undefined,
  stationId: string,
  parameter: MeteorologicalParameter
): Map<number, AnomalyMarkerInfo> {
  const map = new Map<number, AnomalyMarkerInfo>();
  if (!anomalies || anomalies.length === 0) return map;

  for (const anom of anomalies) {
    // 1. Strict station isolation
    if (stationId && anom.station_id !== stationId) {
      continue;
    }

    // 2. Strict parameter isolation
    if (!isAnomalyAssociatedWithParameter(anom, parameter)) {
      continue;
    }

    // 3. Exact observation timestamp matching
    const epochSec = normalizeTimestampToSeconds(anom.timestamp);
    if (epochSec === null) continue;

    const observedValue = extractObservedValue(anom, parameter);

    map.set(epochSec, {
      eventId: anom.event_id,
      stationId: anom.station_id,
      timestamp: anom.timestamp,
      parameter,
      observedValue,
      decision: anom.decision,
      severity: anom.severity,
      explanationSummary: anom.explanation_summary,
    });
  }

  return map;
}
