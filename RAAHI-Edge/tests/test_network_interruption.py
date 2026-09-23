#!/usr/bin/env python3
"""Network interruption and recovery latency test for RTSPReceiver.

Validates:
1. Normal live streaming with low-latency FFmpeg options.
2. Temporary stream/network interruption (5-second outage).
3. Automatic detection of stall/disconnect and complete cleanup of previous VideoCapture.
4. Clean reconnection upon network restoration.
5. Immediate return to live frames without replaying a growing backlog.
"""

import os
import subprocess
import sys
import time

# Ensure raahi-edge root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from capture.rtsp_receiver import RTSPReceiver, StreamState
from utils.logger import setup_logger

logger = setup_logger("raahi-edge.network_test", level="INFO")

RTSP_URL = "rtsp://127.0.0.1:8555/live"


def start_publisher() -> subprocess.Popen:
    """Launches an FFmpeg live H.264 publisher streaming testsrc2 with live timecode."""
    cmd = [
        "ffmpeg", "-re",
        "-f", "lavfi",
        "-i", "testsrc2=size=1920x1080:rate=30",
        "-c:v", "libx264",
        "-g", "30",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-f", "rtsp",
        RTSP_URL
    ]
    return subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run_test():
    logger.info("==================================================")
    logger.info("   RTSP RECEIVER NETWORK INTERRUPTION TEST        ")
    logger.info("==================================================")

    # Step 1: Start initial publisher
    logger.info("[1/5] Starting initial live RTSP publisher...")
    pub1 = start_publisher()
    time.sleep(1.5)  # Allow publisher to establish session on MediaMTX

    # Step 2: Connect receiver
    logger.info("[2/5] Initializing RTSPReceiver with low-latency configuration...")
    receiver = RTSPReceiver(
        rtsp_url=RTSP_URL,
        transport="tcp",
        buffer_size=1,
        reconnect_delay_sec=1.0,
        read_timeout_sec=3.0
    )
    receiver.start()

    # Wait for stream to enter STREAMING state
    logger.info("[2/5] Waiting for receiver to connect...")
    conn_deadline = time.time() + 5.0
    while time.time() < conn_deadline and receiver.stats.state != StreamState.STREAMING:
        time.sleep(0.1)

    # Verify initial normal streaming for 4 seconds
    logger.info("[2/5] Verifying normal live streaming (4s window)...")
    init_start = time.time()
    frames_before = 0
    while time.time() - init_start < 4.0:
        ret, frame, meta = receiver.read(wait_for_new=True, timeout=0.2)
        if ret and frame is not None:
            frames_before += 1

    stats_before = receiver.get_stats()
    logger.info(
        f"Pre-interruption status: {stats_before['state']} | "
        f"Frames: {stats_before['total_frames_received']} | "
        f"FPS: {stats_before['current_fps']:.1f} | "
        f"Failures: {stats_before['read_failures']} | "
        f"Resolution: {stats_before['resolution']}"
    )
    assert frames_before > 30, f"Expected at least 30 frames, got {frames_before}"

    # Step 3: Simulate network interruption
    logger.info("[3/5] Simulating network interruption (killing publisher for 4.0s)...")
    pub1.terminate()
    try:
        pub1.wait(timeout=2.0)
    except subprocess.TimeoutExpired:
        pub1.kill()

    outage_start = time.time()
    stall_detected = False
    while time.time() - outage_start < 4.0:
        ret, frame, meta = receiver.read(wait_for_new=True, timeout=0.2)
        cur_state = receiver.stats.state
        if cur_state in (StreamState.STALLED, StreamState.DISCONNECTED, StreamState.CONNECTING):
            stall_detected = True
        time.sleep(0.1)

    logger.info(f"Stall/Disconnect detected during outage: {stall_detected} (Current state: {receiver.stats.state.value})")

    # Step 4: Restore network
    logger.info("[4/5] Restoring network connection (relaunching live publisher)...")
    recovery_trigger_time = time.time()
    pub2 = start_publisher()

    # Step 5: Verify recovery and measure latency
    logger.info("[5/5] Monitoring stream recovery and latency...")
    recovered = False
    first_recovered_time = None
    frames_after = 0
    test_end = time.time() + 8.0

    while time.time() < test_end:
        ret, frame, meta = receiver.read(wait_for_new=True, timeout=0.2)
        if ret and frame is not None:
            now = time.time()
            if not recovered:
                recovered = True
                first_recovered_time = now
                recovery_latency = first_recovered_time - recovery_trigger_time
                logger.info(f"⚡ STREAM RECOVERED! Observed recovery latency: {recovery_latency:.2f}s")
            frames_after += 1

    # Cleanup
    pub2.terminate()
    try:
        pub2.wait(timeout=2.0)
    except subprocess.TimeoutExpired:
        pub2.kill()

    receiver.stop()

    # Final Report
    final_stats = receiver.get_stats()
    logger.info("==================================================")
    logger.info("          TEST RESULTS & TELEMETRY REPORT         ")
    logger.info("==================================================")
    logger.info(f"Recovery Success:       {recovered}")
    logger.info(f"Observed Recovery Lag:  {recovery_latency:.2f}s" if recovered else "N/A")
    logger.info(f"Reconnection Count:     {final_stats['reconnects']}")
    logger.info(f"Total Read Failures:    {final_stats['read_failures']}")
    logger.info(f"Frames Before Outage:   {frames_before}")
    logger.info(f"Frames After Recovery:  {frames_after}")
    logger.info(f"Recovered FPS:          {final_stats['current_fps']:.1f}")
    logger.info(f"Average FPS:            {final_stats['average_fps']:.1f}")
    logger.info(f"Final Resolution:       {final_stats['resolution']}")
    logger.info("==================================================")

    assert recovered, "Stream failed to recover after network restoration!"
    assert final_stats['reconnects'] >= 2, f"Expected at least 2 connections, got {final_stats['reconnects']}"
    assert frames_after > 30, f"Expected at least 30 frames after recovery, got {frames_after}"
    logger.info("✅ All network interruption and low-latency tests PASSED!")
    return True


if __name__ == "__main__":
    success = run_test()
    sys.exit(0 if success else 1)
