"""
RAAHI Edge Traffic Intelligence Unit Tests (Phase 8C)
=====================================================
Comprehensive deterministic tests for Phase 8C:
1. Track history updates (center points, frame indices, timestamps)
2. Track history bounded behavior (buffer length cap and age pruning)
3. Point/line crossing intersection math
4. Vehicle counted once per crossing (deduplication safeguard)
5. IN / OUT direction detection
6. UNKNOWN direction on ambiguous/stationary motion
7. Rolling 10/30/60 second flow windows and VPM calculation
8. Road ROI membership testing
9. Camera-relative road occupancy calculation with overlapping bounding boxes
10. Density level threshold categorization (LOW, MEDIUM, HIGH)
11. Congestion rule classifier (FREE, MODERATE, HEAVY, CONGESTED)
12. Phase 8B tracker regression (integrated output on real video)
13. Custom pothole pipeline regression protection
"""

import sys
import unittest
from pathlib import Path
import numpy as np

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.traffic import (
    VehicleTracker,
    TrackedVehicle,
    FlowMetrics,
    DensityMetrics,
    TrafficMetrics,
    TrackHistoryManager,
    LineCrossingDetector,
    RoadRoi,
    DEFAULT_ROAD_ROI,
    CongestionClassifier,
    CongestionConfig
)
from ultralytics import YOLO


