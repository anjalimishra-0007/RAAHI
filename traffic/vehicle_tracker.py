"""
RAAHI Edge Vehicle Tracking Subsystem (Phase 8C)
================================================
Wraps Ultralytics YOLO11n COCO inference with ByteTrack, trajectory history,
virtual line-crossing flow, camera-relative density, and traffic-state classification.

STRICT ARCHITECTURAL PRINCIPLES:
1. Operates exclusively with the base COCO model (yolo11n.pt).
   NEVER uses or modifies the custom pothole model (models/pothole_yolo11n.pt).
2. Targets strictly 4 vehicle classes:
   - 2: car
   - 3: motorcycle
   - 5: bus
   - 7: truck
3. Track IDs are LOCAL ONLY to this Edge camera session.
   They are NOT permanent vehicle identities, NOT global IDs, and NOT cross-bus identifiers.
4. All traffic density and congestion measurements are camera-relative and local.
"""

import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
import numpy as np
import torch
from ultralytics import YOLO

from .metrics import DensityMetrics, FlowMetrics, TrackedVehicle, TrafficMetrics
from .track_history import TrackHistoryManager
from .flow import LineCrossingDetector
from .density import RoadRoi, DEFAULT_ROAD_ROI
from .congestion import CongestionClassifier, CongestionConfig

# COCO 80-Class Index Mapping for Supported Road Vehicles
VEHICLE_CLASS_IDS = [2, 3, 5, 7]
VEHICLE_CLASS_NAMES = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck"
}


