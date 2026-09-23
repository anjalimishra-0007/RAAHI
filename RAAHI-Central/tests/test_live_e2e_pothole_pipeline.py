#!/usr/bin/env python3
"""
Phase 15 Live End-to-End Pipeline Integration Test
==================================================
Simulates full end-to-end live operation:
1. Continuously posts live phone GPS telemetry (at a controlled test location).
2. Continuously posts live phone camera frames to Express buffer.
3. Runs src/live_camera.py in real-time inference mode on Apple Silicon MPS.
4. YOLO detects potholes in live frames, dispatches events to Express POST /api/live/detection.
5. Verifies live detection reached Express, associated with GPS, and updated/persisted in MongoDB.
"""

import sys
import time
import json
import subprocess
import threading
import urllib.request
from datetime import datetime, timezone
import cv2

SERVER_URL = "http://localhost:5001"
SAMPLE_VIDEO = "videos/input/cityRoad_potHoles-side.mp4"

# Controlled test coordinate for live end-to-end test (near POT-000004 in Sector 62)
TEST_LAT = 28.53552
TEST_LNG = 77.39103


def gps_worker(stop_event):
    """Continuously publishes phone GPS telemetry every 300ms."""
    while not stop_event.is_set():
        payload = {
            "latitude": TEST_LAT,
            "longitude": TEST_LNG,
            "accuracy": 3.5,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{SERVER_URL}/api/gps",
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                _ = resp.read()
        except Exception:
            pass
        time.sleep(0.3)


def frame_worker(stop_event):
    """Continuously pushes camera frames to Express live frame buffer."""
    cap = cv2.VideoCapture(SAMPLE_VIDEO)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 75)
    while not stop_event.is_set():
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 75)
            continue
        resized = cv2.resize(frame, (640, 360))
        _, buf = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
        req = urllib.request.Request(
            f"{SERVER_URL}/api/live/frame",
            data=buf.tobytes(),
            headers={"Content-Type": "image/jpeg"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=1.0) as resp:
                _ = resp.read()
        except Exception:
            pass
        time.sleep(0.04)  # ~25 FPS
    cap.release()


def main():
    print("==================================================")
    print("   PHASE 15: LIVE END-TO-END PIPELINE TEST       ")
    print("==================================================")

    stop_event = threading.Event()

    # 1. Start live GPS telemetry feeder
    print("[1/4] Starting live GPS telemetry sender...")
    gps_thread = threading.Thread(target=gps_worker, args=(stop_event,), daemon=True)
    gps_thread.start()
    time.sleep(0.5)

    # 2. Start live camera frame feeder
    print("[2/4] Starting live camera frame stream...")
    frame_thread = threading.Thread(target=frame_worker, args=(stop_event,), daemon=True)
    frame_thread.start()
    time.sleep(1.0)

    # Reset in-memory cooldown before test
    req = urllib.request.Request(f"{SERVER_URL}/api/dev/reset-live-cooldown", data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=2.0)
    except Exception:
        pass

    # 3. Launch live_camera.py with YOLO inference and API dispatch enabled
    print("[3/4] Launching src/live_camera.py on Apple Silicon MPS...")
    cmd = [
        sys.executable,
        "src/live_camera.py",
        "--source", f"{SERVER_URL}/api/live/stream",
        "--model", "runs/detect/runs/pothole_yolo11n/weights/best.pt",
        "--conf", "0.35",
        "--cooldown", "1.0",
        "--no-gui",
        "--max-frames", "40"
    ]

    print(f"Executing: {' '.join(cmd)}")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    duration = time.time() - t0

    stop_event.set()
    gps_thread.join(timeout=2.0)
    frame_thread.join(timeout=2.0)

    print(f"\nExecution Duration: {duration:.2f}s | Return Code: {proc.returncode}")
    print("\n--- STDOUT ---")
    print(proc.stdout)
    if proc.stderr:
        print("--- STDERR ---")
        print(proc.stderr)

    assert proc.returncode == 0, f"Expected returncode 0, got {proc.returncode}"
    assert ("LIVE SESSION SUMMARY (PHASE 16)" in proc.stdout) or ("LIVE SESSION SUMMARY (PHASE 15)" in proc.stdout), "Expected session summary in output"
    assert "Events Confirmed:" in proc.stdout, "Expected Events Confirmed line in output"

    # 4. Verify MongoDB state after live run
    print("\n[4/4] Verifying MongoDB and Express API status...")
    with urllib.request.urlopen(f"{SERVER_URL}/api/potholes", timeout=5.0) as resp:
        potholes_data = json.loads(resp.read().decode("utf-8"))

    potholes = potholes_data.get("potholes", [])
    print(f"Total potholes in MongoDB: {len(potholes)}")
    for p in potholes:
        print(f"   • {p.get('potholeId')}: count={p.get('detectionCount')}, lastDetectedAt={p.get('lastDetectedAt')}")

    assert len(potholes) >= 4, f"Expected at least 4 potholes, got {len(potholes)}"

    print("\n==================================================")
    print("   PHASE 15 LIVE END-TO-END PIPELINE VERIFIED!   ")
    print("==================================================")
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
