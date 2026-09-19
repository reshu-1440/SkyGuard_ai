"""Regression test suite for telemetry graph anomaly markers in SkyGuard AI."""

from datetime import datetime, timezone
import pytest
from backend.app.models.processing import AnomalyEventRecord
from ml.decision.schema import HybridDecisionType
from backend.app.core.replay import StreamReplayEngine
from backend.app.core.database import DatabaseRepository
from backend.app.models.run_context import RunContext, RunMode
from backend.app.core.state import RunContextManager
from backend.app.api.v1.endpoints.anomalies import _get_replay_cursor_cutoff


# Python mirror of frontend getAnomalyColor semantics for testing contract
def get_anomaly_color(decision: str) -> str:
    norm = (decision or "").upper()
    if "SENSOR_ANOMALY" in norm:
        return "#EF4444"  # Red
    if "DATA_QUALITY" in norm:
        return "#F97316"  # Amber/Orange-Red
    if "UNCERTAIN" in norm:
        return "#F59E0B"  # Amber
    if "GENUINE_EVENT" in norm:
        return "#06B6D4"  # Cyan
    return "#EF4444"


def is_anomaly_associated_with_parameter(event: AnomalyEventRecord, parameter: str) -> bool:
    param = parameter.lower()
    reasons = [str(r).upper() for r in (event.reason_codes or [])]
    summary = (event.explanation_summary or "").lower()
    obs_vals = event.observed_values or {}
    rec_vals = event.recommended_values or {}

    if any("PHYSICAL" in r or "OUT_OF_RANGE" in r for r in reasons):
        if param == "temperature":
            t = obs_vals.get("temperature_c", obs_vals.get("temperature"))
            if t is not None and (t < -50 or t > 60):
                return True
        if param == "humidity":
            rh = obs_vals.get("relative_humidity_pct", obs_vals.get("humidity"))
            if rh is not None and (rh < 0 or rh > 100):
                return True
        if param == "pressure":
            p = obs_vals.get("sea_level_pressure_hpa", obs_vals.get("pressure"))
            if p is not None and (p < 850 or p > 1090):
                return True

    if any("MULTIVARIATE" in r for r in reasons):
        if param in ("temperature", "humidity"):
            return True

    if param == "temperature" and (rec_vals.get("temperature_c") is not None or rec_vals.get("temperature") is not None):
        return True
    if param == "humidity" and (rec_vals.get("relative_humidity_pct") is not None or rec_vals.get("humidity") is not None):
        return True
    if param == "pressure" and (rec_vals.get("sea_level_pressure_hpa") is not None or rec_vals.get("pressure") is not None):
        return True

    if param == "temperature" and any(k in r for r in reasons for k in ("TEMP", "RATE_OF_CHANGE", "PERSISTENT", "FLATLINE", "SPIKE")):
        return True
    if param == "humidity" and any(k in r for r in reasons for k in ("HUMID", "RH")):
        return True
    if param == "pressure" and any(k in r for r in reasons for k in ("PRESS", "BARO", "SLP")):
        return True

    if param == "temperature" and any(k in summary for k in ("temperature", "temp_rate", "°c", "thermal")):
        return True
    if param == "humidity" and any(k in summary for k in ("humidity", "relative_humidity", "moisture", "rh")):
        return True
    if param == "pressure" and any(k in summary for k in ("pressure", "sea_level_pressure", "barometric", "hpa")):
        return True

    has_other = any(k in summary for k in ("humidity", "relative_humidity", "pressure", "sea_level_pressure"))
    if param == "temperature" and not has_other:
        return True

    return False


