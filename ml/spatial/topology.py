"""Spatial network topology and geodesic neighbor relationships for AWS networks."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import numpy as np
import pandas as pd
import yaml
from pydantic import BaseModel, Field, ConfigDict

from backend.app.core.constants import EARTH_RADIUS_KM


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute the great-circle distance between two points on Earth using the Haversine formula.
    
    Args:
        lat1: Latitude of point 1 in decimal degrees [-90, 90].
        lon1: Longitude of point 1 in decimal degrees [-180, 180].
        lat2: Latitude of point 2 in decimal degrees [-90, 90].
        lon2: Longitude of point 2 in decimal degrees [-180, 180].
        
    Returns:
        Geodesic distance in kilometers. Returns NaN if any coordinate is invalid.
    """
    if any(v is None or math.isnan(v) for v in (lat1, lon1, lat2, lon2)):
        return float("nan")

    if not (-90.0 <= lat1 <= 90.0 and -90.0 <= lat2 <= 90.0):
        return float("nan")
    if not (-180.0 <= lon1 <= 180.0 and -180.0 <= lon2 <= 180.0):
        return float("nan")

    # Identical coordinates
    if lat1 == lat2 and lon1 == lon2:
        return 0.0

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    a_clamped = min(1.0, max(0.0, a))
    c = 2.0 * math.atan2(math.sqrt(a_clamped), math.sqrt(1.0 - a_clamped))

    return EARTH_RADIUS_KM * c


