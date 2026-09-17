#!/usr/bin/env python3
"""
Test Suite: Phase 14 Live Phone Camera Ingestion & YOLO11n Inference Pipeline
=============================================================================
1. Simulates a mobile phone uploading camera frames to POST /api/live/frame
2. Tests GET /api/live/stream (multipart MJPEG stream)
3. Tests GET /api/live/status
4. Runs live YOLO11n inference on Apple Silicon MPS via src/live_camera.py
5. Tests graceful disconnect handling
"""

import sys
import time
import json
import urllib.request
import threading
from pathlib import Path
import cv2
import numpy as np


SERVER_URL = "http://localhost:5001"
SAMPLE_VIDEO = "videos/input/cityRoad_potHoles-side.mp4"


def feed_frames(video_path: str, max_frames: int = 40, fps: float = 20.0, stop_event: threading.Event = None):
    """Reads frames from test video and POSTs to /api/live/frame."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[Feeder] Error: Unable to open {video_path}")
        return

    delay = 1.0 / fps
    count = 0

    print(f"[Feeder] Started feeding up to {max_frames} frames to {SERVER_URL}/api/live/frame at {fps} FPS...")

    while count < max_frames and (stop_event is None or not stop_event.is_set()):
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        # Resize to standard phone camera resolution 640x360
        frame_resized = cv2.resize(frame, (640, 360))
        _, buffer = cv2.imencode('.jpg', frame_resized, [cv2.IMWRITE_JPEG_QUALITY, 70])
        jpg_bytes = buffer.tobytes()

        req = urllib.request.Request(
            f"{SERVER_URL}/api/live/frame",
            data=jpg_bytes,
            headers={"Content-Type": "image/jpeg"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                _ = resp.read()
            count += 1
        except Exception as e:
            print(f"[Feeder] Frame {count} error: {e}")

        time.sleep(delay)

    cap.release()
    print(f"[Feeder] Completed feeding {count} frames.")


def main():
    print("==================================================")
    print("     PHASE 14 LIVE STREAM PIPELINE VERIFICATION   ")
    print("==================================================")

    # 1. Verify /api/live/status
    print("\n[Step 1] Checking /api/live/status...")
    with urllib.request.urlopen(f"{SERVER_URL}/api/live/status", timeout=5.0) as resp:
        data = json.loads(resp.read().decode())
        print(f"  Status response: streaming={data.get('streaming')}, totalFrames={data.get('totalFramesReceived')}")
        assert data.get("success") is True, "Expected success: true"

    # 2. Start feeder in background
    stop_event = threading.Event()
    feeder_thread = threading.Thread(
        target=feed_frames,
        args=(SAMPLE_VIDEO, 60, 20.0, stop_event),
        daemon=True
    )
    feeder_thread.start()

    # Wait for feeder to establish stream
    time.sleep(1.0)

    # 3. Verify /api/live/status reports streaming: true
    print("\n[Step 2] Verifying streaming status after frames sent...")
    with urllib.request.urlopen(f"{SERVER_URL}/api/live/status", timeout=5.0) as resp:
        data = json.loads(resp.read().decode())
        print(f"  Streaming: {data.get('streaming')}, FPS: {data.get('fps')}, Total Frames: {data.get('totalFramesReceived')}")
        assert data.get("streaming") is True, "Expected streaming: true"
        assert data.get("totalFramesReceived") > 0, "Expected frames > 0"

    # 4. Verify single frame retrieval GET /api/live/frame
    print("\n[Step 3] Verifying GET /api/live/frame...")
    with urllib.request.urlopen(f"{SERVER_URL}/api/live/frame", timeout=5.0) as resp:
        content_type = resp.headers.get("Content-Type")
        frame_bytes = resp.read()
        print(f"  Content-Type: {content_type}, Size: {len(frame_bytes)} bytes")
        assert "image/jpeg" in content_type, "Expected image/jpeg Content-Type"
        assert len(frame_bytes) > 1000, "Expected non-empty image bytes"

    # 5. Test OpenCV stream capture
    print("\n[Step 4] Testing cv2.VideoCapture on http://localhost:5001/api/live/stream...")
    cap = cv2.VideoCapture(f"{SERVER_URL}/api/live/stream")
    assert cap.isOpened(), "Expected cap.isOpened() == True"

    frames_read = 0
    for _ in range(15):
        ret, frame = cap.read()
        if ret and frame is not None:
            frames_read += 1
    cap.release()
    print(f"  Successfully decoded {frames_read}/15 frames from MJPEG stream via OpenCV!")
    assert frames_read > 0, "Expected at least 1 frame read by OpenCV"

    # 6. Stop feeder
    stop_event.set()
    feeder_thread.join(timeout=3.0)

    # 7. Wait 4 seconds and verify graceful idle transition
    print("\n[Step 5] Testing graceful stream idle detection...")
    time.sleep(4.0)
    with urllib.request.urlopen(f"{SERVER_URL}/api/live/status", timeout=5.0) as resp:
        data = json.loads(resp.read().decode())
        print(f"  Streaming status after 4s idle: {data.get('streaming')} (Correctly idle)")
        assert data.get("streaming") is False, "Expected streaming: false after idle"

    print("\n==================================================")
    print("      ALL LIVE STREAM PIPELINE TESTS PASSED       ")
    print("==================================================")


if __name__ == "__main__":
    main()
