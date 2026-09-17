#!/usr/bin/env python3
"""
Phase 15 Deterministic Integration Test Suite
=============================================
Verifies Milestones 15.1, 15.2, and 15.3:
- Test 1: GPS match within MAX_GPS_TIME_DELTA_MS
- Test 2: GPS timeout outside MAX_GPS_TIME_DELTA_MS
- Test 3: New pothole (>10m away -> creates POT-000004, count=4)
- Test 4: Existing pothole (<=10m from POT-000002 -> increments detectionCount, count remains 4)
- Test 5: Duplicate live frames (burst detections throttled by in-memory cooldown)
- Test 6: Existing data preservation (POT-000001, POT-000002.videoUrl, POT-000003 preserved)
"""

import sys
import time
import json
import urllib.request
from datetime import datetime, timezone, timedelta

SERVER_URL = "http://localhost:5001"


def http_get(endpoint):
    url = f"{SERVER_URL}{endpoint}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def http_post(endpoint, payload):
    url = f"{SERVER_URL}{endpoint}"
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data_bytes,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def get_all_potholes():
    _, data = http_get("/api/potholes")
    return data.get("potholes", [])


def get_pothole(pothole_id):
    _, data = http_get(f"/api/potholes/{pothole_id}")
    return data.get("pothole", {})


