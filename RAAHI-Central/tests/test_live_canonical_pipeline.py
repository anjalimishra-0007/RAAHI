#!/usr/bin/env python3
"""
Unit and Integration Test Suite for Canonical Central Event Ingestion,
GPS Association & Queuing, and Explicit Promotion.
"""
import sys
import time
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE_URL = "http://localhost:5001"

def http_post(path: str, data: dict):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as he:
        return he.code, json.loads(he.read().decode("utf-8"))

def http_get(path: str):
    req = urllib.request.Request(f"{BASE_URL}{path}", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as he:
        return he.code, json.loads(he.read().decode("utf-8"))

def run_tests():
    print("==================================================")
    print(" CANONICAL CENTRAL EVENT & GPS PIPELINE TEST")
    print("==================================================")

    # 1. Check Central Status
    status, res = http_get("/api/status")
    assert status == 200, f"GET /api/status failed: {res}"
    print(f"✓ Central Status API: {res.get('centralPlatform')} (Database connected: {res.get('database', {}).get('connected')})")
    assert "cityRoad_potHoles-side.mp4" not in json.dumps(res), "Clean status check failed: video file still in /api/status"
    assert "12 Simulated" not in json.dumps(res), "Clean status check failed: demo fleet still in /api/status"
    print("✓ Central Status API is clean and Central-native!")

    # 2. Get baseline counts
    status, cand_res = http_get("/api/central/candidates")
    baseline_cand_count = cand_res.get("count", 0)
    status, pot_res = http_get("/api/potholes")
    baseline_pot_count = pot_res.get("count", len(pot_res.get("potholes", [])))
    print(f"✓ Baseline counts: Candidates={baseline_cand_count}, Potholes={baseline_pot_count}")

    # 3. Test Canonical Event Ingestion with Real Coordinates
    test_event_id = f"EVT-TEST-{int(time.time()*1000)}"
    payload = {
        "eventId": test_event_id,
        "eventType": "pothole",
        "busId": "RAAHI-01",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "latitude": 28.535512,
        "longitude": 77.391024,
        "accuracy": 3.8,
        "edgeModel": "YOLO11n",
        "confidence": 0.86,
        "class": "pothole",
        "boundingBox": {
            "x1": 150,
            "y1": 120,
            "x2": 280,
            "y2": 210
        }
    }

    status, ingest_res = http_post("/api/central/events", payload)
    print(f"Ingestion result (Status {status}): {ingest_res.get('message')}")
    assert status == 201, f"Expected 201 Created, got {status}: {ingest_res}"
    assert ingest_res.get("success") is True
    assert ingest_res.get("created") is True
    assert ingest_res.get("status") == "pending"
    candidate_id = ingest_res.get("candidateId")
    assert candidate_id.startswith("CAN-"), f"Expected CAN- prefix, got {candidate_id}"
    print(f"✓ TEST 1 PASSED: Canonical event ingested as Candidate {candidate_id} (status: pending)")

    # 4. Verify Pothole count did NOT increase on ingestion
    status, pot_res2 = http_get("/api/potholes")
    current_pot_count = pot_res2.get("count", len(pot_res2.get("potholes", [])))
    assert current_pot_count == baseline_pot_count, f"Pothole was prematurely created! {current_pot_count} != {baseline_pot_count}"
    print("✓ TEST 2 PASSED: Ingestion did NOT create authoritative Pothole.")

    # 5. Test Idempotency / Duplicate Retry
    status, dup_res = http_post("/api/central/events", payload)
    assert status == 200, f"Expected 200 OK for duplicate, got {status}"
    assert dup_res.get("duplicate") is True
    assert dup_res.get("candidateId") == candidate_id
    print("✓ TEST 3 PASSED: Duplicate event retry handled idempotently (HTTP 200, duplicate=True).")

    # 6. Test Explicit Promotion
    promote_path = f"/api/central/candidates/{candidate_id}/promote"
    status, prom_res = http_post(promote_path, {})
    print(f"Promotion result (Status {status}): {prom_res.get('message')}")
    assert status in (200, 201), f"Expected 200 or 201 for promotion, got {status}: {prom_res}"
    assert prom_res.get("success") is True
    assert prom_res.get("promoted") is True
    pothole_id = prom_res.get("potholeId")
    assert pothole_id.startswith("POT-"), f"Expected POT- prefix, got {pothole_id}"
    print(f"✓ TEST 4 PASSED: Candidate explicitly promoted to Pothole {pothole_id}")

    # 7. Verify Lineage
    status, cand_after = http_get(f"/api/central/candidates/{candidate_id}")
    cand_doc = cand_after.get("candidate", cand_after)
    assert cand_doc.get("status") == "promoted"
    assert cand_doc.get("promotedToPotholeId") == pothole_id
    print(f"✓ TEST 5 PASSED: Candidate lineage verified: {candidate_id} -> {pothole_id}")

    # 8. Verify Pothole in authoritative list
    status, pot_detail = http_get(f"/api/potholes/{pothole_id}")
    assert pot_detail.get("pothole", {}).get("potholeId") == pothole_id
    source_id = pot_detail.get("pothole", {}).get("sourceCandidateId")
    assert source_id is not None and source_id.startswith("CAN-")
    print(f"✓ TEST 6 PASSED: Pothole lineage verified: {pothole_id} -> sourceCandidateId: {candidate_id}")

    print("==================================================")
    print(" ALL 6 CANONICAL PIPELINE TESTS PASSED!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
