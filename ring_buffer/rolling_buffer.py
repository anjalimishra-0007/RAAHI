"""
Rolling Frame Buffer for RAAHI-Edge.
Thread-safe circular ring buffer retaining ~2.0 seconds of pre-detection frames.
"""

import collections
import threading
import time
from typing import List, Tuple, Optional
import numpy as np


class RollingFrameBuffer:
    """
    Thread-safe, memory-bounded circular ring buffer storing recent camera frames.
    Retains approximately 2.0 seconds of recent frames based on live FPS.
    """

    def __init__(self, target_duration_sec: float = 2.0, max_capacity: int = 90):
        self.target_duration_sec = target_duration_sec
        self.max_capacity = max_capacity
        self.lock = threading.Lock()
        self.buffer = collections.deque(maxlen=max_capacity)

    def push(self, frame: np.ndarray, timestamp: Optional[float] = None):
        """Pushes a frame and timestamp to the buffer."""
        if frame is None or frame.size == 0:
            return
        ts = timestamp if timestamp is not None else time.time()
        with self.lock:
            self.buffer.append((ts, frame.copy()))

    def get_pre_buffer_frames(self, duration_sec: Optional[float] = None) -> List[np.ndarray]:
        """
        Retrieves frames up to duration_sec before the current moment.
        If fewer frames exist (early stream), returns all available frames.
        """
        dur = duration_sec if duration_sec is not None else self.target_duration_sec
        with self.lock:
            if not self.buffer:
                return []
            now = time.time()
            cutoff = now - max(0.0, dur)
            frames = [f.copy() for (t, f) in self.buffer if t >= cutoff]
            if not frames and self.buffer:
                frames = [f.copy() for (t, f) in self.buffer]
            return frames

    def clear(self):
        """Clears all frames from buffer."""
        with self.lock:
            self.buffer.clear()

    def __len__(self) -> int:
        with self.lock:
            return len(self.buffer)
