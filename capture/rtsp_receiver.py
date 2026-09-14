"""RTSP stream receiver using OpenCV with FFmpeg backend.

Features:
- Dedicated background worker thread to prevent RTSP buffer accumulation
- Non-blocking frame retrieval with low-latency latest-frame caching
- Real-time rolling FPS calculation and read-failure tracking
- Automatic reconnection on network dropouts or stream stalls
- Thread-safe lifecycle control (start, read, stop)
"""

import os
import sys
import time
import threading
from collections import deque
from enum import Enum
from typing import Optional, Tuple, Dict, Any

import cv2
import numpy as np

from utils.logger import get_logger

logger = get_logger("raahi-edge.capture")


class StreamState(Enum):
    """Lifecycle states of the RTSP stream."""
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    STREAMING = "STREAMING"
    STALLED = "STALLED"
    STOPPED = "STOPPED"


class StreamStats:
    """Telemetry data collected during stream consumption."""

    def __init__(self):
        self.state: StreamState = StreamState.DISCONNECTED
        self.width: int = 0
        self.height: int = 0
        self.total_frames_received: int = 0
        self.total_frames_consumed: int = 0
        self.dropped_frames: int = 0
        self.read_failures: int = 0
        self.reconnect_count: int = 0
        self.current_fps: float = 0.0
        self.average_fps: float = 0.0
        self.first_frame_time: Optional[float] = None
        self.last_frame_time: Optional[float] = None
        self.last_state_change: float = time.time()

    def update_state(self, new_state: StreamState):
        if self.state != new_state:
            logger.info(f"Stream state transition: {self.state.value} -> {new_state.value}")
            self.state = new_state
            self.last_state_change = time.time()

    def to_dict(self) -> Dict[str, Any]:
        uptime = (time.time() - self.first_frame_time) if self.first_frame_time else 0.0
        return {
            "state": self.state.value,
            "resolution": f"{self.width}x{self.height}" if self.width > 0 else "N/A",
            "current_fps": round(self.current_fps, 1),
            "average_fps": round(self.average_fps, 1),
            "total_frames_received": self.total_frames_received,
            "total_frames_consumed": self.total_frames_consumed,
            "dropped_frames": self.dropped_frames,
            "read_failures": self.read_failures,
            "reconnects": self.reconnect_count,
            "uptime_seconds": round(uptime, 1)
        }


