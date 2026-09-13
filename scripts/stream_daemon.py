#!/usr/bin/env python3
"""Persistent background daemon for Phase 1 stream capture & verification.

Runs continuously in the background. When an incoming RTSP publisher connects to
MediaMTX, it immediately executes FFmpeg stream probe and headless OpenCV tests,
logging full telemetry to captures/stream_verified.json.
"""

import json
import os
import subprocess
import sys
import time

TASK_LOG = "/Users/ujjwalraj/.gemini/antigravity-ide/brain/fefff03a-0dc8-499b-96e5-2af0e971252e/.system_generated/tasks/task-220.log"
RTSP_URL = "rtsp://127.0.0.1:8555/live"
OUTPUT_DIR = "captures"


def run_daemon():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    log_path = os.path.join(OUTPUT_DIR, "daemon.log")

    def log(msg):
        t = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{t}] {msg}"
        print(line, flush=True)
        with open(log_path, "a") as f:
            f.write(line + "\n")

    log("Stream verification daemon active.")
    log(f"Watching MediaMTX log: {TASK_LOG}")
    log(f"RTSP Target: {RTSP_URL}")

    last_processed_pos = 0
    stream_captured = False

    while True:
        if os.path.exists(TASK_LOG):
            with open(TASK_LOG, "r") as f:
                f.seek(last_processed_pos)
                new_content = f.read()
                last_processed_pos = f.tell()

                if new_content:
                    for line in new_content.splitlines():
                        if "is publishing to path 'live'" in line:
                            log(f"PUBLISHER DETECTED: {line.strip()}")
                            log("Executing Step 6: FFmpeg stream inspection...")
                            
                            # Run verify_pipeline.py
                            res = subprocess.run(
                                [sys.executable, "verify_pipeline.py", "15"],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True
                            )
                            log("Verification script output:")
                            log(res.stdout)

                            if res.returncode == 0:
                                log("✅ Phase 1 End-to-End Pipeline Verified!")
                                stream_captured = True
                            else:
                                log("⚠️ Verification script reported issues; see details above.")

        time.sleep(1.0)


if __name__ == "__main__":
    run_daemon()
