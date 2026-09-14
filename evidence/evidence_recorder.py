"""
Evidence Recorder for RAAHI-Edge.
Captures ~5-second MP4 evidence clips (~2.0s pre-buffer + ~3.0s post-buffer)
and saves annotated keyframes for detected candidates.
"""

import os
import subprocess
import threading
import time
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np


class EvidenceCaptureSession:
    """
    Coordinates capturing a ~5-second live evidence video clip:
    ~2.0 seconds PRE-detection + ~3.0 seconds POST-detection.
    Encodes to MP4 and triggers SQLite database update.
    """

    def __init__(
        self,
        event_id: str,
        pre_frames: List[np.ndarray],
        target_post_frames: int,
        fps: float,
        frame_size: Tuple[int, int],
        output_dir: str = "data/evidence",
        on_complete=None
    ):
        self.event_id = event_id
        self.collected_frames = list(pre_frames)
        self.target_post_frames = max(1, target_post_frames)
        self.post_frames_collected = 0
        self.fps = max(10.0, min(60.0, fps if fps > 0 else 30.0))
        self.frame_size = frame_size
        self.output_dir = output_dir
        self.on_complete = on_complete
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
        """Assembles MP4 and triggers background completion."""
        with self.lock:
            self.is_completed = True
        threading.Thread(target=self._worker_finalize, daemon=True).start()

    def _worker_finalize(self):
        with self.lock:
            frames = list(self.collected_frames)

        if not frames:
            print(f"[EvidenceRecorder] Warning: No frames collected for {self.event_id}")
            return

        os.makedirs(self.output_dir, exist_ok=True)
        filename = f"{self.event_id}_evidence.mp4"
        raw_output_path = os.path.join(self.output_dir, f"raw_{filename}")
        final_output_path = os.path.join(self.output_dir, filename)
        keyframe_path = os.path.join(self.output_dir, f"{self.event_id}_keyframe.jpg")
        w, h = self.frame_size

        try:
            # 1. Save mid-point keyframe JPEG
            mid_idx = len(frames) // 2
            cv2.imwrite(keyframe_path, frames[mid_idx])

            # 2. Write raw MP4
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            writer = cv2.VideoWriter(raw_output_path, fourcc, self.fps, (w, h))

            for f in frames:
                if f.shape[1] != w or f.shape[0] != h:
                    f = cv2.resize(f, (w, h))
                writer.write(f)

            writer.release()

            # 3. H.264 faststart remux with ffmpeg for browser / central playback
            remux_success = False
            try:
                remux_cmd = [
                    'ffmpeg', '-y',
                    '-v', 'error',
                    '-i', raw_output_path,
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    final_output_path
                ]
                res = subprocess.run(remux_cmd, check=True, timeout=15)
                if os.path.exists(raw_output_path):
                    os.remove(raw_output_path)
                remux_success = True
            except Exception as ffmpeg_err:
                print(f"[EvidenceRecorder] ffmpeg remux fallback: {ffmpeg_err}")
                if os.path.exists(raw_output_path):
                    if os.path.exists(final_output_path):
                        os.remove(final_output_path)
                    os.rename(raw_output_path, final_output_path)

            file_size_bytes = os.path.getsize(final_output_path) if os.path.exists(final_output_path) else 0
            duration_sec = round(len(frames) / self.fps, 2)

            print(f"[EvidenceRecorder] Evidence clip ready: {final_output_path} ({duration_sec}s, {file_size_bytes / 1024:.1f} KB)")

            if self.on_complete:
                self.on_complete(
                    event_id=self.event_id,
                    clip_path=final_output_path,
                    keyframe_path=keyframe_path,
                    size_bytes=file_size_bytes,
                    duration_sec=duration_sec,
                    fps=self.fps,
                    resolution=f"{w}x{h}"
                )

        except Exception as e:
            print(f"[EvidenceRecorder] Error encoding evidence for {self.event_id}: {e}")


class EvidenceManager:
    """
    Manages active evidence recording sessions across incoming video frames.
    """

    def __init__(self, output_dir: str = "data/evidence", on_evidence_ready=None):
        self.output_dir = output_dir
        self.on_evidence_ready = on_evidence_ready
        self.active_sessions: Dict[str, EvidenceCaptureSession] = {}
        self.recorded_event_ids = set()
        self.lock = threading.Lock()

    def start_capture(
        self,
        event_id: str,
        pre_frames: List[np.ndarray],
        fps: float,
        frame_size: Tuple[int, int],
        post_duration_sec: float = 3.0
    ):
        """Spawns an evidence capture session."""
        with self.lock:
            if event_id in self.active_sessions or event_id in self.recorded_event_ids:
                return  # Avoid duplicate captures

            effective_fps = max(10.0, fps if fps > 0 else 30.0)
            target_post_frames = int(effective_fps * post_duration_sec)

            session = EvidenceCaptureSession(
                event_id=event_id,
                pre_frames=pre_frames,
                target_post_frames=target_post_frames,
                fps=effective_fps,
                frame_size=frame_size,
                output_dir=self.output_dir,
                on_complete=self.on_evidence_ready
            )
            self.active_sessions[event_id] = session
            self.recorded_event_ids.add(event_id)

    def on_new_frame(self, frame: np.ndarray):
        """Feeds incoming live frame to all active recording sessions."""
        with self.lock:
            if not self.active_sessions:
                return
            completed_ids = []
            for eid, session in list(self.active_sessions.items()):
                if session.add_post_frame(frame):
                    completed_ids.append(eid)

            for eid in completed_ids:
                session = self.active_sessions.pop(eid, None)
                if session:
                    session.finalize()

    def flush_all(self):
        """Finalizes all active sessions immediately (e.g. on shutdown)."""
        with self.lock:
            for eid, session in list(self.active_sessions.items()):
                session.finalize()
            self.active_sessions.clear()
