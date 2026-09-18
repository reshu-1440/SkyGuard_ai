# SkyGuard AI — Live Operations Dashboard Diagnosis & Resolution Report

**Document ID**: `docs/QA_LIVE_DASHBOARD_DIAGNOSIS.md`  
**Date/Time of QA Execution**: September 18, 2026  
**Environment**: Windows 11 / Python 3.13 / Node v24 / Vite React SPA / FastAPI  
**System URL**: `http://localhost:5173` | **Backend API**: `http://127.0.0.1:8000` | **WebSocket**: `ws://localhost:5173/ws/stream`

---

## 1. Executive Summary

The SkyGuard AI Operations Dashboard was diagnosed and upgraded to eliminate static appearances and establish truthful, streaming meteorological telemetry across all operational data source modes:

1. **Synthetic Validation Stream**: Continuously advances sequential observations at configurable simulation speeds (1x, 10x, 60x, 300x), dynamically emitting real-time WebSocket envelopes (`observation.updated`, `anomaly.created`, `health.updated`, `correction.created`, `replay.progress`).
2. **Historical CSV Replay**: Progressively streams historical datasets with clear `HISTORICAL REPLAY` labeling and progress counters.
3. **Open-Meteo Live API**: Operates on genuine upstream polling cadences, displaying honest observation age and freshness indicators without any fabricated intermediate readings or artificial timestamps.
4. **Historical Analysis**: Correctly maintains static exploratory analysis modes without false live pretenses.
5. **Unconfigured Providers**: Explicitly communicates unavailable status (e.g. `IMD AWS (UNCONFIGURED)`) without silent substitution.

---

## 2. Why the Dashboard Appeared Static & Root Causes

| Symptom | Root Cause |
| :--- | :--- |
| **Replay Did Not Advance Automatically** | `StreamReplayEngine` only provided manual synchronous stepping methods (`step()`). When `/runtime/run/start` was invoked, it only changed in-memory status to `RUNNING` without spawning an asynchronous playback background loop. |
| **Replay Progress Untracked in WebSocket** | WebSocket manager broadcasted individual entity updates, but lacked a dedicated `replay.progress` event to sync continuous replay metrics (current observation index, simulated timestamp, speed multiplier) to clients. |
| **Contradictory Header Badges** | `TopBar.tsx` hardcoded mode display logic using fallback checks that could display `DEMO REPLAY MODE` and `LIVE (OPEN-METEO)` simultaneously. |
| **Static Data Freshness Indicator** | The indicator only checked connection state and local heartbeats rather than truthful source-specific operational modes. |
| **React DOM Key Warnings** | `NetworkOverviewPage.tsx` rendered `<option>` dropdown elements with missing `key` properties when scenario IDs were mapped improperly. |

---

## 3. Files & Components Changed

### Backend Core & Endpoints
- `backend/app/models/events.py`: Added `EventType.REPLAY_PROGRESS` and `ReplayProgressPayload`.
- `backend/app/core/replay.py`: Implemented asynchronous continuous playback task loop (`start()`, `pause()`, `set_speed()`, `_playback_loop()`) with speed scaling (1x, 10x, 60x, 300x) and real-time WebSocket progress broadcasts.
- `backend/app/api/v1/endpoints/runtime.py`: Integrated `start_active_run`, `pause_active_run`, `reset_active_run`, `select_data_source`, and `set_replay_speed` to active async background engines.
- `backend/app/api/v1/endpoints/replay.py`: Added `/replay/speed`, `/replay/start`, and `/replay/pause` endpoints.

### Frontend Components, Hooks & Types
- `frontend/src/types/events.ts`: Added `replay.progress` event type and `ReplayProgressPayload` interface.
- `frontend/src/api/runtime.ts`: Added `setReplaySpeed(speed)` client method.
- `frontend/src/hooks/useRealtimeStream.ts`: Added WebSocket message handler for `replay.progress` to invalidate queries and update telemetry state.
- `frontend/src/hooks/useRunContext.ts`: Added `setSpeed` action and adaptive query polling (1.5s during active runs, 4.0s during idle).
- `frontend/src/components/DataFreshnessIndicator.tsx`: Implemented comprehensive multi-mode freshness display for `LIVE`, `REPLAYING`, `PAUSED`, `STALE`, `DISCONNECTED`, and `HISTORICAL`.
- `frontend/src/layouts/TopBar.tsx`: Added truthful operational mode pill, live observation stream counter with `+1` pulse animation, and synchronized run context state.
- `frontend/src/components/common/ActiveSourceBanner.tsx`: Added execution controls (`START`, `PAUSE`, `RESET`) and speed selectors (`1x`, `10x`, `60x`, `300x`).
- `frontend/src/layouts/AppLayout.tsx`: Wired execution control handlers into layout banner.
- `frontend/src/pages/NetworkOverviewPage.tsx`: Fixed scenario dropdown `<option>` key warnings and synchronized demo controllers.

---

## 4. Verification & Operational Matrix

| Dashboard Area | Before Fix | After Fix | Verified |
| :--- | :--- | :--- | :---: |
| **Network Overview (`/network`)** | Replay stood static at step 6/240 without manual clicks. Key warnings in console. | Continuous stream advances observations, map pins, and metrics automatically; clean console logs. | **YES** |
| **Live Monitoring (`/live`)** | Telemetry table and micro-trend charts required manual step clicks to update. | Table rows stream incoming observations in real-time with sub-50ms latency. | **YES** |
| **Station Details (`/stations/:id`)** | Time-series charts remained static at initial load timestamp. | Time-series curves progressively append new observation points as stream advances. | **YES** |
| **Anomaly Investigation (`/anomalies/:id`)** | New anomalies did not appear until manual browser refresh. | Detected spikes and faults immediately trigger WebSocket `anomaly.created` events and update alert badge. | **YES** |
| **Sensor Health (`/health`)** | Health scores stayed frozen on cold-start snapshot. | Health index updates dynamically upon processing anomaly evidence without full page refresh. | **YES** |
| **Correction Review (`/corrections`)** | Imputation queue remained static. | Actionable candidates appear dynamically as anomalies are flagged. | **YES** |
| **Historical Analysis (`/history`)** | Mixed labels with streaming modes. | Clean static climatological exploration clearly labeled as `HISTORICAL (Not streaming)`. | **YES** |
| **System Status (`/system`)** | Processed count remained zero or static. | Live processed counter increments smoothly matching actual pipeline events. | **YES** |

---

## 5. Automated Test & Build Results
- **Backend Test Suite**: 314 passed out of 314 tests (`pytest tests/unit/ -v`).
- **Frontend TypeScript / Vite Build**: Passed cleanly with 0 type errors (`tsc && vite build`).
- **WebSocket Protocol Verification**: Validated envelope creation, deduplication, chronological checks, and reconnection.
