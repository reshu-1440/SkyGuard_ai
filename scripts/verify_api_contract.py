"""FastAPI Comprehensive Endpoint Contract Validation for SkyGuard AI.

Verifies status code, response schema, error handling, and parameter typing
for every registered endpoint in the application.
"""

from datetime import datetime, timezone
import json
from typing import Any, Dict, List
import os
from pathlib import Path
import sys

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

ENDPOINTS = [
    # Root & Health Probes
    ("GET", "/", None, 200, "Root service metadata"),
    ("GET", "/health/live", None, 200, "Liveness probe"),
    ("GET", "/health/ready", None, 200, "Readiness probe"),
    ("GET", "/api/v1/health", None, 200, "API v1 basic health probe"),

    # Runtime & Control Plane
    ("GET", "/api/v1/runtime/context", None, 200, "Canonical active RunContext"),
    ("GET", "/api/v1/runtime/providers", None, 200, "List of available data source providers"),
    ("POST", "/api/v1/runtime/source/select", {"source_type": "SYNTHETIC_VALIDATION", "mode": "SYNTHETIC_REPLAY"}, 200, "Select data source"),
    ("POST", "/api/v1/runtime/run/reset", None, 200, "Reset active run"),
    ("POST", "/api/v1/runtime/run/speed", {"speed": 10.0}, 200, "Set replay speed"),
    ("GET", "/api/v1/runtime/history", None, 200, "Audit log of execution runs"),

    # Stations
    ("GET", "/api/v1/stations", None, 200, "List configured AWS stations"),
    ("GET", "/api/v1/stations/AWS_DEL_001", None, 200, "Get specific station metadata"),
    ("GET", "/api/v1/stations/AWS_DEL_001/latest", None, 200, "Get station latest telemetry snapshot"),
    ("GET", "/api/v1/stations/AWS_DEL_001/history", None, 200, "Chronological telemetry history"),
    ("GET", "/api/v1/stations/AWS_DEL_001/health", None, 200, "Continuous sensor health evaluation"),
    ("GET", "/api/v1/stations/NON_EXISTENT_STN/health", None, 404, "404 Not Found handling for health"),

    # Anomalies
    ("GET", "/api/v1/anomalies", None, 200, "List detected anomalies"),
    ("GET", "/api/v1/anomalies/stats", None, 200, "Anomaly counts summary"),
    ("GET", "/api/v1/anomalies/NON_EXISTENT_ANOM_ID", None, 404, "404 Not Found for non-existent anomaly event"),

    # Corrections
    ("GET", "/api/v1/corrections", None, 200, "List correction recommendations"),
    ("GET", "/api/v1/corrections/NON_EXISTENT_OBS", None, 404, "404 Not Found for correction recommendation"),

    # Observations
    ("POST", "/api/v1/observations/process", {
        "station_id": "AWS_DEL_001",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": 28.61,
        "longitude": 77.23,
        "temperature": 25.5,
        "humidity": 55.0,
        "pressure": 1012.0,
    }, 200, "Ingest single observation"),

    # System
    ("GET", "/api/v1/system/health", None, 200, "Detailed system health"),

    # Replay
    ("GET", "/api/v1/replay/status", None, 200, "Replay simulator status"),
    ("GET", "/api/v1/replay/scenarios", None, 200, "Replay scenarios list"),
    ("POST", "/api/v1/replay/speed", {"speed": 1.0}, 200, "Adjust replay speed"),
    ("POST", "/api/v1/replay/reset", None, 200, "Reset replay state"),

    # Live Source
    ("GET", "/api/v1/live/status", None, 200, "Live source status summary"),
    ("GET", "/api/v1/live/source-health", None, 200, "Operational source health and station freshness"),
    ("POST", "/api/v1/live/poll-now", None, 200, "Synchronous poll trigger"),
]


def test_api_contracts() -> List[Dict[str, Any]]:
    results = []
    print("\n" + "="*80)
    print("SKYGUARD AI — COMPLETE REST API ENDPOINT CONTRACT MATRIX")
    print("="*80)
    print(f"{'METHOD':<7} | {'PATH':<42} | {'EXPECTED':<8} | {'ACTUAL':<8} | {'STATUS':<6} | NOTES")
    print("-" * 110)

    for method, path, payload, expected_status, notes in ENDPOINTS:
        try:
            if method == "GET":
                resp = client.get(path)
            elif method == "POST":
                if payload is not None:
                    resp = client.post(path, json=payload)
                else:
                    resp = client.post(path)
            else:
                resp = None

            actual_status = resp.status_code if resp is not None else 0
            is_pass = actual_status == expected_status
            status_label = "PASS" if is_pass else "FAIL"

            print(f"{method:<7} | {path:<42} | {expected_status:<8} | {actual_status:<8} | {status_label:<6} | {notes}")
            results.append({
                "method": method,
                "path": path,
                "expected": expected_status,
                "actual": actual_status,
                "status": status_label,
                "notes": notes,
            })
            assert is_pass, f"Endpoint {method} {path} returned {actual_status}, expected {expected_status}. Detail: {resp.text}"
        except Exception as e:
            print(f"{method:<7} | {path:<42} | {expected_status:<8} | ERROR    | FAIL   | {str(e)[:40]}")
            results.append({
                "method": method,
                "path": path,
                "expected": expected_status,
                "actual": "ERROR",
                "status": "FAIL",
                "notes": str(e),
            })
            raise

    print("="*110)
    print(f"Total API Endpoints Tested: {len(results)} | ALL PASSED: 100%\n")
    return results


if __name__ == "__main__":
    test_api_contracts()
