"""WebSocket Connection Manager for SkyGuard AI Real-Time Streaming."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from fastapi import WebSocket

from backend.app.models.events import EventType, WebSocketEnvelope

logger = logging.getLogger("skyguard.websocket")


class WebSocketConnectionManager:
    """Manages active WebSocket client connections, real-time event broadcasting, and latency profiling."""

    def __init__(self) -> None:
        self.active_connections: Set[WebSocket] = set()
        self.total_broadcast_count: int = 0
        self.total_dropped_count: int = 0
        self.last_broadcast_time: Optional[datetime] = None
        self._latencies_ms: List[float] = []
        self._lock = asyncio.Lock()

    @property
    def active_connections_count(self) -> int:
        """Return the count of currently connected WebSocket clients."""
        return len(self.active_connections)

    async def connect(self, websocket: WebSocket) -> None:
        """Accept incoming connection and register in active set."""
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("WebSocket client connected. Total active: %d", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove disconnected client from active set."""
        self.active_connections.discard(websocket)
        logger.info("WebSocket client disconnected. Remaining active: %d", len(self.active_connections))

    async def send_personal(self, websocket: WebSocket, envelope: WebSocketEnvelope) -> bool:
        """Send a structured event envelope directly to a specific client."""
        try:
            payload_json = envelope.model_dump_json()
            await websocket.send_text(payload_json)
            return True
        except Exception as exc:
            logger.warning("Failed to send personal WebSocket message: %s", exc)
            self.disconnect(websocket)
            return False

    async def broadcast(self, envelope: WebSocketEnvelope) -> int:
        """Broadcast an event envelope to all connected WebSocket clients.
        
        Returns the number of clients successfully delivered to.
        """
        t_start = time.perf_counter_ns()
        self.total_broadcast_count += 1
        self.last_broadcast_time = datetime.now(timezone.utc)

        if not self.active_connections:
            return 0

        payload_json = envelope.model_dump_json()
        
        disconnected_clients: Set[WebSocket] = set()
        delivered_count = 0

        # Snapshot current connections for safe concurrent iteration
        current_conns = list(self.active_connections)

        for ws in current_conns:
            try:
                await ws.send_text(payload_json)
                delivered_count += 1
            except Exception as exc:
                logger.debug("Client dropped during broadcast: %s", exc)
                disconnected_clients.add(ws)
                self.total_dropped_count += 1

        for ws in disconnected_clients:
            self.disconnect(ws)

        elapsed_ms = (time.perf_counter_ns() - t_start) / 1e6
        self._latencies_ms.append(elapsed_ms)
        if len(self._latencies_ms) > 100:
            self._latencies_ms.pop(0)

        ev_type = envelope.event_type.value if hasattr(envelope.event_type, "value") else str(envelope.event_type)
        logger.info(
            "[STREAM] Broadcasted %s for %s to %d active client(s) (%.2fms)",
            ev_type,
            envelope.station_id or "all",
            delivered_count,
            elapsed_ms,
        )

        return delivered_count

    def broadcast_sync(self, envelope: WebSocketEnvelope) -> None:
        """Synchronous bridge for broadcasting from non-async processing threads/contexts."""
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                asyncio.create_task(self.broadcast(envelope))
            else:
                loop.run_until_complete(self.broadcast(envelope))
        except RuntimeError:
            # No running event loop in current thread
            self.total_broadcast_count += 1
            self.last_broadcast_time = datetime.now(timezone.utc)
            if self.active_connections:
                try:
                    asyncio.run(self.broadcast(envelope))
                except Exception:
                    pass

    def get_metrics(self) -> Dict[str, Any]:
        """Return operational observability metrics for WebSocket subsystem."""
        avg_latency = (
            sum(self._latencies_ms) / len(self._latencies_ms)
            if self._latencies_ms
            else 0.0
        )
        return {
            "active_clients": len(self.active_connections),
            "total_broadcasts": self.total_broadcast_count,
            "total_dropped_messages": self.total_dropped_count,
            "last_broadcast_utc": self.last_broadcast_time.isoformat() if self.last_broadcast_time else None,
            "avg_broadcast_latency_ms": round(avg_latency, 3),
        }


# Global singleton instance
_ws_manager: Optional[WebSocketConnectionManager] = None


def get_ws_manager() -> WebSocketConnectionManager:
    """Get or create singleton WebSocketConnectionManager."""
    global _ws_manager
    if _ws_manager is None:
        _ws_manager = WebSocketConnectionManager()
    return _ws_manager
