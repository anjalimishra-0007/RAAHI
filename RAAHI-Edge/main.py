#!/usr/bin/env python3
"""RAAHI Edge AI - Main Entry Point.

Phase 1: Android S23 FE -> RTSP (MediaMTX) -> OpenCV Live Feed & Telemetry.
"""

import argparse
import os
import signal
import sys
import time
from typing import Dict, Any

import cv2
import numpy as np
import yaml

from capture.rtsp_receiver import RTSPReceiver, StreamState
from utils.logger import setup_logger, get_logger


def load_config(config_path: str) -> Dict[str, Any]:
    """Loads configuration YAML file."""
    if not os.path.exists(config_path):
        print(f"[ERROR] Config file not found at {config_path}")
        sys.exit(1)
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def draw_diagnostics_overlay(
    frame: np.ndarray,
    stats: Dict[str, Any],
    scale_factor: float = 1.0
) -> np.ndarray:
    """Draws a semi-transparent telemetry overlay on the frame."""
    h, w = frame.shape[:2]

    # Create overlay panel
    overlay = frame.copy()
    box_w = min(420, int(w * 0.9))
    box_h = 210
    cv2.rectangle(overlay, (10, 10), (10 + box_w, 10 + box_h), (20, 24, 30), -1)

    # Blend overlay with original frame (alpha transparency)
    alpha = 0.75
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

    # Border around HUD
    cv2.rectangle(frame, (10, 10), (10 + box_w, 10 + box_h), (60, 70, 85), 1)

    # Status indicator color
    state = stats.get("state", "UNKNOWN")
    if state == "STREAMING":
        status_color = (0, 220, 0)      # Bright Green
    elif state == "CONNECTING":
        status_color = (0, 200, 255)    # Amber / Orange
    else:
        status_color = (0, 0, 255)      # Red

    # Header
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(frame, "RAAHI EDGE - TELEMETRY", (25, 38), font, 0.65, (255, 255, 255), 2)
    cv2.circle(frame, (10 + box_w - 25, 34), 7, status_color, -1)

    # Diagnostic text lines
    uptime = stats.get("uptime_seconds", 0.0)
    mins, secs = divmod(int(uptime), 60)
    uptime_str = f"{mins:02d}:{secs:02d}"

    lines = [
        f"State:       {state}",
        f"Resolution:  {stats.get('resolution', 'N/A')}",
        f"FPS:         {stats.get('current_fps', 0.0)} (avg: {stats.get('average_fps', 0.0)})",
        f"Frames:      {stats.get('total_frames_received', 0)} rx / {stats.get('dropped_frames', 0)} drop",
        f"Failures:    {stats.get('read_failures', 0)} (reconnects: {stats.get('reconnects', 0)})",
        f"Uptime:      {uptime_str}",
        "E2E Latency: Unsynced clocks (sender TS required)"
    ]

    y_offset = 65
    for line in lines:
        is_latency = "E2E Latency" in line
        text_color = (160, 170, 180) if is_latency else (220, 230, 240)
        font_scale = 0.40 if is_latency else 0.46
        cv2.putText(frame, line, (25, y_offset), font, font_scale, text_color, 1, cv2.LINE_AA)
        y_offset += 20

    return frame


