"""Unit tests for the new /corrections API endpoint and database queries."""

import pytest
from backend.app.core.database import DatabaseRepository
from backend.app.api.v1.endpoints.corrections import list_corrections, get_correction_detail
from ml.imputation.schema import (
    CorrectionRecommendation,
    RecommendationStatus,
    EstimationMethod,
    MethodQuality,
    UncertaintyEstimate,
)
from ml.spatial.topology import SpatialNetworkTopology, StationNode


from backend.app.db.session import DatabaseSessionManager


@pytest.fixture
def test_repo(tmp_path):
    db_file = tmp_path / "test_corrections.db"
    session_mgr = DatabaseSessionManager(f"sqlite:///{db_file}")
    topo = SpatialNetworkTopology()
    topo.add_station(StationNode(station_id="AWS_001", name="Station 1", latitude=28.6, longitude=77.2, elevation_m=200.0))
    repo = DatabaseRepository(topology=topo, session_manager=session_mgr)
    
    corr1 = CorrectionRecommendation(
        observation_id="OBS-AWS001-20260917-001",
        station_id="AWS_001",
        timestamp="2026-09-17T00:00:00Z",
        target_variable="temperature_c",
        observed_value=48.5,
        recommended_value=24.2,
        status=RecommendationStatus.REVIEW_RECOMMENDED,
        method=EstimationMethod.SPATIAL_IDW_CONSENSUS,
        decision_type="PROBABLE_SENSOR_ANOMALY",
        reason_codes=["ISOLATION_FOREST_SPIKE", "SPATIAL_DISCORDANCE"],
        supporting_evidence=["Neighbor delta: +24.3C", "Historical 3-sigma exceedance"],
        uncertainty=UncertaintyEstimate(
            estimate_range=(23.5, 24.9),
            standard_error=0.35,
            absolute_deviation=24.3,
            supporting_neighbor_count=4,
            method_quality=MethodQuality.HIGH,
            confidence_index=0.92,
        ),
        multivariate_consistent=True,
        station_health_score=68.5,
        station_health_band="DEGRADED",
        operator_summary="Sudden 24.3C positive spike uncorroborated by 4 spatial neighbors. IDW spatial consensus suggests 24.2C.",
    )
    corr2 = CorrectionRecommendation(
        observation_id="OBS-AWS001-20260917-002",
        station_id="AWS_001",
        timestamp="2026-09-17T01:00:00Z",
        target_variable="humidity_pct",
        observed_value=5.0,
        recommended_value=55.0,
        status=RecommendationStatus.CORRECTION_CANDIDATE,
        method=EstimationMethod.CAUSAL_TEMPORAL_INTERPOLATION,
        decision_type="PROBABLE_SENSOR_ANOMALY",
        operator_summary="Humidity drop candidate for correction.",
    )
    repo.save_correction(corr1)
    repo.save_correction(corr2)
    return repo


@pytest.mark.anyio
async def test_corrections_api_endpoints(test_repo):
    # 1. Test listing corrections via endpoint function
    res = await list_corrections(
        station_id=None,
        status=None,
        target_variable=None,
        limit=50,
        offset=0,
        repo=test_repo,
    )
    assert res.pagination.total_count == 2
    assert len(res.items) == 2
    assert res.items[0].observation_id == "OBS-AWS001-20260917-002"

    # 2. Test filtering by status
    res_filt = await list_corrections(
        station_id="AWS_001",
        status="REVIEW_RECOMMENDED",
        target_variable=None,
        limit=50,
        offset=0,
        repo=test_repo,
    )
    assert res_filt.pagination.total_count == 1
    assert res_filt.items[0].observation_id == "OBS-AWS001-20260917-001"

    # 3. Test detail endpoint function
    detail = await get_correction_detail(
        observation_id="OBS-AWS001-20260917-001",
        repo=test_repo,
    )
    assert detail.observation_id == "OBS-AWS001-20260917-001"
    assert detail.observed_value == 48.5
    assert detail.recommended_value == 24.2
    assert detail.status == RecommendationStatus.REVIEW_RECOMMENDED
