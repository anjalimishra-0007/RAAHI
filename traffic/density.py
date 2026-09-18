"""
RAAHI Edge Road ROI & Camera-Relative Traffic Density Subsystem (Phase 8C)
========================================================================
Evaluates vehicle presence within a resolution-independent road Region of
Interest (ROI) and calculates camera-relative occupancy and density levels.

STRICT PRINCIPLES:
1. All metrics are CAMERA-RELATIVE based on visible road surface pixels.
   Do NOT claim physical calibration or units like vehicles/km².
2. Safeguards against overlapping bounding boxes via binary mask rasterization.
3. Density thresholds are configurable.
"""

from typing import List, Tuple
import cv2
import numpy as np
from .metrics import DensityMetrics, TrackedVehicle

# Default normalized trapezoid covering the forward roadway in dashcam perspective
DEFAULT_ROAD_ROI = [
    (0.10, 0.95),  # Bottom Left
    (0.32, 0.45),  # Top Left
    (0.68, 0.45),  # Top Right
    (0.90, 0.95)   # Bottom Right
]


class RoadRoi:
    """
    Resolution-independent Road Region of Interest evaluator.
    """
    def __init__(
        self,
        polygon: List[Tuple[float, float]] = None,
        low_threshold: float = 0.15,
        high_threshold: float = 0.35
    ):
        self.polygon = polygon if polygon is not None else list(DEFAULT_ROAD_ROI)
        self.low_threshold = low_threshold
        self.high_threshold = high_threshold

    def get_pixel_polygon(self, frame_w: int, frame_h: int) -> np.ndarray:
        """
        Scales normalized polygon coordinates to integer pixel coordinates.
        """
        pts = [(int(x * frame_w), int(y * frame_h)) for (x, y) in self.polygon]
        return np.array(pts, dtype=np.int32)

    def is_point_in_roi(self, pt: Tuple[int, int], frame_w: int, frame_h: int) -> bool:
        """
        Tests whether pixel point (x, y) lies inside or on the ROI polygon.
        """
        poly_pts = self.get_pixel_polygon(frame_w, frame_h)
        return cv2.pointPolygonTest(poly_pts, (float(pt[0]), float(pt[1])), False) >= 0

    def evaluate(
        self,
        active_tracks: List[TrackedVehicle],
        frame_size: Tuple[int, int]
    ) -> DensityMetrics:
        """
        Calculates vehicles in ROI, camera-relative occupancy ratio, and density level.
        
        Uses an internal downscaled grid (160x90) for instantaneous, pixel-exact
        mask union with robust handling of overlapping vehicle bounding boxes.
        """
        w, h = frame_size
        if w <= 0 or h <= 0:
            return DensityMetrics()

        poly_pts = self.get_pixel_polygon(w, h)

        # 1. Count vehicles whose center lies inside the ROI
        vehicles_in_roi = 0
        for track in active_tracks:
            cx, cy = track.center
            if cv2.pointPolygonTest(poly_pts, (float(cx), float(cy)), False) >= 0:
                vehicles_in_roi += 1

        # 2. Camera-relative occupancy calculation
        # Downscale to 160x90 for fast bitwise rasterization (< 0.05 ms)
        grid_w, grid_h = 160, 90
        scale_x = grid_w / w
        scale_y = grid_h / h

        # Rasterize ROI mask
        scaled_poly = [(int(x * grid_w), int(y * grid_h)) for (x, y) in self.polygon]
        roi_mask = np.zeros((grid_h, grid_w), dtype=np.uint8)
        cv2.fillPoly(roi_mask, [np.array(scaled_poly, dtype=np.int32)], 1)
        roi_pixel_count = int(np.count_nonzero(roi_mask))

        if roi_pixel_count == 0:
            return DensityMetrics(vehicles_in_roi=vehicles_in_roi)

        # Rasterize vehicle bounding box union
        veh_mask = np.zeros((grid_h, grid_w), dtype=np.uint8)
        for track in active_tracks:
            x1, y1, x2, y2 = track.bbox
            sx1 = max(0, min(grid_w - 1, int(x1 * scale_x)))
            sy1 = max(0, min(grid_h - 1, int(y1 * scale_y)))
            sx2 = max(0, min(grid_w - 1, int(x2 * scale_x)))
            sy2 = max(0, min(grid_h - 1, int(y2 * scale_y)))
            if sx2 > sx1 and sy2 > sy1:
                cv2.rectangle(veh_mask, (sx1, sy1), (sx2, sy2), 1, -1)

        # Intersection of vehicle boxes and ROI
        overlap_pixels = int(np.count_nonzero(veh_mask & roi_mask))
        occupancy_ratio = min(1.0, overlap_pixels / roi_pixel_count)
        occupancy_percent = round(occupancy_ratio * 100.0, 1)

        # 3. Categorize density level
        if occupancy_ratio < self.low_threshold:
            density_level = "LOW"
        elif occupancy_ratio < self.high_threshold:
            density_level = "MEDIUM"
        else:
            density_level = "HIGH"

        return DensityMetrics(
            vehicles_in_roi=vehicles_in_roi,
            occupancy_ratio=round(occupancy_ratio, 3),
            occupancy_percent=occupancy_percent,
            density_level=density_level
        )