def main():
    parser = argparse.ArgumentParser(description="RAAHI Edge AI - Phase 1 RTSP Receiver")
    parser.add_argument("--config", type=str, default="config.yaml", help="Path to config YAML")
    parser.add_argument("--no-gui", action="store_true", help="Run in headless benchmark mode without GUI")
    args = parser.parse_args()

    # Load configuration
    cfg = load_config(args.config)
    stream_cfg = cfg.get("stream", {})
    camera_cfg = cfg.get("camera", {})
    disp_cfg = cfg.get("display", {})
    log_cfg = cfg.get("logging", {})

    # Setup logger
    logger = setup_logger("raahi-edge", level=log_cfg.get("level", "INFO"))
    logger.info("==================================================")
    logger.info("           RAAHI EDGE AI - PHASE 1")
    logger.info("==================================================")

    # Build RTSP URL
    rtsp_host = stream_cfg.get("rtsp_host", "127.0.0.1")
    rtsp_port = stream_cfg.get("rtsp_port", 8555)
    rtsp_path = stream_cfg.get("rtsp_path", "live")
    rtsp_url = f"rtsp://{rtsp_host}:{rtsp_port}/{rtsp_path}"

    logger.info(f"Target RTSP URL: {rtsp_url}")
    logger.info(f"Transport: {stream_cfg.get('transport', 'tcp')}")
    logger.info(f"Expected Camera: {camera_cfg.get('expected_width', 1920)}x{camera_cfg.get('expected_height', 1080)} @ {camera_cfg.get('expected_fps', 30)} FPS")

    # Initialize Receiver
    receiver = RTSPReceiver(
        rtsp_url=rtsp_url,
        transport=stream_cfg.get("transport", "tcp"),
        buffer_size=stream_cfg.get("buffer_size", 1),
        reconnect_delay_sec=stream_cfg.get("reconnect_delay_sec", 2.0),
        max_reconnect_attempts=stream_cfg.get("max_reconnect_attempts", 0),
        read_timeout_sec=stream_cfg.get("read_timeout_sec", 5.0)
    )

    # Handle graceful exit on SIGINT / SIGTERM
    stop_signal = False

    def sig_handler(signum, frame):
        nonlocal stop_signal
        logger.info(f"Signal {signum} received. Initiating graceful shutdown...")
        stop_signal = True

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    # Start capture thread
    receiver.start()

    window_name = disp_cfg.get("window_name", "RAAHI Edge AI - Live Feed")
    show_overlay = disp_cfg.get("show_diagnostics", True)
    scale_factor = disp_cfg.get("scale_factor", 1.0)
    no_gui = args.no_gui

    if not no_gui:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 1280, 720)

    last_stats_log = time.time()
    logger.info("Entering processing loop. Press 'q' to quit, 'd' to toggle overlay, 's' for snapshot.")

    try:
        while not stop_signal:
            success, frame, metadata = receiver.read(wait_for_new=True, timeout=0.1)
            stats = receiver.get_stats()

            # Periodic console telemetry (every 5 seconds)
            now = time.time()
            if now - last_stats_log >= 5.0:
                logger.info(
                    f"Status: {stats['state']:<11} | Res: {stats['resolution']:<10} | "
                    f"FPS: {stats['current_fps']:<4.1f} | Rx: {stats['total_frames_received']:<5} | "
                    f"Drops: {stats['dropped_frames']:<3} | Failures: {stats['read_failures']:<2}"
                )
                last_stats_log = now

            if not success or frame is None:
                # If no frame yet, handle OpenCV event loop to keep window responsive
                if not no_gui:
                    key = cv2.waitKey(10) & 0xFF
                    if key in (ord('q'), 27):  # 'q' or ESC
                        break
                continue

            # Frame processing / display
            if not no_gui:
                display_frame = frame
                if scale_factor != 1.0:
                    display_frame = cv2.resize(
                        frame,
                        (int(frame.shape[1] * scale_factor), int(frame.shape[0] * scale_factor)),
                        interpolation=cv2.INTER_LINEAR
                    )

                if show_overlay:
                    display_frame = draw_diagnostics_overlay(display_frame, stats, scale_factor)

                cv2.imshow(window_name, display_frame)

                key = cv2.waitKey(1) & 0xFF
                if key in (ord('q'), 27):
                    logger.info("Exit requested via keyboard shortcut.")
                    break
                elif key == ord('d'):
                    show_overlay = not show_overlay
                    logger.info(f"Diagnostics overlay set to: {show_overlay}")
                elif key == ord('s'):
                    os.makedirs("captures", exist_ok=True)
                    fname = f"captures/snapshot_{int(time.time())}.jpg"
                    cv2.imwrite(fname, frame)
                    logger.info(f"Saved snapshot to {fname}")

    except Exception as e:
        logger.error(f"Unexpected error in main loop: {e}", exc_info=True)
    finally:
        logger.info("Cleaning up resources...")
        receiver.stop()
        if not no_gui:
            cv2.destroyAllWindows()
            # On macOS, extra waitKey calls help properly close HighGUI Cocoa windows
            cv2.waitKey(1)
            cv2.waitKey(1)

        # Print final session report
        final_stats = receiver.get_stats()
        logger.info("==================================================")
        logger.info("             FINAL PIPELINE TELEMETRY             ")
        logger.info("==================================================")
        logger.info(f"Final State:            {final_stats['state']}")
        logger.info(f"Stream Resolution:      {final_stats['resolution']}")
        logger.info(f"Total Frames Received:  {final_stats['total_frames_received']}")
        logger.info(f"Total Frames Consumed:  {final_stats['total_frames_consumed']}")
        logger.info(f"Frames Dropped:         {final_stats['dropped_frames']}")
        logger.info(f"Read Failures:          {final_stats['read_failures']}")
        logger.info(f"Reconnection Count:     {final_stats['reconnects']}")
        logger.info(f"Average Received FPS:   {final_stats['average_fps']}")
        logger.info(f"Total Uptime:           {final_stats['uptime_seconds']}s")
        logger.info("==================================================")


if __name__ == "__main__":
    main()
