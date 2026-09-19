# SkyGuard AI — Anomaly Count Semantics & Current-Run Scoping Architecture Report

**Document ID:** `DOC-QA-ANOM-20260919-01`  
**Status:** Completed & Verified  
**Author:** Antigravity AI Engineering Team  
**Scope:** Telemetry Pipeline, Storage Repository, REST API Contracts, and Frontend MOC Dashboard  

---

## 1. Executive Summary

During synthetic replay testing of SkyGuard AI, a critical semantic discrepancy was identified:
- When the replay stream progressed to `5750 / 5760` observations, the top-bar notification counter displayed **`9005 ANOMALIES`**, despite only a small fraction of current-run benchmark observations being synthetic anomaly injections.
- Concurrently, the station telemetry table displayed `24h Flags = 0`.

This report provides the full architectural trace, root cause explanation, disambiguation matrix, schema migration, and end-to-end verification proving the complete separation and precise scoping of:
1. **`CURRENT RUN ANOMALIES`**: strictly scoped to the active execution run (`run_id`), active source (`source_type`), and bounded by the replay stream cursor timestamp (`timestamp <= cutoff`).
2. **`ACTIVE ANOMALIES (24H)`**: operational anomaly flags occurring within the active 24-hour temporal window.
3. **`TOTAL PERSISTED ANOMALY RECORDS`**: total cumulative persisted anomaly rows stored across all historical test suites and benchmarking runs in the database.

---

## 2. Root Cause Analysis: Source of "9005 Anomalies"

### 2.1 The Investigation Trace

Tracing the data path from frontend to storage revealed the exact lifecycle:

| Layer | File / Location | Implementation Prior to Fix | Consequence |
|---|---|---|---|
| **Frontend UI** | [`frontend/src/layouts/TopBar.tsx`](file:///d:/Projects/sih_project/frontend/src/layouts/TopBar.tsx) | Queried `useAnomalies({ limit: 1 })` and displayed `pagination.total_count` with the generic label `"ANOMALIES"`. | Displayed the API's global total count as if it were the active replay alert counter. |
| **API Endpoint** | [`backend/app/api/v1/endpoints/anomalies.py`](file:///d:/Projects/sih_project/backend/app/api/v1/endpoints/anomalies.py) | `GET /api/v1/anomalies` filtered only on `timestamp <= cutoff`. | Because historical benchmark observations were dated 2026-09-17/18, all previously persisted records from automated test suites fell before the cutoff and were returned in the total count. |
| **Database Model** | [`backend/app/db/models.py`](file:///d:/Projects/sih_project/backend/app/db/models.py) | `AnomalyEventModel` only stored `event_id`, `station_id`, `timestamp`, `decision`, `severity`, etc. **No `run_id` or `source` columns existed.** | Impossible at the SQL layer to isolate anomalies created by run `A` versus run `B` or distinguish synthetic bench tests from live polling. |
| **Storage Engine** | `data/skyguard_dev.db` (SQLite) | Cumulative inserts over repeated automated test runs (`pytest`) accumulated **10,254 rows** in `anomaly_events`. | The database table contained thousands of orphaned test records that bled into the operational dashboard. |

### 2.2 Why Station Table Showed "24h Flags = 0"
In [`backend/app/core/database.py`](file:///d:/Projects/sih_project/backend/app/core/database.py) (`get_station_latest()`), `active_anomaly_count_24h` is computed from in-memory ring buffers (`self.anomaly_events`) matching each station within the active sliding 24-hour operational window. When no anomaly has been injected for a specific station within that simulated 24h window, the count is legitimately `0`.
The contradiction arose solely because the TopBar was displaying global cumulative persisted records from the database table rather than current-run anomalies.

---

## 3. Disambiguation Matrix

To prevent cognitive ambiguity across operator dashboards, SkyGuard AI establishes strict definitions for every numerical metric:

```
+-----------------------------------------------------------------------------------------------+
|                                      DATA METRIC ONTOLOGY                                     |
+-----------------------------------+-----------------------------------------------------------+
| Metric Concept                    | Operational Meaning & Scope                               |
+-----------------------------------+-----------------------------------------------------------+
| 1. DATASET SIZE                   | Total observations loaded in simulator benchmark file     |
|                                   | (e.g., 5,760 observations across 20 AWS stations)         |
+-----------------------------------+-----------------------------------------------------------+
| 2. PROCESSED OBSERVATIONS         | Number of observations streamed & evaluated so far        |
|                                   | (e.g., 278 / 5,760 in active replay)                      |
+-----------------------------------+-----------------------------------------------------------+
| 3. CURRENT RUN ANOMALIES          | Faults detected in current session since play/reset       |
|                                   | (scoped to run_id, source_type, and replay cursor)        |
+-----------------------------------+-----------------------------------------------------------+
| 4. ACTIVE ANOMALIES (24h)         | Sensor flags raised within sliding 24-hour window         |
|                                   | (station table column: Active Flags (24h))                |
+-----------------------------------+-----------------------------------------------------------+
| 5. TOTAL PERSISTED ANOMALIES      | Cumulative historical records in database across all time |
|                                   | (e.g., 10,254 records in system status diagnostics)       |
+-----------------------------------+-----------------------------------------------------------+
```

---

## 4. Technical Architecture & Implementation

### 4.1 Database Schema & Non-Destructive Migration
1. **Model Updates (`backend/app/db/models.py`)**:
   - Added `run_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)`
   - Added `source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True, index=True)`
   - Added composite indexes for high-throughput temporal lookups:
     - `ix_anom_run_time`: `(run_id, timestamp)`
     - `ix_anom_source_time`: `(source, timestamp)`

2. **Auto-Migration (`backend/app/core/database.py`)**:
   - Added `_ensure_anomaly_columns()` executing `PRAGMA table_info(anomaly_events)` and non-destructively running `ALTER TABLE anomaly_events ADD COLUMN run_id/source` on startup.

3. **Domain Schema (`backend/app/models/processing.py`)**:
   - Updated `AnomalyEventRecord` with `run_id: Optional[str] = None` and `source: Optional[str] = None`.
   - Defined `AnomalyStatsSummary`:
     ```python
     class AnomalyStatsSummary(BaseModel):
         current_run_anomalies: int
         active_anomalies_24h: int
         total_persisted_anomalies: int
         active_run_id: Optional[str] = None
         replay_cursor_time: Optional[datetime] = None
         source_type: Optional[str] = None
     ```

### 4.2 Pipeline Propagation (`engine.py`, `replay.py`, `runtime.py`)
- **Run ID Lifecycle**: Upon stream reset or source transition, `reset_active_run()` assigns a new unique run identifier `RUN-YYYYMMDDHHMMSS` (e.g. `RUN-20260919041000`).
- **Telemetry Ingestion**: Every observation emitted by `StreamReplayEngine` is tagged with `run_id` and `source_type` from `RunContext`.
- **Persistence**: When `engine.py` generates an `AnomalyEventRecord`, it inherits the observation's `run_id` and `source_type` (with safe fallback to `active_ctx`), ensuring every anomaly row in `data/skyguard_dev.db` is unambiguously attributable.

### 4.3 REST API Endpoints (`backend/app/api/v1/endpoints/anomalies.py`)
1. **`GET /api/v1/anomalies/stats`**:
   - Computes:
     - `current_run_anomalies`: filtered by `run_id == ctx.run_id` and `timestamp <= cutoff`.
     - `active_anomalies_24h`: count of active flags in the 24h operational window.
     - `total_persisted_anomalies`: cumulative `COUNT(*)` from `anomaly_events`.
2. **`GET /api/v1/anomalies`**:
   - In operational mode (`historical=False`), automatically enforces `eff_run_id = run_id or ctx.run_id`.
   - Supports explicit `source`, `run_id`, `start_time`, `end_time`, `limit`, `offset`.
   - In historical mode (`historical=True`), bypasses run and replay cursor constraints for deep forensic inspection.

### 4.4 Frontend MOC Integration
- **`TopBar.tsx`**: Uses `useAnomalyStats()`. Displays:
  ```tsx
  <span className="hidden sm:inline">CURRENT RUN ANOMALIES</span>
  <span className="font-mono font-bold text-amber-300">{stats?.current_run_anomalies ?? 0}</span>
  ```
  Hovering over the indicator presents a clear tooltip contrasting the active run anomalies against the total persisted records in SQLite.
- **`NetworkOverviewPage.tsx`**: Updated KPI card to display `CURRENT RUN ANOMALIES` with live count.
- **`LiveMonitoringPage.tsx`**: Clarified station telemetry column header to `Active Flags (24h)`.
- **`SystemStatusPage.tsx`**: Added explicit summary metrics distinguishing `RUN ANOMALIES: X` from `PERSISTED ANOMALIES: 10,254`.

---

## 5. Verification & Test Evidence

### 5.1 Automated Pytest Results
All 361 tests in the repository pass cleanly:

```
tests/integration/test_anomaly_scoping.py::test_anomaly_count_scoped_to_active_run PASSED
tests/integration/test_anomaly_scoping.py::test_total_persisted_anomaly_count_separate_from_current_run_count PASSED
tests/integration/test_anomaly_scoping.py::test_anomaly_count_scoped_to_replay_cursor PASSED
tests/integration/test_anomaly_scoping.py::test_future_anomalies_not_visible PASSED
tests/integration/test_anomaly_scoping.py::test_previous_run_anomalies_not_visible PASSED
tests/integration/test_anomaly_scoping.py::test_source_switch_changes_anomaly_scope PASSED
tests/integration/test_anomaly_scoping.py::test_reset_clears_current_run_anomaly_view PASSED
tests/integration/test_api_endpoints.py (7 passed)
================= 361 passed, 4 warnings in 98.05s ==================
```

### 5.2 Browser Subagent E2E Verification
The autonomous browser subagent conducted exhaustive verification against `http://localhost:5174/`:

| Verification Step | Target State | Actual Result | Status | Screenshot Artifact |
|---|---|---|---|---|
| **1. Initial Replay State** | Top bar shows `0 CURRENT RUN ANOMALIES` at cursor 0 | Top bar displays `0 CURRENT RUN ANOMALIES`, KPI displays `0` | **PASS** | [`initial_state_1789791076105.png`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/initial_state_1789791076105.png) |
| **2. Stream Execution** | Replay advances past 200 obs (`278 / 5,760`) | Counters advance cleanly, anomaly counter remains scoped | **PASS** | [`replay_advancing_1789791146156.png`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/replay_advancing_1789791146156.png) |
| **3. Stream Reset** | Resetting stream resets current run count to 0 | Pointer resets to `0 / 5,760`, current run anomaly count = `0` | **PASS** | [`replay_reset_1789791230644.png`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/replay_reset_1789791230644.png) |
| **4. Network Overview** | KPI card displays `CURRENT RUN ANOMALIES: 0` | Card rendered with verified label and scoped count | **PASS** | [`network_overview_kpi_1789791257337.png`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/network_overview_kpi_1789791257337.png) |
| **5. Live Monitoring Table** | Column header displays `Active Flags (24h)` | Header clearly labeled, eliminating ambiguity | **PASS** | [`live_monitoring_table_1789791432186.png`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/live_monitoring_table_1789791432186.png) |
| **6. System Status Diagnostics** | Separate metrics for Run vs Persisted anomalies | Displays `RUN ANOMALIES: 0` and `PERSISTED ANOMALIES: 10,254` | **PASS** | [`system_status_metrics_1789791557192.png`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/system_status_metrics_1789791557192.png) |

Full browser interaction recording: [`anomaly_count_semantics_1789791025857.webp`](file:///C:/Users/VICTUS/.gemini/antigravity-ide/brain/c8955726-9331-412f-9256-aae15a09ef58/anomaly_count_semantics_1789791025857.webp)

---

## 6. Operational Guidelines for Future Development
1. **Never conflate database rows with active run flags**: Operational screens must always call `/api/v1/anomalies/stats` or query `/api/v1/anomalies` with `historical=False` (scoping to active `run_id`).
2. **Preserve full historical access for forensics**: The Historical Analysis view (`/historical`) must continue to pass `historical=True` to allow analysis across all persisted anomalies.
3. **Run isolation on source switch**: Any trigger that switches data sources (`Synthetic Replay` -> `Live Polling` -> `Open-Meteo`) must call `reset_active_run()` to cycle the `run_id`.
