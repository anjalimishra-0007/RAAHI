#!/usr/bin/env python3
"""
RAAHI - Phase 14: Live Phone-Camera Pothole Detection
=====================================================
Connects to the incoming live phone camera stream over Wi-Fi,
performs real-time YOLO11n inference on Apple Silicon MPS,
draws bounding boxes with confidence scores, displays FPS/telemetry,
and handles stream disconnections gracefully.

Usage:
    # 1. Standard run connecting to live phone camera stream:
    python src/live_camera.py

    # 2. Custom confidence threshold and model path:
    python src/live_camera.py --model runs/detect/runs/pothole_yolo11n/weights/best.pt --conf 0.35

    # 3. Test using a local video file (simulator mode):
    python src/live_camera.py --source videos/input/cityRoad_potHoles-side.mp4

    # 4. Headless mode (without OpenCV GUI window):
    python src/live_camera.py --no-gui --max-frames 50
"""

import os
import sys
import time
import signal
import argparse
import threading
import json
import queue
import collections
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
import cv2
import numpy as np
import torch
from ultralytics import YOLO

# Ensure repo root is on sys.path for local module imports
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.traffic import VehicleTracker, draw_tracked_vehicles, draw_traffic_hud, draw_traffic_overlays


class PhoneGpsReceiver:
    """
    Polls the real Samsung S23 FE phone GPS telemetry from Central's /api/gps endpoint.
    Strict constraints:
    - Never uses fake/default coordinates (e.g. 28.6139, 77.2090 or 0,0).
    - Checks staleness: if no fresh GPS received within max_stale_sec (default 10s), returns None.
    - Thread-safe access to latest valid phone GPS fix.
    """
    def __init__(self, gps_url: str, poll_interval: float = 0.4, max_stale_sec: float = 10.0):
        self.gps_url = gps_url
        self.poll_interval = poll_interval
        self.max_stale_sec = max_stale_sec
        self.latest_sample = None
        self.history = collections.deque(maxlen=100)
        self.lock = threading.Lock()
        self.running = True
        self.connected = False
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    @staticmethod
    def is_fake_or_invalid_coordinate(lat: float, lon: float) -> bool:
        if lat is None or lon is None:
            return True
        # Reject hardcoded fake coordinates (e.g. 28.6139, 77.2090)
        if abs(lat - 28.6139) < 0.0001 and abs(lon - 77.2090) < 0.0001:
            return True
        # Reject (0, 0)
        if abs(lat) < 0.0001 and abs(lon) < 0.0001:
            return True
        # Bounds check
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            return True
        return False

    def _worker(self):
        while self.running:
            try:
                req = urllib.request.Request(
                    self.gps_url,
                    headers={'Accept': 'application/json'}
                )
                with urllib.request.urlopen(req, timeout=2.5) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    if data.get('connected') and 'latitude' in data and 'longitude' in data:
                        lat = float(data['latitude'])
                        lon = float(data['longitude'])
                        if not self.is_fake_or_invalid_coordinate(lat, lon):
                            sample = {
                                "latitude": lat,
                                "longitude": lon,
                                "accuracy": float(data['accuracy']) if data.get('accuracy') is not None else None,
                                "timestamp": data.get('timestamp') or datetime.now(timezone.utc).isoformat(),
                                "received_at": time.time()
                            }
                            with self.lock:
                                self.latest_sample = sample
                                self.history.append(sample)
                                self.connected = True
                        else:
                            with self.lock:
                                self.connected = False
                    else:
                        with self.lock:
                            self.connected = False
            except Exception:
                with self.lock:
                    self.connected = False
            time.sleep(self.poll_interval)

    def get_valid_phone_gps(self):
        with self.lock:
            if not self.latest_sample:
                return None
            age = time.time() - self.latest_sample["received_at"]
            if age <= self.max_stale_sec:
                return dict(self.latest_sample)
            return None

    def get_status(self):
        with self.lock:
            sample = self.get_valid_phone_gps()
            return (sample is not None), sample

    def stop(self):
        self.running = False
        if hasattr(self, 'thread') and self.thread.is_alive():
            self.thread.join(timeout=1.0)


class AsyncDetectionSender:
    """
    Background worker thread to dispatch live YOLO detection events to the Express
    backend over HTTP without blocking or introducing latency into the real-time inference loop.
    """
    def __init__(self, api_url: str, on_detection_success=None):
        self.api_url = api_url
        self.on_detection_success = on_detection_success
        self.queue = queue.Queue(maxsize=30)
        self.running = True
        self.total_sent = 0
        self.total_confirmed = 0
        self.total_throttled = 0
        self.last_result = None
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self):
        while self.running:
            try:
                payload = self.queue.get(timeout=0.2)
            except queue.Empty:
                continue

            try:
                data_bytes = json.dumps(payload).encode('utf-8')
                req = urllib.request.Request(
                    self.api_url,
                    data=data_bytes,
                    headers={'Content-Type': 'application/json'}
                )
                with urllib.request.urlopen(req, timeout=4.0) as resp:
                    resp_body = resp.read().decode('utf-8')
                    resp_data = json.loads(resp_body) if resp_body else {}
                    self.last_result = resp_data
                    self.total_sent += 1
                    status_code = resp.getcode()

                    event_id = payload.get('eventId', 'UNKNOWN')
                    cand_id = resp_data.get('candidateId', '')
                    cand_status = resp_data.get('status', 'pending')

                    if status_code == 201:
                        self.total_confirmed += 1
                        print(f"\n[CENTRAL EVENT]\neventId={event_id}\nstatus=201\ncandidateStatus={cand_status}\ncandidateId={cand_id}\n")
                        if self.on_detection_success:
                            self.on_detection_success(payload, resp_data)
                    elif status_code == 200 and resp_data.get('duplicate'):
                        print(f"\n[CENTRAL EVENT]\neventId={event_id}\nstatus=200\nduplicate=true\ncandidateId={cand_id}\n")
                        if self.on_detection_success:
                            self.on_detection_success(payload, resp_data)
                    else:
                        if resp_data.get('success'):
                            self.total_confirmed += 1
                        print(f"\n[CENTRAL EVENT]\neventId={event_id}\nstatus={status_code}\nresp={resp_data}\n")
            except urllib.error.HTTPError as he:
                err_text = he.read().decode('utf-8')
                print(f"\n[CENTRAL EVENT REJECTED]\neventId={payload.get('eventId')}\nstatus={he.code}\nerror={err_text}\n")
            except Exception as e:
                print(f"\n[CENTRAL EVENT ERROR]\neventId={payload.get('eventId')}\nerror={e}\n")
            finally:
                self.queue.task_done()

    def send_detection(self, payload: dict):
        if not self.running or not self.api_url:
            return
        try:
            self.queue.put_nowait(payload)
        except queue.Full:
            pass  # Drop if queue is full to prevent memory explosion

    def stop(self):
        self.running = False
        if hasattr(self, 'thread') and self.thread.is_alive():
            self.thread.join(timeout=1.0)


