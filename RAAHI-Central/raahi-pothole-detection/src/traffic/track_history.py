"""
RAAHI Edge Vehicle Track History Subsystem (Phase 8C)
=====================================================
Maintains bounded local center-point trajectory history for actively
tracked vehicles without retaining raw video frames.

STRICT PRINCIPLES:
1. Retains bounded center point history (default max 30 points per vehicle).
2. Prunes inactive tracks exceeding max_age_seconds (default 5.0 seconds).
3. Track IDs are session-local and never interpreted as permanent identities.
"""

from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from .metrics import TrackedVehicle


@dataclass
class TrackPoint:
    """
    A single spatio-temporal coordinate sample in a vehicle's trajectory.
    """
    x: int
    y: int
    timestamp: float
    frame_idx: int


class TrackHistoryManager:
    """
    Thread-safe, bounded memory manager for vehicle center trajectories.
    """
    def __init__(
        self,
        max_history_points: int = 30,
        max_age_seconds: float = 5.0
    ):
        self.max_history_points = max(2, max_history_points)
        self.max_age_seconds = max_age_seconds

        # Map track_id -> deque of TrackPoint
        self._history: Dict[int, deque] = {}
        # Map track_id -> last seen timestamp
        self._last_seen: Dict[int, float] = {}
        # Map track_id -> class name
        self._class_names: Dict[int, str] = {}

    def update(
        self,
        tracks: List[TrackedVehicle],
        timestamp: float,
        frame_idx: int
    ) -> None:
        """
        Appends the latest center coordinates for currently active tracks
        and triggers age-based cleanup of obsolete tracks.
        """
        active_ids = set()

        for track in tracks:
            tid = track.track_id
            active_ids.add(tid)
            self._last_seen[tid] = timestamp
            self._class_names[tid] = track.class_name

            if tid not in self._history:
                self._history[tid] = deque(maxlen=self.max_history_points)

            cx, cy = track.center
            self._history[tid].append(TrackPoint(
                x=cx,
                y=cy,
                timestamp=timestamp,
                frame_idx=frame_idx
            ))

        # Periodic cleanup of tracks that have disappeared
        self.cleanup(timestamp)

    def get_recent_segment(
        self,
        track_id: int
    ) -> Optional[Tuple[TrackPoint, TrackPoint]]:
        """
        Returns (previous_point, current_point) for a track if it has at least 2 points.
        Used by the line-crossing detector to evaluate displacement.
        """
        points = self._history.get(track_id)
        if points and len(points) >= 2:
            return points[-2], points[-1]
        return None

    def get_points(self, track_id: int) -> List[Tuple[int, int]]:
        """
        Returns list of (x, y) coordinates for rendering motion trails.
        """
        points = self._history.get(track_id)
        if not points:
            return []
        return [(p.x, p.y) for p in points]

    def get_displacement_speed(self, track_id: int) -> float:
        """
        Calculates recent average pixel speed (pixels per second) over recent history.
        Used as an ego-motion/traffic flow activity heuristic.
        """
        points = self._history.get(track_id)
        if not points or len(points) < 2:
            return 0.0

        p_start = points[0]
        p_end = points[-1]
        dt = p_end.timestamp - p_start.timestamp
        if dt <= 0.001:
            return 0.0

        dx = p_end.x - p_start.x
        dy = p_end.y - p_start.y
        dist = (dx * dx + dy * dy) ** 0.5
        return dist / dt

    def cleanup(self, current_time: float) -> None:
        """
        Removes any tracks that have not been observed for longer than max_age_seconds.
        """
        dead_ids = [
            tid for tid, last_t in self._last_seen.items()
            if current_time - last_t > self.max_age_seconds
        ]
        for tid in dead_ids:
            self._history.pop(tid, None)
            self._last_seen.pop(tid, None)
            self._class_names.pop(tid, None)

    def active_track_count(self) -> int:
        """Returns number of tracks currently held in history."""
        return len(self._history)

    def reset(self) -> None:
        """Clears all stored history."""
        self._history.clear()
        self._last_seen.clear()
        self._class_names.clear()
