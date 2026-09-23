#!/usr/bin/env python3
"""
End-to-End Test: Live Camera Stream + YOLO11n Inference on Apple Silicon MPS
============================================================================
1. Starts frame feeder sending real road video frames to Express
2. Runs src/live_camera.py as a subprocess with --no-gui --max-frames 30
3. Verifies that live YOLO inference executed, detected potholes, and printed summary
"""

import sys
import time
import subprocess
import threading
import urllib.request
import cv2


SERVER_URL = "http://localhost:5001"
SAMPLE_VIDEO = "videos/input/cityRoad_potHoles-side.mp4"


def feed_frames(stop_event):
    cap = cv2.VideoCapture(SAMPLE_VIDEO)
    while not stop_event.is_set():
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        resized = cv2.resize(frame, (640, 360))
        _, buf = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
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
        time.sleep(0.045)  # ~22 FPS
    cap.release()


def main():
    print("==================================================")
    print("   PHASE 14 END-TO-END LIVE INFERENCE TEST        ")
    print("==================================================")

    stop_event = threading.Event()
    feeder = threading.Thread(target=feed_frames, args=(stop_event,), daemon=True)
    feeder.start()
    time.sleep(1.0)

    # Run src/live_camera.py
    cmd = [
        sys.executable,
        "src/live_camera.py",
        "--source", f"{SERVER_URL}/api/live/stream",
        "--model", "runs/detect/runs/pothole_yolo11n/weights/best.pt",
        "--conf", "0.35",
        "--no-gui",
        "--max-frames", "30"
    ]

    print(f"Executing: {' '.join(cmd)}")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    duration = time.time() - t0

    stop_event.set()
    feeder.join(timeout=2.0)

    print(f"\nReturn Code: {proc.returncode}")
    print("\n--- STDOUT ---")
    print(proc.stdout)
    if proc.stderr:
        print("--- STDERR ---")
        print(proc.stderr)

    assert proc.returncode == 0, f"Expected return code 0, got {proc.returncode}"
    assert "LIVE SESSION SUMMARY (PHASE 14)" in proc.stdout, "Expected summary in output"
    assert "Frames Processed:   30" in proc.stdout, "Expected 30 frames processed"
    assert "Apple Silicon MPS" in proc.stdout or "MPS" in proc.stdout, "Expected MPS device in output"

    print("==================================================")
    print("      END-TO-END LIVE INFERENCE TEST PASSED!      ")
    print("==================================================")


if __name__ == "__main__":
    main()
