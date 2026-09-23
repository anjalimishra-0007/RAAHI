"""
RAAHI Edge Virtual Line-Crossing & Flow Rate Subsystem (Phase 8C)
================================================================
Implements deterministic virtual line-crossing detection, crossing direction
determination (IN, OUT, UNKNOWN), and rolling flow rate windows (10s, 30s, 60s).

STRICT PRINCIPLES:
1. Flow means vehicles that physically crossed the virtual counting line.
   Active tracks are NOT counted as flow.
2. A vehicle crossing the line must be counted strictly ONCE per crossing event.
3. No duplicate counts while a vehicle hovers near the line.
"""

from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple
from .metrics import FlowMetrics, TrackedVehicle
from .track_history import TrackHistoryManager, TrackPoint


@dataclass
class LineCrossingEvent:
    """
    Records a discrete line-crossing event.
    """
    timestamp: float
    frame_idx: int
    track_id: int
    class_name: str
    direction: str  # 'IN', 'OUT', or 'UNKNOWN'
    point: Tuple[int, int]


class LineCrossingDetector:
    """
    Detects trajectory intersections across a configurable virtual counting line
    and calculates rolling flow metrics.
    """
    def __init__(
        self,
        line_start: Tuple[float, float] = (0.05, 0.65),
        line_end: Tuple[float, float] = (0.95, 0.65),
        debounce_seconds: float = 4.0
    ):
        # Normalized coordinates (0.0 to 1.0)
        self.line_start = line_start
        self.line_end = line_end
        self.debounce_seconds = debounce_seconds

        # Crossing events buffer for rolling window calculations (retains last 70s)
        self._events: deque[LineCrossingEvent] = deque()

        # Deduplication guard: track_id -> timestamp of last counted crossing
        self._last_crossing_time: Dict[int, float] = {}

        # Cumulative counters
        self.total_in = 0
        self.total_out = 0
        self.total_unknown = 0

        # Session tracking start time for VPM normalization
        self.session_start_time: Optional[float] = None

    def get_pixel_line(self, frame_w: int, frame_h: int) -> Tuple[Tuple[int, int], Tuple[int, int]]:
        """
        Scales normalized line coordinates to integer pixel coordinates for the given resolution.
        """
        p1 = (int(self.line_start[0] * frame_w), int(self.line_start[1] * frame_h))
        p2 = (int(self.line_end[0] * frame_w), int(self.line_end[1] * frame_h))
        return p1, p2

    @staticmethod
    def _ccw(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> float:
        """2D cross product of vector AB and AC."""
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    @staticmethod
    def _on_segment(a: Tuple[float, float], b: Tuple[float, float], p: Tuple[float, float]) -> bool:
        """Checks if point P lies on line segment AB."""
        return (
            min(a[0], b[0]) <= p[0] <= max(a[0], b[0]) and
            min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
        )

    def check_intersection(
        self,
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        l1: Tuple[float, float],
        l2: Tuple[float, float]
    ) -> bool:
        """
        Determines if line segment P1-P2 (vehicle trajectory) intersects
        counting line segment L1-L2.
        """
        ccw1 = self._ccw(l1, l2, p1)
        ccw2 = self._ccw(l1, l2, p2)
        ccw3 = self._ccw(p1, p2, l1)
        ccw4 = self._ccw(p1, p2, l2)

        # Standard crossing: endpoints straddle both lines
        if ((ccw1 > 0 and ccw2 < 0) or (ccw1 < 0 and ccw2 > 0)) and \
           ((ccw3 > 0 and ccw4 < 0) or (ccw3 < 0 and ccw4 > 0)):
            return True

        # Collinear / touching boundary cases
        if abs(ccw1) < 1e-5 and self._on_segment(l1, l2, p1):
            return True
        if abs(ccw2) < 1e-5 and self._on_segment(l1, l2, p2):
            return True
        if abs(ccw3) < 1e-5 and self._on_segment(p1, p2, l1):
            return True
        if abs(ccw4) < 1e-5 and self._on_segment(p1, p2, l2):
            return True

        return False

    def determine_direction(
        self,
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        l1: Tuple[float, float],
        l2: Tuple[float, float]
    ) -> str:
        """
        Computes motion direction relative to counting line vector L1 -> L2.
        Cross product (L2 - L1) x (P2 - P1):
        - Positive: IN (left-to-right relative to line orientation)
        - Negative: OUT (right-to-left relative to line orientation)
        - Near-zero / minimal displacement: UNKNOWN
        """
        lx = l2[0] - l1[0]
        ly = l2[1] - l1[1]
        vx = p2[0] - p1[0]
        vy = p2[1] - p1[1]

        displacement_sq = vx * vx + vy * vy
        if displacement_sq < 4.0:  # Less than 2 pixels of motion
            return "UNKNOWN"

        cross_prod = lx * vy - ly * vx
        if abs(cross_prod) < 1e-3:
            return "UNKNOWN"
        return "IN" if cross_prod > 0 else "OUT"

    def update(
        self,
        history_manager: TrackHistoryManager,
        active_tracks: List[TrackedVehicle],
        frame_size: Tuple[int, int],
        timestamp: float,
        frame_idx: int
    ) -> List[LineCrossingEvent]:
        """
        Checks active tracks for line crossings and updates rolling flow windows.
        """
        if self.session_start_time is None:
            self.session_start_time = timestamp

        w, h = frame_size
        l1, l2 = self.get_pixel_line(w, h)
        new_crossings: List[LineCrossingEvent] = []

        for track in active_tracks:
            tid = track.track_id
            segment = history_manager.get_recent_segment(tid)
            if not segment:
                continue

            prev_pt, curr_pt = segment
            p1 = (float(prev_pt.x), float(prev_pt.y))
            p2 = (float(curr_pt.x), float(curr_pt.y))

            # Deduplication cooldown check
            last_time = self._last_crossing_time.get(tid, -1e9)
            if timestamp - last_time < self.debounce_seconds:
                continue

            # Check if trajectory crossed the line
            if self.check_intersection(p1, p2, l1, l2):
                direction = self.determine_direction(p1, p2, l1, l2)
                event = LineCrossingEvent(
                    timestamp=timestamp,
                    frame_idx=frame_idx,
                    track_id=tid,
                    class_name=track.class_name,
                    direction=direction,
                    point=track.center
                )
                self._events.append(event)
                self._last_crossing_time[tid] = timestamp
                new_crossings.append(event)

                if direction == "IN":
                    self.total_in += 1
                elif direction == "OUT":
                    self.total_out += 1
                else:
                    self.total_unknown += 1

        # Prune crossing events older than 65 seconds
        while self._events and (timestamp - self._events[0].timestamp > 65.0):
            self._events.popleft()

        return new_crossings

    def get_metrics(self, current_time: float) -> FlowMetrics:
        """
        Computes rolling flow counts (10s, 30s, 60s) and vehicles-per-minute.
        """
        f10 = 0
        f30 = 0
        f60 = 0

        for evt in self._events:
            dt = current_time - evt.timestamp
            if dt <= 10.0:
                f10 += 1
            if dt <= 30.0:
                f30 += 1
            if dt <= 60.0:
                f60 += 1

        # Normalized vehicles per minute (VPM)
        elapsed = max(0.1, current_time - (self.session_start_time or current_time))
        if elapsed < 60.0:
            # Extrapolate from current session if under 60 seconds
            total_window = len(self._events)
            vpm = round((total_window / elapsed) * 60.0, 1)
        else:
            vpm = float(f60)

        return FlowMetrics(
            flow_10s=f10,
            flow_30s=f30,
            flow_60s=f60,
            vpm=vpm,
            total_in=self.total_in,
            total_out=self.total_out,
            total_unknown=self.total_unknown,
            total_crossed=self.total_in + self.total_out + self.total_unknown
        )

    def reset(self) -> None:
        """Clears all events, deduplication states, and cumulative counters."""
        self._events.clear()
        self._last_crossing_time.clear()
        self.total_in = 0
        self.total_out = 0
        self.total_unknown = 0
        self.session_start_time = None
