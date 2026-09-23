"""
RAAHI Edge Traffic Visualization & OpenCV HUD (Phase 8C)
========================================================
Renders vehicle bounding boxes, trajectory trails, road ROI polygon,
virtual counting line, and the extended traffic intelligence telemetry HUD.
"""

from typing import List, Optional, Tuple
import cv2
import numpy as np
from .metrics import TrackedVehicle, TrafficMetrics
from .track_history import TrackHistoryManager

# BGR color mapping for vehicle classes
CLASS_COLORS = {
    "car": (248, 189, 56),         # Cyan / Sky Blue in BGR
    "motorcycle": (62, 226, 162),   # Mint / Emerald Green in BGR
    "bus": (45, 180, 255),         # Amber / Gold in BGR
    "truck": (255, 108, 155),      # Purple / Pink in BGR
}
DEFAULT_VEHICLE_COLOR = (200, 200, 200)

# Traffic state badge colors (BGR)
STATE_COLORS = {
    "FREE": (66, 230, 164),       # Mint Green
    "MODERATE": (0, 210, 255),    # Amber Yellow
    "HEAVY": (0, 140, 255),       # Orange
    "CONGESTED": (77, 77, 255)    # Red / Crimson
}


def draw_tracked_vehicles(
    frame: np.ndarray,
    tracked_vehicles: List[TrackedVehicle]
) -> np.ndarray:
    """
    Renders bounding boxes and local track ID badges on the OpenCV frame.
    Format: [#<track_id> <class_name> <confidence>]
    """
    h, w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX

    for v in tracked_vehicles:
        x1, y1, x2, y2 = v.bbox
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w - 1, x2), min(h - 1, y2)

        color = CLASS_COLORS.get(v.class_name, DEFAULT_VEHICLE_COLOR)

        # 1. Bounding box
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        # 2. Text label with track ID
        label = f"#{v.track_id} {v.class_name} {v.confidence:.2f}"
        font_scale = 0.45
        font_thickness = 1
        (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, font_thickness)

        badge_y1 = max(0, y1 - text_h - baseline - 4)
        badge_y2 = y1
        badge_x2 = min(w - 1, x1 + text_w + 6)

        # Draw filled badge
        cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), color, -1)
        # Draw dark text on bright badge for high readability
        cv2.putText(
            frame,
            label,
            (x1 + 3, badge_y2 - baseline - 1),
            font,
            font_scale,
            (10, 15, 25),
            font_thickness,
            cv2.LINE_AA
        )

    return frame


def draw_traffic_overlays(
    frame: np.ndarray,
    roi_polygon: Optional[List[Tuple[float, float]]] = None,
    count_line: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None,
    history_manager: Optional[TrackHistoryManager] = None,
    active_tracks: Optional[List[TrackedVehicle]] = None
) -> np.ndarray:
    """
    Renders road ROI polygon, virtual counting line, and vehicle motion trails.
    """
    h, w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX

    # 1. Draw Road ROI Polygon (translucent fill + boundary)
    if roi_polygon:
        poly_pts = np.array([(int(x * w), int(y * h)) for (x, y) in roi_polygon], dtype=np.int32)
        roi_overlay = frame.copy()
        cv2.fillPoly(roi_overlay, [poly_pts], (35, 55, 45))
        cv2.addWeighted(roi_overlay, 0.35, frame, 0.65, 0, frame)
        cv2.polylines(frame, [poly_pts], isClosed=True, color=(62, 226, 162), thickness=1, lineType=cv2.LINE_AA)

        # Label near top-left of ROI
        top_x, top_y = poly_pts[1]
        cv2.putText(frame, "ROAD ROI", (top_x + 5, top_y + 14), font, 0.35, (62, 226, 162), 1, cv2.LINE_AA)

    # 2. Draw Virtual Counting Line
    if count_line:
        (lx1, ly1), (lx2, ly2) = count_line
        p1 = (int(lx1 * w), int(ly1 * h))
        p2 = (int(lx2 * w), int(ly2 * h))

        # Vibrant gold counting line
        cv2.line(frame, p1, p2, (45, 200, 255), 2, lineType=cv2.LINE_AA)
        cv2.circle(frame, p1, 4, (45, 200, 255), -1)
        cv2.circle(frame, p2, 4, (45, 200, 255), -1)

        # Label above line
        mid_x = (p1[0] + p2[0]) // 2
        mid_y = (p1[1] + p2[1]) // 2 - 6
        cv2.putText(frame, "COUNT LINE", (mid_x - 36, mid_y), font, 0.36, (45, 200, 255), 1, cv2.LINE_AA)

    # 3. Draw Vehicle Trajectory Trails
    if history_manager and active_tracks:
        for track in active_tracks:
            pts = history_manager.get_points(track.track_id)
            if len(pts) >= 2:
                color = CLASS_COLORS.get(track.class_name, (200, 200, 200))
                for i in range(1, len(pts)):
                    cv2.line(frame, pts[i - 1], pts[i], color, 1, lineType=cv2.LINE_AA)

    return frame


