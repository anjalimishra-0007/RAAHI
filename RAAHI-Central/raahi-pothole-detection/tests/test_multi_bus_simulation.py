#!/usr/bin/env python3
"""
Phase 18: Multi-Bus Fleet Simulation & Cross-Bus Deduplication Test Suite
========================================================================
Automated verification of fleet detection and geographical deduplication:
  TEST 1: First bus (RAAHI-01) creates an incident.
  TEST 2: Second bus (RAAHI-02) detects same physical pothole (<10m) -> same potholeId.
  TEST 3: Third bus (RAAHI-03) detects same physical pothole (<10m) -> same potholeId.
  TEST 4: detectionCount becomes 3.
  TEST 5: busesDetectedBy contains all three buses: [RAAHI-01, RAAHI-02, RAAHI-03].
  TEST 6: No duplicate pothole document is created for the same physical location.
  TEST 7: Far-away pothole (>10m) creates a distinct potholeId.
  TEST 8: Same bus repeated detection does not duplicate the bus ID.

Usage:
  python3 tests/test_multi_bus_simulation.py
"""

import math
import sys
import json
import urllib.request
from datetime import datetime, timezone

SERVER_URL = "http://localhost:5001"
EARTH_RADIUS_METERS = 6371000

total_assertions = 0
passed_assertions = 0
failed_assertions = 0


def haversine_distance_meters(lat1, lon1, lat2, lon2):
    if lat1 == lat2 and lon1 == lon2:
        return 0.0
    to_rad = math.pi / 180.0
    phi1 = lat1 * to_rad
    phi2 = lat2 * to_rad
    delta_phi = (lat2 - lat1) * to_rad
    delta_lambda = (lon2 - lon1) * to_rad

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(EARTH_RADIUS_METERS * c, 2)


def assert_condition(condition, description, detail=""):
    global total_assertions, passed_assertions, failed_assertions
    total_assertions += 1
    if condition:
        passed_assertions += 1
        suffix = f" ({detail})" if detail else ""
        print(f"  ✅ [PASS] {description}{suffix}")
    else:
        failed_assertions += 1
        suffix = f" ({detail})" if detail else ""
        print(f"  ❌ [FAIL] {description}{suffix}")


