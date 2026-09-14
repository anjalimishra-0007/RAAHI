"""
YOLO11n Inference Engine for RAAHI-Edge.
Runs optimized pothole and road hazard inference on Apple Silicon MPS.
"""

import os
from typing import Dict, List, Optional, Tuple, Any
import cv2
import numpy as np
import torch
from ultralytics import YOLO


class YOLODetector:
    """
    YOLO11n Edge inference detector running on Apple Silicon MPS with
    sub-20ms latency and high-throughput frame processing.
    """

    CLASS_COLOR_MAP = {
        "pothole": (0, 140, 255),        # High-visibility Orange (BGR)
        "hole": (0, 165, 255),           # Amber
        "manhole": (0, 220, 100),        # Emerald Green
        "sewer cover": (200, 200, 0),    # Teal
        "Drain Hole": (255, 180, 0),     # Sky Blue
    }
    DEFAULT_COLOR = (0, 220, 100)

    def __init__(
        self,
        model_path: str = "models/pothole_yolo11n.pt",
        conf_threshold: float = 0.35,
        imgsz: int = 640,
        device: Optional[str] = None
    ):
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self.imgsz = imgsz

        # Device selection
        if device:
            self.device = device
        elif torch.backends.mps.is_available():
            self.device = "mps"
        elif torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"

        print(f"[YOLODetector] Loading model '{self.model_path}' on device '{self.device}'...")
        self.model = YOLO(self.model_path)
        self.class_names = self.model.names
        print(f"[YOLODetector] Model ready! Classes: {self.class_names}")

    def detect(
        self,
        frame: np.ndarray,
        conf: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Runs YOLO11n inference on a single frame.
        Returns list of detections with normalized coordinates and class info.
        """
        if frame is None or frame.size == 0:
            return []

        effective_conf = conf if conf is not None else self.conf_threshold
        results = self.model.predict(
            source=frame,
            conf=effective_conf,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False
        )

        detections = []
        if not results or len(results) == 0:
            return detections

        res = results[0]
        if res.boxes is None or len(res.boxes) == 0:
            return detections

        for box in res.boxes:
            score = float(box.conf[0])
            if score < effective_conf:
                continue

            cls_id = int(box.cls[0])
            cls_name = self.class_names.get(cls_id, f"class_{cls_id}")
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())

            detections.append({
                "class_id": cls_id,
                "class_name": cls_name,
                "confidence": round(score, 3),
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "is_pothole": (cls_name.lower() == "pothole")
            })

        return detections

    def track(
        self,
        frame: np.ndarray,
        conf: Optional[float] = None,
        tracker: str = "bytetrack.yaml"
    ) -> List[Dict[str, Any]]:
        """
        Runs YOLO inference with persistent ByteTrack tracking across frames.
        Returns detections with persistent track IDs.
        """
        if frame is None or frame.size == 0:
            return []

        effective_conf = conf if conf is not None else self.conf_threshold
        results = self.model.track(
            source=frame,
            conf=effective_conf,
            imgsz=self.imgsz,
            device=self.device,
            tracker=tracker,
            persist=True,
            verbose=False
        )

        detections = []
        if not results or len(results) == 0:
            return detections

        res = results[0]
        if res.boxes is None or len(res.boxes) == 0:
            return detections

        for box in res.boxes:
            score = float(box.conf[0])
            if score < effective_conf:
                continue

            cls_id = int(box.cls[0])
            cls_name = self.class_names.get(cls_id, f"class_{cls_id}")
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            track_id = int(box.id[0]) if box.id is not None else None

            detections.append({
                "track_id": track_id,
                "class_id": cls_id,
                "class_name": cls_name,
                "confidence": round(score, 3),
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "is_pothole": (cls_name.lower() == "pothole")
            })

        return detections

    def draw_detections(self, frame: np.ndarray, detections: List[Dict[str, Any]]) -> np.ndarray:
        """Draws bounding boxes and labels onto the frame."""
        annotated = frame.copy()
        for d in detections:
            bbox = d["bbox"]
            cls_name = d["class_name"]
            conf = d["confidence"]
            color = self.CLASS_COLOR_MAP.get(cls_name, self.DEFAULT_COLOR)
            track_id = d.get("track_id")

            # Draw box
            x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Label banner
            id_prefix = f"#{track_id} " if track_id is not None else ""
            label = f"{id_prefix}{cls_name.upper()} {int(conf * 100)}%"
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(annotated, (x1, max(0, y1 - lh - 8)), (x1 + lw + 6, max(lh + 8, y1)), color, -1)
            cv2.putText(annotated, label, (x1 + 3, max(lh + 4, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)

        return annotated
