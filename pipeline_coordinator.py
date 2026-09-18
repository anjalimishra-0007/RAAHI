"""
RAAHI-Edge Unified Pipeline Coordinator.
Orchestrates RTSP capture, rolling pre-buffer, YOLO11n inference,
GPS correlation, evidence video generation, and SQLite persistence.
"""

import os
import threading
import time
from typing import Dict, List, Optional, Any, Tuple
import cv2
import numpy as np

from capture.rtsp_receiver import RTSPReceiver, StreamState
from ring_buffer.rolling_buffer import RollingFrameBuffer
from inference.yolo_detector import YOLODetector
from gps.gps_manager import GpsManager
from events.event_engine import EventEngine
from evidence.evidence_recorder import EvidenceManager
from storage.sqlite_db import EdgeDatabase
from transmission.central_client import CentralClient, TransmissionQueueWorker


class PipelineCoordinator:
    """
    Central controller managing the entire edge lifecycle, services,
    and background worker threads.
    """

    def __init__(
        self,
        bus_id: str = "RAAHI-001",
        rtsp_url: str = "rtsp://127.0.0.1:8555/live",
        model_path: str = "models/pothole_yolo11n.pt",
        db_path: str = "data/raahi_edge.db",
        evidence_dir: str = "data/evidence",
        central_url: str = "http://localhost:5001",
        conf_threshold: float = 0.35,
        pre_buffer_sec: float = 5.0,
        post_buffer_sec: float = 10.0,
        enable_tracking: bool = False
    ):
        self.bus_id = bus_id
        self.rtsp_url = rtsp_url
        self.model_path = model_path
        self.db_path = db_path
        self.evidence_dir = evidence_dir
        self.central_url = central_url
        self.conf_threshold = conf_threshold
        self.pre_buffer_sec = pre_buffer_sec
        self.post_buffer_sec = post_buffer_sec
        self.enable_tracking = enable_tracking

        # 1. Storage & Central
        self.db = EdgeDatabase(db_path=self.db_path)
        self.central_client = CentralClient(central_base_url=self.central_url)
        self.transmission_worker = TransmissionQueueWorker(self.db, self.central_client)

        # 2. Ring Buffer & GPS & Events
        self.ring_buffer = RollingFrameBuffer(
            target_duration_sec=self.pre_buffer_sec,
            max_capacity=180
        )
        self.gps_manager = GpsManager(default_bus_id=self.bus_id)
        self.event_engine = EventEngine(default_bus_id=self.bus_id)

        # 3. Evidence Manager
        self.evidence_manager = EvidenceManager(
            output_dir=self.evidence_dir,
            on_evidence_ready=self._on_evidence_clip_ready
        )

        # 4. Detector & Receiver
        self.detector: Optional[YOLODetector] = None
        self.receiver: Optional[RTSPReceiver] = None

        # 5. Runtime State
        self.is_running = False
        self.worker_thread: Optional[threading.Thread] = None
        self.lock = threading.Lock()

        # Telemetry metrics
        self.processed_frames = 0
        self.total_candidates_detected = 0
        self.total_candidates_suppressed = 0
        self.inference_fps = 0.0
        self.receiver_fps = 0.0
        self.last_frame_size = (1920, 1080)
        self.latest_annotated_frame: Optional[np.ndarray] = None
        self.latest_preview_jpeg: Optional[bytes] = None
        self.preview_frame_id: int = 0
        self.last_inference_latency_ms = 0.0
        self.preview_resolution = (960, 540)
        self.preview_jpeg_quality = 85

    def _on_evidence_clip_ready(
        self,
        event_id: str,
        clip_path: str,
        keyframe_path: Optional[str],
        size_bytes: int,
        duration_sec: float,
        fps: float,
        resolution: str,
        timing: Optional[Dict[str, Any]] = None
    ):
        """Callback triggered when an evidence MP4 clip has been assembled."""
        t4_start = time.time()
        self.db.update_event_evidence(
            event_id=event_id,
            clip_path=clip_path,
            keyframe_path=keyframe_path,
            size_bytes=size_bytes,
            duration_sec=duration_sec,
            fps=fps,
            resolution=resolution
        )
        t4_end = time.time()
        timing_str = ""
        if timing and "t0" in timing:
            t0 = timing["t0"]
            t3 = timing.get("t3", t4_start)
            timing_str = (
                f" [t3-t0: {round(t3 - t0, 2)}s, "
                f"t4-t0: {round(t4_end - t0, 2)}s, "
                f"pre: {timing.get('pre_frames_count', '?')}f, "
                f"post: {timing.get('post_frames_count', '?')}f]"
            )
        self.db.log_system_message(
            "EVENT",
            "EVIDENCE",
            f"Evidence clip finalized for {event_id} ({duration_sec}s, {size_bytes // 1024} KB){timing_str}"
        )

    def start(self) -> bool:
        """Starts the entire edge processing pipeline."""
        with self.lock:
            if self.is_running:
                return True

            print(f"[Pipeline] Starting RAAHI-Edge for bus {self.bus_id}...")
            self.db.log_system_message("INFO", "AI", f"Initializing YOLO11n from {self.model_path}")

            # Lazy load YOLO detector
            if self.detector is None:
                self.detector = YOLODetector(
                    model_path=self.model_path,
                    conf_threshold=self.conf_threshold
                )

            # Initialize RTSP Receiver
            self.receiver = RTSPReceiver(
                rtsp_url=self.rtsp_url,
                transport="tcp",
                reconnect_delay_sec=2.0,
                read_timeout_sec=5.0
            )
            self.receiver.start()

            # Start transmission worker
            self.transmission_worker.start()

            self.is_running = True
            self.worker_thread = threading.Thread(target=self._processing_loop, daemon=True)
            self.worker_thread.start()

            self.db.log_system_message("INFO", "AI", "RAAHI-Edge processing pipeline started successfully")
            return True

    def stop(self) -> bool:
        """Stops the processing pipeline cleanly."""
        with self.lock:
            if not self.is_running:
                return True

            print("[Pipeline] Stopping RAAHI-Edge pipeline...")
            self.is_running = False

            if self.receiver:
                self.receiver.stop()
                self.receiver = None

            if self.evidence_manager:
                self.evidence_manager.flush_all()

            if self.transmission_worker:
                self.transmission_worker.stop()

            if self.worker_thread and self.worker_thread.is_alive():
                self.worker_thread.join(timeout=2.0)
                self.worker_thread = None

            self.db.log_system_message("INFO", "AI", "RAAHI-Edge processing pipeline stopped cleanly")
            return True

    def restart(self) -> bool:
        """Restarts the edge pipeline."""
        self.stop()
        time.sleep(0.5)
        return self.start()

    def _processing_loop(self):
        """Core real-time frame processing and event detection loop."""
        fps_timer = time.time()
        fps_counter = 0

        while self.is_running:
            if not self.receiver:
                time.sleep(0.1)
                continue

            success, frame, metadata = self.receiver.read(wait_for_new=True, timeout=0.1)
            if not success or frame is None or frame.size == 0:
                time.sleep(0.005)
                continue
            self.last_frame_size = (frame.shape[1], frame.shape[0])
            self.processed_frames += 1
            fps_counter += 1

            # Push to circular ring buffer (~2.0s pre-buffer)
            self.ring_buffer.push(frame)

            # Feed frame to active evidence recording sessions (~3.0s post-buffer)
            self.evidence_manager.on_new_frame(frame)

            # Measure inference FPS every second
            now = time.time()
            if now - fps_timer >= 1.0:
                self.inference_fps = round(fps_counter / (now - fps_timer), 1)
                fps_counter = 0
                fps_timer = now

            # Run YOLO11n inference
            t_infer_start = time.time()
            if self.enable_tracking:
                detections = self.detector.track(frame)
            else:
                detections = self.detector.detect(frame)
            self.last_inference_latency_ms = round((time.time() - t_infer_start) * 1000.0, 1)

            # Process candidate detections
            pothole_candidates = [d for d in detections if d.get("is_pothole")]
            for cand in pothole_candidates:
                # 1. Match with GPS
                gps_match = self.gps_manager.match_detection(
                    detection_timestamp=now,
                    bus_id=self.bus_id,
                    max_delta_ms=2000.0
                )

                # 2. Package candidate event (with local spatial debounce check)
                pkg, suppressed, reason = self.event_engine.create_candidate_event(
                    event_type="pothole",
                    class_name="pothole",
                    confidence=cand["confidence"],
                    bbox=cand["bbox"],
                    frame_number=self.processed_frames,
                    gps_match=gps_match,
                    bus_id=self.bus_id
                )

                if suppressed:
                    self.total_candidates_suppressed += 1
                    continue

                if pkg:
                    # 1. Record exact event acceptance/detection timestamp t0
                    t0 = time.time()
                    self.total_candidates_detected += 1
                    event_id = pkg["eventId"]

                    # 2. Extract pre-event frames anchored to t0 (prevents SQLite I/O latency from advancing cutoff)
                    pre_frames = self.ring_buffer.get_pre_buffer_frames(
                        duration_sec=self.pre_buffer_sec,
                        reference_time=t0
                    )

                    # 3. Save candidate to local SQLite database (status = PENDING_VERIFICATION / queue = RECORDING)
                    self.db.log_system_message("EVENT", "AI", f"Candidate pothole detected: {event_id} (conf: {pkg['edgeConfidence']})")
                    self.db.insert_event(pkg)

                    # 4. Trigger evidence video capture (~5.0s pre-buffer + ~10.0s post-buffer = ~15s total)
                    self.evidence_manager.start_capture(
                        event_id=event_id,
                        pre_frames=pre_frames,
                        fps=self.inference_fps if self.inference_fps > 0 else 30.0,
                        frame_size=self.last_frame_size,
                        post_duration_sec=self.post_buffer_sec,
                        t0=t0
                    )

            # Render preview image (downsampled for lightweight web streaming)
            if detections:
                annotated = self.detector.draw_detections(frame, detections)
            else:
                annotated = frame

            # Encode preview frame to JPEG for live dashboard preview
            try:
                preview_small = cv2.resize(
                    annotated,
                    self.preview_resolution,
                    interpolation=cv2.INTER_AREA
                )
                _, buf = cv2.imencode(
                    '.jpg',
                    preview_small,
                    [cv2.IMWRITE_JPEG_QUALITY, self.preview_jpeg_quality]
                )
                self.latest_preview_jpeg = buf.tobytes()
                self.preview_frame_id += 1
            except Exception:
                pass

    def get_health_status(self) -> Dict[str, Any]:
        """Returns comprehensive status of all pipeline components with genuine telemetry."""
        receiver_state = self.receiver.stats.state.name if self.receiver else "STOPPED"
        receiver_stats = self.receiver.get_stats() if self.receiver else {}
        self.receiver_fps = receiver_stats.get("current_fps", 0.0)
        average_input_fps = receiver_stats.get("average_fps", 0.0)
        frames_received = receiver_stats.get("total_frames_received", 0)
        frames_dropped = receiver_stats.get("dropped_frames", 0)
        read_failures = receiver_stats.get("read_failures", 0)
        reconnects = receiver_stats.get("reconnects", 0)
        receiver_uptime = receiver_stats.get("uptime_seconds", 0.0)
        resolution_str = receiver_stats.get("resolution", f"{self.last_frame_size[0]}x{self.last_frame_size[1]}")

        # Check MediaMTX
        mediamtx_up = False
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.5)
            mediamtx_up = (sock.connect_ex(('127.0.0.1', 8555)) == 0)
            sock.close()
        except Exception:
            mediamtx_up = False

        # Central health check
        central_health = self.central_client.check_central_health()

        # GPS fix & freshness calculation
        latest_gps = self.gps_manager.get_latest_fix(self.bus_id)
        gps_age_sec = None
        if latest_gps and latest_gps.get("epochMs"):
            gps_age_sec = round(time.time() - (latest_gps["epochMs"] / 1000.0), 1)
            latest_gps["ageSec"] = gps_age_sec
            latest_gps["isFresh"] = (gps_age_sec < 5.0)

        # Operational status definitions (LIVE, STANDBY, OFFLINE, DEGRADED, ERROR)
        camera_status = "LIVE" if (receiver_state == "STREAMING" and self.receiver_fps > 0) else ("STANDBY" if mediamtx_up else "OFFLINE")
        gps_status = "LIVE" if (latest_gps and gps_age_sec is not None and gps_age_sec < 5.0) else ("DEGRADED" if latest_gps else "OFFLINE")
        ai_status = "LIVE" if (self.is_running and self.inference_fps > 0) else ("STANDBY" if self.detector else "OFFLINE")
        central_status = "LIVE" if central_health.get("connected") else "OFFLINE"

        return {
            "busId": self.bus_id,
            "pipelineRunning": self.is_running,
            "components": {
                "camera": camera_status,
                "rtsp": "LIVE" if mediamtx_up else "OFFLINE",
                "mediamtx": "LIVE" if mediamtx_up else "OFFLINE",
                "opencv": "LIVE" if receiver_state == "STREAMING" else ("DEGRADED" if receiver_state == "STALLED" else receiver_state),
                "yolo11n": ai_status,
                "gps": gps_status,
                "eventEngine": "LIVE" if self.is_running else "STANDBY",
                "localDb": "LIVE" if os.path.exists(self.db_path) else "INITIALIZING",
                "centralConnection": central_status
            },
            "metrics": {
                # Genuine Physical Input Telemetry (S23 FE -> RTSP -> OpenCV)
                "inputFps": self.receiver_fps,
                "input_fps": self.receiver_fps,
                "receiverFps": self.receiver_fps,
                "averageInputFps": average_input_fps,
                "average_input_fps": average_input_fps,

                # Genuine AI Edge Processing Telemetry (YOLO11n MPS)
                "processingFps": self.inference_fps,
                "processing_fps": self.inference_fps,
                "inferenceFps": self.inference_fps,
                "inferenceLatencyMs": self.last_inference_latency_ms,
                "inference_latency_ms": self.last_inference_latency_ms,

                # Web Browser Preview Stream (Throttled MJPEG)
                "previewFps": 15.0 if self.latest_preview_jpeg else 0.0,
                "preview_fps": 15.0 if self.latest_preview_jpeg else 0.0,

                # Real Frame Counters
                "framesReceived": frames_received,
                "frames_received": frames_received,
                "framesProcessed": self.processed_frames,
                "frames_processed": self.processed_frames,
                "processedFrames": self.processed_frames,
                "droppedFrames": frames_dropped,
                "framesDropped": frames_dropped,
                "frames_dropped": frames_dropped,
                "readFailures": read_failures,
                "read_failures": read_failures,
                "reconnects": reconnects,
                "uptimeSeconds": receiver_uptime,

                # Detection & Buffer Telemetry
                "candidatesDetected": self.total_candidates_detected,
                "candidatesSuppressed": self.total_candidates_suppressed,
                "ringBufferFrames": len(self.ring_buffer),
                "resolution": resolution_str
            },
            "latestGps": latest_gps,
            "centralSync": {
                "status": self.transmission_worker.last_sync_status,
                "lastSyncTime": self.transmission_worker.last_sync_time
            }
        }
