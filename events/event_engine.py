"""
Event Engine for RAAHI-Edge.
Constructs canonical edge Event Packages and applies local spatial suppression (debounce).
"""

import math
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates spherical Haversine great-circle distance in meters between two lat/lon pairs."""
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    r = 6371000.0  # Earth radius in meters
    to_rad = math.pi / 180.0
    phi1 = lat1 * to_rad
    phi2 = lat2 * to_rad
    delta_phi = (lat2 - lat1) * to_rad
    delta_lambda = (lon2 - lon1) * to_rad

    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


class LocalEventDebouncer:
    """
    Prevents high-frequency duplicate candidate events from flooding the pipeline
    when the same physical pothole remains visible across consecutive video frames.
    """

    def __init__(self, cooldown_sec: float = 3.0, spatial_radius_meters: float = 10.0):
        self.cooldown_sec = cooldown_sec
        self.spatial_radius_meters = spatial_radius_meters
        # Stores recent candidate points: list of (epoch_time, lat, lon)
        self._recent_detections = []

    def should_suppress(self, lat: float, lon: float) -> Tuple[bool, Optional[float]]:
        """
        Returns (True, distance_meters) if a detection within spatial_radius_meters
        occurred within the last cooldown_sec.
        """
        now = time.time()
        # Clean up expired items
        self._recent_detections = [
            (t, lt, ln) for (t, lt, ln) in self._recent_detections if (now - t) < self.cooldown_sec
        ]

        for t, prev_lat, prev_lon in self._recent_detections:
            dist = haversine_distance_meters(lat, lon, prev_lat, prev_lon)
            if dist <= self.spatial_radius_meters:
                return True, dist

        # Not suppressed; register new detection
        self._recent_detections.append((now, lat, lon))
        return False, None


class EventEngine:
    """
    Builds canonical Event Packages conforming to RAAHI architectural standards.
    """

    def __init__(
        self,
        default_bus_id: str = "RAAHI-001",
        edge_model_name: str = "YOLO11n",
        cooldown_sec: float = 3.0,
        spatial_radius_meters: float = 10.0
    ):
        self.default_bus_id = default_bus_id
        self.edge_model_name = edge_model_name
        self.debouncer = LocalEventDebouncer(cooldown_sec, spatial_radius_meters)
        self._event_counter = 0

    def generate_event_id(self) -> str:
        """Generates a structured human-readable Event ID."""
        self._event_counter += 1
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        rand_suffix = uuid.uuid4().hex[:4].upper()
        return f"EVT-{date_str}-{self._event_counter:05d}-{rand_suffix}"

    def create_candidate_event(
        self,
        event_type: str,
        class_name: str,
        confidence: float,
        bbox: Dict[str, int],
        frame_number: int,
        gps_match: Dict[str, Any],
        bus_id: Optional[str] = None,
        source: str = "RAAHI-Eye"
    ) -> Tuple[Optional[Dict[str, Any]], bool, Optional[str]]:
        """
        Constructs a complete candidate event package.
        Checks local debouncer: returns (event_package, is_suppressed, suppression_reason).
        """
        bid = (bus_id or self.default_bus_id).strip()
        lat = gps_match.get("latitude", 0.0)
        lon = gps_match.get("longitude", 0.0)

        # Check local spatial debounce
        if lat != 0.0 and lon != 0.0:
            suppressed, dist = self.debouncer.should_suppress(lat, lon)
            if suppressed:
                return None, True, f"Local spatial suppression: same candidate within {dist:.1f}m in cooldown window"

        event_id = self.generate_event_id()
        now_iso = datetime.now(timezone.utc).isoformat()

        package = {
            "eventId": event_id,
            "eventType": event_type,
            "className": class_name,
            "busId": bid,
            "timestamp": now_iso,
            "latitude": lat,
            "longitude": lon,
            "gpsAccuracy": gps_match.get("accuracy"),
            "gpsTimestamp": gps_match.get("gpsTimestamp"),
            "isGpsFallback": gps_match.get("isFallback", False),
            "edgeModel": self.edge_model_name,
            "edgeConfidence": round(float(confidence), 3),
            "bbox": bbox,
            "frameNumber": int(frame_number),
            "source": source,
            "evidence": {
                "clipPath": None,
                "framePaths": [],
                "fileSizeBytes": 0,
                "durationSec": 0.0,
                "generated": False
            },
            "verification": {
                "status": "PENDING_VERIFICATION",
                "centralModel": None,
                "verifiedAt": None,
                "reason": "Awaiting 7B-30B Multimodal VLM analysis"
            },
            "centralDelivery": {
                "status": "PENDING",
                "attempts": 0,
                "lastAttempt": None,
                "centralEventId": None
            }
        }

        return package, False, None
