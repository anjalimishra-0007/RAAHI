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
        pre_buffer_sec: float = 2.0,
        post_buffer_sec: float = 3.0,
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
        self.ring_buffer = RollingFrameBuffer(target_duration_sec=self.pre_buffer_sec)
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
        self.last_inference_latency_ms = 0.0

    def _on_evidence_clip_ready(
        self,
        event_id: str,
        clip_path: str,
        keyframe_path: Optional[str],
        size_bytes: int,
        duration_sec: float,
        fps: float,
        resolution: str
    ):
        """Callback triggered when an evidence MP4 clip has been assembled."""
        self.db.update_event_evidence(
            event_id=event_id,
            clip_path=clip_path,
            keyframe_path=keyframe_path,
            size_bytes=size_bytes,
            duration_sec=duration_sec,
            fps=fps,
            resolution=resolution
        )
        self.db.log_system_message("EVENT", "EVIDENCE", f"Evidence clip finalized for {event_id} ({duration_sec}s, {size_bytes // 1024} KB)")

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

            success, frame, metadata = self.receiver.read(wait_for_new=False)
            if not success or frame is None or frame.size == 0:
                time.sleep(0.01)
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
                    self.total_candidates_detected += 1
                    event_id = pkg["eventId"]
                    self.db.log_system_message("EVENT", "AI", f"Candidate pothole detected: {event_id} (conf: {pkg['edgeConfidence']})")

                    # 3. Save candidate to local SQLite database (status = PENDING_VERIFICATION)
                    self.db.insert_event(pkg)

                    # 4. Trigger evidence video capture (~2.0s pre-buffer + ~3.0s post-buffer)
                    pre_frames = self.ring_buffer.get_pre_buffer_frames(duration_sec=self.pre_buffer_sec)
                    self.evidence_manager.start_capture(
                        event_id=event_id,
                        pre_frames=pre_frames,
                        fps=self.inference_fps if self.inference_fps > 0 else 30.0,
                        frame_size=self.last_frame_size,
                        post_duration_sec=self.post_buffer_sec
                    )

            # Render preview image (downsampled for lightweight web streaming)
            if detections:
                annotated = self.detector.draw_detections(frame, detections)
            else:
                annotated = frame

            # Encode preview frame to JPEG for live dashboard preview
            try:
                preview_small = cv2.resize(annotated, (640, 360))
                _, buf = cv2.imencode('.jpg', preview_small, [cv2.IMWRITE_JPEG_QUALITY, 70])
                self.latest_preview_jpeg = buf.tobytes()
            except Exception:
                pass

    def get_health_status(self) -> Dict[str, Any]:
        """Returns comprehensive status of all pipeline components."""
        receiver_state = self.receiver.stats.state.name if self.receiver else "STOPPED"
        receiver_stats = self.receiver.get_stats() if self.receiver else {}
        self.receiver_fps = receiver_stats.get("fps", 0.0)

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

        # GPS fix
        latest_gps = self.gps_manager.get_latest_fix(self.bus_id)

        return {
            "busId": self.bus_id,
            "pipelineRunning": self.is_running,
            "components": {
                "camera": "STREAMING" if (receiver_state == "STREAMING" and self.receiver_fps > 0) else ("STANDBY" if mediamtx_up else "OFFLINE"),
                "rtsp": "ONLINE" if mediamtx_up else "OFFLINE",
                "mediamtx": "RUNNING" if mediamtx_up else "STOPPED",
                "opencv": receiver_state,
                "yolo11n": "INFERRING" if (self.is_running and self.inference_fps > 0) else ("READY" if self.detector else "STOPPED"),
                "gps": "CONNECTED" if (latest_gps and (time.time() - latest_gps.get("epochMs", 0) / 1000.0 < 5.0)) else ("STALE" if latest_gps else "DISCONNECTED"),
                "eventEngine": "ACTIVE" if self.is_running else "IDLE",
                "localDb": "ONLINE" if os.path.exists(self.db_path) else "INITIALIZING",
                "centralConnection": "CONNECTED" if central_health.get("connected") else "OFFLINE"
            },
            "metrics": {
                "receiverFps": self.receiver_fps,
                "inferenceFps": self.inference_fps,
                "inferenceLatencyMs": self.last_inference_latency_ms,
                "processedFrames": self.processed_frames,
                "candidatesDetected": self.total_candidates_detected,
                "candidatesSuppressed": self.total_candidates_suppressed,
                "ringBufferFrames": len(self.ring_buffer),
                "resolution": f"{self.last_frame_size[0]}x{self.last_frame_size[1]}"
            },
            "latestGps": latest_gps,
            "centralSync": {
                "status": self.transmission_worker.last_sync_status,
                "lastSyncTime": self.transmission_worker.last_sync_time
            }
        }
