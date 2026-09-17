#!/usr/bin/env python3
"""
RAAHI Edge Traffic Intelligence Unit Tests (Phase 8B)
=====================================================
Tests:
1. COCO class mapping in yolo11n.pt (2=car, 3=motorcycle, 5=bus, 7=truck)
2. Class filtering (only vehicle classes allowed, non-vehicles ignored)
3. ByteTrack tracking output and persistent track ID generation
4. In-frame active vehicle counting
5. Per-class vehicle breakdown
6. Local track ID semantics (session-local, not global)
7. Pothole pipeline regression protection (models/pothole_yolo11n.pt intact)
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

from src.traffic import (
    VehicleTracker,
    VEHICLE_CLASS_IDS,
    VEHICLE_CLASS_NAMES,
    TrackedVehicle,
    TrafficMetrics
)


class TestTrafficTracker(unittest.TestCase):
    """Unit and regression tests for Phase 8B Edge Traffic Intelligence."""

    @classmethod
    def setUpClass(cls):
        cls.coco_model_path = REPO_ROOT / "yolo11n.pt"
        cls.pothole_model_path = REPO_ROOT / "models" / "pothole_yolo11n.pt"
        cls.test_video_path = REPO_ROOT / "videos" / "input" / "cityRoad_potHoles-side.mp4"

        if not cls.coco_model_path.exists():
            raise FileNotFoundError(f"Missing base model: {cls.coco_model_path}")
        if not cls.pothole_model_path.exists():
            raise FileNotFoundError(f"Missing pothole model: {cls.pothole_model_path}")

    def test_01_coco_class_mapping(self):
        """Test 1: Verify COCO vehicle class index mapping in yolo11n.pt."""
        model = YOLO(str(self.coco_model_path))
        self.assertEqual(model.names[2], "car", "Class index 2 must be 'car'")
        self.assertEqual(model.names[3], "motorcycle", "Class index 3 must be 'motorcycle'")
        self.assertEqual(model.names[5], "bus", "Class index 5 must be 'bus'")
        self.assertEqual(model.names[7], "truck", "Class index 7 must be 'truck'")
        self.assertEqual(VEHICLE_CLASS_IDS, [2, 3, 5, 7])

    def test_02_class_filtering(self):
        """Test 2: Verify that non-vehicle classes are strictly excluded from tracking."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        # Verify allowed classes
        self.assertEqual(set(VEHICLE_CLASS_NAMES.keys()), {2, 3, 5, 7})
        # Non-vehicle classes (person=0, bicycle=1, train=6, traffic light=9, dog=16) must not be in mapping
        for non_veh_id in [0, 1, 4, 6, 8, 9, 11, 16]:
            self.assertNotIn(non_veh_id, VEHICLE_CLASS_NAMES)

    def test_03_bytetrack_tracking_output(self):
        """Test 3: Verify ByteTrack produces integer track IDs on real video frames with vehicles."""
        import cv2
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        cap = cv2.VideoCapture(str(self.test_video_path))
        self.assertTrue(cap.isOpened(), "Test video must open successfully")

        # Frame 90 to 140 is known to contain road vehicles
        cap.set(cv2.CAP_PROP_POS_FRAMES, 90)
        found_tracks = False
        consecutive_tracks = []

        for _ in range(30):
            ret, frame = cap.read()
            if not ret:
                break
            vehicles, metrics = tracker.track(frame)
            if vehicles:
                found_tracks = True
                for v in vehicles:
                    self.assertIsInstance(v.track_id, int)
                    self.assertGreater(v.track_id, 0)
                    self.assertIn(v.class_name, ["car", "motorcycle", "bus", "truck"])
                    self.assertGreaterEqual(v.confidence, 0.25)
                    self.assertEqual(len(v.bbox), 4)
                consecutive_tracks.append([v.track_id for v in vehicles])
        cap.release()

        self.assertTrue(found_tracks, "ByteTrack must detect and track at least one vehicle in the sample clip")
        # Check that track IDs persist across frames
        flat_ids = [tid for sublist in consecutive_tracks for tid in sublist]
        self.assertGreater(len(flat_ids), len(tracker.seen_track_ids), "Persistent tracks must appear across multiple frames")

    def test_04_vehicle_counting(self):
        """Test 4: Verify active vehicle counting matches detected vehicle list."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        # On a blank frame, active count must be 0
        blank = np.zeros((640, 640, 3), dtype=np.uint8)
        vehicles, metrics = tracker.track(blank)
        self.assertEqual(len(vehicles), 0)
        self.assertEqual(metrics.active_count, 0)

    def test_05_per_class_count(self):
        """Test 5: Verify class-wise aggregation dictionary integrity."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        blank = np.zeros((640, 640, 3), dtype=np.uint8)
        _, metrics = tracker.track(blank)
        self.assertIn("car", metrics.per_class_count)
        self.assertIn("motorcycle", metrics.per_class_count)
        self.assertIn("bus", metrics.per_class_count)
        self.assertIn("truck", metrics.per_class_count)
        self.assertEqual(sum(metrics.per_class_count.values()), metrics.active_count)

    def test_06_local_id_semantics(self):
        """Test 6: Verify track IDs are session-scoped and resets cleanly."""
        tracker = VehicleTracker(model_path=str(self.coco_model_path), conf=0.25)
        # Manually add synthetic session track IDs
        tracker.seen_track_ids.update([1, 2, 5, 8])
        self.assertEqual(len(tracker.seen_track_ids), 4)
        tracker.reset_session()
        self.assertEqual(len(tracker.seen_track_ids), 0, "reset_session must clear seen_track_ids")

    def test_07_pothole_pipeline_regression(self):
        """Test 7: Regression check: Verify custom pothole model is UNTOUCHED and has 8 classes."""
        pothole_ckpt = torch.load(str(self.pothole_model_path), map_location="cpu", weights_only=False)
        model = pothole_ckpt.get("model")
        names = model.names if hasattr(model, "names") else pothole_ckpt.get("names")
        self.assertEqual(len(names), 8, "Custom pothole model must have exactly 8 classes")
        self.assertEqual(names[6], "pothole", "Pothole class must be index 6")
        self.assertNotIn("car", names.values(), "Pothole model must NOT contain vehicle classes")
        self.assertNotIn("bus", names.values(), "Pothole model must NOT contain vehicle classes")


if __name__ == "__main__":
    unittest.main(verbosity=2)
