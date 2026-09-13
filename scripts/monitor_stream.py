#!/usr/bin/env python3
"""Background monitor for MediaMTX publisher events.

Watches MediaMTX log output for incoming RTSP publish events from S23 FE.
Once detected, automatically triggers FFmpeg verification and OpenCV smoke tests.
"""

import os
import subprocess
import sys
import time

TASK_LOG = "/Users/ujjwalraj/.gemini/antigravity-ide/brain/fefff03a-0dc8-499b-96e5-2af0e971252e/.system_generated/tasks/task-220.log"
RTSP_URL = "rtsp://127.0.0.1:8555/live"


def monitor_and_verify(timeout_sec: float = 300.0):
    print(f"[*] Monitoring {TASK_LOG} for incoming S23 FE publisher...")
    print(f"[*] Target RTSP URL: {RTSP_URL}")
    print(f"[*] Listening on port 8555 for up to {timeout_sec}s...")

    start_time = time.time()
    last_size = 0

    while time.time() - start_time < timeout_sec:
        if os.path.exists(TASK_LOG):
            with open(TASK_LOG, "r") as f:
                lines = f.readlines()
                for line in lines:
                    if "is publishing to path 'live'" in line or "publishing to path 'live'" in line:
                        print(f"\n[+] PUBLISHER DETECTED!\n{line.strip()}")
                        print("\n[+] Triggering Step 6: FFmpeg verification & frame capture...")
                        subprocess.run([sys.executable, "verify_pipeline.py", "10"])
                        return True
        time.sleep(1.0)
        sys.stdout.write(".")
        sys.stdout.flush()

    print(f"\n[-] Monitor timed out after {timeout_sec}s.")
    return False


if __name__ == "__main__":
    timeout = float(sys.argv[1]) if len(sys.argv) > 1 else 300.0
    monitor_and_verify(timeout)