class RollingFrameBuffer:
    """
    Thread-safe, memory-bounded circular ring buffer storing recent camera frames.
    Retains approximately 2.0 seconds of recent frames based on live FPS.
    """
    def __init__(self, target_duration_sec: float = 2.0, max_capacity: int = 80):
        self.target_duration_sec = target_duration_sec
        self.max_capacity = max_capacity
        self.lock = threading.Lock()
        self.buffer = collections.deque(maxlen=max_capacity)

    def push(self, frame: np.ndarray, timestamp: float = None):
        if frame is None or frame.size == 0:
            return
        ts = timestamp if timestamp is not None else time.time()
        with self.lock:
            self.buffer.append((ts, frame.copy()))

    def get_pre_buffer_frames(self, duration_sec: float = 2.0) -> list:
        """
        Retrieves frames up to duration_sec before the current moment.
        If fewer frames exist (early stream), returns all available frames.
        Never uses negative timestamps.
        """
        with self.lock:
            if not self.buffer:
                return []
            now = time.time()
            cutoff = now - max(0.0, duration_sec)
            frames = [f.copy() for (t, f) in self.buffer if t >= cutoff]
            if not frames and self.buffer:
                frames = [f.copy() for (t, f) in self.buffer]
            return frames

    def __len__(self):
        with self.lock:
            return len(self.buffer)


class EvidenceCaptureSession:
    """
    Coordinates capturing a ~5-second live evidence video clip:
    ~2.0 seconds PRE-detection + ~3.0 seconds POST-detection.
    Encodes to MP4 and dispatches asynchronous upload to Google Drive via Express.
    """
    def __init__(
        self,
        pothole_id: str,
        detection_id: int,
        pre_frames: list,
        target_post_frames: int,
        fps: float,
        frame_size: tuple,
        evidence_dir: Path,
        upload_api_url: str
    ):
        self.pothole_id = pothole_id
        self.detection_id = detection_id
        self.collected_frames = list(pre_frames)
        self.target_post_frames = max(1, target_post_frames)
        self.post_frames_collected = 0
        self.fps = max(10.0, min(60.0, fps if fps > 0 else 25.0))
        self.frame_size = frame_size
        self.evidence_dir = evidence_dir
        self.upload_api_url = upload_api_url
        self.is_completed = False
        self.lock = threading.Lock()

    def add_post_frame(self, frame: np.ndarray) -> bool:
        """Appends incoming live post-frame. Returns True when target frame count reached."""
        with self.lock:
            if self.is_completed:
                return True
            self.collected_frames.append(frame.copy())
            self.post_frames_collected += 1
            if self.post_frames_collected >= self.target_post_frames:
                self.is_completed = True
                return True
            return False

    def finalize(self):
        """Assembles MP4 and triggers background upload."""
        with self.lock:
            self.is_completed = True
        threading.Thread(target=self._worker_finalize, daemon=True).start()

    def _worker_finalize(self):
        with self.lock:
            frames = list(self.collected_frames)

        if not frames:
            print(f"\n[EvidenceCapture] Warning: No frames collected for {self.pothole_id}")
            return

        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{self.pothole_id}_detection-{self.detection_id}.mp4"
        raw_output_path = self.evidence_dir / f"raw_{filename}"
        final_output_path = self.evidence_dir / filename
        w, h = self.frame_size

        try:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            writer = cv2.VideoWriter(str(raw_output_path), fourcc, self.fps, (w, h))

            for f in frames:
                if f.shape[1] != w or f.shape[0] != h:
                    f = cv2.resize(f, (w, h))
                writer.write(f)

            writer.release()

            # Attempt H.264 faststart remux with ffmpeg if available for optimal web/Drive playback
            try:
                remux_cmd = [
                    'ffmpeg', '-y',
                    '-v', 'error',
                    '-i', str(raw_output_path),
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    str(final_output_path)
                ]
                subprocess.run(remux_cmd, check=True, timeout=10)
                raw_output_path.unlink(missing_ok=True)
            except Exception:
                # Fallback to direct raw output if ffmpeg fails or unavailable
                if raw_output_path.exists():
                    raw_output_path.replace(final_output_path)

            duration_sec = len(frames) / self.fps
            file_size_kb = final_output_path.stat().st_size / 1024
            print(f"\n[EvidenceCapture] Created evidence clip: {final_output_path.name} ({len(frames)} frames, {duration_sec:.2f}s, {file_size_kb:.1f} KB at {self.fps:.1f} FPS)")

            # Dispatch upload to Google Drive via Express backend
            if self.upload_api_url:
                self._dispatch_drive_upload(final_output_path, filename)
        except Exception as e:
            print(f"\n[EvidenceCapture] Error encoding evidence clip {filename}: {e}")

    def _dispatch_drive_upload(self, file_path: Path, filename: str):
        payload = {
            "potholeId": self.pothole_id,
            "detectionId": self.detection_id,
            "filePath": str(file_path.resolve()),
            "fileName": filename
        }
        try:
            data_bytes = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                self.upload_api_url,
                data=data_bytes,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=60.0) as resp:
                resp_data = json.loads(resp.read().decode('utf-8'))
                if resp_data.get('success'):
                    if resp_data.get('uploaded'):
                        print(f"\n[Live Evidence] Google Drive upload CONFIRMED for {self.pothole_id}: {resp_data.get('videoUrl')}")
                    else:
                        print(f"\n[Live Evidence] Google Drive upload SKIPPED (already has evidence): {self.pothole_id} -> {resp_data.get('videoUrl')}")
                else:
                    print(f"\n[Live Evidence] Google Drive upload FAILED for {self.pothole_id}: {resp_data.get('error')}")
        except urllib.error.HTTPError as e:
            err_msg = ""
            try:
                body = e.read().decode('utf-8')
                data = json.loads(body)
                err_msg = data.get('error') or data.get('message') or body
            except Exception:
                err_msg = e.reason
            print(f"\n[Live Evidence] Error notifying upload API: HTTP Error {e.code}: {err_msg}")
        except Exception as e:
            print(f"\n[Live Evidence] Error notifying upload API: {e}")