class RTSPReceiver:
    """Threaded RTSP Stream Receiver using OpenCV VideoCapture."""

    def __init__(
        self,
        rtsp_url: str,
        transport: str = "tcp",
        buffer_size: int = 1,
        reconnect_delay_sec: float = 2.0,
        max_reconnect_attempts: int = 0,
        read_timeout_sec: float = 5.0
    ):
        self.rtsp_url = rtsp_url
        self.transport = transport.lower()
        self.buffer_size = max(1, buffer_size)
        self.reconnect_delay_sec = reconnect_delay_sec
        self.max_reconnect_attempts = max_reconnect_attempts
        self.read_timeout_sec = read_timeout_sec

        # Thread synchronization
        self._lock = threading.Lock()
        self._new_frame_event = threading.Event()
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None

        # Frame buffers
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_timestamp: Optional[float] = None
        self._frame_unread: bool = False

        # Metrics and statistics
        self.stats = StreamStats()
        self._fps_window: deque = deque(maxlen=30)  # rolling window over last 30 frames

        # Configure OpenCV FFmpeg low-latency capture options
        # Options are passed as key;value pairs delimited by '|'
        ffmpeg_opts = [
            f"rtsp_transport;{self.transport}",
            "fflags;nobuffer",
            "flags;low_delay",
            "max_delay;500000",
            "reorder_queue_size;0",
            "stimeout;5000000",
            "analyzeduration;100000",
            "probesize;32768"
        ]
        self._effective_ffmpeg_options = "|".join(ffmpeg_opts)
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = self._effective_ffmpeg_options
        logger.info(f"Effective RTSP/FFmpeg low-latency options: {self._effective_ffmpeg_options}")

    def start(self):
        """Starts the background capture thread."""
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                logger.warning("RTSP receiver worker thread is already running.")
                return

            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._capture_worker,
                name="RTSPReceiverWorker",
                daemon=True
            )
            self._worker_thread.start()
            logger.info(f"Started RTSP receiver worker thread for {self.rtsp_url}")

    def stop(self, timeout: float = 3.0):
        """Signals worker to stop and waits for thread completion."""
        logger.info("Stopping RTSP receiver worker thread...")
        self._stop_event.set()
        self._new_frame_event.set()

        if self._worker_thread is not None and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=timeout)
            if self._worker_thread.is_alive():
                logger.warning("Worker thread did not terminate within timeout.")

        self.stats.update_state(StreamState.STOPPED)
        logger.info("RTSP receiver stopped cleanly.")

    def read(self, wait_for_new: bool = True, timeout: float = 0.5) -> Tuple[bool, Optional[np.ndarray], Dict[str, Any]]:
        """Consumes the latest received video frame.

        Args:
            wait_for_new: If True, blocks until a new frame arrives or timeout expires.
            timeout: Maximum wait time in seconds if wait_for_new is True.

        Returns:
            Tuple of (success: bool, frame: Optional[np.ndarray], metadata: dict)
        """
        if wait_for_new:
            self._new_frame_event.wait(timeout=timeout)

        with self._lock:
            self._new_frame_event.clear()
            if self._latest_frame is None:
                return False, None, {"timestamp": None, "state": self.stats.state.value}

            frame = self._latest_frame.copy()
            frame_ts = self._latest_timestamp
            self._frame_unread = False
            self.stats.total_frames_consumed += 1

            metadata = {
                "timestamp": frame_ts,
                "frame_id": self.stats.total_frames_consumed,
                "current_fps": self.stats.current_fps,
                "resolution": (self.stats.width, self.stats.height),
                "state": self.stats.state.value
            }
            return True, frame, metadata

    def get_stats(self) -> Dict[str, Any]:
        """Returns snapshot of current stream metrics."""
        with self._lock:
            return self.stats.to_dict()

    @staticmethod
    def _release_capture(cap: Optional[cv2.VideoCapture]) -> None:
        """Completely releases and cleans up a VideoCapture handle."""
        if cap is not None:
            try:
                cap.release()
            except Exception as e:
                logger.warning(f"Error releasing VideoCapture handle: {e}")

    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        """Creates and validates cv2.VideoCapture instance."""
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = self._effective_ffmpeg_options
        logger.info(
            f"Connecting to RTSP endpoint: {self.rtsp_url} (transport={self.transport}) "
            f"with options: [{self._effective_ffmpeg_options}]..."
        )
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)

        # Set buffer size to minimize internal queueing
        cap.set(cv2.CAP_PROP_BUFFERSIZE, self.buffer_size)

        if not cap.isOpened():
            logger.warning(f"Could not open RTSP stream at {self.rtsp_url}")
            self._release_capture(cap)
            return None

        # Probe stream properties
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        reported_fps = cap.get(cv2.CAP_PROP_FPS)

        logger.info(
            f"RTSP stream connected successfully! "
            f"Reported: {width}x{height} @ {reported_fps:.1f} FPS"
        )
        return cap

    def _capture_worker(self):
        """Worker loop reading frames continuously in background."""
        attempts = 0
        cap: Optional[cv2.VideoCapture] = None

        while not self._stop_event.is_set():
            # Ensure any previous capture instance is completely released before opening a new one
            if cap is not None:
                self._release_capture(cap)
                cap = None

            self.stats.update_state(StreamState.CONNECTING)
            cap = self._open_capture()

            if cap is None:
                attempts += 1
                self.stats.read_failures += 1
                if 0 < self.max_reconnect_attempts <= attempts:
                    logger.error(f"Exceeded max reconnect attempts ({self.max_reconnect_attempts}). Exiting worker.")
                    self.stats.update_state(StreamState.DISCONNECTED)
                    break

                logger.info(f"Retrying connection in {self.reconnect_delay_sec}s (attempt {attempts})...")
                self._stop_event.wait(self.reconnect_delay_sec)
                continue

            # Connected successfully
            attempts = 0
            self.stats.reconnect_count += 1
            self.stats.update_state(StreamState.STREAMING)
            last_received_time = time.time()

            # Stream read loop
            while not self._stop_event.is_set():
                ret, frame = cap.read()
                now = time.time()

                if not ret or frame is None or frame.size == 0:
                    self.stats.read_failures += 1
                    # Check for stall timeout
                    if (now - last_received_time) > self.read_timeout_sec:
                        logger.warning(
                            f"Stream stalled! No frames received for {self.read_timeout_sec}s. Reconnecting..."
                        )
                        self.stats.update_state(StreamState.STALLED)
                        break
                    # Short sleep to prevent busy spinning on read failure
                    time.sleep(0.01)
                    continue

                # Valid frame received
                last_received_time = now
                if self.stats.first_frame_time is None:
                    self.stats.first_frame_time = now
                self.stats.last_frame_time = now

                # Update resolution if needed
                h, w = frame.shape[:2]
                self.stats.width = w
                self.stats.height = h

                # FPS Calculation
                self._fps_window.append(now)
                if len(self._fps_window) > 1:
                    dt = self._fps_window[-1] - self._fps_window[0]
                    if dt > 0:
                        self.stats.current_fps = (len(self._fps_window) - 1) / dt

                self.stats.total_frames_received += 1
                total_elapsed = now - self.stats.first_frame_time
                if total_elapsed > 0:
                    self.stats.average_fps = self.stats.total_frames_received / total_elapsed

                # Update latest frame cache
                with self._lock:
                    if self._frame_unread:
                        self.stats.dropped_frames += 1
                    self._latest_frame = frame
                    self._latest_timestamp = now
                    self._frame_unread = True
                    self._new_frame_event.set()

            # Teardown capture object before reconnecting
            if cap is not None:
                self._release_capture(cap)
                cap = None
            logger.info("RTSP capture handle released.")
            if not self._stop_event.is_set():
                self.stats.update_state(StreamState.DISCONNECTED)
                time.sleep(self.reconnect_delay_sec)

        # Final cleanup on exit
        if cap is not None:
            self._release_capture(cap)
            cap = None