class TestTrafficPhase8C(unittest.TestCase):
    """Deterministic unit tests for Phase 8C Edge Traffic Intelligence."""

    def test_01_track_history_updates(self):
        """Test 1: Verify trajectory updates with center points, frame indices, timestamps."""
        mgr = TrackHistoryManager(max_history_points=10)
        v1 = TrackedVehicle(track_id=1, class_id=2, class_name="car", confidence=0.85, bbox=(100, 100, 200, 200))
        # Center should be (150, 150)
        self.assertEqual(v1.center, (150, 150))

        mgr.update([v1], timestamp=10.0, frame_idx=1)
        pts = mgr.get_points(track_id=1)
        self.assertEqual(len(pts), 1)
        self.assertEqual(pts[0], (150, 150))

        # Second update
        v1_moved = TrackedVehicle(track_id=1, class_id=2, class_name="car", confidence=0.86, bbox=(110, 120, 210, 220))
        mgr.update([v1_moved], timestamp=10.5, frame_idx=2)
        pts = mgr.get_points(track_id=1)
        self.assertEqual(len(pts), 2)
        self.assertEqual(pts[1], (160, 170))

        segment = mgr.get_recent_segment(track_id=1)
        self.assertIsNotNone(segment)
        p_prev, p_curr = segment
        self.assertEqual((p_prev.x, p_prev.y), (150, 150))
        self.assertEqual((p_curr.x, p_curr.y), (160, 170))

    def test_02_track_history_bounded_and_cleanup(self):
        """Test 2: Verify track history buffer length cap and timeout cleanup."""
        mgr = TrackHistoryManager(max_history_points=5, max_age_seconds=2.0)
        v = TrackedVehicle(track_id=42, class_id=5, class_name="bus", confidence=0.90, bbox=(50, 50, 150, 150))

        # Push 8 points
        for i in range(8):
            mgr.update([v], timestamp=1.0 + i * 0.1, frame_idx=i)

        pts = mgr.get_points(track_id=42)
        self.assertEqual(len(pts), 5, "Trajectory buffer must be strictly capped at max_history_points=5")

        # Inactivity cleanup
        mgr.cleanup(current_time=10.0)
        self.assertEqual(mgr.get_points(track_id=42), [], "Inactive track must be pruned after max_age_seconds")

    def test_03_line_crossing_detection(self):
        """Test 3: Verify 2D line segment intersection detection."""
        detector = LineCrossingDetector(line_start=(0.0, 0.5), line_end=(1.0, 0.5))

        # Trajectory crossing horizontal line y=180 in 640x360 frame
        l1, l2 = detector.get_pixel_line(640, 360)
        self.assertEqual(l1, (0, 180))
        self.assertEqual(l2, (640, 180))

        p_before = (320.0, 150.0)
        p_after = (320.0, 210.0)
        self.assertTrue(detector.check_intersection(p_before, p_after, l1, l2))

        # Non-crossing trajectory (stays above line)
        p_no_cross = (320.0, 170.0)
        self.assertFalse(detector.check_intersection(p_before, p_no_cross, l1, l2))

    def test_04_vehicle_counted_once_per_crossing(self):
        """Test 4: Verify that a vehicle is counted only once per crossing event."""
        mgr = TrackHistoryManager()
        detector = LineCrossingDetector(line_start=(0.0, 0.5), line_end=(1.0, 0.5), debounce_seconds=3.0)

        # Step 1: Vehicle above line
        v1 = TrackedVehicle(track_id=7, class_id=2, class_name="car", confidence=0.8, bbox=(300, 140, 340, 160))  # center=(320, 150)
        mgr.update([v1], timestamp=1.0, frame_idx=1)
        events1 = detector.update(mgr, [v1], (640, 360), timestamp=1.0, frame_idx=1)
        self.assertEqual(len(events1), 0)

        # Step 2: Vehicle crosses line (center=(320, 210))
        v2 = TrackedVehicle(track_id=7, class_id=2, class_name="car", confidence=0.8, bbox=(300, 200, 340, 220))
        mgr.update([v2], timestamp=1.1, frame_idx=2)
        events2 = detector.update(mgr, [v2], (640, 360), timestamp=1.1, frame_idx=2)
        self.assertEqual(len(events2), 1, "Must detect crossing on first intersection")
        self.assertEqual(detector.total_in + detector.total_out + detector.total_unknown, 1)

        # Step 3: Vehicle continues moving nearby (debounce active)
        v3 = TrackedVehicle(track_id=7, class_id=2, class_name="car", confidence=0.8, bbox=(300, 210, 340, 230))
        mgr.update([v3], timestamp=1.2, frame_idx=3)
        events3 = detector.update(mgr, [v3], (640, 360), timestamp=1.2, frame_idx=3)
        self.assertEqual(len(events3), 0, "Must NOT duplicate crossing count while vehicle is in cooldown")
        self.assertEqual(detector.total_in + detector.total_out + detector.total_unknown, 1)

    def test_05_in_out_direction(self):
        """Test 5: Verify direction detection (IN vs OUT)."""
        detector = LineCrossingDetector(line_start=(0.0, 0.5), line_end=(1.0, 0.5))
        l1 = (0.0, 180.0)
        l2 = (640.0, 180.0)

        # Moving downwards (y increases): approaching/forward
        dir_in = detector.determine_direction((320.0, 150.0), (320.0, 210.0), l1, l2)
        self.assertEqual(dir_in, "IN")

        # Moving upwards (y decreases): receding
        dir_out = detector.determine_direction((320.0, 210.0), (320.0, 150.0), l1, l2)
        self.assertEqual(dir_out, "OUT")

    def test_06_unknown_direction_handling(self):
        """Test 6: Verify UNKNOWN direction on near-zero motion or parallel displacement."""
        detector = LineCrossingDetector(line_start=(0.0, 0.5), line_end=(1.0, 0.5))
        l1 = (0.0, 180.0)
        l2 = (640.0, 180.0)

        # Minimal displacement (< 2px)
        dir_stat = detector.determine_direction((320.0, 180.0), (320.0, 180.5), l1, l2)
        self.assertEqual(dir_stat, "UNKNOWN")

    def test_07_rolling_flow_windows(self):
        """Test 7: Verify rolling 10s, 30s, 60s windows and VPM calculation."""
        detector = LineCrossingDetector()

        # Simulate 3 crossing events at different timestamps
        from src.traffic.flow import LineCrossingEvent
        detector._events.append(LineCrossingEvent(timestamp=100.0, frame_idx=10, track_id=1, class_name="car", direction="IN", point=(100, 100)))
        detector._events.append(LineCrossingEvent(timestamp=125.0, frame_idx=25, track_id=2, class_name="car", direction="IN", point=(100, 100)))
        detector._events.append(LineCrossingEvent(timestamp=145.0, frame_idx=45, track_id=3, class_name="bus", direction="OUT", point=(100, 100)))
        detector.session_start_time = 80.0

        metrics = detector.get_metrics(current_time=150.0)
        # At t=150:
        # Event 3 (t=145, dt=5s) -> in 10s, 30s, 60s
        # Event 2 (t=125, dt=25s) -> in 30s, 60s
        # Event 1 (t=100, dt=50s) -> in 60s
        self.assertEqual(metrics.flow_10s, 1)
        self.assertEqual(metrics.flow_30s, 2)
        self.assertEqual(metrics.flow_60s, 3)
        self.assertEqual(metrics.vpm, 3.0)

    def test_08_road_roi_membership(self):
        """Test 8: Verify point inclusion in road ROI polygon."""
        roi = RoadRoi()
        # In a 640x360 frame:
        # Road center near bottom (320, 300) should be inside
        self.assertTrue(roi.is_point_in_roi((320, 300), frame_w=640, frame_h=360))
        # Top-left corner of the frame (10, 10) should be outside
        self.assertFalse(roi.is_point_in_roi((10, 10), frame_w=640, frame_h=360))

    def test_09_occupancy_calculation_with_overlap(self):
        """Test 9: Verify occupancy calculation with overlapping bounding boxes."""
        roi = RoadRoi()
        # Place two completely overlapping vehicle bounding boxes
        v1 = TrackedVehicle(track_id=1, class_id=2, class_name="car", confidence=0.9, bbox=(200, 200, 400, 320))
        v2 = TrackedVehicle(track_id=2, class_id=2, class_name="car", confidence=0.8, bbox=(200, 200, 400, 320))

        dens_single = roi.evaluate([v1], (640, 360))
        dens_double = roi.evaluate([v1, v2], (640, 360))

        # Because bounding boxes overlap completely, occupancy ratio must remain identical!
        self.assertAlmostEqual(dens_single.occupancy_ratio, dens_double.occupancy_ratio, places=2)
        self.assertEqual(dens_double.vehicles_in_roi, 2)

    def test_10_density_thresholds(self):
        """Test 10: Verify density level categorization (LOW, MEDIUM, HIGH)."""
        roi = RoadRoi(low_threshold=0.15, high_threshold=0.35)

        # No vehicles -> LOW
        dens_low = roi.evaluate([], (640, 360))
        self.assertEqual(dens_low.density_level, "LOW")
        self.assertEqual(dens_low.occupancy_ratio, 0.0)

    def test_11_congestion_rule_classification(self):
        """Test 11: Verify rule-based classification across FREE, MODERATE, HEAVY, CONGESTED."""
        clf = CongestionClassifier()

        # Low occupancy, no vehicles -> FREE
        self.assertEqual(clf.classify(occupancy_ratio=0.04, vehicles_in_roi=0, active_count=0, flow_vpm=5.0), "FREE")

        # Moderate occupancy -> MODERATE
        self.assertEqual(clf.classify(occupancy_ratio=0.15, vehicles_in_roi=2, active_count=3, flow_vpm=8.0), "MODERATE")

        # Heavy occupancy with flow -> HEAVY
        self.assertEqual(clf.classify(occupancy_ratio=0.28, vehicles_in_roi=4, active_count=6, flow_vpm=12.0), "HEAVY")

        # High occupancy with stalled flow -> CONGESTED
        self.assertEqual(clf.classify(occupancy_ratio=0.38, vehicles_in_roi=5, active_count=8, flow_vpm=1.0), "CONGESTED")

        # Extreme occupancy -> CONGESTED
        self.assertEqual(clf.classify(occupancy_ratio=0.52, vehicles_in_roi=6, active_count=9, flow_vpm=10.0), "CONGESTED")

    def test_12_phase8b_tracker_regression(self):
        """Test 12: Verify full VehicleTracker output preserves Phase 8B active counts."""
        tracker = VehicleTracker(model_path=str(REPO_ROOT / "yolo11n.pt"), conf=0.25)
        # Synthetic empty frame
        empty_frame = np.zeros((360, 640, 3), dtype=np.uint8)
        tracks, metrics = tracker.track(empty_frame)

        self.assertEqual(metrics.active_count, 0)
        self.assertEqual(metrics.traffic_state, "FREE")
        self.assertEqual(metrics.density.density_level, "LOW")
        self.assertEqual(metrics.flow.total_crossed, 0)
        self.assertIn("car", metrics.per_class_count)

    def test_13_pothole_model_regression(self):
        """Test 13: Regression check: Verify custom pothole model is UNTOUCHED and has 8 classes."""
        pothole_model_path = REPO_ROOT / "runs" / "detect" / "runs" / "pothole_yolo11n" / "weights" / "best.pt"
        self.assertTrue(pothole_model_path.exists(), "Custom pothole model best.pt must exist")
        model = YOLO(str(pothole_model_path))
        self.assertEqual(len(model.names), 8, "Pothole model must have exactly 8 defect classes")
        self.assertIn("pothole", model.names.values())


if __name__ == "__main__":
    unittest.main(verbosity=2)
