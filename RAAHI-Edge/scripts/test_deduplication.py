"""
Validation of EventEngine Debouncing / Deduplication logic.
Verifies that high-frequency detections of the same physical pothole
do NOT create duplicate events or evidence clips.
"""

import sys
import os
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from events.event_engine import EventEngine


def test_deduplication():
    print("=" * 60)
    print("EVENT ENGINE DEDUPLICATION & DEBOUNCE TEST")
    print("=" * 60)

    # 15s cooldown, 10m spatial radius
    engine = EventEngine(cooldown_sec=15.0, spatial_radius_meters=10.0)

    # 1. Initial detection
    gps_match_1 = {"latitude": 28.613900, "longitude": 77.209000, "accuracy": 2.5}
    bbox = {"x1": 100, "y1": 200, "x2": 300, "y2": 400, "w": 200, "h": 200}

    pkg1, suppressed1, reason1 = engine.create_candidate_event(
        event_type="pothole",
        class_name="pothole",
        confidence=0.75,
        bbox=bbox,
        frame_number=1,
        gps_match=gps_match_1
    )

    print(f"[1] Frame #1: Initial detection -> Accepted: {pkg1 is not None} (Event: {pkg1['eventId'] if pkg1 else 'None'})")
    assert pkg1 is not None and not suppressed1, "First event should be accepted!"

    # 2. Simulate 60 consecutive frames (2 seconds of camera stream) over the same pothole
    print(f"\n[2] Simulating 60 consecutive detections over next 2 seconds (same pothole)...")
    suppressed_count = 0
    accepted_count = 0
    for f in range(2, 62):
        # Slightly jitter GPS by ~2-5 meters across 60 frames (moving vehicle passing pothole)
        jitter_lat = 28.613900 + (f * 0.0000008)  # ~5.3 meters at frame 60
        jitter_lon = 77.209000 + (f * 0.0000008)
        gps_jitter = {"latitude": jitter_lat, "longitude": jitter_lon, "accuracy": 2.5}

        pkg, suppressed, reason = engine.create_candidate_event(
            event_type="pothole",
            class_name="pothole",
            confidence=0.80,
            bbox=bbox,
            frame_number=f,
            gps_match=gps_jitter
        )
        if suppressed:
            suppressed_count += 1
        else:
            accepted_count += 1

    print(f"    Total consecutive frames tested: 60")
    print(f"    Suppressed count: {suppressed_count} / 60")
    print(f"    Duplicate accepted count: {accepted_count} / 60")
    assert suppressed_count == 60, f"Expected 60 suppressed, got {suppressed_count}"
    assert accepted_count == 0, f"Expected 0 duplicates accepted, got {accepted_count}"
    print("    [+] PASS: Zero duplicate events created during vehicle pass!")

    # 3. Test detection with no GPS (0.0, 0.0)
    print(f"\n[3] Testing fallback temporal debouncing when GPS is (0.0, 0.0)...")
    engine_no_gps = EventEngine(cooldown_sec=15.0, spatial_radius_meters=10.0)
    no_gps = {"latitude": 0.0, "longitude": 0.0, "accuracy": None}

    pkg_ng1, supp_ng1, _ = engine_no_gps.create_candidate_event(
        event_type="pothole", class_name="pothole", confidence=0.70, bbox=bbox, frame_number=100, gps_match=no_gps
    )
    assert pkg_ng1 is not None and not supp_ng1, "First no-GPS event should be accepted!"

    # Rapid fire 10 detections without GPS
    supp_ng_count = 0
    for f in range(101, 111):
        _, supp, _ = engine_no_gps.create_candidate_event(
            event_type="pothole", class_name="pothole", confidence=0.70, bbox=bbox, frame_number=f, gps_match=no_gps
        )
        if supp:
            supp_ng_count += 1
    assert supp_ng_count == 10, f"Expected 10 suppressed without GPS, got {supp_ng_count}"
    print(f"    Suppressed {supp_ng_count}/10 detections without GPS lock.")
    print("    [+] PASS: Temporal debouncer prevents event storms even with 0,0 GPS coordinates!")

    print("\n" + "=" * 60)
    print("ALL DEDUPLICATION TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    test_deduplication()
