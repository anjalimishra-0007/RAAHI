#!/usr/bin/env python3
"""Stream verification script for Phase 1.

Performs:
1. Polling for active publisher on RTSP endpoint
2. FFmpeg stream probe and frame capture (Step 6)
3. Headless OpenCV decoding validation (Step 7)
"""

import json
import subprocess
import sys
import time
import os

RTSP_URL = "rtsp://127.0.0.1:8555/live"


def check_stream_active(timeout_sec: float = 60.0) -> bool:
    """Waits until an RTSP publisher is detected on the endpoint."""
    print(f"[*] Waiting for S23 FE publisher on {RTSP_URL} (timeout: {timeout_sec}s)...")
    start = time.time()
    
    while time.time() - start < timeout_sec:
        # Run brief probe with ffmpeg
        cmd = [
            "ffmpeg", "-rtsp_transport", "tcp",
            "-i", RTSP_URL,
            "-t", "1",
            "-f", "null", "-"
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if "404 Not Found" not in res.stderr and "Connection refused" not in res.stderr:
            if "Stream #0" in res.stderr or "Input #0" in res.stderr:
                print("\n[+] Publisher stream DETECTED on MediaMTX!")
                return True
        time.sleep(1.5)
        sys.stdout.write(".")
        sys.stdout.flush()

    print(f"\n[-] Timed out waiting for stream after {timeout_sec}s.")
    return False


def verify_ffmpeg() -> dict:
    """Runs ffprobe on the live stream and extracts codec, resolution, FPS."""
    print("\n" + "=" * 50)
    print("STEP 6: FFMPEG INDEPENDENT STREAM VERIFICATION")
    print("=" * 50)

    cmd = [
        "ffprobe",
        "-rtsp_transport", "tcp",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name,profile,width,height,r_frame_rate,avg_frame_rate,pix_fmt",
        "-of", "json",
        RTSP_URL
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print(f"[-] ffprobe failed: {res.stderr}")
        return {}

    try:
        data = json.loads(res.stdout)
        stream_info = data.get("streams", [{}])[0]
        print(f"[+] Codec:      {stream_info.get('codec_name')} (Profile: {stream_info.get('profile')})")
        print(f"[+] Resolution: {stream_info.get('width')}x{stream_info.get('height')}")
        print(f"[+] Frame Rate: {stream_info.get('r_frame_rate')}")
        print(f"[+] Pixel Fmt:  {stream_info.get('pix_fmt')}")
        return stream_info
    except Exception as e:
        print(f"[-] Error parsing ffprobe JSON: {e}")
        return {}


def capture_sample_frame(output_path: str = "captures/ffmpeg_verified_frame.jpg"):
    """Captures a single frame via FFmpeg to prove decoder stability."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-rtsp_transport", "tcp",
        "-i", RTSP_URL,
        "-vframes", "1",
        "-q:v", "2",
        output_path
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode == 0 and os.path.exists(output_path):
        print(f"[+] Successfully captured sample frame via FFmpeg: {output_path}")
        return True
    else:
        print(f"[-] FFmpeg frame capture failed: {res.stderr}")
        return False


if __name__ == "__main__":
    timeout = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
    active = check_stream_active(timeout)
    if not active:
        sys.exit(1)

    info = verify_ffmpeg()
    capture_sample_frame()

    print("\n" + "=" * 50)
    print("STEP 7: OPENCV RECEIVER VALIDATION")
    print("=" * 50)
    # Run test_stream.py
    cmd = [sys.executable, "tests/test_stream.py", "--frames", "60"]
    test_res = subprocess.run(cmd)
    sys.exit(test_res.returncode)
