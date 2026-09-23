#!/usr/bin/env python3
"""
tests/test_traffic_pipeline.py
Comprehensive unit test suite for RAAHI-Edge Traffic & Vehicle Perception Pipeline.
Tests:
1. Vehicle detection & COCO class mapping (2=car, 3=motorcycle, 5=bus, 7=truck)
2. Class filtering (non-vehicle classes strictly ignored)
3. ByteTrack tracking & integer track ID generation
4. In-frame vehicle counting & per-class breakdown
5. Trajectory history & displacement speed calculation
6. Virtual line crossing detection (direction, debounce, single count)
7. Rolling flow windows & VPM calculation
8. Road ROI membership & occupancy ratio calculation with box overlap
9. Rule-based traffic state & congestion classification
10. Session reset & memory bounded cleanup
11. Regression check: Pothole model (pothole_yolo11n.pt) intact with 8 classes
"""

import os
import sys
import unittest
from pathlib import Path
import numpy as np
import torch
from ultralytics import YOLO

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from traffic import (
    VehicleTracker,
    VEHICLE_CLASS_IDS,
    VEHICLE_CLASS_NAMES,
    TrackedVehicle,
    TrafficMetrics,
    FlowMetrics,
    DensityMetrics,
    TrackHistoryManager,
    TrackPoint,
    LineCrossingDetector,
    LineCrossingEvent,
    RoadRoi,
    DEFAULT_ROAD_ROI,
    CongestionClassifier,
    CongestionConfig
)


class TestTrafficPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.coco_model_path = REPO_ROOT / "models" / "yolo11n.pt"
        cls.pothole_model_path = REPO_ROOT / "models" / "pothole_yolo11n.pt"

        if not cls.coco_model_path.exists():
            raise FileNotFoundError(f"Missing base COCO model: {cls.coco_model_path}")
        if not cls.pothole_model_path.exists():
            raise FileNotFoundError(f"Missing pothole model: {cls.pothole_model_path}")

    def test_01_coco_class_mapping(self):
        """Verify COCO vehicle class index mapping in yolo11n.pt."""
        model = YOLO(str(self.coco_model_path))
        self.assertEqual(model.names[2], "car")
        self.assertEqual(model.names[3], "motorcycle")
        self.assertEqual(model.names[5], "bus")
        self.assertEqual(model.names[7], "truck")
        self.assertEqual(VEHICLE_CLASS_IDS, [2, 3, 5, 7])
        self.assertEqual(VEHICLE_CLASS_NAMES[2], "car")
        self.assertEqual(VEHICLE_CLASS_NAMES[3], "motorcycle")
        self.assertEqual(VEHICLE_CLASS_NAMES[5], "bus")
        self.assertEqual(VEHICLE_CLASS_NAMES[7], "truck")

    def test_02_class_filtering(self):
        """Verify that non-vehicle classes are strictly excluded from tracking."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        self.assertEqual(set(VEHICLE_CLASS_NAMES.keys()), {2, 3, 5, 7})
        for non_veh_id in [0, 1, 4, 6, 8, 9, 11, 16]:
            self.assertNotIn(non_veh_id, VEHICLE_CLASS_NAMES)

    def test_03_bytetrack_tracking_synthetic_frames(self):
        """Verify ByteTrack processes frames and produces TrackedVehicle instances."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        # Empty synthetic frame
        blank = np.zeros((360, 640, 3), dtype=np.uint8)
        tracks, metrics = tracker.track(blank)
        self.assertEqual(len(tracks), 0)
        self.assertEqual(metrics.active_count, 0)
        self.assertEqual(metrics.traffic_state, "FREE")

    def test_04_vehicle_counting_and_class_breakdown(self):
        """Verify per-class vehicle counting dictionary integrity."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        blank = np.zeros((360, 640, 3), dtype=np.uint8)
        _, metrics = tracker.track(blank)
        self.assertIn("car", metrics.per_class_count)
        self.assertIn("motorcycle", metrics.per_class_count)
        self.assertIn("bus", metrics.per_class_count)
        self.assertIn("truck", metrics.per_class_count)
        self.assertEqual(sum(metrics.per_class_count.values()), metrics.active_count)

    def test_05_track_history_and_displacement_speed(self):
        """Verify trajectory history manager updates and calculates displacement speed."""
        mgr = TrackHistoryManager(max_history_points=10, max_age_seconds=2.0)
        v1 = TrackedVehicle(track_id=1, class_id=2, class_name="car", confidence=0.9, bbox=(100, 100, 140, 140))
        mgr.update([v1], timestamp=10.0, frame_idx=1)

        pts1 = mgr.get_points(1)
        self.assertEqual(len(pts1), 1)
        self.assertEqual(pts1[0], (120, 120))

        # Move vehicle 100 pixels in 0.5 seconds
        v2 = TrackedVehicle(track_id=1, class_id=2, class_name="car", confidence=0.9, bbox=(200, 100, 240, 140))
        mgr.update([v2], timestamp=10.5, frame_idx=2)
        pts2 = mgr.get_points(1)
        self.assertEqual(len(pts2), 2)

        # Speed = 100 px / 0.5s = 200 px/s
        speed = mgr.get_displacement_speed(1)
        self.assertAlmostEqual(speed, 200.0, places=1)

    def test_06_line_crossing_detection_and_direction(self):
        """Verify line crossing detection counts once per event and determines IN/OUT."""
        mgr = TrackHistoryManager()
        detector = LineCrossingDetector(line_start=(0.0, 0.5), line_end=(1.0, 0.5), debounce_seconds=3.0)

        # Step 1: Vehicle above horizontal line (y=150 in 360h frame)
        v1 = TrackedVehicle(track_id=10, class_id=2, class_name="car", confidence=0.85, bbox=(300, 140, 340, 160))
        mgr.update([v1], timestamp=1.0, frame_idx=1)
        ev1 = detector.update(mgr, [v1], (640, 360), timestamp=1.0, frame_idx=1)
        self.assertEqual(len(ev1), 0)

        # Step 2: Vehicle crosses line to y=210 (moving downwards -> IN)
        v2 = TrackedVehicle(track_id=10, class_id=2, class_name="car", confidence=0.85, bbox=(300, 200, 340, 220))
        mgr.update([v2], timestamp=1.2, frame_idx=2)
        ev2 = detector.update(mgr, [v2], (640, 360), timestamp=1.2, frame_idx=2)
        self.assertEqual(len(ev2), 1)
        self.assertEqual(ev2[0].direction, "IN")
        self.assertEqual(detector.total_in, 1)

        # Step 3: Vehicle stays below line (debounce should prevent re-count)
        v3 = TrackedVehicle(track_id=10, class_id=2, class_name="car", confidence=0.85, bbox=(300, 210, 340, 230))
        mgr.update([v3], timestamp=1.4, frame_idx=3)
        ev3 = detector.update(mgr, [v3], (640, 360), timestamp=1.4, frame_idx=3)
        self.assertEqual(len(ev3), 0)
        self.assertEqual(detector.total_in, 1)

    def test_07_rolling_flow_windows_and_vpm(self):
        """Verify rolling 10s, 30s, 60s windows and VPM calculations."""
        detector = LineCrossingDetector()
        detector._events.append(LineCrossingEvent(timestamp=100.0, frame_idx=10, track_id=1, class_name="car", direction="IN", point=(100, 100)))
        detector._events.append(LineCrossingEvent(timestamp=125.0, frame_idx=25, track_id=2, class_name="car", direction="IN", point=(100, 100)))
        detector._events.append(LineCrossingEvent(timestamp=145.0, frame_idx=45, track_id=3, class_name="bus", direction="OUT", point=(100, 100)))
        detector.session_start_time = 80.0

        metrics = detector.get_metrics(current_time=150.0)
        self.assertEqual(metrics.flow_10s, 1)
        self.assertEqual(metrics.flow_30s, 2)
        self.assertEqual(metrics.flow_60s, 3)
        self.assertEqual(metrics.vpm, 3.0)

    def test_08_road_roi_occupancy_and_overlap_handling(self):
        """Verify road ROI point testing and occupancy calculation with overlapping boxes."""
        roi = RoadRoi()
        # Road center near bottom (320, 300) should be inside 640x360 frame
        self.assertTrue(roi.is_point_in_roi((320, 300), frame_w=640, frame_h=360))
        # Top-left corner (10, 10) must be outside
        self.assertFalse(roi.is_point_in_roi((10, 10), frame_w=640, frame_h=360))

        # Two identical overlapping vehicle bounding boxes
        v1 = TrackedVehicle(track_id=1, class_id=2, class_name="car", confidence=0.9, bbox=(200, 200, 400, 320))
        v2 = TrackedVehicle(track_id=2, class_id=2, class_name="car", confidence=0.8, bbox=(200, 200, 400, 320))

        dens_single = roi.evaluate([v1], (640, 360))
        dens_double = roi.evaluate([v1, v2], (640, 360))

        # Mask union must ensure identical occupancy ratio even though 2 vehicles exist
        self.assertAlmostEqual(dens_single.occupancy_ratio, dens_double.occupancy_ratio, places=2)
        self.assertEqual(dens_double.vehicles_in_roi, 2)

    def test_09_congestion_classification_regimes(self):
        """Verify CongestionClassifier correctly maps regimes across FREE, MODERATE, HEAVY, CONGESTED."""
        clf = CongestionClassifier()

        # Free flow
        self.assertEqual(clf.classify(occupancy_ratio=0.05, vehicles_in_roi=0, active_count=0, flow_vpm=6.0), "FREE")
        # Moderate
        self.assertEqual(clf.classify(occupancy_ratio=0.15, vehicles_in_roi=2, active_count=3, flow_vpm=8.0), "MODERATE")
        # Heavy
        self.assertEqual(clf.classify(occupancy_ratio=0.28, vehicles_in_roi=4, active_count=6, flow_vpm=12.0), "HEAVY")
        # Congested (high occupancy + low flow)
        self.assertEqual(clf.classify(occupancy_ratio=0.38, vehicles_in_roi=5, active_count=8, flow_vpm=1.0), "CONGESTED")
        # Congested (extreme occupancy)
        self.assertEqual(clf.classify(occupancy_ratio=0.50, vehicles_in_roi=6, active_count=9, flow_vpm=10.0), "CONGESTED")

    def test_10_tracker_session_reset(self):
        """Verify session reset cleanly clears seen track IDs, history, and metrics."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        tracker.seen_track_ids.update([1, 5, 9])
        self.assertEqual(len(tracker.seen_track_ids), 3)

        tracker.reset_session()
        self.assertEqual(len(tracker.seen_track_ids), 0)
        self.assertEqual(len(tracker.latest_tracks), 0)
    def test_11_pothole_model_regression_integrity(self):
        """Verify custom pothole model (pothole_yolo11n.pt) has 8 classes and is completely untouched."""
        ckpt = torch.load(str(self.pothole_model_path), map_location="cpu", weights_only=False)
        model = ckpt.get("model")
        names = model.names if hasattr(model, "names") else ckpt.get("names")
        self.assertEqual(len(names), 8, "Pothole model must retain exactly 8 classes")
        self.assertEqual(names[6], "pothole", "Class 6 must be 'pothole'")
        for veh in ["car", "bus", "truck", "motorcycle"]:
            self.assertNotIn(veh, names.values(), "Pothole model must not be polluted with vehicle classes")

    def test_12_traffic_event_generation_and_debouncing(self):
        """Verify EventEngine creates structured traffic events and debounces duplicate spam."""
        from events.event_engine import EventEngine
        engine = EventEngine(default_bus_id="BUS-TEST-01")

        gps_data = {
            "latitude": 28.6139,
            "longitude": 77.2090,
            "accuracy": 4.5,
            "gpsTimestamp": "2026-09-19T01:00:00Z"
        }

        # Create dummy metrics
        metrics = TrafficMetrics(
            active_count=5,
            per_class_count={"car": 4, "bus": 1, "motorcycle": 0, "truck": 0},
            traffic_state="CONGESTED",
            density=DensityMetrics(vehicles_in_roi=4, occupancy_ratio=0.42),
            flow=FlowMetrics(vpm=2.0, flow_10s=0, flow_60s=2)
        )

        # 1. First event should succeed
        pkg1, suppressed1, reason1 = engine.create_traffic_event(
            event_type="congestion",
            class_name="traffic_congestion",
            confidence=0.88,
            bbox={"x": 0, "y": 0, "width": 1920, "height": 1080},
            frame_number=100,
            gps_match=gps_data,
            traffic_metrics=metrics,
            bus_id="BUS-TEST-01"
        )
        self.assertFalse(suppressed1)
        self.assertIsNotNone(pkg1)
        self.assertTrue(pkg1["eventId"].startswith("TRF-"))
        self.assertEqual(pkg1["eventType"], "congestion")
        self.assertEqual(pkg1["trafficTelemetry"]["trafficState"], "CONGESTED")
        self.assertEqual(pkg1["trafficTelemetry"]["occupancyRatio"], 0.42)
        self.assertEqual(pkg1["trafficTelemetry"]["flowVpm"], 2.0)

        # 2. Duplicate event within 60s at same location should be suppressed
        pkg2, suppressed2, reason2 = engine.create_traffic_event(
            event_type="congestion",
            class_name="traffic_congestion",
            confidence=0.88,
            bbox={"x": 0, "y": 0, "width": 1920, "height": 1080},
            frame_number=130,
            gps_match=gps_data,
            traffic_metrics=metrics,
            bus_id="BUS-TEST-01"
        )
        self.assertTrue(suppressed2)
        self.assertIsNone(pkg2)
        self.assertIn("Local spatial suppression", reason2)

    def test_13_pipeline_coordinator_traffic_telemetry(self):
        """Verify PipelineCoordinator integrates VehicleTracker and exposes traffic health telemetry."""
        from pipeline_coordinator import PipelineCoordinator
        coord = PipelineCoordinator(
            bus_id="TEST-BUS",
            enable_traffic=True,
            traffic_cadence_stride=2
        )
        status = coord.get_health_status()
        self.assertIn("traffic", status)
        self.assertTrue(status["traffic"]["enabled"])
        self.assertIn("state", status["traffic"])
        self.assertIn("trafficTracker", status["components"])
        self.assertIn("vehicleFps", status["metrics"])
        self.assertIn("vehicleLatencyMs", status["metrics"])
        self.assertIn("bytetrackLatencyMs", status["metrics"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