def initial_compass_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute initial compass bearing (forward azimuth) from point 1 to point 2 in degrees [0, 360).
    
    Args:
        lat1: Latitude of origin point.
        lon1: Longitude of origin point.
        lat2: Latitude of destination point.
        lon2: Longitude of destination point.
        
    Returns:
        Bearing in degrees normalized to [0.0, 360.0).
    """
    if any(v is None or math.isnan(v) for v in (lat1, lon1, lat2, lon2)):
        return float("nan")

    if lat1 == lat2 and lon1 == lon2:
        return 0.0

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    x = math.sin(delta_lambda) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)

    initial_bearing = math.atan2(x, y)
    initial_bearing_deg = math.degrees(initial_bearing)
    compass_bearing = (initial_bearing_deg + 360.0) % 360.0

    return compass_bearing


class StationNode(BaseModel):
    """Metadata representation of an Automatic Weather Station node in the network."""
    model_config = ConfigDict(frozen=True)

    station_id: str = Field(..., description="Unique station identifier.")
    name: str = Field("Unknown Station", description="Descriptive station name.")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees.")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees.")
    elevation_m: float = Field(0.0, description="Station elevation above sea level in meters.")
    wmo_id: Optional[str] = Field(None, description="WMO identifier if available.")
    state: Optional[str] = Field(None, description="Administrative state / province.")
    climate_zone: Optional[str] = Field(None, description="Köppen / IMD climate classification zone.")
    sampling_interval_seconds: int = Field(1800, gt=0, description="Nominal sampling interval in seconds.")
    status: str = Field("ACTIVE", description="Operating status.")


class NeighborLink(BaseModel):
    """Pairwise link from a target station to an eligible neighbor station."""
    model_config = ConfigDict(frozen=True)

    target_station_id: str
    neighbor_station_id: str
    distance_km: float
    bearing_deg: float
    elevation_diff_m: float


class SpatialNetworkTopology:
    """Precomputed and cached spatial graph of AWS station nodes and geodesic links."""

    def __init__(self, stations: Optional[Dict[str, StationNode]] = None) -> None:
        self.stations: Dict[str, StationNode] = stations or {}
        self._distance_matrix: Optional[pd.DataFrame] = None
        self._bearing_matrix: Optional[pd.DataFrame] = None
        self._elevation_diff_matrix: Optional[pd.DataFrame] = None
        self._cached_neighbors: Dict[str, List[NeighborLink]] = {}
        
        if self.stations:
            self._recompute_matrices()

    def add_station(self, node: StationNode) -> None:
        """Add or update a station node and invalidate matrix caches."""
        self.stations[node.station_id] = node
        self._recompute_matrices()

    @classmethod
    def from_yaml(cls, yaml_path: Union[str, Path]) -> SpatialNetworkTopology:
        """Construct topology from SkyGuard `stations.yaml` configuration."""
        path = Path(yaml_path)
        if not path.exists():
            raise FileNotFoundError(f"Stations configuration not found at: {path}")

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        stations: Dict[str, StationNode] = {}
        for s in data.get("stations", []):
            s_id = str(s["station_id"])
            node = StationNode(
                station_id=s_id,
                name=s.get("name", f"Station {s_id}"),
                latitude=float(s["latitude"]),
                longitude=float(s["longitude"]),
                elevation_m=float(s.get("elevation", s.get("elevation_m", 0.0))),
                wmo_id=s.get("wmo_id"),
                state=s.get("state"),
                climate_zone=s.get("climate_zone"),
                sampling_interval_seconds=int(s.get("sampling_interval_seconds", 1800)),
                status=s.get("status", "ACTIVE"),
            )
            stations[s_id] = node

        return cls(stations=stations)

    @classmethod
    def from_dataframe(cls, df: pd.DataFrame, station_id_col: str = "station_id") -> SpatialNetworkTopology:
        """Construct topology by inspecting unique station metadata in an observation DataFrame."""
        if df.empty or station_id_col not in df.columns:
            return cls()

        stations: Dict[str, StationNode] = {}
        for s_id, grp in df.groupby(station_id_col):
            row = grp.iloc[0]
            lat = row.get("latitude")
            lon = row.get("longitude")
            if lat is None or lon is None or pd.isna(lat) or pd.isna(lon):
                continue

            elev = row.get("elevation_m", row.get("elevation", 0.0))
            if pd.isna(elev):
                elev = 0.0

            node = StationNode(
                station_id=str(s_id),
                name=str(row.get("station_name", f"Station {s_id}")),
                latitude=float(lat),
                longitude=float(lon),
                elevation_m=float(elev),
                wmo_id=str(row.get("wmo_id", "")) if pd.notna(row.get("wmo_id")) else None,
                state=str(row.get("state", "")) if pd.notna(row.get("state")) else None,
                climate_zone=str(row.get("climate_zone", "")) if pd.notna(row.get("climate_zone")) else None,
            )
            stations[str(s_id)] = node

        return cls(stations=stations)

    @classmethod
    def from_observations(cls, observations: Sequence[Any]) -> SpatialNetworkTopology:
        """Construct topology by inspecting unique station metadata in a sequence of WeatherObservation objects."""
        stations: Dict[str, StationNode] = {}
        for obs in observations:
            s_id = str(obs.station_id)
            if s_id in stations:
                continue
            lat = obs.latitude
            lon = obs.longitude
            if lat is None or lon is None:
                continue
            try:
                if math.isnan(lat) or math.isnan(lon):
                    continue
            except TypeError:
                pass
            elev = getattr(obs, "elevation", 0.0) or 0.0
            try:
                if math.isnan(elev):
                    elev = 0.0
            except TypeError:
                elev = 0.0
            stn_name = getattr(obs, "station_name", None) or f"Station {s_id}"
            node = StationNode(
                station_id=s_id,
                name=str(stn_name),
                latitude=float(lat),
                longitude=float(lon),
                elevation_m=float(elev),
            )
            stations[s_id] = node

        return cls(stations=stations)

    def _recompute_matrices(self) -> None:
        """Recompute pairwise geodesic distances, bearings, and elevation differences."""
        s_ids = list(self.stations.keys())
        n = len(s_ids)
        dist_mat = np.full((n, n), np.nan)
        bear_mat = np.full((n, n), np.nan)
        elev_mat = np.full((n, n), np.nan)

        for i, s1 in enumerate(s_ids):
            node1 = self.stations[s1]
            for j, s2 in enumerate(s_ids):
                if i == j:
                    dist_mat[i, j] = 0.0
                    bear_mat[i, j] = 0.0
                    elev_mat[i, j] = 0.0
                    continue

                node2 = self.stations[s2]
                dist = haversine_distance_km(node1.latitude, node1.longitude, node2.latitude, node2.longitude)
                bearing = initial_compass_bearing_deg(node1.latitude, node1.longitude, node2.latitude, node2.longitude)
                elev_diff = node2.elevation_m - node1.elevation_m

                dist_mat[i, j] = dist
                bear_mat[i, j] = bearing
                elev_mat[i, j] = elev_diff

        self._distance_matrix = pd.DataFrame(dist_mat, index=s_ids, columns=s_ids)
        self._bearing_matrix = pd.DataFrame(bear_mat, index=s_ids, columns=s_ids)
        self._elevation_diff_matrix = pd.DataFrame(elev_mat, index=s_ids, columns=s_ids)
        self._cached_neighbors = {}

    def get_distance_matrix(self) -> pd.DataFrame:
        """Return the square DataFrame of pairwise geodesic distances in km."""
        if self._distance_matrix is None:
            self._recompute_matrices()
        return self._distance_matrix.copy()

    def get_neighbors(
        self,
        target_station_id: str,
        max_distance_km: float = 600.0,
        max_neighbors: int = 5,
        max_elevation_diff_m: Optional[float] = None,
    ) -> List[NeighborLink]:
        """Query deterministic, distance-sorted nearest neighbor links for a target station.
        
        Args:
            target_station_id: Station identifier.
            max_distance_km: Maximum radius in km.
            max_neighbors: Maximum count of nearest neighbors to retain.
            max_elevation_diff_m: Optional maximum absolute elevation difference in meters.
            
        Returns:
            List of `NeighborLink` objects sorted by increasing geodesic distance.
        """
        if target_station_id not in self.stations:
            return []

        cache_key = f"{target_station_id}_{max_distance_km}_{max_neighbors}_{max_elevation_diff_m}"
        if cache_key in self._cached_neighbors:
            return self._cached_neighbors[cache_key]

        if self._distance_matrix is None:
            self._recompute_matrices()

        target_node = self.stations[target_station_id]
        links: List[NeighborLink] = []

        for s_id, s_node in self.stations.items():
            if s_id == target_station_id:
                continue

            dist = self._distance_matrix.loc[target_station_id, s_id]
            if math.isnan(dist) or dist > max_distance_km:
                continue

            elev_diff = s_node.elevation_m - target_node.elevation_m
            if max_elevation_diff_m is not None and abs(elev_diff) > max_elevation_diff_m:
                continue

            bearing = self._bearing_matrix.loc[target_station_id, s_id]

            links.append(
                NeighborLink(
                    target_station_id=target_station_id,
                    neighbor_station_id=s_id,
                    distance_km=float(dist),
                    bearing_deg=float(bearing),
                    elevation_diff_m=float(elev_diff),
                )
            )

        links.sort(key=lambda x: x.distance_km)
        selected = links[:max_neighbors]
        self._cached_neighbors[cache_key] = selected
        return selected

    def to_dict(self) -> Dict[str, Any]:
        """Serialize network topology to a JSON-compatible dictionary."""
        return {
            "stations": {s_id: node.model_dump() for s_id, node in self.stations.items()},
            "station_count": len(self.stations),
        }

    def save_json(self, file_path: Union[str, Path]) -> None:
        """Save network topology artifact to a JSON file."""
        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load_json(cls, file_path: Union[str, Path]) -> SpatialNetworkTopology:
        """Load network topology from a JSON file artifact."""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Topology JSON artifact not found: {path}")

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        stations: Dict[str, StationNode] = {}
        for s_id, s_dict in data.get("stations", {}).items():
            stations[s_id] = StationNode(**s_dict)

        return cls(stations=stations)
