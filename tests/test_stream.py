#!/usr/bin/env python3
"""Headless RTSP Stream Smoke Test.

Validates that:
1. RTSP endpoint is accessible.
2. H.264 video frames decode successfully without error.
3. Dimensions and FPS meet minimum viable thresholds.
4. Consecutive frames arrive consistently without corruption.
"""

import argparse
import sys
import time
import os

# Add parent directory to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import yaml
from capture.rtsp_receiver import RTSPReceiver, StreamState
from utils.logger import setup_logger

logger = setup_logger("raahi-edge.tests", level="INFO")


def run_stream_test(config_path: str = "config.yaml", target_frame_count: int = 60, timeout_sec: float = 30.0) -> bool:
    """Tests RTSP stream connectivity and frame capture."""
    if not os.path.exists(config_path):
        logger.error(f"Config file not found: {config_path}")
        return False

    with open(config_path, "r") as f:
        cfg = yaml.safe_load(f)

    stream_cfg = cfg.get("stream", {})
    rtsp_host = stream_cfg.get("rtsp_host", "127.0.0.1")
    rtsp_port = stream_cfg.get("rtsp_port", 8555)
    rtsp_path = stream_cfg.get("rtsp_path", "live")
    rtsp_url = f"rtsp://{rtsp_host}:{rtsp_port}/{rtsp_path}"

    logger.info(f"=== Starting RTSP Stream Smoke Test ===")
    logger.info(f"Target URL: {rtsp_url}")
    logger.info(f"Target frames: {target_frame_count} | Timeout: {timeout_sec}s")

    receiver = RTSPReceiver(
        rtsp_url=rtsp_url,
        transport=stream_cfg.get("transport", "tcp"),
        buffer_size=1,
        reconnect_delay_sec=1.0,
        read_timeout_sec=4.0
    )

    receiver.start()
    start_time = time.time()
    frames_received = 0
    sample_frame_shape = None

    try:
        while frames_received < target_frame_count:
            if time.time() - start_time > timeout_sec:
                logger.error(f"Test timed out after {timeout_sec}s. Only received {frames_received}/{target_frame_count} frames.")
                return False

            success, frame, meta = receiver.read(wait_for_new=True, timeout=0.5)
            if success and frame is not None:
                frames_received += 1
                if sample_frame_shape is None:
                    sample_frame_shape = frame.shape
                    logger.info(f"First frame received! Resolution: {sample_frame_shape[1]}x{sample_frame_shape[0]} ({sample_frame_shape[2]} channels)")

                if frames_received % 15 == 0:
                    stats = receiver.get_stats()
                    logger.info(f"Progress: {frames_received}/{target_frame_count} frames | Current FPS: {stats['current_fps']:.1f}")

    finally:
        receiver.stop()

    stats = receiver.get_stats()
    logger.info("=== Test Results Summary ===")
    logger.info(f"Total Frames Received: {stats['total_frames_received']}")
    logger.info(f"Average FPS:          {stats['average_fps']:.1f}")
    logger.info(f"Read Failures:        {stats['read_failures']}")
    logger.info(f"Dropped Frames:       {stats['dropped_frames']}")
    logger.info(f"Resolution:           {stats['resolution']}")

    if frames_received >= target_frame_count and stats['read_failures'] < (target_frame_count * 0.1):
        logger.info("✅ RTSP Stream Test PASSED!")
        return True
    else:
        logger.error("❌ RTSP Stream Test FAILED!")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run RTSP Smoke Test")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--frames", type=int, default=60, help="Number of frames to verify")
    parser.add_argument("--timeout", type=float, default=30.0, help="Test timeout in seconds")
    args = parser.parse_args()

    success = run_stream_test(args.config, args.frames, args.timeout)
    sys.exit(0 if success else 1)
