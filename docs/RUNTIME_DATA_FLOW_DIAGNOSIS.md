# SkyGuard AI — Runtime Data-Flow Diagnosis & Architecture Record

## Executive Summary

This document records the comprehensive architectural diagnosis, defect analysis, and implementation fixes applied to achieve **end-to-end runtime data-flow consistency**, **live reactivity**, and **cross-page state synchronization** across SkyGuard AI.

Prior to these fixes, the dashboard suffered from competing local state stores, disconnected polling loops, inverted database queries that froze sparkline updates, misleading "100/100" health defaults during uncalibrated cold starts, and visual coupling between synthetic replay and live ingestion statuses. 

With this implementation, the system strictly enforces the **Single Active Run / Canonical Stream** paradigm across all 8 dashboard pages and backend services.

---

## 1. Unified Runtime Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          ONE ACTIVE RUN                                │
│                (RunContext / RunControlEngine)                         │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         ONE ACTIVE SOURCE                              │
│       (Synthetic Replay | Historical CSV | Open-Meteo Live API)        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      ONE OBSERVATION STREAM                            │
│           (RealtimeEngine -> Persistence -> Event Dispatch)            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        WEBSOCKET / SSE FEED                            │
│            (replay.progress, observation.updated, anomaly.alert)        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     CANONICAL RUNCONTEXT (FRONTEND)                    │
│   (React Context + TanStack Query Cache + RealtimeStreamContext)       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 ALL 8 DASHBOARD PAGES & SUBCOMPONENTS                  │
│   (/network, /live, /stations/:id, /anomalies, /health, /system, etc.) │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Root Cause Analysis of Primary Defects

### 2.1 Static History Charts & Sparklines
- **Root Cause**: In `backend/app/core/database.py`, `get_station_history` was applying `.order_by(asc).offset(0).limit(N)`. When querying with a limit of 36 or 100 observations, the query always returned the oldest $N$ observations from the start of time. As new observations arrived with later timestamps, the query result remained static.
- **Resolution**: Implemented an explicit `order` parameter (`asc` vs `desc`). Sparklines and station details request `order="desc"` to retrieve the most recent observations, which are then reversed into chronological order for chart rendering.

### 2.2 Fragmented Frontend State & Desynchronized Polling
- **Root Cause**: `useRunContext` declared its own isolated `useState` inside each hook execution. Each component mounted a detached copy of state and launched independent intervals with conflicting refresh cadences (e.g. 15s hardcoded poll badge on `/live`).
- **Resolution**: Created a canonical `RunContextProvider` at the React root. All pages consume shared state, centralized action handlers (`startRun`, `pauseRun`, `resetRun`, `setSpeed`, `selectSource`), and dynamic polling intervals that adapt to the active run state (e.g., fast 2s polling during active replay, 15s during idle).

### 2.3 Provider State Bleeding (Open-Meteo in Synthetic Mode)
- **Root Cause**: In `NetworkOverviewPage.tsx`, the Live Provider Health widget was displayed unconditionally, showing Open-Meteo operational status and latency even during Synthetic Replay runs.
- **Resolution**: Strictly gated live ingestion metrics to `RunMode.LIVE_MONITORING` and `source === 'OPEN_METEO'`. In replay modes, the UI displays dedicated Replay Controller metrics.

### 2.4 Misleading Health Scores on Insufficient History
- **Root Cause**: `get_station_snapshot` fell back to `100.0` when health calculations were unavailable or returned `INSUFFICIENT_HISTORY`. Components rendered green 100/100 health bars during cold starts.
- **Resolution**: `get_station_snapshot` preserves `None` when health score is uncomputed or has `INSUFFICIENT_HISTORY`. `HealthScore` and `HealthTrend` components now explicitly display `--/100` with a notice explaining that historical calibration is in progress.

### 2.5 Hardcoded Anomaly Candidate Corrections
- **Root Cause**: `AnomalyInvestigationPage.tsx` defaulted missing candidate corrections to hardcoded mock values (`SPATIAL_IDW_CONSENSUS`, `±0.6°C`), violating data truthfulness.
- **Resolution**: Replaced mock fallbacks with conditional rendering based on actual `imputation_record` and `recommended_value` availability.

---

## 3. Before vs After Comparison Matrix

| Area / Feature | Before Fix (Defective State) | After Fix (Canonical State) |
| :--- | :--- | :--- |
| **1. Source Identity** | Provider health and live poller shown regardless of active source. | Strictly gated by active source type (`SYNTHETIC_VALIDATION`, `HISTORICAL_CSV`, `OPEN_METEO`). |
| **2. Global State** | Multiple disconnected hook instances across pages. | Single canonical `RunContextProvider` wrapping the entire application tree. |
| **3. Replay Flow** | Replay controls desynchronized between TopBar and System page. | Real-time WebSocket synchronization (`replay.progress`) updates all pages simultaneously. |
| **4. Telemetry Sparklines** | Pinned to first 36 historical records; never updated. | Queries recent descending records with `order="desc"` and appends live stream points. |
| **5. Station Details** | Fixed history window from earliest observations. | Dynamically queries latest 150 observations matching the active run source. |
| **6. Mode Indicator** | Hardcoded `POLLING (15s)` badge on Live Monitoring page. | Dynamic badge reflecting active transport (`SYNTHETIC REPLAY`, `HISTORICAL REPLAY`, `LIVE STREAM`). |
| **7. Sensor Health** | Defaulted to 100/100 with full green bars on zero history. | Explicit `--/100` and `INSUFFICIENT_HISTORY` calibration progress notice. |
| **8. Anomaly Feed** | Static mock fallbacks for missing explanation packages. | Live anomaly event stream updates with genuine 4-tier operational explanations. |
| **9. Correction Review** | Hardcoded candidate methods (`SPATIAL_IDW_CONSENSUS`). | Strict provenance: shows genuine ML/spatial consensus corrections or diagnostic notice. |
| **10. Latency SLA** | Hardcoded static latency numbers in System status. | Dynamic roundtrip measurements tracked from engine pipeline execution. |
| **11. Error Handling** | 404 on anomaly explanation caused unhandled rejection. | Graceful fallback banner explaining missing explanation without console errors. |
| **12. Step Execution** | Single-step simulation did not trigger query cache invalidation. | `stepReplay` invalidates station snapshots, health, and anomaly caches across pages. |
| **13. Test Coverage** | History query tests failed on unhandled query parameters. | 100% test pass rate across 349 backend tests and TypeScript clean build. |

---

## 4. Verification Evidence

### Automated Test Suite
- **Command**: `pytest tests/`
- **Result**: **349 PASSED, 0 FAILED** (Unit, Integration, Performance, Security suites).

### Frontend Build
- **Command**: `npm run build`
- **Result**: **Clean TypeScript compilation**, zero errors, 2,419 modules transformed into production bundle.

### End-to-End Browser Acceptance
- Verified all 8 routes (`/network`, `/live`, `/stations/:id`, `/anomalies`, `/health`, `/system`, etc.) in Google Chrome.
- Tested active replay at 1x, 10x, 60x speeds.
- Tested manual cycle stepping (`Step 1 Obs`).
- Tested data source selection modal.
- Confirmed zero unhandled promise rejections, zero React render exceptions, and zero console errors.
