"""
GPS Manager for RAAHI-Edge.
Maintains per-bus GPS telemetry history and associates detection timestamps
with nearest-neighbor GPS fixes.
"""

import collections
import math
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any


def parse_timestamp_to_epoch_ms(ts: Any) -> Optional[float]:
    """Parses ISO-8601 string, Date object, or numeric timestamp to epoch milliseconds."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        # If seconds (e.g. 1.7e9), convert to ms
        return ts * 1000.0 if ts < 1e11 else float(ts)
    if isinstance(ts, str):
        try:
            # Handle ISO string
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return dt.timestamp() * 1000.0
        except Exception:
            try:
                val = float(ts)
                return val * 1000.0 if val < 1e11 else val
            except Exception:
                return None
    return None


def evaluate_gps_accuracy(accuracy_m: Optional[float]) -> Dict[str, Any]:
    """Rates GPS horizontal accuracy in meters."""
    if accuracy_m is None or accuracy_m < 0 or math.isnan(accuracy_m):
        return {"tier": "unknown", "score": 0.5, "label": "Unknown Accuracy", "usable": True}
    if accuracy_m <= 5.0:
        return {"tier": "excellent", "score": 1.0, "label": f"High Precision (±{accuracy_m:.1f}m)", "usable": True}
    if accuracy_m <= 15.0:
        return {"tier": "good", "score": 0.85, "label": f"Good Precision (±{accuracy_m:.1f}m)", "usable": True}
    if accuracy_m <= 35.0:
        return {"tier": "moderate", "score": 0.65, "label": f"Moderate Precision (±{accuracy_m:.1f}m)", "usable": True}
    return {"tier": "degraded", "score": 0.3, "label": f"Degraded Drift (±{accuracy_m:.1f}m)", "usable": False}


class GpsManager:
    """
    Manages per-bus GPS telemetry history and performs nearest-neighbor
    timestamp association for candidate events.
    """

    def __init__(self, max_history_per_bus: int = 1000, default_bus_id: str = "RAAHI-001"):
        self.max_history_per_bus = max_history_per_bus
        self.default_bus_id = default_bus_id
        self.lock = threading.Lock()
        # bus_id -> deque of GPS samples
        self._bus_history: Dict[str, collections.deque] = collections.defaultdict(
            lambda: collections.deque(maxlen=self.max_history_per_bus)
        )
        # bus_id -> latest sample
        self._latest_fix: Dict[str, Dict[str, Any]] = {}

    def ingest_sample(
        self,
        latitude: float,
        longitude: float,
        accuracy: Optional[float] = None,
        timestamp: Optional[Any] = None,
        speed: Optional[float] = None,
        bus_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Ingests a GPS fix into the bus history."""
        bid = (bus_id or self.default_bus_id).strip()
        epoch_ms = parse_timestamp_to_epoch_ms(timestamp) or (time.time() * 1000.0)
        iso_str = datetime.fromtimestamp(epoch_ms / 1000.0, timezone.utc).isoformat()

        sample = {
            "busId": bid,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "accuracy": float(accuracy) if accuracy is not None else None,
            "speed": float(speed) if speed is not None else None,
            "timestamp": iso_str,
            "epochMs": epoch_ms,
            "receivedAt": datetime.now(timezone.utc).isoformat()
        }

        with self.lock:
            self._bus_history[bid].append(sample)
            self._latest_fix[bid] = sample

        return sample

    def get_latest_fix(self, bus_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Returns the latest GPS fix for the specified bus."""
        bid = (bus_id or self.default_bus_id).strip()
        with self.lock:
            return self._latest_fix.get(bid)

    def match_detection(
        self,
        detection_timestamp: Any,
        bus_id: Optional[str] = None,
        max_delta_ms: float = 2000.0
    ) -> Dict[str, Any]:
        """
        Matches a detection timestamp against the nearest GPS sample in history.
        If no sample is within max_delta_ms, falls back to latest fix if available with flag.
        """
        bid = (bus_id or self.default_bus_id).strip()
        target_ms = parse_timestamp_to_epoch_ms(detection_timestamp) or (time.time() * 1000.0)

        with self.lock:
            samples = list(self._bus_history.get(bid, []))
            latest = self._latest_fix.get(bid)

        if not samples:
            return {
                "matched": False,
                "reason": f"No GPS telemetry in history buffer for bus {bid}",
                "latitude": latest["latitude"] if latest else 0.0,
                "longitude": latest["longitude"] if latest else 0.0,
                "accuracy": latest.get("accuracy") if latest else None,
                "timeDeltaMs": None,
                "isFallback": True
            }

        # Find sample with minimum |epochMs - target_ms|
        best_sample = None
        min_delta = float("inf")

        for s in samples:
            delta = abs(s["epochMs"] - target_ms)
            if delta < min_delta:
                min_delta = delta
                best_sample = s

        if best_sample is None:
            return {
                "matched": False,
                "reason": "Could not correlate with any valid GPS sample",
                "latitude": 0.0,
                "longitude": 0.0,
                "accuracy": None,
                "timeDeltaMs": None,
                "isFallback": True
            }

        accuracy_eval = evaluate_gps_accuracy(best_sample.get("accuracy"))
        exceeds_window = min_delta > max_delta_ms

        if exceeds_window:
            # Stale match fallback
            return {
                "matched": False,
                "reason": f"Closest GPS sample was {min_delta:.0f}ms away (exceeds threshold {max_delta_ms:.0f}ms)",
                "latitude": best_sample["latitude"],
                "longitude": best_sample["longitude"],
                "accuracy": best_sample.get("accuracy"),
                "gpsTimestamp": best_sample["timestamp"],
                "timeDeltaMs": min_delta,
                "accuracyEvaluation": accuracy_eval,
                "isFallback": True
            }

        return {
            "matched": True,
            "latitude": best_sample["latitude"],
            "longitude": best_sample["longitude"],
            "accuracy": best_sample.get("accuracy"),
            "gpsTimestamp": best_sample["timestamp"],
            "timeDeltaMs": min_delta,
            "accuracyEvaluation": accuracy_eval,
            "isFallback": False
        }

    def get_stats(self) -> Dict[str, Any]:
        """Returns statistics of all active bus GPS streams."""
        with self.lock:
            res = {}
            for bid, history in self._bus_history.items():
                latest = self._latest_fix.get(bid)
                res[bid] = {
                    "sampleCount": len(history),
                    "hasFix": latest is not None,
                    "latestFix": latest
                }
            return res