def run_tests():
    print("==================================================")
    print("   PHASE 15: LIVE DETECTION → GPS → MONGODB       ")
    print("       DETERMINISTIC INTEGRATION TEST SUITE       ")
    print("==================================================")

    # Pre-check: Inspect initial MongoDB state
    potholes_before = get_all_potholes()
    initial_count = len(potholes_before)
    print(f"[Initial Check] Existing MongoDB potholes count: {initial_count}")
    for p in potholes_before:
        print(f"   • {p.get('potholeId')}: lat={p.get('location', {}).get('latitude')}, lng={p.get('location', {}).get('longitude')}, count={p.get('detectionCount')}, hasVideo={bool(p.get('videoUrl'))}")

    # Check if POT-000004 already exists from a prior run; if not, initial_count should be 3
    has_p4_already = any(p.get("potholeId") == "POT-000004" for p in potholes_before)

    # Reset in-memory cooldown at start of test suite
    http_post("/api/dev/reset-live-cooldown", {})

    # =========================================================================
    # Test 1 — GPS Match
    # =========================================================================
    print("\n--- TEST 1: GPS Match within allowed time delta ---")
    now_iso = datetime.now(timezone.utc).isoformat()

    # Send GPS telemetry
    gps_payload = {
        "latitude": 28.5355,
        "longitude": 77.3910,
        "accuracy": 4.5,
        "timestamp": now_iso
    }
    status, gps_res = http_post("/api/gps", gps_payload)
    assert status == 200, f"GPS POST failed: {gps_res}"
    print(f"✓ Posted GPS sample at {now_iso}: lat=28.5355, lng=77.3910")

    # Send matching live pothole detection 100ms later (well within MAX_GPS_TIME_DELTA_MS=2000ms)
    det_time = (datetime.now(timezone.utc) + timedelta(milliseconds=100)).isoformat()
    detection_payload = {
        "detectionId": 101,
        "className": "pothole",
        "confidence": 0.88,
        "frame": 10,
        "timestamp": det_time,
        "bbox": {"x1": 100, "y1": 120, "x2": 220, "y2": 200},
        "bus": "RAAHI-01"
    }
    status, det_res = http_post("/api/live/detection", detection_payload)
    print(f"Response: {det_res}")
    assert det_res.get("success") is True, f"Expected success=True, got {det_res}"
    assert det_res.get("gpsMatched") is True, f"Expected gpsMatched=True, got {det_res}"
    print("✓ TEST 1 PASSED: Live detection successfully matched with GPS!")

    # =========================================================================
    # Test 2 — GPS Timeout / Stale GPS
    # =========================================================================
    print("\n--- TEST 2: GPS Timeout outside MAX_GPS_TIME_DELTA_MS ---")
    # Send a detection with timestamp 30 seconds into the future (delta ~30,000ms > 2000ms threshold)
    future_time = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    stale_detection_payload = {
        "detectionId": 102,
        "className": "pothole",
        "confidence": 0.82,
        "frame": 50,
        "timestamp": future_time,
        "bbox": {"x1": 150, "y1": 140, "x2": 260, "y2": 220},
        "bus": "RAAHI-01"
    }
    status, stale_res = http_post("/api/live/detection", stale_detection_payload)
    print(f"Response: {stale_res}")
    assert stale_res.get("success") is False, f"Expected success=False, got {stale_res}"
    assert stale_res.get("gpsMatched") is False, f"Expected gpsMatched=False, got {stale_res}"
    assert "within allowed time" in stale_res.get("reason", "").lower() or "no gps sample" in stale_res.get("reason", "").lower()
    print("✓ TEST 2 PASSED: Stale detection rejected correctly without GPS match!")

    # =========================================================================
    # Test 3 — New Pothole Creation (POT-000004)
    # =========================================================================
    print("\n--- TEST 3: New Pothole Creation (>10m from all existing) ---")
    # Test 1's detection created POT-000004 at lat=28.5355, lng=77.3910
    potholes_after_t1 = get_all_potholes()
    count_after_t1 = len(potholes_after_t1)
    print(f"Current MongoDB count: {count_after_t1}")
    assert count_after_t1 == 4, f"Expected 4 potholes in MongoDB, found {count_after_t1}"

    p4 = get_pothole("POT-000004")
    assert p4.get("potholeId") == "POT-000004", "POT-000004 was not found in MongoDB!"
    assert p4.get("confidence") == 0.88, f"Expected confidence=0.88, got {p4.get('confidence')}"
    assert "RAAHI-01" in p4.get("busesDetectedBy", []), f"Unexpected buses: {p4.get('busesDetectedBy')}"
    print(f"✓ TEST 3 PASSED: New pothole POT-000004 exists in MongoDB (detectionCount={p4.get('detectionCount')}) and total MongoDB count is 4!")

    # =========================================================================
    # Test 4 — Existing Pothole Deduplication (Near POT-000002)
    # =========================================================================
    print("\n--- TEST 4: Existing Pothole Deduplication (<=10m of POT-000002) ---")
    # POT-000002 location is lat: 28.6139, lng: 77.209
    # Place GPS at 28.61393, 77.20903 (~4.4m away from POT-000002)
    p2_time_iso = datetime.now(timezone.utc).isoformat()
    gps_p2 = {
        "latitude": 28.61393,
        "longitude": 77.20903,
        "accuracy": 3.8,
        "timestamp": p2_time_iso
    }
    http_post("/api/gps", gps_p2)
    print(f"✓ Posted GPS near POT-000002: lat=28.61393, lng=77.20903")

    p2_before = get_pothole("POT-000002")
    p2_count_before = p2_before.get("detectionCount", 2)
    print(f"POT-000002 detectionCount before: {p2_count_before}")

    # Send detection event
    det_p2_payload = {
        "detectionId": 103,
        "className": "pothole",
        "confidence": 0.95,
        "frame": 85,
        "timestamp": p2_time_iso,
        "bbox": {"x1": 80, "y1": 90, "x2": 210, "y2": 190},
        "bus": "RAAHI-01"
    }
    status, dedup_res = http_post("/api/live/detection", det_p2_payload)
    print(f"Response: {dedup_res}")
    assert dedup_res.get("success") is True, f"Expected success=True: {dedup_res}"
    assert dedup_res.get("gpsMatched") is True, f"Expected gpsMatched=True: {dedup_res}"
    assert dedup_res.get("deduplicated") is True, f"Expected deduplicated=True: {dedup_res}"
    assert dedup_res.get("potholeId") == "POT-000002", f"Expected POT-000002, got {dedup_res.get('potholeId')}"

    # Verify MongoDB count remains 4 (no new document created)
    potholes_after_dedup = get_all_potholes()
    assert len(potholes_after_dedup) == 4, f"Expected count to remain 4, but got {len(potholes_after_dedup)}"

    # Verify POT-000002 detectionCount incremented
    p2_after = get_pothole("POT-000002")
    p2_count_after = p2_after.get("detectionCount")
    print(f"POT-000002 detectionCount after: {p2_count_after}")
    assert p2_count_after == p2_count_before + 1, f"Expected {p2_count_before + 1}, got {p2_count_after}"
    print("✓ TEST 4 PASSED: POT-000002 successfully deduplicated! DetectionCount incremented, total count remains 4.")

    # =========================================================================
    # Test 5 — Duplicate Live Frames / Cooldown
    # =========================================================================
    print("\n--- TEST 5: Duplicate Live Frames & In-Memory Cooldown ---")
    # Send a detection for POT-000002 IMMEDIATELY (within 50ms < 1000ms cooldown)
    rapid_time_iso = datetime.now(timezone.utc).isoformat()
    http_post("/api/gps", {
        "latitude": 28.61393,
        "longitude": 77.20903,
        "accuracy": 3.8,
        "timestamp": rapid_time_iso
    })
    rapid_det_payload = {
        "detectionId": 104,
        "className": "pothole",
        "confidence": 0.94,
        "frame": 86,
        "timestamp": rapid_time_iso,
        "bbox": {"x1": 81, "y1": 91, "x2": 211, "y2": 191},
        "bus": "RAAHI-01"
    }
    status, rapid_res = http_post("/api/live/detection", rapid_det_payload)
    print(f"Immediate repeat detection response: {rapid_res}")
    assert rapid_res.get("throttled") is True or rapid_res.get("cooldownActive") is True, f"Expected throttled response, got {rapid_res}"

    # Verify detectionCount did NOT increment
    p2_check = get_pothole("POT-000002")
    assert p2_check.get("detectionCount") == p2_count_after, f"Count should not have changed from {p2_count_after}, but is {p2_check.get('detectionCount')}"
    print(f"✓ Verified: Repeat detection was throttled. POT-000002 detectionCount remained {p2_count_after}.")

    # Wait for cooldown to expire (>1.0s)
    print("Waiting 1.2s for cooldown window to expire...")
    time.sleep(1.2)

    after_cooldown_iso = datetime.now(timezone.utc).isoformat()
    http_post("/api/gps", {
        "latitude": 28.61393,
        "longitude": 77.20903,
        "accuracy": 3.8,
        "timestamp": after_cooldown_iso
    })
    after_cooldown_payload = {
        "detectionId": 105,
        "className": "pothole",
        "confidence": 0.96,
        "frame": 120,
        "timestamp": after_cooldown_iso,
        "bbox": {"x1": 82, "y1": 92, "x2": 212, "y2": 192},
        "bus": "RAAHI-01"
    }
    status, after_cd_res = http_post("/api/live/detection", after_cooldown_payload)
    print(f"After-cooldown detection response: {after_cd_res}")
    assert after_cd_res.get("success") is True, f"Expected success after cooldown: {after_cd_res}"
    assert after_cd_res.get("deduplicated") is True, f"Expected deduplicated=True: {after_cd_res}"

    p2_final = get_pothole("POT-000002")
    assert p2_final.get("detectionCount") == p2_count_after + 1, f"Expected count {p2_count_after + 1}, got {p2_final.get('detectionCount')}"
    print(f"✓ TEST 5 PASSED: Cooldown throttling verified! Burst was blocked, post-cooldown detection succeeded (detectionCount={p2_final.get('detectionCount')}).")

    # =========================================================================
    # Test 6 — Existing Data Preservation
    # =========================================================================
    print("\n--- TEST 6: Existing Data Preservation ---")
    p1 = get_pothole("POT-000001")
    assert p1.get("potholeId") == "POT-000001", "POT-000001 missing"
    assert p1.get("location", {}).get("latitude") == 28.4595, "POT-000001 latitude modified"
    assert p1.get("location", {}).get("longitude") == 77.0266, "POT-000001 longitude modified"
    print("✓ POT-000001 unchanged.")

    p2_preserved = get_pothole("POT-000002")
    assert p2_preserved.get("potholeId") == "POT-000002", "POT-000002 missing"
    expected_drive_url = "https://drive.google.com/file/d/1qJM1Pu5dLhX6lYlSKxcy8CiuatawNZ18/view"
    assert p2_preserved.get("videoUrl") == expected_drive_url, f"POT-000002 videoUrl modified! Expected {expected_drive_url}, got {p2_preserved.get('videoUrl')}"
    assert p2_preserved.get("address") == "Kartavya Path, Raisina Hill, New Delhi, Delhi, 110004, India", "POT-000002 address modified"
    print(f"✓ POT-000002 videoUrl strictly preserved: {p2_preserved.get('videoUrl')}")

    p3 = get_pothole("POT-000003")
    assert p3.get("potholeId") == "POT-000003", "POT-000003 missing"
    assert p3.get("location", {}).get("latitude") == 28.7041, "POT-000003 latitude modified"
    assert p3.get("location", {}).get("longitude") == 77.1025, "POT-000003 longitude modified"
    print("✓ POT-000003 unchanged.")

    print("\n==================================================")
    print("   ALL 6 DETERMINISTIC INTEGRATION TESTS PASSED!  ")
    print("==================================================")
    return True


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