class EvidenceCaptureManager:
    """
    Manages active evidence recording sessions:
    - Avoids duplicate capture windows for the same pothole/event
    - Dispatches incoming live frames to active sessions
    - Finalizes sessions safely upon completion or camera disconnect
    """
    def __init__(self, evidence_dir: Path, upload_api_url: str):
        self.evidence_dir = Path(evidence_dir)
        self.upload_api_url = upload_api_url
        self.active_sessions = {}
        self.recorded_pothole_ids = set()
        self.lock = threading.Lock()

    def is_recording(self, pothole_id: str) -> bool:
        with self.lock:
            return (pothole_id in self.active_sessions) or (pothole_id in self.recorded_pothole_ids)

    def start_capture(
        self,
        pothole_id: str,
        detection_id: int,
        pre_frames: list,
        fps: float,
        frame_size: tuple,
        post_duration_sec: float = 3.0
    ):
        with self.lock:
            if pothole_id in self.active_sessions or pothole_id in self.recorded_pothole_ids:
                return  # Duplicate protection: already recording or recorded
            
            effective_fps = max(10.0, fps if fps > 0 else 25.0)
            target_post_frames = int(effective_fps * post_duration_sec)
            session = EvidenceCaptureSession(
                pothole_id=pothole_id,
                detection_id=detection_id,
                pre_frames=pre_frames,
                target_post_frames=target_post_frames,
                fps=effective_fps,
                frame_size=frame_size,
                evidence_dir=self.evidence_dir,
                upload_api_url=self.upload_api_url
            )
            self.active_sessions[pothole_id] = session
            self.recorded_pothole_ids.add(pothole_id)
            print(f"\n[EvidenceCapture] Triggered evidence capture for {pothole_id} (pre-buffer: {len(pre_frames)} frames, post-target: {target_post_frames} frames)...")

    def on_new_frame(self, frame: np.ndarray):
        """Passes incoming frame to all active sessions."""
        with self.lock:
            if not self.active_sessions:
                return
            completed_ids = []
            for pid, session in list(self.active_sessions.items()):
                if session.add_post_frame(frame):
                    completed_ids.append(pid)

            for pid in completed_ids:
                session = self.active_sessions.pop(pid)
                session.finalize()

    def flush_all(self):
        """Finalizes any active sessions immediately (e.g. on stream disconnect or exit)."""
        with self.lock:
            for pid, session in list(self.active_sessions.items()):
                session.finalize()
            self.active_sessions.clear()


def get_default_device() -> str:
    """Selects Apple Silicon MPS if available, then CUDA, then CPU."""
    if torch.backends.mps.is_available():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    return "cpu"


class LatestFrameReader:
    """
    Threaded stream reader that continuously polls frames from cv2.VideoCapture
    and keeps strictly only the latest frame in memory.

    This guarantees zero latency backlog: YOLO always processes the most
    recent physical camera frame regardless of processing vs. capture speed.
    """
    def __init__(self, source: str):
        self.source = source
        self.cap = None
        self.latest_frame = None
        self.lock = threading.Lock()
        self.running = True
        self.connected = False
        self.total_frames_read = 0
        self.last_frame_time = 0.0

        # Start background polling thread
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _open_capture(self):
        """Attempts to open the video source."""
        try:
            # If RTSP stream, configure FFmpeg low-delay TCP interleaved transport
            if str(self.source).startswith("rtsp://"):
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"

            # Check if integer webcam index
            if str(self.source).isdigit():
                cap = cv2.VideoCapture(int(self.source))
            else:
                cap = cv2.VideoCapture(str(self.source))
            
            # Minimize internal buffer size where supported by backend
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return cap
        except Exception:
            return None

    def _worker(self):
        """Continuous background loop reading frames."""
        try:
            while self.running:
                if self.cap is None or not self.cap.isOpened():
                    self.cap = self._open_capture()
                    if self.cap is None or not self.cap.isOpened():
                        self.connected = False
                        time.sleep(0.3)
                        continue

                ret, frame = self.cap.read()
                if not self.running:
                    break

                if ret and frame is not None and frame.size > 0:
                    with self.lock:
                        self.latest_frame = frame
                        self.connected = True
                        self.total_frames_read += 1
                        self.last_frame_time = time.time()
                else:
                    # Stream ended or disconnected
                    self.connected = False
                    if self.cap is not None:
                        try:
                            self.cap.release()
                        except Exception:
                            pass
                        self.cap = None
                    time.sleep(0.1)
        finally:
            if self.cap is not None:
                try:
                    self.cap.release()
                except Exception:
                    pass
                self.cap = None

    def read_latest(self):
        """Returns (connected, frame) without blocking."""
        with self.lock:
            # If no frame received within 2.5 seconds, consider disconnected
            is_alive = self.connected and (time.time() - self.last_frame_time < 2.5)
            frame_copy = self.latest_frame.copy() if (is_alive and self.latest_frame is not None) else None
            return is_alive, frame_copy

    def stop(self):
        """Stops worker thread and waits for clean release."""
        self.running = False
        if hasattr(self, 'thread') and self.thread.is_alive():
            self.thread.join(timeout=1.5)