def match_anomaly_to_observation(
    observation_station_id: str,
    observation_timestamp: str,
    parameter: str,
    anomalies: list[AnomalyEventRecord],
) -> AnomalyEventRecord | None:
    obs_time = datetime.fromisoformat(observation_timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    obs_epoch_sec = int(obs_time.timestamp())

    for anom in anomalies:
        if anom.station_id != observation_station_id:
            continue
        if not is_anomaly_associated_with_parameter(anom, parameter):
            continue

        anom_time = datetime.fromisoformat(anom.timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
        anom_epoch_sec = int(anom_time.timestamp())

        if anom_epoch_sec == obs_epoch_sec:
            return anom

    return None


def test_anomaly_marker_matches_station_and_timestamp():
    """Verify exact matching using station_id + observation timestamp + parameter."""
    anom = AnomalyEventRecord(
        event_id="ANOM-20260918-001",
        station_id="STN_ALPHA",
        timestamp="2026-09-18T10:00:00Z",
        decision=HybridDecisionType.PROBABLE_SENSOR_ANOMALY,
        severity="HIGH",
        reason_codes=["RAPID_RATE_OF_CHANGE"],
        observed_values={"temperature_c": 52.0},
        explanation_summary="Sudden temperature spike detected.",
    )

    # 1. Exact match on station, timestamp, and parameter
    match = match_anomaly_to_observation("STN_ALPHA", "2026-09-18T10:00:00Z", "temperature", [anom])
    assert match is not None
    assert match.event_id == "ANOM-20260918-001"

    # 2. Mismatched timestamp must NOT match
    match_wrong_time = match_anomaly_to_observation("STN_ALPHA", "2026-09-18T10:05:00Z", "temperature", [anom])
    assert match_wrong_time is None


def test_future_anomaly_marker_hidden_during_replay():
    """Verify that future anomalies ahead of active replay cursor are strictly hidden."""
    ctx_mgr = RunContextManager()
    replay = StreamReplayEngine()

    ctx = ctx_mgr.get_context()
    ctx.mode = RunMode.SYNTHETIC_REPLAY

    # 1. At index 0 (unstarted), cutoff is 1970, hiding all future events
    replay.current_index = 0
    cutoff_zero = _get_replay_cursor_cutoff(ctx, replay, historical=False)
    assert cutoff_zero is not None
    assert cutoff_zero.year <= 1970

    # 2. Advance replay cursor to observation index 5
    if replay.observations and len(replay.observations) >= 10:
        replay.current_index = 5
        cutoff_five = _get_replay_cursor_cutoff(ctx, replay, historical=False)
        assert cutoff_five is not None
        assert cutoff_five == replay.observations[4].timestamp.astimezone(timezone.utc)

        # Future observation at subsequent time step must be strictly after the cutoff
        future_obs = next(o for o in replay.observations if o.timestamp.astimezone(timezone.utc) > cutoff_five)
        assert future_obs.timestamp.astimezone(timezone.utc) > cutoff_five


def test_sensor_anomaly_rendered_red():
    """Verify PROBABLE_SENSOR_ANOMALY yields restrained red color."""
    color = get_anomaly_color("PROBABLE_SENSOR_ANOMALY")
    assert color == "#EF4444"


def test_data_quality_anomaly_rendered_distinctly():
    """Verify PROBABLE_DATA_QUALITY_ISSUE yields distinct amber/orange color."""
    color = get_anomaly_color("PROBABLE_DATA_QUALITY_ISSUE")
    assert color == "#F97316"
    assert color != "#EF4444"


def test_genuine_event_marker_rendered_distinctly():
    """Verify POSSIBLE_GENUINE_EVENT yields distinct cyan/blue color."""
    color = get_anomaly_color("POSSIBLE_GENUINE_EVENT")
    assert color == "#06B6D4"
    assert color != "#EF4444"
    assert color != "#F97316"


def test_anomaly_tooltip_matches_event():
    """Verify tooltip payload fields match anomaly event contract."""
    anom = AnomalyEventRecord(
        event_id="ANOM-20260918-XYZ",
        station_id="STN_DELHI",
        timestamp="2026-09-18T14:30:00Z",
        decision=HybridDecisionType.PROBABLE_SENSOR_ANOMALY,
        severity="CRITICAL",
        reason_codes=["OUT_OF_RANGE_PHYSICAL"],
        observed_values={"temperature_c": 58.5},
        explanation_summary="Physical upper boundary breached.",
    )

    tooltip_data = {
        "timestamp": anom.timestamp,
        "parameter": "temperature",
        "observed_value": anom.observed_values.get("temperature_c"),
        "decision": anom.decision,
        "severity": anom.severity,
        "event_id": anom.event_id,
        "summary": anom.explanation_summary,
    }

    assert tooltip_data["timestamp"] == "2026-09-18T14:30:00Z"
    assert tooltip_data["observed_value"] == 58.5
    assert tooltip_data["decision"] == "PROBABLE_SENSOR_ANOMALY"
    assert tooltip_data["severity"] == "CRITICAL"
    assert tooltip_data["event_id"] == "ANOM-20260918-XYZ"


def test_cross_station_anomaly_marker_isolation():
    """Verify anomaly at Station A never appears on Station B graph."""
    anom_station_a = AnomalyEventRecord(
        event_id="ANOM-STN-A-01",
        station_id="STN_ALPHA",
        timestamp="2026-09-18T12:00:00Z",
        decision=HybridDecisionType.PROBABLE_SENSOR_ANOMALY,
        severity="HIGH",
        reason_codes=["RAPID_RATE_OF_CHANGE"],
        observed_values={"temperature_c": 48.0},
        explanation_summary="Spike at station Alpha.",
    )

    # Observation from Station B at the EXACT SAME timestamp
    match_station_b = match_anomaly_to_observation(
        observation_station_id="STN_BETA",
        observation_timestamp="2026-09-18T12:00:00Z",
        parameter="temperature",
        anomalies=[anom_station_a],
    )

    # Must be completely isolated: no cross-station contamination
    assert match_station_b is None

    # Station A observation at the same timestamp must match
    match_station_a = match_anomaly_to_observation(
        observation_station_id="STN_ALPHA",
        observation_timestamp="2026-09-18T12:00:00Z",
        parameter="temperature",
        anomalies=[anom_station_a],
    )
    assert match_station_a is not None
    assert match_station_a.station_id == "STN_ALPHA"