def http_get(endpoint):
    url = f"{SERVER_URL}{endpoint}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=10.0) as resp:
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
    with urllib.request.urlopen(req, timeout=15.0) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def run_multi_bus_tests():
    print("================================================================")
    print("  RAAHI PHASE 18: PYTHON MULTI-BUS DEDUPLICATION TEST SUITE     ")
    print("================================================================\n")

    # Distinct test coordinates for Python test suite isolation
    TEST_LAT = 28.536000
    TEST_LNG = 77.392000

    # Ensure backend is reachable
    status_code, status_data = http_get("/api/status")
    assert_condition(status_code == 200, "Backend server is reachable", f"Status {status_code}")
    assert_condition(status_data.get("database", {}).get("connected") is True, "MongoDB database connected")

    # ------------------------------------------------------------------
    # TEST 1: First bus creates an incident
    # ------------------------------------------------------------------
    print("\n--- TEST 1: First bus creates an incident ---")
    candidate1 = {
        "candidate": {
            "type": "pothole",
            "confidence": 0.86,
            "gpsTimestamp": datetime.now(timezone.utc).isoformat(),
            "location": {
                "latitude": TEST_LAT,
                "longitude": TEST_LNG,
                "accuracy": 3.0
            },
            "bus": "RAAHI-01"
        }
    }

    code1, res1 = http_post("/api/dev/create-pothole", candidate1)
    pothole1 = res1.get("pothole", {})
    created_id = pothole1.get("potholeId")

    assert_condition(code1 in (200, 201), "HTTP status indicates successful candidate creation", f"Code {code1}")
    assert_condition(res1.get("created") is True, "First detection marked as created=True")
    assert_condition(res1.get("deduplicated") is False, "First detection marked as deduplicated=False")
    assert_condition(bool(created_id and created_id.startswith("POT-")), "Valid potholeId generated", created_id)
    assert_condition(pothole1.get("detectionCount") == 1, "Initial detectionCount is 1")
    assert_condition(pothole1.get("busesDetectedBy") == ["RAAHI-01"], "busesDetectedBy contains ['RAAHI-01']")

    # ------------------------------------------------------------------
    # TEST 2: Second bus detects the same physical pothole (<10m)
    # ------------------------------------------------------------------
    print("\n--- TEST 2: Second bus detects the same physical pothole ---")
    lat2 = TEST_LAT + 0.000007
    lng2 = TEST_LNG + 0.000008
    d2 = haversine_distance_meters(TEST_LAT, TEST_LNG, lat2, lng2)
    assert_condition(d2 < 10.0, "Bus 2 distance to base is < 10m", f"{d2}m")

    candidate2 = {
        "candidate": {
            "type": "pothole",
            "confidence": 0.91,
            "gpsTimestamp": datetime.now(timezone.utc).isoformat(),
            "location": {
                "latitude": lat2,
                "longitude": lng2,
                "accuracy": 2.6
            },
            "bus": "RAAHI-02"
        }
    }

    code2, res2 = http_post("/api/dev/create-pothole", candidate2)
    pothole2 = res2.get("pothole", {})

    assert_condition(code2 == 200, "HTTP 200 returned for deduplicated event")
    assert_condition(res2.get("deduplicated") is True, "Second detection marked as deduplicated=True")
    assert_condition(res2.get("matchedPotholeId") == created_id, "Second bus matched the same potholeId", f"{res2.get('matchedPotholeId')} == {created_id}")
    assert_condition(pothole2.get("detectionCount") == 2, "detectionCount incremented to 2")
    assert_condition(
        "RAAHI-01" in pothole2.get("busesDetectedBy", []) and "RAAHI-02" in pothole2.get("busesDetectedBy", []),
        "busesDetectedBy contains both RAAHI-01 and RAAHI-02"
    )

    # ------------------------------------------------------------------
    # TEST 3: Third bus detects the same physical pothole (<10m)
    # ------------------------------------------------------------------
    print("\n--- TEST 3: Third bus detects the same physical pothole ---")
    lat3 = TEST_LAT + 0.000014
    lng3 = TEST_LNG + 0.000004
    d3 = haversine_distance_meters(TEST_LAT, TEST_LNG, lat3, lng3)
    assert_condition(d3 < 10.0, "Bus 3 distance to base is < 10m", f"{d3}m")

    candidate3 = {
        "candidate": {
            "type": "pothole",
            "confidence": 0.88,
            "gpsTimestamp": datetime.now(timezone.utc).isoformat(),
            "location": {
                "latitude": lat3,
                "longitude": lng3,
                "accuracy": 3.1
            },
            "bus": "RAAHI-03"
        }
    }

    code3, res3 = http_post("/api/dev/create-pothole", candidate3)
    pothole3 = res3.get("pothole", {})

    assert_condition(code3 == 200, "HTTP 200 returned for third detection")
    assert_condition(res3.get("deduplicated") is True, "Third detection marked as deduplicated=True")
    assert_condition(res3.get("matchedPotholeId") == created_id, "Third bus matched the same potholeId", f"{res3.get('matchedPotholeId')} == {created_id}")

    # ------------------------------------------------------------------
    # TEST 4: detectionCount becomes 3
    # ------------------------------------------------------------------
    print("\n--- TEST 4: detectionCount becomes 3 ---")
    assert_condition(pothole3.get("detectionCount") == 3, "detectionCount is exactly 3", f"count={pothole3.get('detectionCount')}")

    # ------------------------------------------------------------------
    # TEST 5: busesDetectedBy contains all three buses
    # ------------------------------------------------------------------
    print("\n--- TEST 5: busesDetectedBy contains all three buses ---")
    buses_list = pothole3.get("busesDetectedBy", [])
    assert_condition("RAAHI-01" in buses_list, "RAAHI-01 present in busesDetectedBy")
    assert_condition("RAAHI-02" in buses_list, "RAAHI-02 present in busesDetectedBy")
    assert_condition("RAAHI-03" in buses_list, "RAAHI-03 present in busesDetectedBy")
    assert_condition(len(buses_list) == 3, "busesDetectedBy length is exactly 3", str(buses_list))

    # ------------------------------------------------------------------
    # TEST 6: No duplicate pothole document is created for same physical location
    # ------------------------------------------------------------------
    print("\n--- TEST 6: No duplicate pothole document for same physical location ---")
    _, all_potholes_data = http_get("/api/potholes")
    all_potholes = all_potholes_data.get("potholes", [])
    matches = [
        p for p in all_potholes
        if haversine_distance_meters(TEST_LAT, TEST_LNG, p["location"]["latitude"], p["location"]["longitude"]) <= 10.0
    ]
    assert_condition(len(matches) == 1, "Exactly one document exists within 10m of location", f"Found {len(matches)}")
    assert_condition(matches[0].get("potholeId") == created_id, "Document potholeId matches expected", created_id)

    # ------------------------------------------------------------------
    # TEST 7: A far-away pothole creates a different potholeId
    # ------------------------------------------------------------------
    print("\n--- TEST 7: A far-away pothole creates a different potholeId ---")
    FAR_LAT = 28.710000
    FAR_LNG = 77.120000
    d_far = haversine_distance_meters(TEST_LAT, TEST_LNG, FAR_LAT, FAR_LNG)
    assert_condition(d_far > 10.0, "Far coordinate distance > 10m", f"{d_far}m")

    candidate_far = {
        "candidate": {
            "type": "pothole",
            "confidence": 0.83,
            "gpsTimestamp": datetime.now(timezone.utc).isoformat(),
            "location": {
                "latitude": FAR_LAT,
                "longitude": FAR_LNG,
                "accuracy": 3.8
            },
            "bus": "RAAHI-01"
        }
    }

    code_far, res_far = http_post("/api/dev/create-pothole", candidate_far)
    pothole_far = res_far.get("pothole", {})
    far_id = pothole_far.get("potholeId")

    assert_condition(res_far.get("created") is True, "Far candidate marked as created=True")
    assert_condition(res_far.get("deduplicated") is False, "Far candidate marked as deduplicated=False")
    assert_condition(far_id != created_id, "Far candidate assigned distinct potholeId", f"{far_id} != {created_id}")

    # ------------------------------------------------------------------
    # TEST 8: Same bus repeated detection does not duplicate the bus ID
    # ------------------------------------------------------------------
    print("\n--- TEST 8: Same bus repeated detection does not duplicate bus ID ---")
    candidate_repeat = {
        "candidate": {
            "type": "pothole",
            "confidence": 0.89,
            "gpsTimestamp": datetime.now(timezone.utc).isoformat(),
            "location": {
                "latitude": TEST_LAT + 0.000002,
                "longitude": TEST_LNG + 0.000003,
                "accuracy": 2.7
            },
            "bus": "RAAHI-01"  # Repeat detection by RAAHI-01
        }
    }

    code_repeat, res_repeat = http_post("/api/dev/create-pothole", candidate_repeat)
    pothole_repeat = res_repeat.get("pothole", {})

    assert_condition(res_repeat.get("deduplicated") is True, "Repeated detection deduplicated")
    assert_condition(res_repeat.get("matchedPotholeId") == created_id, "Matched base pothole ID")
    assert_condition(pothole_repeat.get("detectionCount") == 4, "detectionCount incremented to 4", f"count={pothole_repeat.get('detectionCount')}")

    repeat_buses = pothole_repeat.get("busesDetectedBy", [])
    count_bus1 = repeat_buses.count("RAAHI-01")
    assert_condition(count_bus1 == 1, "RAAHI-01 appears exactly once in busesDetectedBy", f"count={count_bus1}")
    assert_condition(len(set(repeat_buses)) == len(repeat_buses), "All elements in busesDetectedBy are unique", str(repeat_buses))

    # Safe cleanup of dedicated test records created by this runner
    try:
        import subprocess
        cleanup_script = f"""
import('./dashboard/server/db.js').then(async ({{ connectDB }}) => {{
  await connectDB();
  const Pothole = (await import('./dashboard/server/models/Pothole.js')).default;
  await Pothole.deleteMany({{ potholeId: {{ '\\$in': ['{created_id}', '{far_id}'] }} }});
  process.exit(0);
}});
"""
        subprocess.run(["node", "-e", cleanup_script], capture_output=True, timeout=10)
    except Exception as e:
        print(f"  (Notice: Cleanup skipped: {e})")

    print("\n================================================================")
    print(f"  PYTHON TEST RESULTS: {passed_assertions}/{total_assertions} Assertions Passed")
    print(f"  Failures:            {failed_assertions}")
    print("================================================================\n")

    if failed_assertions > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    run_multi_bus_tests()