def draw_detection_box(
    frame: np.ndarray,
    box_coords: tuple,
    class_name: str,
    confidence: float,
    color: tuple = (0, 140, 255)
) -> None:
    """Draws high-visibility bounding box and badge with class and confidence."""
    x1, y1, x2, y2 = box_coords
    h, w = frame.shape[:2]

    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w - 1, x2), min(h - 1, y2)

    # 1. Bounding box rectangle
    thickness = 2
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)

    # 2. Text label
    label = f"{class_name} {confidence:.2f}"
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.5
    font_thickness = 1

    (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, font_thickness)
    badge_y1 = max(0, y1 - text_h - baseline - 6)
    badge_y2 = y1
    badge_x2 = min(w - 1, x1 + text_w + 8)

    # Solid badge
    cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), color, -1)
    # Text
    cv2.putText(
        frame,
        label,
        (x1 + 4, badge_y2 - baseline - 2),
        font,
        font_scale,
        (255, 255, 255),
        font_thickness,
        cv2.LINE_AA
    )


def draw_telemetry_hud(
    frame: np.ndarray,
    fps: float,
    frame_count: int,
    detection_count: int,
    device_name: str,
    camera_connected: bool,
    api_events: int = 0,
    gps_sample: dict = None,
    pending_count: int = 0
) -> None:
    """Renders semi-transparent HUD overlay with system status and telemetry."""
    h, w = frame.shape[:2]
    hud_h = 92
    hud_w = min(w, 580)

    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (hud_w, hud_h), (12, 16, 24), -1)
    # Blend with transparency
    cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)

    # Top border accent line
    status_color = (66, 230, 164) if camera_connected else (77, 77, 255)
    cv2.line(frame, (0, hud_h), (hud_w, hud_h), (40, 50, 68), 1)

    font = cv2.FONT_HERSHEY_SIMPLEX

    # Line 1: Title
    cv2.putText(frame, "RAAHI  LIVE POTHOLE DETECTION (YOLO11n)", (12, 18), font, 0.46, (255, 255, 255), 1, cv2.LINE_AA)

    # Line 2: Pipeline State
    cam_str = "CONNECTED" if camera_connected else "DISCONNECTED"
    cam_color = (66, 230, 164) if camera_connected else (80, 80, 255)
    cv2.putText(frame, "YOLO: ONLINE", (12, 38), font, 0.38, (66, 230, 164), 1, cv2.LINE_AA)
    cv2.putText(frame, "| Cam:", (105, 38), font, 0.38, (140, 150, 170), 1, cv2.LINE_AA)
    cv2.putText(frame, cam_str, (150, 38), font, 0.38, cam_color, 1, cv2.LINE_AA)
    cv2.putText(frame, f"| Dev: {device_name}", (250, 38), font, 0.38, (140, 150, 170), 1, cv2.LINE_AA)
    if api_events > 0:
        cv2.putText(frame, f"| Ingested: {api_events}", (430, 38), font, 0.38, (66, 230, 164), 1, cv2.LINE_AA)

    # Line 3: Runtime Metrics
    fps_color = (66, 230, 164) if fps >= 20 else (0, 200, 255)
    cv2.putText(frame, f"FPS: {fps:.1f}", (12, 58), font, 0.40, fps_color, 1, cv2.LINE_AA)
    cv2.putText(frame, f"| Frame: #{frame_count}", (105, 58), font, 0.38, (200, 210, 230), 1, cv2.LINE_AA)
    cv2.putText(frame, f"| Potholes: {detection_count}", (235, 58), font, 0.38, (0, 140, 255) if detection_count > 0 else (160, 170, 190), 1, cv2.LINE_AA)

    # Line 4: Phone GPS & Pending Queue
    if gps_sample is not None:
        gps_str = f"GPS: LIVE ({gps_sample['latitude']:.4f}, {gps_sample['longitude']:.4f})"
        gps_color = (66, 230, 164)
    else:
        gps_str = "GPS: WAITING FOR FIX"
        gps_color = (80, 80, 255)
    cv2.putText(frame, gps_str, (12, 78), font, 0.38, gps_color, 1, cv2.LINE_AA)
    if pending_count > 0:
        cv2.putText(frame, f"| Pending GPS: {pending_count}", (275, 78), font, 0.38, (0, 200, 255), 1, cv2.LINE_AA)


