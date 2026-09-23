"""
RAAHI Edge Traffic Data Structures & Metrics (Phase 8C)
======================================================
Defines unified data models for vehicle detections, track history,
virtual line-crossing flow, camera-relative road density/occupancy,
and rule-based traffic state.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple, Optional


@dataclass
class TrackedVehicle:
    """
    Represents an actively tracked vehicle in the current video frame.
    
    Attributes:
        track_id: Sequential integer ID assigned by ByteTrack for this session.
        class_id: COCO class ID (2=car, 3=motorcycle, 5=bus, 7=truck).
        class_name: Human-readable class name ('car', 'motorcycle', 'bus', 'truck').
        confidence: Detection confidence score (0.0 to 1.0).
        bbox: Integer pixel coordinates (x1, y1, x2, y2).
        center: Calculated center point (cx, cy).
    """
    track_id: int
    class_id: int
    class_name: str
    confidence: float
    bbox: Tuple[int, int, int, int]
    center: Tuple[int, int] = (0, 0)

    def __post_init__(self):
        if self.center == (0, 0) and self.bbox:
            x1, y1, x2, y2 = self.bbox
            self.center = ((x1 + x2) // 2, (y1 + y2) // 2)


@dataclass
class FlowMetrics:
    """
    Line-crossing flow measurements over rolling time windows.
    
    Attributes:
        flow_10s: Number of vehicles that crossed the line in the last 10 seconds.
        flow_30s: Number of vehicles that crossed the line in the last 30 seconds.
        flow_60s: Number of vehicles that crossed the line in the last 60 seconds.
        vpm: Normalized vehicles per minute based on recent crossing rate.
        total_in: Total cumulative crossings in the 'IN' direction.
        total_out: Total cumulative crossings in the 'OUT' direction.
        total_unknown: Total cumulative crossings where direction was ambiguous.
        total_crossed: Total cumulative line crossing events.
    """
    flow_10s: int = 0
    flow_30s: int = 0
    flow_60s: int = 0
    vpm: float = 0.0
    total_in: int = 0
    total_out: int = 0
    total_unknown: int = 0
    total_crossed: int = 0


@dataclass
class DensityMetrics:
    """
    Camera-relative road occupancy and density within the configured road ROI.
    
    Attributes:
        vehicles_in_roi: Number of actively tracked vehicle centers inside the ROI polygon.
        occupancy_ratio: Camera-relative ratio (0.0 to 1.0) of ROI area occupied by vehicles.
        occupancy_percent: Occupancy ratio formatted as a percentage (0.0% to 100.0%).
        density_level: Qualitative density level ('LOW', 'MEDIUM', 'HIGH').
    """
    vehicles_in_roi: int = 0
    occupancy_ratio: float = 0.0
    occupancy_percent: float = 0.0
    density_level: str = "LOW"


@dataclass
class TrafficMetrics:
    """
    Unified Edge traffic intelligence metrics combining Phase 8B active counts
    and Phase 8C flow, density, and congestion state.
    
    Attributes:
        active_count: Number of vehicles actively tracked in the current frame.
        per_class_count: Count of active vehicles grouped by class.
        unique_track_ids_count: Total unique track IDs observed in this session.
        seen_track_ids: Set of all unique integer track IDs observed.
        flow: Flow metrics over rolling time windows (Phase 8C).
        density: Camera-relative road density and occupancy metrics (Phase 8C).
        traffic_state: Rule-based traffic state ('FREE', 'MODERATE', 'HEAVY', 'CONGESTED').
    """
    # Phase 8B baseline attributes
    active_count: int = 0
    per_class_count: Dict[str, int] = field(default_factory=lambda: {
        "car": 0,
        "motorcycle": 0,
        "bus": 0,
        "truck": 0
    })
    unique_track_ids_count: int = 0
    seen_track_ids: Set[int] = field(default_factory=set)

    # Phase 8C extensions
    flow: FlowMetrics = field(default_factory=FlowMetrics)
    density: DensityMetrics = field(default_factory=DensityMetrics)
    traffic_state: str = "FREE"

    # Convenience accessors for HUD / logging
    @property
    def cars(self) -> int:
        return self.per_class_count.get("car", 0)

    @property
    def motorcycles(self) -> int:
        return self.per_class_count.get("motorcycle", 0)

    @property
    def buses(self) -> int:
        return self.per_class_count.get("bus", 0)

    @property
    def trucks(self) -> int:
        return self.per_class_count.get("truck", 0)
