"""
RAAHI Edge Traffic Intelligence Module (Phase 8C)
=================================================
Local, real-time vehicle detection, ByteTrack tracking, trajectory history,
virtual line-crossing flow, camera-relative density, and traffic-state classification.

Exports:
- VehicleTracker: Unified vehicle tracker and metrics engine.
- TrackedVehicle, FlowMetrics, DensityMetrics, TrafficMetrics: Data structures.
- TrackHistoryManager: Bounded center-point trajectory manager.
- LineCrossingDetector: Virtual counting line evaluator.
- RoadRoi, DEFAULT_ROAD_ROI: Road region of interest and density calculator.
- CongestionClassifier, CongestionConfig: Rule-based traffic state classifier.
- draw_tracked_vehicles, draw_traffic_overlays, draw_traffic_hud: Visualization utilities.
- VEHICLE_CLASS_IDS, VEHICLE_CLASS_NAMES: Supported COCO class taxonomy.
"""

from .metrics import (
    TrackedVehicle,
    FlowMetrics,
    DensityMetrics,
    TrafficMetrics
)
from .track_history import TrackHistoryManager, TrackPoint
from .flow import LineCrossingDetector, LineCrossingEvent
from .density import RoadRoi, DEFAULT_ROAD_ROI
from .congestion import CongestionClassifier, CongestionConfig
from .vehicle_tracker import (
    VehicleTracker,
    VEHICLE_CLASS_IDS,
    VEHICLE_CLASS_NAMES
)
from .visualizer import (
    draw_tracked_vehicles,
    draw_traffic_overlays,
    draw_traffic_hud
)

__all__ = [
    "VehicleTracker",
    "VEHICLE_CLASS_IDS",
    "VEHICLE_CLASS_NAMES",
    "TrackedVehicle",
    "FlowMetrics",
    "DensityMetrics",
    "TrafficMetrics",
    "TrackHistoryManager",
    "TrackPoint",
    "LineCrossingDetector",
    "LineCrossingEvent",
    "RoadRoi",
    "DEFAULT_ROAD_ROI",
    "CongestionClassifier",
    "CongestionConfig",
    "draw_tracked_vehicles",
    "draw_traffic_overlays",
    "draw_traffic_hud"
]
