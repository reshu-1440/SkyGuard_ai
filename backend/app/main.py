"""FastAPI Application Entry Point for SkyGuard AI."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.v1.endpoints.health import router as health_router
from backend.app.api.v1.endpoints.ws import router as ws_router
from backend.app.api.v1.router import router as api_v1_router
from backend.app.core.config import get_settings
from backend.app.core.logging import get_logger, setup_logging

settings = get_settings()
setup_logging(log_level=settings.log_level, log_format=settings.log_format)
logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for deterministic startup and graceful shutdown."""
    logger.info(
        "Initializing %s (v%s) in [%s] mode",
        settings.system.project_name,
        settings.system.version,
        settings.env,
    )
    logger.info(
        "Observation Cadence: %ds (5-min default)",
        settings.observation_interval_seconds
    )
    # Automated Database Migration / Schema check on startup (controlled by settings.storage.auto_migrate)
    if settings.storage.auto_migrate:
        try:
            from backend.app.db.migrations import run_db_migrations
            run_db_migrations()
        except Exception as mig_err:
            logger.warning("Automated migration check note: %s (fallback schema initialized)", str(mig_err))
    else:
        logger.info("Auto-migration disabled (production mode: explicit alembic migration expected)")

    # Start live polling task if enabled in configuration
    if settings.live_source.enabled:
        from backend.app.api.v1.deps import get_live_poller
        poller = get_live_poller()
        if not poller.is_running:
            logger.info("Starting background live source poller for provider '%s'...", settings.live_source.provider)
            await poller.start()

    # Auto-start demo replay simulation if demo_autostart is enabled
    if settings.demo_autostart:
        from backend.app.api.v1.deps import get_engine, get_replay_engine, get_repository, get_run_context_manager, get_synthetic_topology
        from backend.app.models.run_context import RunStatus
        replay = get_replay_engine()
        engine = get_engine()
        repo = get_repository()
        ctx_mgr = get_run_context_manager()
        ctx = ctx_mgr.get_context()

        # Ensure active topology has all 20 synthetic benchmark stations
        if len(repo.topology.stations) != 20:
            synth_topo = get_synthetic_topology()
            repo.set_topology(synth_topo)
            if hasattr(engine, "spatial_engine") and engine.spatial_engine is not None:
                engine.spatial_engine.topology = synth_topo

        if ctx.status == RunStatus.IDLE:
            logger.info("DEMO_AUTOSTART enabled: launching Synthetic Benchmark Replay at 1.0x cadence...")
            replay.set_speed(1.0)
            await replay.start(engine=engine, ctx_mgr=ctx_mgr)
            ctx_mgr.update_context(status=RunStatus.RUNNING)

    yield

    # Graceful shutdown
    logger.info("Shutting down SkyGuard AI backend service...")
    if settings.demo_autostart:
        try:
            from backend.app.api.v1.deps import get_replay_engine
            replay = get_replay_engine()
            if replay.is_running:
                await replay.pause()
        except Exception:
            pass

    if settings.live_source.enabled:
        try:
            from backend.app.api.v1.deps import get_live_poller
            poller = get_live_poller()
            if poller.is_running:
                logger.info("Stopping background live poller...")
                await poller.stop()
        except Exception as stop_err:
            logger.warning("Error stopping live poller on shutdown: %s", str(stop_err))

    logger.info("SkyGuard AI backend shutdown completed cleanly.")


app = FastAPI(
    title="SkyGuard AI — Meteorological Data Quality & Anomaly Detection API",
    description="REST API for Automatic Weather Station telemetry, quality control, and sensor health.",
    version=settings.system.version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Health Probes, API v1 Router & WebSocket Router
app.include_router(health_router)
app.include_router(api_v1_router, prefix=settings.api_prefix)
app.include_router(ws_router)


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint providing service metadata."""
    return {
        "service": settings.system.project_name,
        "version": settings.system.version,
        "status": "online",
        "docs_url": "/docs",
        "api_v1": settings.api_prefix,
    }