class VehicleTracker:
    """
    Manages vehicle detection, ByteTrack tracking, trajectory history,
    line-crossing flow, road density, and traffic-state classification.
    """
    def __init__(
        self,
        model_path: str = "yolo11n.pt",
        conf: float = 0.30,
        imgsz: int = 640,
        device: Optional[str] = None,
        tracker_config: str = "bytetrack.yaml",
        roi_polygon: Optional[List[Tuple[float, float]]] = None,
        count_line: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None,
        congestion_config: Optional[CongestionConfig] = None
    ):
        p = Path(model_path)
        if not p.exists() and (Path("models") / p.name).exists():
            p = Path("models") / p.name
        self.model_path = p
        if not self.model_path.exists():
            raise FileNotFoundError(f"COCO YOLO11n weights not found at: {self.model_path}")

        self.conf = conf
        self.imgsz = imgsz
        self.device = device if device else self._get_default_device()
        self.tracker_config = tracker_config

        # Load COCO YOLO model
        self.model = YOLO(str(self.model_path))

        # Validate that the model includes expected vehicle classes
        for cls_id, expected_name in VEHICLE_CLASS_NAMES.items():
            actual_name = self.model.names.get(cls_id)
            if actual_name != expected_name:
                raise ValueError(
                    f"Model class mismatch at index {cls_id}: expected '{expected_name}', got '{actual_name}'. "
                    f"Ensure you are loading the COCO-trained base model, NOT the custom pothole model."
                )

        # Session tracking state (local only)
        self.seen_track_ids: Set[int] = set()
        self.frame_counter: int = 0

        # Phase 8C subcomponents
        self.history_manager = TrackHistoryManager(max_history_points=30, max_age_seconds=5.0)

        # Counting line setup (default: horizontal line across lower roadway at y=0.65)
        if count_line is not None:
            l_start, l_end = count_line
            self.count_line = (l_start, l_end)
            self.line_detector = LineCrossingDetector(line_start=l_start, line_end=l_end)
        else:
            self.count_line = ((0.05, 0.65), (0.95, 0.65))
            self.line_detector = LineCrossingDetector(line_start=(0.05, 0.65), line_end=(0.95, 0.65))

        # Road ROI setup
        self.roi_polygon = roi_polygon if roi_polygon is not None else list(DEFAULT_ROAD_ROI)
        self.road_roi = RoadRoi(polygon=self.roi_polygon)

        # Congestion classifier setup
        self.congestion_classifier = CongestionClassifier(config=congestion_config)

        # Cached state for cadence downsampling
        self.latest_tracks: List[TrackedVehicle] = []
        self.latest_metrics: TrafficMetrics = TrafficMetrics()

        # Latency profiling
        self.last_inference_ms: float = 0.0
        self.last_bytetrack_ms: float = 0.0
        self.last_total_ms: float = 0.0

    @property
    def tracked_classes(self) -> List[str]:
        return list(VEHICLE_CLASS_NAMES.values())

    @staticmethod
    def _get_default_device() -> str:
        """Selects best available hardware accelerator."""
        if torch.backends.mps.is_available():
            return "mps"
        elif torch.cuda.is_available():
            return "cuda"
        return "cpu"

    def track(
        self,
        frame: np.ndarray,
        timestamp: Optional[float] = None,
        frame_idx: Optional[int] = None
    ) -> Tuple[List[TrackedVehicle], TrafficMetrics]:
        """
        Executes ByteTrack on a video frame and returns tracked vehicles and unified traffic metrics.
        
        Args:
            frame: OpenCV BGR frame (numpy array).
            timestamp: Monotonic or wall timestamp (seconds). If None, uses time.time().
            frame_idx: Optional sequential frame number.
            
        Returns:
            Tuple of:
            - List of TrackedVehicle instances in the current frame.
            - Unified TrafficMetrics object with counts, flow, density, and traffic state.
        """
        if frame is None or frame.size == 0:
            return [], TrafficMetrics(seen_track_ids=set(self.seen_track_ids))

        curr_time = timestamp if timestamp is not None else time.time()
        self.frame_counter += 1
        curr_frame_idx = frame_idx if frame_idx is not None else self.frame_counter

        h, w = frame.shape[:2]

        t_start = time.time()
        # 1. Run ByteTrack tracking using Ultralytics native API
        results = self.model.track(
            source=frame,
            persist=True,
            tracker=self.tracker_config,
            classes=VEHICLE_CLASS_IDS,
            conf=self.conf,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False
        )

        tracked_vehicles: List[TrackedVehicle] = []
        per_class_count = {name: 0 for name in VEHICLE_CLASS_NAMES.values()}

        infer_ms = 0.0
        post_ms = 0.0
        if results and len(results) > 0:
            res = results[0]
            if hasattr(res, 'speed') and isinstance(res.speed, dict):
                infer_ms = res.speed.get('inference', 0.0)
                post_ms = res.speed.get('postprocess', 0.0)
            boxes = res.boxes

            if boxes is not None and boxes.id is not None:
                track_ids = boxes.id.int().cpu().tolist()
                cls_ids = boxes.cls.int().cpu().tolist()
                confs = boxes.conf.cpu().tolist()
                xyxys = boxes.xyxy.int().cpu().tolist()

                for tid, cid, conf_val, xyxy in zip(track_ids, cls_ids, confs, xyxys):
                    if cid not in VEHICLE_CLASS_NAMES:
                        continue

                    class_name = VEHICLE_CLASS_NAMES[cid]
                    x1, y1, x2, y2 = xyxy
                    cx = (x1 + x2) // 2
                    cy = (y1 + y2) // 2

                    vehicle = TrackedVehicle(
                        track_id=int(tid),
                        class_id=int(cid),
                        class_name=class_name,
                        confidence=round(float(conf_val), 2),
                        bbox=(x1, y1, x2, y2),
                        center=(cx, cy)
                    )
                    tracked_vehicles.append(vehicle)

                    # Update local class count
                    per_class_count[class_name] = per_class_count.get(class_name, 0) + 1

                    # Accumulate session unique track IDs
                    self.seen_track_ids.add(int(tid))

        # 2. Update trajectory history
        self.history_manager.update(tracked_vehicles, curr_time, curr_frame_idx)

        # 3. Detect line crossings and calculate rolling flow
        self.line_detector.update(
            history_manager=self.history_manager,
            active_tracks=tracked_vehicles,
            frame_size=(w, h),
            timestamp=curr_time,
            frame_idx=curr_frame_idx
        )
        flow_metrics = self.line_detector.get_metrics(curr_time)

        # 4. Evaluate road ROI occupancy and density
        density_metrics = self.road_roi.evaluate(
            active_tracks=tracked_vehicles,
            frame_size=(w, h)
        )

        # 5. Classify traffic state
        traffic_state = self.congestion_classifier.classify(
            occupancy_ratio=density_metrics.occupancy_ratio,
            vehicles_in_roi=density_metrics.vehicles_in_roi,
            active_count=len(tracked_vehicles),
            flow_vpm=flow_metrics.vpm
        )

        # 6. Package unified metrics
        metrics = TrafficMetrics(
            active_count=len(tracked_vehicles),
            per_class_count=per_class_count,
            unique_track_ids_count=len(self.seen_track_ids),
            seen_track_ids=set(self.seen_track_ids),
            flow=flow_metrics,
            density=density_metrics,
            traffic_state=traffic_state
        )

        self.latest_tracks = tracked_vehicles
        self.latest_metrics = metrics

        total_elapsed_ms = (time.time() - t_start) * 1000.0
        self.last_inference_ms = round(infer_ms, 1)
        self.last_bytetrack_ms = round(post_ms if post_ms > 0 else max(0.0, total_elapsed_ms - infer_ms), 1)
        self.last_total_ms = round(total_elapsed_ms, 1)

        return tracked_vehicles, metrics

    @property
    def metrics(self) -> TrafficMetrics:
        """Returns the latest traffic metrics computed by the tracker."""
        return self.latest_metrics

    def reset_session(self) -> None:
        """Resets all session state, track IDs, history, flow, and tracker internals."""
        self.seen_track_ids.clear()
        self.frame_counter = 0
        self.history_manager.reset()
        self.line_detector.reset()
        self.latest_tracks.clear()
        self.latest_metrics = TrafficMetrics()

        if hasattr(self.model, 'predictor'):
            self.model.predictor = None