def create_waiting_screen(width: int = 640, height: int = 360, source_url: str = "") -> np.ndarray:
    """Generates a clean dark screen when camera stream is disconnected or waiting."""
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    canvas[:] = (14, 18, 26)

    # Subtle grid lines
    for x in range(0, width, 40):
        cv2.line(canvas, (x, 0), (x, height), (22, 28, 40), 1)
    for y in range(0, height, 40):
        cv2.line(canvas, (0, y), (width, y), (22, 28, 40), 1)

    # Center box
    cv2.rectangle(canvas, (60, 60), (width - 60, height - 60), (32, 42, 60), 1)

    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(canvas, "RAAHI - WAITING FOR PHONE CAMERA", (90, 120), font, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(canvas, "Status: Camera disconnected or stream idle", (90, 165), font, 0.45, (130, 150, 180), 1, cv2.LINE_AA)
    cv2.putText(canvas, f"Target Stream: {source_url}", (90, 195), font, 0.40, (56, 189, 248), 1, cv2.LINE_AA)
    cv2.putText(canvas, "To connect phone:", (90, 235), font, 0.42, (255, 180, 45), 1, cv2.LINE_AA)
    cv2.putText(canvas, "1. Open https://<MAC-IP>:5173/camera on your mobile browser", (110, 260), font, 0.38, (180, 190, 210), 1, cv2.LINE_AA)
    cv2.putText(canvas, "2. Tap 'Start Road Camera' to stream live frames", (110, 285), font, 0.38, (180, 190, 210), 1, cv2.LINE_AA)

    # Bottom exit hint
    cv2.putText(canvas, "Press 'q' in this window to exit", (width - 240, height - 20), font, 0.36, (100, 110, 130), 1, cv2.LINE_AA)
    return canvas


def main():
    parser = argparse.ArgumentParser(description="RAAHI Real-Time Phone Camera Pothole & Traffic Intelligence")
    parser.add_argument(
        "--mode",
        type=str,
        choices=["pothole", "traffic", "dual"],
        default="pothole",
        help="Pipeline execution mode: 'pothole' (default), 'traffic' (ByteTrack vehicles), or 'dual' (both)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="runs/detect/runs/pothole_yolo11n/weights/best.pt",
        help="Path to trained pothole YOLO11n weights file"
    )
    parser.add_argument(
        "--traffic-model",
        type=str,
        default="yolo11n.pt",
        help="Path to base COCO YOLO11n weights for vehicle detection (default: yolo11n.pt)"
    )
    parser.add_argument(
        "--traffic-conf",
        type=float,
        default=0.30,
        help="Confidence threshold for vehicle detection (default: 0.30)"
    )
    parser.add_argument(
        "--traffic-cadence",
        type=int,
        default=3,
        help="Traffic inference cadence in dual mode: process traffic every N frames (default: 3, ~8-10 FPS)"
    )
    parser.add_argument(
        "--count-line",
        type=str,
        default="0.05,0.65,0.95,0.65",
        help="Normalized coordinates for virtual counting line (x1,y1,x2,y2)"
    )
    parser.add_argument(
        "--traffic-roi",
        type=str,
        default="0.10,0.95,0.32,0.45,0.68,0.45,0.90,0.95",
        help="Normalized polygon coordinates for road ROI (x1,y1,x2,y2,...)"
    )
    parser.add_argument(
        "--source",
        type=str,
        default="http://localhost:5001/api/live/stream",
        help="Video stream source (MJPEG stream URL, RTSP stream URL, webcam index 0, or video file)"
    )
    parser.add_argument(
        "--rtsp",
        action="store_true",
        help="Enable RTSP live input mode from MediaMTX (Android RAAHI Eye)"
    )
    parser.add_argument(
        "--rtsp-url",
        type=str,
        default=os.getenv("RAAHI_RTSP_URL", "rtsp://127.0.0.1:8555/live"),
        help="RTSP stream URL (default: rtsp://127.0.0.1:8555/live or RAAHI_RTSP_URL env var)"
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.35,
        help="Confidence detection threshold for pothole model (0.0 to 1.0)"
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Inference image resolution"
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Compute device ('mps', 'cuda', 'cpu', or auto-detect)"
    )
    parser.add_argument(
        "--no-gui",
        action="store_true",
        help="Run headlessly without OpenCV window (useful for background/CI tests)"
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Exit after processing N frames (0 = run indefinitely)"
    )
    parser.add_argument(
        "--api-url",
        type=str,
        default="http://localhost:5001/api/central/events",
        help="Canonical Central backend endpoint for live pothole detection events"
    )
    parser.add_argument(
        "--gps-url",
        type=str,
        default="http://localhost:5001/api/gps",
        help="Endpoint to poll live phone GPS telemetry from Samsung S23 FE"
    )
    parser.add_argument(
        "--cooldown",
        type=float,
        default=1.0,
        help="Debounce cooldown in seconds between detection events (default: 1.0s)"
    )
    parser.add_argument(
        "--bus",
        type=str,
        default="RAAHI-01",
        help="Bus identifier (default: RAAHI-01)"
    )
    parser.add_argument(
        "--no-api",
        action="store_true",
        help="Run without dispatching events to the backend API"
    )
    parser.add_argument(
        "--evidence-dir",
        type=str,
        default="videos/evidence",
        help="Local directory to store generated video evidence clips (default: videos/evidence)"
    )
    parser.add_argument(
        "--upload-url",
        type=str,
        default="http://localhost:5001/api/dev/upload-live-evidence",
        help="Endpoint to trigger Google Drive upload of live evidence clip"
    )
    parser.add_argument(
        "--no-evidence",
        action="store_true",
        help="Disable capturing live evidence clips and Google Drive upload"
    )

    args = parser.parse_args()

    # Determine effective video stream source (RTSP vs HTTP MJPEG vs Video File)
    if args.rtsp or ("RAAHI_RTSP_URL" in os.environ and args.source == "http://localhost:5001/api/live/stream"):
        effective_source = args.rtsp_url
    else:
        effective_source = args.source

    # Determine compute device
    device = args.device if args.device else get_default_device()
    device_label = "Apple Silicon MPS" if device == "mps" else ("CUDA GPU" if device == "cuda" else "CPU")

    # Validate models for active execution mode
    model_path = Path(args.model)
    if args.mode in ("pothole", "dual"):
        if not model_path.exists():
            print(f"Error: Pothole model weights not found at: {model_path}", file=sys.stderr)
            sys.exit(1)

    traffic_model_path = Path(args.traffic_model)
    if args.mode in ("traffic", "dual"):
        if not traffic_model_path.exists():
            print(f"Error: Traffic COCO weights not found at: {traffic_model_path}", file=sys.stderr)
            sys.exit(1)

    source_type = "RTSP MediaMTX (RAAHI Eye)" if str(effective_source).startswith("rtsp://") else ("HTTP MJPEG" if str(effective_source).startswith("http") else "Local File/Webcam")

    enable_api = (not args.no_api) and (args.mode in ("pothole", "dual"))
    enable_evidence = (not args.no_evidence) and (args.mode in ("pothole", "dual"))

    print("==================================================")
    print("   RAAHI LIVE CAMERA & RTSP INFERENCE PIPELINE    ")
    print("==================================================")
    print(f"Execution Mode: {args.mode.upper()}")
    if args.mode in ("pothole", "dual"):
        print(f"Pothole Model:  {model_path}")
        print(f"Pothole Conf:   {args.conf}")
    # Parse count line if provided
    count_line_coords = None
    if args.count_line:
        try:
            parts = [float(p.strip()) for p in args.count_line.split(",")]
            if len(parts) == 4:
                count_line_coords = ((parts[0], parts[1]), (parts[2], parts[3]))
        except Exception:
            count_line_coords = None

    # Parse ROI polygon if provided
    roi_poly_coords = None
    if args.traffic_roi:
        try:
            parts = [float(p.strip()) for p in args.traffic_roi.split(",")]
            if len(parts) >= 6 and len(parts) % 2 == 0:
                roi_poly_coords = [(parts[i], parts[i + 1]) for i in range(0, len(parts), 2)]
        except Exception:
            roi_poly_coords = None

    if args.mode in ("traffic", "dual"):
        print(f"Traffic Model:  {traffic_model_path} (COCO YOLO11n)")
        print(f"Traffic Conf:   {args.traffic_conf}")
        print(f"Traffic Cadence:Every {args.traffic_cadence} frame(s)")
        print(f"Count Line:     {count_line_coords if count_line_coords else 'Default ((0.05, 0.65), (0.95, 0.65))'}")
        print(f"Road ROI:       {len(roi_poly_coords) if roi_poly_coords else 4} polygon vertices")
    print(f"Source:         {effective_source} ({source_type})")
    print(f"Image Size:     {args.imgsz}")
    print(f"Compute Device: {device.upper()} ({device_label})")
    print(f"GUI Mode:       {'Headless (--no-gui)' if args.no_gui else 'Cocoa Window Active'}")
    print(f"API Endpoint:   {args.api_url if enable_api else 'Disabled'}")
    print(f"Event Cooldown: {args.cooldown}s")
    print(f"Bus ID:         {args.bus}")
    print(f"Evidence Dir:   {args.evidence_dir if enable_evidence else 'Disabled'}")
    print("==================================================")

    # Initialize rolling buffer and evidence capture manager
    evidence_dir_path = Path(args.evidence_dir)
    evidence_manager = EvidenceCaptureManager(evidence_dir_path, args.upload_url) if enable_evidence else None
    rolling_buffer = RollingFrameBuffer(target_duration_sec=2.0)
    latest_frame_size = (640, 360)
    current_fps = 25.0

    def handle_detection_success(payload, resp_data):
        candidate_id = resp_data.get('candidateId') or resp_data.get('potholeId') or payload.get('eventId', 'CAN-EVT')
        detection_id = payload.get('eventId', '1')

        if enable_evidence and evidence_manager:
            if not evidence_manager.is_recording(candidate_id):
                pre_frames = rolling_buffer.get_pre_buffer_frames(duration_sec=2.0)
                evidence_manager.start_capture(
                    pothole_id=candidate_id,
                    detection_id=detection_id,
                    pre_frames=pre_frames,
                    fps=current_fps if current_fps > 0 else 25.0,
                    frame_size=latest_frame_size,
                    post_duration_sec=3.0
                )

    # Initialize live detection event sender with evidence callback (pothole only)
    sender = AsyncDetectionSender(args.api_url, on_detection_success=handle_detection_success) if enable_api else None
    gps_receiver = PhoneGpsReceiver(args.gps_url) if enable_api else None
    pending_gps_queue = collections.deque(maxlen=50)
    last_detection_event_time = 0.0
    pothole_event_counter = 0

    def dispatch_pothole_detection(conf_score: float, box_xyxy: tuple, frame_num: int):
        nonlocal last_detection_event_time, pothole_event_counter
        curr_t = time.time()
        if curr_t - last_detection_event_time < args.cooldown:
            return
        last_detection_event_time = curr_t
        pothole_event_counter += 1
        evt_id = f"EVT-{pothole_event_counter:06d}"
        x1_b, y1_b, x2_b, y2_b = box_xyxy
        iso_ts = datetime.now(timezone.utc).isoformat()

        gps_sample = gps_receiver.get_valid_phone_gps() if gps_receiver else None
        if gps_sample is not None:
            lat = gps_sample["latitude"]
            lon = gps_sample["longitude"]
            acc = gps_sample.get("accuracy")
            print(
                f"\n[POTHOLE DETECTED]\n"
                f"eventId={evt_id}\n"
                f"confidence={conf_score:.2f}\n"
                f"frame={frame_num}\n"
                f"bbox=({x1_b},{y1_b},{x2_b},{y2_b})\n"
                f"GPS=AVAILABLE\n"
                f"lat={lat:.6f}\n"
                f"lon={lon:.6f}\n"
                f"action=SENDING_TO_CENTRAL\n"
            )
            canonical_package = {
                "eventId": evt_id,
                "eventType": "pothole",
                "busId": args.bus,
                "timestamp": iso_ts,
                "latitude": lat,
                "longitude": lon,
                "accuracy": acc,
                "edgeModel": "YOLO11n",
                "confidence": round(float(conf_score), 2),
                "class": "pothole",
                "boundingBox": {
                    "x1": x1_b,
                    "y1": y1_b,
                    "x2": x2_b,
                    "y2": y2_b
                }
            }
            if sender is not None:
                sender.send_detection(canonical_package)
        else:
            print(
                f"\n[POTHOLE DETECTED]\n"
                f"eventId={evt_id}\n"
                f"confidence={conf_score:.2f}\n"
                f"frame={frame_num}\n"
                f"bbox=({x1_b},{y1_b},{x2_b},{y2_b})\n"
                f"GPS=WAITING\n"
                f"action=QUEUED_PENDING_GPS\n"
            )
            pending_item = {
                "eventId": evt_id,
                "eventType": "pothole",
                "busId": args.bus,
                "timestamp": iso_ts,
                "edgeModel": "YOLO11n",
                "confidence": round(float(conf_score), 2),
                "class": "pothole",
                "boundingBox": {
                    "x1": x1_b,
                    "y1": y1_b,
                    "x2": x2_b,
                    "y2": y2_b
                },
                "frame": frame_num,
                "detection_time": curr_t
            }
            pending_gps_queue.append(pending_item)

    # 1. Load models according to mode
    model = None
    if args.mode in ("pothole", "dual"):
        print(f"Loading Pothole YOLO11n model onto {device.upper()}...")
        model = YOLO(str(model_path))
        print(f"Pothole model loaded! Classes: {list(model.names.values())}\n")

    traffic_tracker = None
    if args.mode in ("traffic", "dual"):
        print(f"Initializing VehicleTracker (Phase 8C) on {device.upper()}...")
        traffic_tracker = VehicleTracker(
            model_path=str(traffic_model_path),
            conf=args.traffic_conf,
            imgsz=args.imgsz,
            device=device,
            count_line=count_line_coords,
            roi_polygon=roi_poly_coords
        )
        print("Traffic VehicleTracker loaded with ByteTrack + Flow + Road ROI + Traffic State!\n")


    # Colors for detected pothole classes (BGR)
    class_color_map = {
        "pothole": (0, 140, 255),        # Orange
        "hole": (0, 165, 255),           # Amber
        "manhole": (0, 220, 100),        # Green
        "sewer cover": (200, 200, 0),    # Teal
        "Drain Hole": (255, 180, 0),     # Sky Blue
    }
    default_color = (0, 220, 100)

    # 2. Start threaded frame reader (zero backlog)
    print(f"Connecting to incoming stream: {effective_source}...")
    reader = LatestFrameReader(effective_source)

    # Window configuration
    if args.mode == "traffic":
        window_name = "RAAHI - Live Traffic Intelligence (ByteTrack)"
    elif args.mode == "dual":
        window_name = "RAAHI - Live Pothole & Traffic Intelligence (Dual Mode)"
    else:
        window_name = "RAAHI - Live Pothole Detection (YOLO11n)"

    if not args.no_gui:
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 960, 540)

    processed_frames = 0
    total_pothole_detections = 0
    fps = 0.0
    fps_start_time = time.time()
    fps_frame_count = 0

    running = True

    def handle_sigint(signum, frame):
        nonlocal running
        print("\nInterrupt signal received. Shutting down gracefully...")
        running = False

    signal.signal(signal.SIGINT, handle_sigint)

    try:
        while running:
            is_connected, frame = reader.read_latest()

            if not is_connected or frame is None:
                # Disconnected or waiting for stream
                if evidence_manager:
                    evidence_manager.flush_all()

                if not args.no_gui:
                    waiting_screen = create_waiting_screen(640, 360, args.source)
                    cv2.imshow(window_name, waiting_screen)
                    key = cv2.waitKey(50) & 0xFF
                    if key == ord('q') or key == 27:
                        break
                else:
                    time.sleep(0.1)
                continue

            # Frame received! Update frame size & FPS
            h_frame, w_frame = frame.shape[:2]
            latest_frame_size = (w_frame, h_frame)
            processed_frames += 1
            fps_frame_count += 1

            # Push to rolling circular buffer (~2.0s pre-buffer)
            rolling_buffer.push(frame)

            # Pass incoming frame to any active evidence recording sessions (~3.0s post-buffer)
            if evidence_manager:
                evidence_manager.on_new_frame(frame)

            # Update FPS measurement every 10 frames
            now = time.time()
            if now - fps_start_time >= 0.5:
                fps = fps_frame_count / (now - fps_start_time)
                current_fps = fps
                fps_frame_count = 0
                fps_start_time = now

            # Check and drain pending GPS queue if fresh phone GPS arrived
            current_valid_gps = gps_receiver.get_valid_phone_gps() if gps_receiver else None
            if current_valid_gps and pending_gps_queue:
                while pending_gps_queue:
                    item = pending_gps_queue.popleft()
                    item["latitude"] = current_valid_gps["latitude"]
                    item["longitude"] = current_valid_gps["longitude"]
                    if current_valid_gps.get("accuracy") is not None:
                        item["accuracy"] = current_valid_gps["accuracy"]
                    bbox = item["boundingBox"]
                    print(
                        f"\n[POTHOLE DETECTED - PENDING GPS RESOLVED]\n"
                        f"eventId={item['eventId']}\n"
                        f"confidence={item['confidence']:.2f}\n"
                        f"frame={item.get('frame', 'N/A')}\n"
                        f"bbox=({bbox['x1']},{bbox['y1']},{bbox['x2']},{bbox['y2']})\n"
                        f"GPS=AVAILABLE\n"
                        f"lat={item['latitude']:.6f}\n"
                        f"lon={item['longitude']:.6f}\n"
                        f"action=SENDING_TO_CENTRAL\n"
                    )
                    if sender is not None:
                        canonical_payload = {
                            "eventId": item["eventId"],
                            "eventType": item["eventType"],
                            "busId": item["busId"],
                            "timestamp": item["timestamp"],
                            "latitude": item["latitude"],
                            "longitude": item["longitude"],
                            "accuracy": item.get("accuracy"),
                            "edgeModel": item["edgeModel"],
                            "confidence": item["confidence"],
                            "class": item["class"],
                            "boundingBox": item["boundingBox"]
                        }
                        sender.send_detection(canonical_payload)

            # =========================================================
            # MODE 1: TRAFFIC ONLY (ByteTrack Vehicle Intelligence)
            # =========================================================
            if args.mode == "traffic":
                tracks, metrics = traffic_tracker.track(frame, timestamp=now, frame_idx=processed_frames)
                draw_traffic_overlays(
                    frame,
                    roi_polygon=traffic_tracker.roi_polygon,
                    count_line=traffic_tracker.count_line,
                    history_manager=traffic_tracker.history_manager,
                    active_tracks=tracks
                )
                draw_tracked_vehicles(frame, tracks)
                draw_traffic_hud(
                    frame,
                    metrics=metrics,
                    fps=fps,
                    mode=args.mode,
                    bus_id=args.bus,
                    offset_y=0
                )

                if processed_frames % 30 == 0:
                    cls_brk = metrics.per_class_count
                    print(
                        f"[Traffic Live] Frame #{processed_frames} | FPS: {fps:.1f} | "
                        f"Active: {metrics.active_count} | Flow 60s: {metrics.flow.flow_60s} (VPM: {metrics.flow.vpm:.1f}) | "
                        f"Occ: {metrics.density.occupancy_percent:.1f}% ({metrics.density.density_level}) | "
                        f"State: {metrics.traffic_state} | Unique Track IDs: {metrics.unique_track_ids_count}"
                    )

            # =========================================================
            # MODE 2: POTHOLE ONLY (Custom Road Defect YOLO11n)
            # =========================================================
            elif args.mode == "pothole":
                results = model.predict(
                    source=frame,
                    conf=args.conf,
                    imgsz=args.imgsz,
                    device=device,
                    verbose=False
                )

                result = results[0]
                detections_in_frame = 0

                if result.boxes is not None and len(result.boxes) > 0:
                    for box in result.boxes:
                        conf = float(box.conf[0])
                        if conf < args.conf:
                            continue

                        cls_id = int(box.cls[0])
                        class_name = model.names.get(cls_id, f"class_{cls_id}")
                        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())

                        color = class_color_map.get(class_name, default_color)
                        draw_detection_box(frame, (x1, y1, x2, y2), class_name, conf, color=color)

                        detections_in_frame += 1
                        total_pothole_detections += 1

                        if class_name.lower() == "pothole" and sender is not None:
                            dispatch_pothole_detection(conf, (x1, y1, x2, y2), processed_frames)

                # Render Pothole Telemetry HUD
                draw_telemetry_hud(
                    frame,
                    fps=fps,
                    frame_count=processed_frames,
                    detection_count=detections_in_frame,
                    device_name=device_label,
                    camera_connected=True,
                    api_events=sender.total_confirmed if sender else 0,
                    gps_sample=current_valid_gps,
                    pending_count=len(pending_gps_queue)
                )

                if processed_frames % 30 == 0:
                    api_str = f" | Synced: {sender.total_confirmed}" if sender else ""
                    print(f"[YOLO11n Live] Frame #{processed_frames} | FPS: {fps:.1f} | Detections: {detections_in_frame} | Total: {total_pothole_detections}{api_str}")

            # =========================================================
            # MODE 3: DUAL MODE (Pothole Pipeline + Cadenced Traffic)
            # =========================================================
            elif args.mode == "dual":
                # 1. Pothole inference runs on every incoming frame
                results = model.predict(
                    source=frame,
                    conf=args.conf,
                    imgsz=args.imgsz,
                    device=device,
                    verbose=False
                )

                result = results[0]
                detections_in_frame = 0

                if result.boxes is not None and len(result.boxes) > 0:
                    for box in result.boxes:
                        conf = float(box.conf[0])
                        if conf < args.conf:
                            continue

                        cls_id = int(box.cls[0])
                        class_name = model.names.get(cls_id, f"class_{cls_id}")
                        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())

                        color = class_color_map.get(class_name, default_color)
                        draw_detection_box(frame, (x1, y1, x2, y2), class_name, conf, color=color)

                        detections_in_frame += 1
                        total_pothole_detections += 1

                        if class_name.lower() == "pothole" and sender is not None:
                            dispatch_pothole_detection(conf, (x1, y1, x2, y2), processed_frames)

                # 2. Traffic inference executed at cadence (every N frames)
                if processed_frames % max(1, args.traffic_cadence) == 0:
                    cached_tracks, cached_metrics = traffic_tracker.track(frame, timestamp=now, frame_idx=processed_frames)
                else:
                    cached_tracks = traffic_tracker.latest_tracks
                    cached_metrics = traffic_tracker.metrics

                if cached_tracks or traffic_tracker is not None:
                    draw_traffic_overlays(
                        frame,
                        roi_polygon=traffic_tracker.roi_polygon,
                        count_line=traffic_tracker.count_line,
                        history_manager=traffic_tracker.history_manager,
                        active_tracks=cached_tracks
                    )
                    draw_tracked_vehicles(frame, cached_tracks)

                # Render Pothole HUD at top (offset 0)
                draw_telemetry_hud(
                    frame,
                    fps=fps,
                    frame_count=processed_frames,
                    detection_count=detections_in_frame,
                    device_name=device_label,
                    camera_connected=True,
                    api_events=sender.total_confirmed if sender else 0,
                    gps_sample=current_valid_gps,
                    pending_count=len(pending_gps_queue)
                )

                # Render Traffic HUD stacked below Pothole HUD (offset 76)
                if cached_metrics:
                    draw_traffic_hud(
                        frame,
                        metrics=cached_metrics,
                        fps=fps,
                        mode=args.mode,
                        bus_id=args.bus,
                        offset_y=76
                    )

                if processed_frames % 30 == 0:
                    act_cnt = cached_metrics.active_count if cached_metrics else 0
                    flow_60 = cached_metrics.flow.flow_60s if cached_metrics else 0
                    occ = cached_metrics.density.occupancy_percent if cached_metrics else 0.0
                    state = cached_metrics.traffic_state if cached_metrics else "N/A"
                    uniq_cnt = cached_metrics.unique_track_ids_count if cached_metrics else 0
                    print(
                        f"[Dual Live] Frame #{processed_frames} | FPS: {fps:.1f} | "
                        f"Potholes: {detections_in_frame} | Active Veh: {act_cnt} | "
                        f"Flow: {flow_60} | Occ: {occ:.1f}% | State: {state} | "
                        f"Unique Track IDs: {uniq_cnt}"
                    )

            if not args.no_gui:
                cv2.imshow(window_name, frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q') or key == 27:
                    print("\nExit key pressed ('q').")
                    break

            if args.max_frames > 0 and processed_frames >= args.max_frames:
                print(f"Reached target frame count ({args.max_frames}).")
                break

    finally:
        print("\nCleaning up live camera resources...")
        reader.stop()
        if evidence_manager:
            evidence_manager.flush_all()
        if gps_receiver is not None:
            gps_receiver.stop()
        if sender is not None:
            sender.stop()

        if not args.no_gui:
            cv2.destroyAllWindows()
            cv2.waitKey(1)

        print("==================================================")
        print("          LIVE SESSION SUMMARY (PHASE 8C)         ")
        print("==================================================")
        print(f"Execution Mode:     {args.mode.upper()}")
        print(f"Frames Processed:   {processed_frames}")
        print(f"Average FPS:        {fps:.1f}")
        print(f"Inference Device:   {device.upper()} ({device_label})")
        if args.mode in ("pothole", "dual"):
            print(f"Pothole Detections: {total_pothole_detections}")
            if sender is not None:
                print(f"Events Sent:        {sender.total_sent}")
                print(f"Events Confirmed:   {sender.total_confirmed}")
                print(f"Events Throttled:   {sender.total_throttled}")
            if enable_evidence:
                print(f"Evidence Directory: {args.evidence_dir}")
        if args.mode in ("traffic", "dual") and traffic_tracker is not None:
            m = traffic_tracker.metrics
            print(f"Unique Track IDs:   {m.unique_track_ids_count} (Session-local)")
            print(f"Active Vehicles:    {m.active_count}")
            print(f"Per-Class Breakdown:{m.per_class_count}")
            print(f"Line Crossings:     Total: {m.flow.total_crossed} (IN: {m.flow.total_in}, OUT: {m.flow.total_out}, UNK: {m.flow.total_unknown})")
            print(f"Flow Rate (60s):    {m.flow.flow_60s} vehicles ({m.flow.vpm:.1f} VPM)")
            print(f"Road ROI Occupancy: {m.density.occupancy_percent:.1f}% ({m.density.density_level}, {m.density.vehicles_in_roi} in ROI)")
            print(f"Traffic State:      {m.traffic_state}")
        print("Shutdown:           Clean and Graceful")
        print("==================================================")


if __name__ == "__main__":
    main()


