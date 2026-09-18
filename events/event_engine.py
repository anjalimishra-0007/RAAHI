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

    def __init__(self, cooldown_sec: float = 15.0, spatial_radius_meters: float = 10.0):
        self.cooldown_sec = cooldown_sec
        self.spatial_radius_meters = spatial_radius_meters
        # Stores recent candidate points: list of (epoch_time, lat, lon)
        self._recent_detections = []

    def should_suppress(self, lat: float, lon: float) -> Tuple[bool, Optional[str]]:
        """
        Returns (True, reason) if a detection within spatial_radius_meters or temporal
        cooldown occurred within cooldown_sec.
        """
        now = time.time()
        # Clean up expired items
        self._recent_detections = [
            (t, lt, ln) for (t, lt, ln) in self._recent_detections if (now - t) < self.cooldown_sec
        ]

        # 1. Fallback temporal check if GPS is not fixed (0.0, 0.0)
        if lat == 0.0 and lon == 0.0:
            if self._recent_detections:
                last_t = self._recent_detections[-1][0]
                elapsed = now - last_t
                if elapsed < self.cooldown_sec:
                    return True, f"Temporal debounce: {self.cooldown_sec - elapsed:.1f}s cooldown remaining"
            self._recent_detections.append((now, 0.0, 0.0))
            return False, None

        # 2. Spatial check if GPS fix is available
        for t, prev_lat, prev_lon in self._recent_detections:
            if prev_lat != 0.0 and prev_lon != 0.0:
                dist = haversine_distance_meters(lat, lon, prev_lat, prev_lon)
                if dist <= self.spatial_radius_meters:
                    return True, f"Local spatial suppression: same candidate within {dist:.1f}m in cooldown window"
            else:
                elapsed = now - t
                if elapsed < self.cooldown_sec:
                    return True, f"Temporal debounce: {self.cooldown_sec - elapsed:.1f}s cooldown remaining"

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
        cooldown_sec: float = 15.0,
        spatial_radius_meters: float = 10.0
    ):
        self.default_bus_id = default_bus_id
        self.edge_model_name = edge_model_name
        self.debouncer = LocalEventDebouncer(cooldown_sec, spatial_radius_meters)
        self.traffic_debouncer = LocalEventDebouncer(cooldown_sec=60.0, spatial_radius_meters=30.0)
        self._event_counter = 0

    def generate_event_id(self, prefix: str = "EVT") -> str:
        """Generates a structured human-readable Event ID."""
        self._event_counter += 1
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        rand_suffix = uuid.uuid4().hex[:4].upper()
        return f"{prefix}-{date_str}-{self._event_counter:05d}-{rand_suffix}"

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

        # Check local spatial/temporal debounce
        suppressed, reason = self.debouncer.should_suppress(lat, lon)
        if suppressed:
            return None, True, reason

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
                "reason": "Awaiting Central deterministic spatial & incident validation"
            },
            "centralDelivery": {
                "status": "PENDING",
                "attempts": 0,
                "lastAttempt": None,
                "centralEventId": None
            }
        }

        return package, False, None

    def create_traffic_event(
        self,
        event_type: str,
        class_name: str,
        confidence: float,
        bbox: Dict[str, int],
        frame_number: int,
        gps_match: Dict[str, Any],
        traffic_metrics: Any,
        bus_id: Optional[str] = None,
        source: str = "RAAHI-Eye"
    ) -> Tuple[Optional[Dict[str, Any]], bool, Optional[str]]:
        """
        Constructs a candidate traffic intelligence event package (e.g. CONGESTION).
        Checks local traffic debouncer: returns (event_package, is_suppressed, suppression_reason).
        """
        bid = (bus_id or self.default_bus_id).strip()
        lat = gps_match.get("latitude", 0.0)
        lon = gps_match.get("longitude", 0.0)

        # Check traffic spatial/temporal debounce (default 60s / 30m window)
        suppressed, reason = self.traffic_debouncer.should_suppress(lat, lon)
        if suppressed:
            return None, True, reason

        event_id = self.generate_event_id(prefix="TRF")
        now_iso = datetime.now(timezone.utc).isoformat()

        # Extract structured traffic telemetry
        telemetry = {}
        if traffic_metrics is not None:
            telemetry = {
                "trafficState": getattr(traffic_metrics, "traffic_state", "CONGESTED"),
                "activeVehicles": getattr(traffic_metrics, "active_count", 0),
                "vehiclesInRoi": getattr(traffic_metrics.density, "vehicles_in_roi", 0) if hasattr(traffic_metrics, "density") else 0,
                "occupancyRatio": getattr(traffic_metrics.density, "occupancy_ratio", 0.0) if hasattr(traffic_metrics, "density") else 0.0,
                "flowVpm": getattr(traffic_metrics.flow, "vpm", 0.0) if hasattr(traffic_metrics, "flow") else 0.0,
                "flow10s": getattr(traffic_metrics.flow, "flow_10s", 0) if hasattr(traffic_metrics, "flow") else 0,
                "flow60s": getattr(traffic_metrics.flow, "flow_60s", 0) if hasattr(traffic_metrics, "flow") else 0,
                "perClassCount": getattr(traffic_metrics, "per_class_count", {})
            }

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
            "edgeModel": "yolo11n-bytetrack",
            "edgeConfidence": round(float(confidence), 3),
            "bbox": bbox,
            "frameNumber": int(frame_number),
            "source": source,
            "trafficTelemetry": telemetry,
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
                "reason": "Awaiting Central deterministic spatial & incident validation"
            },
            "centralDelivery": {
                "status": "PENDING",
                "attempts": 0,
                "lastAttempt": None,
                "centralEventId": None
            }
        }

        return package, False, None
