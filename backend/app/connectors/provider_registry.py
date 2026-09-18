"""Provider Registry for SkyGuard AI Data Sources."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Generator, List, Optional
import pandas as pd

from backend.app.connectors.base import BaseConnector
from backend.app.connectors.historical_csv import HistoricalCSVConnector
from backend.app.ingestion.csv_normalizer import CSVNormalizer
from backend.app.models.observation import ObservationSource, QualityStatus, WeatherObservation
from backend.app.models.run_context import DataSourceType, RunContext, RunMode, RunStatus, TransportType


class SyntheticValidationConnector(BaseConnector):
    """Data source adapter for the Synthetic Validation Replay dataset (Phase 13A benchmark)."""

    DATASET_PATH = Path("synthetic_validation/datasets/injected_validation_dataset.csv")

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config=config)
        self.file_path = self.DATASET_PATH

    def connect(self) -> None:
        if not self.file_path.is_file():
            raise FileNotFoundError(f"Synthetic validation benchmark dataset missing at {self.file_path}")
        self.is_connected = True

    def fetch_observations(self) -> Generator[WeatherObservation, None, None]:
        if not self.is_connected:
            self.connect()

        df = pd.read_csv(self.file_path)
        for _, row in df.iterrows():
            t_val = row.get("temperature_c") if "temperature_c" in row else row.get("temperature")
            rh_val = row.get("relative_humidity_pct") if "relative_humidity_pct" in row else row.get("humidity")
            slp_val = row.get("sea_level_pressure_hpa") if "sea_level_pressure_hpa" in row else row.get("pressure")
            stn_name = row.get("station_name") or f"AWS_{row['station_id']}"

            obs = WeatherObservation(
                station_id=str(row["station_id"]),
                station_name=str(stn_name),
                latitude=float(row.get("latitude", 28.6139)),
                longitude=float(row.get("longitude", 77.2090)),
                elevation=float(row.get("elevation", 216.0)),
                timestamp=pd.to_datetime(row["timestamp"], utc=True).to_pydatetime(),
                temperature=float(t_val) if pd.notna(t_val) else None,
                dew_point_c=float(row["dew_point_c"]) if "dew_point_c" in row and pd.notna(row["dew_point_c"]) else None,
                humidity=float(rh_val) if pd.notna(rh_val) else None,
                pressure=float(slp_val) if pd.notna(slp_val) else None,
                source=ObservationSource.SYNTHETIC_VALIDATION,
                data_quality_status=QualityStatus.VALID,
                is_synthetic=True,
                source_type=DataSourceType.SYNTHETIC_VALIDATION.value,
                source_name="Synthetic Benchmark Replay",
                dataset_id="synthetic_validation_v1",
                dataset_version="1.0.0",
                metadata={
                    "scenario_id": str(row.get("scenario_id", "")),
                    "scenario_name": str(row.get("scenario_name", "")),
                    "is_injected_anomaly": bool(row.get("is_injected_anomaly", False)),
                    "expected_decision": str(row.get("expected_decision", "")),
                }
            )
            yield obs

    def disconnect(self) -> None:
        self.is_connected = False


class IMDAWSConnector(BaseConnector):
    """Connector slot for future IMD AWS integration (Architectural compatibility slot)."""

    def connect(self) -> None:
        raise NotImplementedError("IMD AWS source is not configured yet. Status: COMING SOON")

    def fetch_observations(self) -> Generator[WeatherObservation, None, None]:
        raise NotImplementedError("IMD AWS source is not configured yet.")

    def disconnect(self) -> None:
        self.is_connected = False


class ProviderRegistry:
    """Registry maintaining available ObservationSource providers and metadata."""

    _providers: Dict[str, Dict[str, Any]] = {
        DataSourceType.SYNTHETIC_VALIDATION.value: {
            "name": "Synthetic Validation Replay",
            "type": DataSourceType.SYNTHETIC_VALIDATION,
            "connector_cls": SyntheticValidationConnector,
            "configured": True,
            "default_mode": RunMode.SYNTHETIC_REPLAY,
            "ground_truth_available": True,
            "dataset_id": "synthetic_validation",
            "dataset_version": "1.0.0",
            "station_count": 20,
            "observation_count": 5760,
            "cadence": "5 minutes",
            "seed": 42,
            "description": "20 stations, 24-hour benchmark, 24 injected anomaly scenarios with ground truth labels.",
        },
        DataSourceType.HISTORICAL_CSV.value: {
            "name": "Historical CSV",
            "type": DataSourceType.HISTORICAL_CSV,
            "connector_cls": HistoricalCSVConnector,
            "configured": True,
            "default_mode": RunMode.HISTORICAL_ANALYSIS,
            "ground_truth_available": False,
            "dataset_id": "historical_csv_upload",
            "dataset_version": "1.0.0",
            "station_count": 0,
            "observation_count": 0,
            "cadence": "variable",
            "seed": None,
            "description": "User-provided or configured historical CSV file with schema auto-normalization.",
        },
        DataSourceType.OPEN_METEO.value: {
            "name": "Open-Meteo Live API",
            "type": DataSourceType.OPEN_METEO,
            "connector_cls": None,  # Handled by live poller
            "configured": True,
            "default_mode": RunMode.LIVE_MONITORING,
            "ground_truth_available": False,
            "dataset_id": "open_meteo_live",
            "dataset_version": "v1",
            "station_count": 20,
            "observation_count": 0,
            "cadence": "15 minutes",
            "seed": None,
            "description": "Free public live meteorological telemetry connector for 20 NCR AWS coordinates.",
        },
        DataSourceType.IMD_AWS.value: {
            "name": "IMD AWS (India Meteorological Department)",
            "type": DataSourceType.IMD_AWS,
            "connector_cls": IMDAWSConnector,
            "configured": False,
            "default_mode": RunMode.LIVE_MONITORING,
            "ground_truth_available": False,
            "dataset_id": "imd_aws_future",
            "dataset_version": "2.0.0",
            "station_count": 0,
            "observation_count": 0,
            "cadence": "15 minutes",
            "seed": None,
            "description": "Status: COMING SOON / NOT CONFIGURED. Future direct connector slot for IMD telemetry.",
        },
    }

    @classmethod
    def list_providers(cls) -> List[Dict[str, Any]]:
        """Return list of available provider configurations."""
        providers = []
        for p_id, p_info in cls._providers.items():
            providers.append({
                "source_type": p_info["type"].value,
                "name": p_info["name"],
                "configured": p_info["configured"],
                "default_mode": p_info["default_mode"].value,
                "ground_truth_available": p_info["ground_truth_available"],
                "dataset_id": p_info["dataset_id"],
                "dataset_version": p_info["dataset_version"],
                "station_count": p_info["station_count"],
                "observation_count": p_info["observation_count"],
                "cadence": p_info["cadence"],
                "description": p_info["description"],
            })
        return providers

    @classmethod
    def get_provider_info(cls, source_type: str | DataSourceType) -> Dict[str, Any]:
        """Fetch metadata for a specific provider."""
        key = source_type.value if isinstance(source_type, DataSourceType) else source_type
        if key not in cls._providers:
            raise ValueError(f"Unknown data source provider: {source_type}")
        return cls._providers[key]