def draw_traffic_hud(
    frame: np.ndarray,
    metrics: TrafficMetrics,
    fps: float = 0.0,
    mode: str = "traffic",
    bus_id: str = "RAAHI-01",
    offset_y: int = 0
) -> np.ndarray:
    """
    Renders the complete Phase 8C telemetry HUD with active counts, rolling flow,
    camera-relative road occupancy, and rule-based traffic state.
    """
    h, w = frame.shape[:2]
    hud_h = 108
    hud_w = min(w, 620)
    top_y = offset_y
    bot_y = min(h, offset_y + hud_h)

    # Semi-transparent background
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, top_y), (hud_w, bot_y), (10, 15, 22), -1)
    cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)

    # State accent color
    state_color = STATE_COLORS.get(metrics.traffic_state, (200, 200, 200))
    cv2.line(frame, (0, bot_y), (hud_w, bot_y), (35, 45, 60), 1)

    font = cv2.FONT_HERSHEY_SIMPLEX

    # Line 1: Header + Mode
    cv2.putText(
        frame,
        "RAAHI EDGE - TRAFFIC INTELLIGENCE",
        (12, top_y + 18),
        font,
        0.44,
        (255, 255, 255),
        1,
        cv2.LINE_AA
    )
    mode_str = f"MODE: {mode.upper()}"
    cv2.putText(frame, mode_str, (hud_w - 110, top_y + 18), font, 0.38, (248, 189, 56), 1, cv2.LINE_AA)

    # Line 2: Active Vehicles & Class Breakdown
    cls = metrics.per_class_count
    line2 = f"Active Vehicles: {metrics.active_count}  (Cars: {cls.get('car', 0)} | Bikes: {cls.get('motorcycle', 0)} | Buses: {cls.get('bus', 0)} | Trucks: {cls.get('truck', 0)})"
    cv2.putText(
        frame,
        line2,
        (12, top_y + 39),
        font,
        0.38,
        (220, 230, 245),
        1,
        cv2.LINE_AA
    )

    # Line 3: Flow Metrics
    flow = metrics.flow
    line3 = f"Flow: 10s: {flow.flow_10s} | 30s: {flow.flow_30s} | 60s: {flow.flow_60s}  (Rate: {flow.vpm:.1f} VPM | Total: {flow.total_crossed})"
    cv2.putText(
        frame,
        line3,
        (12, top_y + 60),
        font,
        0.38,
        (62, 226, 162),
        1,
        cv2.LINE_AA
    )

    # Line 4: Road ROI & Occupancy
    dens = metrics.density
    line4 = f"Road ROI: {dens.vehicles_in_roi} veh | Occ: {dens.occupancy_percent:.1f}% ({dens.density_level})"
    cv2.putText(
        frame,
        line4,
        (12, top_y + 81),
        font,
        0.38,
        (245, 210, 110),
        1,
        cv2.LINE_AA
    )

    # Line 5: Traffic State + Unique Track IDs + FPS
    cv2.putText(frame, "Traffic State:", (12, top_y + 102), font, 0.38, (140, 160, 185), 1, cv2.LINE_AA)
    cv2.putText(frame, f"[{metrics.traffic_state}]", (108, top_y + 102), font, 0.40, state_color, 1, cv2.LINE_AA)

    stats_str = f"| Track IDs: {metrics.unique_track_ids_count} | FPS: {fps:.1f} | Bus: {bus_id}"
    cv2.putText(frame, stats_str, (210, top_y + 102), font, 0.36, (140, 160, 185), 1, cv2.LINE_AA)

    return frame
