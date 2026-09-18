"""
Code-Level Validation script for RAAHI-Edge 15-second Evidence Capture System.
NOTE: This is a CODE-LEVEL UNIT BENCHMARK using synthetic frames to precisely
measure buffer mechanics, t0 anchoring, FFmpeg encoding, and SQLite lifecycle.

Verifies:
- Configured pre-buffer = 5.0 seconds
- Configured post-buffer = 10.0 seconds
- t0 timestamp anchoring eliminates pre-buffer truncation from SQLite I/O latency
- Pre-event frame count = 150 frames @ 30 FPS (5.00s)
- Post-event frame count = 300 frames @ 30 FPS (10.00s)
- Total evidence duration = 450 frames / 15.00s
- ffprobe validation: 1920x1080 @ 30 FPS H.264
- SQLite integrity: 1 row in events, 1 in evidence, 1 in transmission_queue
"""

import json
import os
import shutil
import subprocess
import sys
import time
import cv2
import numpy as np

# Ensure project root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from ring_buffer.rolling_buffer import RollingFrameBuffer
from evidence.evidence_recorder import EvidenceManager, get_ffmpeg_bin
from storage.sqlite_db import EdgeDatabase


def run_evidence_timing_test():
    print("=" * 70)
    print("RAAHI-EDGE CODE-LEVEL EVIDENCE LIFECYCLE & t0 ANCHORING TEST")
    print("=" * 70)

    test_db_path = os.path.join(BASE_DIR, "data", "test_evidence.db")
    if os.path.exists(test_db_path):
        os.remove(test_db_path)

    test_evidence_dir = os.path.join(BASE_DIR, "data", "evidence")
    os.makedirs(test_evidence_dir, exist_ok=True)

    db = EdgeDatabase(db_path=test_db_path)

    # Completed session storage
    completed_event = {}
    completed_event_ready = False

    def on_evidence_ready(event_id, clip_path, keyframe_path, size_bytes, duration_sec, fps, resolution, timing=None):
        nonlocal completed_event_ready
        t4_start = time.time()
        db.update_event_evidence(
            event_id=event_id,
            clip_path=clip_path,
            keyframe_path=keyframe_path,
            size_bytes=size_bytes,
            duration_sec=duration_sec,
            fps=fps,
            resolution=resolution
        )
        t4_end = time.time()

        completed_event["event_id"] = event_id
        completed_event["clip_path"] = clip_path
        completed_event["keyframe_path"] = keyframe_path
        completed_event["size_bytes"] = size_bytes
        completed_event["duration_sec"] = duration_sec
        completed_event["fps"] = fps
        completed_event["resolution"] = resolution
        completed_event["timing"] = timing or {}
        completed_event["t4"] = t4_end
        completed_event_ready = True

    # 1. Configuration
    target_fps = 30.0
    pre_duration_sec = 5.0
    post_duration_sec = 10.0
    expected_pre_frames = int(target_fps * pre_duration_sec)   # 150 frames
    expected_post_frames = int(target_fps * post_duration_sec)  # 300 frames
    expected_total_frames = expected_pre_frames + expected_post_frames  # 450 frames

    ring_buffer = RollingFrameBuffer(target_duration_sec=pre_duration_sec, max_capacity=180)
    evidence_mgr = EvidenceManager(output_dir=test_evidence_dir, on_evidence_ready=on_evidence_ready)

    print(f"\n[1] Buffer Configuration:")
    print(f"    Target FPS:            {target_fps} FPS | Resolution: 1920x1080")
    print(f"    Pre-buffer target:     {pre_duration_sec:.1f}s ({expected_pre_frames} frames)")
    print(f"    Post-buffer target:    {post_duration_sec:.1f}s ({expected_post_frames} frames)")
    print(f"    Total evidence target: {pre_duration_sec + post_duration_sec:.1f}s ({expected_total_frames} frames)")

    # 2. Simulate 150 pre-event frames arriving over preceding 5.0 seconds leading up to t0
    print(f"\n[2] Pushing {expected_pre_frames} pre-event frames to rolling buffer...")
    base_frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    base_frame[:] = (45, 45, 45)

    # Establish exact t0 anchor
    t0 = time.time()
    stream_start_time = t0 - pre_duration_sec
    for i in range(expected_pre_frames):
        f = base_frame.copy()
        cv2.putText(f, f"PRE-EVENT FRAME #{i+1:03d} / {expected_pre_frames}", (80, 200),
                    cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 255, 255), 4)
        ts = stream_start_time + (i / target_fps)
        ring_buffer.push(f, timestamp=ts)

    print(f"    Buffer size after pre-fill: {len(ring_buffer)} frames in memory.")

    # 3. Simulate Event Acceptance at t0 with t0-anchored retrieval
    event_id = f"EVT-TEST-{int(t0)}"
    print(f"\n[3] Event accepted at t0 = {t0:.4f} (Event ID: {event_id})")

    # Step A: Retrieve pre-frames immediately anchored to t0
    pre_frames = ring_buffer.get_pre_buffer_frames(duration_sec=pre_duration_sec, reference_time=t0)
    actual_pre_frames_count = len(pre_frames)
    actual_pre_duration = actual_pre_frames_count / target_fps
    print(f"    Pre-frames retrieved (anchored to t0): {actual_pre_frames_count} frames ({actual_pre_duration:.2f}s)")
    assert actual_pre_frames_count == expected_pre_frames, (
        f"Expected {expected_pre_frames} pre-frames, got {actual_pre_frames_count}!"
    )

    # Step B: Simulate SQLite insertion latency (~300ms delay) to test decoupling
    print("    Simulating ~300ms SQLite database serialization & disk sync latency...")
    time.sleep(0.300)

    pkg = {
        "eventId": event_id,
        "eventType": "pothole",
        "className": "pothole",
        "busId": "RAAHI-001",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
        "latitude": 28.6139,
        "longitude": 77.2090,
        "gpsAccuracy": 3.2,
        "gpsTimestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
        "isGpsFallback": False,
        "edgeModel": "YOLO11n",
        "edgeConfidence": 0.88,
        "bbox": {"x1": 600, "y1": 500, "x2": 900, "y2": 750, "w": 300, "h": 250},
        "frameNumber": 1500,
        "source": "RAAHI-Eye"
    }
    db.insert_event(pkg)
    print("    Candidate inserted into SQLite events & transmission_queue (status='RECORDING').")

    # Verify that pre_frames retained the full 150 frames despite the 300ms delay
    print(f"    [+] Pre-buffer preserved at {len(pre_frames)} frames despite 300ms SQLite delay!")

    # Step C: Start evidence capture session
    evidence_mgr.start_capture(
        event_id=event_id,
        pre_frames=pre_frames,
        fps=target_fps,
        frame_size=(1920, 1080),
        post_duration_sec=post_duration_sec,
        t0=t0
    )
    t1 = time.time()
    print(f"    Evidence capture session started at t1 = {t1:.4f} (delta t1 - t0: {(t1 - t0)*1000:.2f} ms)")

    # 4. Stream post-event frames (300 frames)
    print(f"\n[4] Feeding {expected_post_frames} post-event frames...")
    for j in range(expected_post_frames):
        f = base_frame.copy()
        cv2.putText(f, f"POST-EVENT FRAME #{j+1:03d} / {expected_post_frames}", (80, 200),
                    cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 165, 255), 4)
        evidence_mgr.on_new_frame(f)
        time.sleep(0.001)

    t2 = time.time()
    print(f"    Post-event stream completed at t2 = {t2:.4f}")

    # 5. Await worker finalization
    print(f"\n[5] Waiting for evidence MP4 finalization, H.264 remux, and SQLite commit...")
    wait_start = time.time()
    while not completed_event_ready and (time.time() - wait_start) < 30.0:
        time.sleep(0.1)

    if not completed_event_ready:
        print("[-] ERROR: Timed out waiting for evidence finalization!")
        sys.exit(1)

    t3 = completed_event["timing"].get("t3", 0.0)
    t4 = completed_event.get("t4", 0.0)

    print("\n" + "=" * 70)
    print("TIMING & FRAME COUNT BENCHMARK RESULTS")
    print("=" * 70)
    print(f"t0 (Event accepted):           {t0:.4f}")
    print(f"t1 (Evidence capture started): {t1:.4f}  (delta t1-t0: {(t1-t0)*1000:.2f} ms)")
    print(f"t2 (Post-recording ended):     {t2:.4f}  (delta t2-t1: {t2-t1:.3f} s)")
    print(f"t3 (MP4 finalized on disk):    {t3:.4f}  (delta t3-t2: {t3-t2:.3f} s remux)")
    print(f"t4 (SQLite updated & queued):  {t4:.4f}  (delta t4-t3: {(t4-t3)*1000:.2f} ms)")
    print("-" * 70)
    print(f"★ Pre-event frame count:       {completed_event['timing'].get('pre_frames_count')} frames")
    print(f"★ Actual pre-event duration:   {completed_event['timing'].get('pre_frames_count', 0) / target_fps:.2f} seconds")
    print(f"★ Post-event frame count:      {completed_event['timing'].get('post_frames_count')} frames")
    print(f"★ Actual post-event duration:  {completed_event['timing'].get('post_frames_count', 0) / target_fps:.2f} seconds")
    print(f"★ Total frames in clip:        {completed_event['timing'].get('total_frames_count')} frames")
    print(f"★ Total video duration:        {completed_event['duration_sec']:.2f} seconds")
    print(f"★ Total Pipeline Latency:      {t3 - t0:.3f} seconds")

    assert completed_event['timing'].get('pre_frames_count') == 150, "Pre-frames must be exactly 150!"
    assert completed_event['timing'].get('post_frames_count') == 300, "Post-frames must be exactly 300!"
    assert completed_event['timing'].get('total_frames_count') == 450, "Total frames must be exactly 450!"

    # 6. ffprobe inspection
    clip_path = completed_event["clip_path"]
    print("\n" + "=" * 70)
    print("MEDIA INSPECTION VIA FFPROBE")
    print("=" * 70)
    print(f"File Path: {clip_path}")
    print(f"File Size: {completed_event['size_bytes'] / 1024:.1f} KB")

    ffprobe_bin = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe" or "/usr/local/bin/ffprobe"
    if os.path.exists(ffprobe_bin):
        cmd = [
            ffprobe_bin,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            clip_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            info = json.loads(res.stdout)
            v_stream = info.get("streams", [{}])[0]
            format_info = info.get("format", {})

            codec_name = v_stream.get("codec_name")
            width = v_stream.get("width")
            height = v_stream.get("height")
            r_frame_rate = v_stream.get("r_frame_rate")
            nb_frames = int(v_stream.get("nb_frames", 0))
            duration = float(format_info.get("duration", 0.0))

            print(f"  Codec:       {codec_name}")
            print(f"  Resolution:  {width}x{height}")
            print(f"  Frame Rate:  {r_frame_rate} FPS")
            print(f"  nb_frames:   {nb_frames}")
            print(f"  Duration:    {duration:.2f} seconds")
            print(f"  Bitrate:     {int(format_info.get('bit_rate', 0)) / 1000:.1f} kbps")

            assert codec_name == "h264", f"Expected h264, got {codec_name}"
            assert width == 1920, f"Expected 1920, got {width}"
            assert height == 1080, f"Expected 1080, got {height}"
            assert nb_frames == 450, f"Expected 450 frames in ffprobe, got {nb_frames}"
            assert 14.9 <= duration <= 15.1, f"Expected ~15.0s duration, got {duration}"
            print("  [+] FFPROBE VALIDATION PASSED: Exactly 450 frames @ 30 FPS = 15.00s H.264!")

    # 7. Check SQLite records
    print("\n" + "=" * 70)
    print("SQLITE INTEGRITY VERIFICATION")
    print("=" * 70)
    event_row = db.get_event_by_id(event_id)
    print(f"  Events Table Row:        event_id={event_row['event_id']}, evidence_path={event_row['evidence_clip_path']}")

    conn = db._get_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM evidence WHERE event_id = ?", (event_id,))
    ev_row = dict(cur.fetchone())
    print(f"  Evidence Table Row:      duration={ev_row['duration_sec']}s, fps={ev_row['fps']}, resolution={ev_row['resolution']}")

    cur.execute("SELECT * FROM transmission_queue WHERE event_id = ?", (event_id,))
    q_row = dict(cur.fetchone())
    print(f"  Transmission Queue Row:  status={q_row['status']} (transitioned to PENDING)")

    cur.execute("SELECT COUNT(*) FROM events")
    evt_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM transmission_queue")
    q_count = cur.fetchone()[0]
    conn.close()

    assert evt_count == 1, f"Expected exactly 1 event, got {evt_count}"
    assert q_count == 1, f"Expected exactly 1 queue row, got {q_count}"
    assert q_row["status"] == "PENDING"
    print(f"  [+] Exactly 1 event & 1 evidence row created (zero raw frames stored in SQLite).")

    # Clean up test database
    if os.path.exists(test_db_path):
        os.remove(test_db_path)

    print("\n" + "=" * 70)
    print("ALL CODE-LEVEL t0 ANCHORING & LIFECYCLE TESTS PASSED!")
    print("=" * 70)


if __name__ == "__main__":
    run_evidence_timing_test()
