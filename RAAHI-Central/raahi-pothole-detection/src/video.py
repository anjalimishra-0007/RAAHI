#!/usr/bin/env python3
"""
RAAHI Pothole Detection - Video Inference Pipeline
===================================================
Processes input videos frame-by-frame using the trained YOLO11n pothole detection model.
Draws bounding boxes, class names, and confidence scores on detections while preserving
the original video resolution and frame rate (FPS).

Usage Examples:
    # 1. Process a video from videos/input/ and save to videos/output/
    python src/video.py --input videos/input/road_test.mp4

    # 2. Specify custom output destination and confidence threshold
    python src/video.py --input videos/input/road_test.mp4 --output videos/output/annotated.mp4 --conf 0.35

    # 3. Automatic detection of first video in videos/input/
    python src/video.py
"""

import os
import sys
import time
import json
import shutil
import subprocess
import argparse
from pathlib import Path
import cv2
import numpy as np
import torch
from ultralytics import YOLO


def get_default_device() -> str:
    """
    Selects the best available hardware accelerator:
    - Apple Silicon MPS (Metal Performance Shaders) on macOS
    - CUDA on Nvidia GPU systems
    - CPU as fallback
    """
    if torch.backends.mps.is_available():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    return "cpu"


def draw_detection_box(
    frame: np.ndarray,
    box_coords: tuple,
    class_name: str,
    confidence: float,
    color: tuple = (0, 140, 255)
) -> None:
    """
    Draws a bounding box and label badge with class name and confidence score on the frame.

    Args:
        frame: OpenCV image array in BGR format.
        box_coords: Tuple of (x1, y1, x2, y2) integer pixel coordinates.
        class_name: Name of the detected class (e.g. 'pothole').
        confidence: Confidence score between 0.0 and 1.0.
        color: BGR color tuple for box and label background.
    """
    x1, y1, x2, y2 = box_coords
    h, w = frame.shape[:2]

    # Clip coordinates to frame boundaries
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w - 1, x2), min(h - 1, y2)

    # 1. Draw outer bounding box rectangle
    thickness = max(2, int(min(w, h) / 350))
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)

    # 2. Format the text label: "<class_name> <confidence>"
    label = f"{class_name} {confidence:.2f}"
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.45, min(w, h) / 1100)
    font_thickness = max(1, int(font_scale * 2))

    # Calculate text dimensions to draw a solid background badge
    (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, font_thickness)
    badge_y1 = max(0, y1 - text_h - baseline - 6)
    badge_y2 = y1
    badge_x2 = min(w - 1, x1 + text_w + 8)

    # 3. Draw filled background badge for contrast
    cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), color, -1)

    # 4. Draw label text in white on top of the badge
    text_origin = (x1 + 4, badge_y2 - baseline - 2)
    cv2.putText(
        frame,
        label,
        text_origin,
        font,
        font_scale,
        (255, 255, 255),
        font_thickness,
        cv2.LINE_AA
    )


def process_video(
    input_path: Path,
    output_path: Path,
    model: YOLO,
    conf_thresh: float = 0.25,
    iou_thresh: float = 0.45,
    device: str = "cpu",
    show_preview: bool = False,
    detections_json_path: Path = None,
    summary_json_path: Path = None,
) -> dict:
    """
    Processes an input video frame-by-frame:
      - Reads each frame
      - Detects objects using the YOLO model
      - Draws bounding boxes, class names, and confidence scores
      - Writes the annotated frame to the output video preserving FPS & resolution

    Args:
        input_path: Path to the input video.
        output_path: Destination path for the annotated video.
        model: Loaded YOLO model instance.
        conf_thresh: Confidence detection threshold.
        iou_thresh: Non-maximum suppression IoU threshold.
        device: Hardware device ('mps', 'cuda', 'cpu').
        show_preview: Whether to display a real-time OpenCV preview window.

    Returns:
        Dictionary containing processing statistics.
    """
    # Open the input video stream
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        print(f"Error: Unable to open input video at: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Retrieve video properties to preserve original FPS and resolution
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0 or np.isnan(fps):
        fps = 30.0  # Fallback to standard 30 FPS if metadata is missing

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print("\n==================================================")
    print("         RAAHI VIDEO PROCESSING PIPELINE          ")
    print("==================================================")
    print(f"Input Video:        {input_path}")
    print(f"Resolution:         {width} x {height}")
    print(f"Original FPS:       {fps:.2f}")
    print(f"Total Frames:       {total_frames if total_frames > 0 else 'Variable / Unknown'}")
    print(f"Output Video:       {output_path}")
    print(f"Compute Device:     {device.upper()}")
    print(f"Confidence Thresh:  {conf_thresh}")
    print("==================================================\n")

    # Ensure output folder exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Initialize VideoWriter with mp4v codec
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))

    if not out.isOpened():
        print(f"Error: Unable to create output video writer for: {output_path}", file=sys.stderr)
        cap.release()
        sys.exit(1)

    # High-contrast color scheme for detected road hazards (BGR format)
    class_color_map = {
        "pothole": (0, 140, 255),        # Orange for potholes
        "hole": (0, 165, 255),           # Amber
        "manhole": (0, 220, 100),        # Green
        "sewer cover": (200, 200, 0),    # Cyan/Teal
        "Drain Hole": (255, 180, 0),     # Sky Blue
    }
    default_color = (0, 220, 100)

    frame_idx = 0
    total_detections = 0
    detection_id = 0
    detections_list = []
    start_time = time.time()

    print("Processing video frames...")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break  # Video stream finished

            frame_idx += 1

            # Run YOLO detection on the current frame
            results = model.predict(
                source=frame,
                conf=conf_thresh,
                iou=iou_thresh,
                device=device,
                verbose=False
            )

            result = results[0]
            detections_in_frame = 0

            # Draw bounding boxes and labels for each detection
            if result.boxes is not None and len(result.boxes) > 0:
                for box in result.boxes:
                    conf = float(box.conf[0])
                    if conf < conf_thresh:
                        continue

                    cls_id = int(box.cls[0])
                    class_name = model.names.get(cls_id, f"class_{cls_id}")

                    # Coordinates
                    x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())

                    # Select display color
                    color = class_color_map.get(class_name, default_color)

                    # Draw detection box with class and confidence
                    draw_detection_box(frame, (x1, y1, x2, y2), class_name, conf, color=color)

                    detections_in_frame += 1
                    total_detections += 1
                    detection_id += 1

                    # Compute precise timestamp based on video FPS
                    time_sec = frame_idx / fps if fps > 0 else 0.0
                    mins = int(time_sec // 60)
                    secs = time_sec % 60
                    timestamp_str = f"{mins:02d}:{secs:05.2f}"

                    detections_list.append({
                        "id": detection_id,
                        "type": class_name.lower(),
                        "confidence": round(float(conf), 2),
                        "frame": frame_idx,
                        "timestamp": timestamp_str,
                        "bbox": {
                            "x1": int(x1),
                            "y1": int(y1),
                            "x2": int(x2),
                            "y2": int(y2)
                        }
                    })

            # Write the annotated frame to output video file
            out.write(frame)

            # Optional live preview window
            if show_preview:
                cv2.imshow("RAAHI Video Detection Preview", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    print("\nProcessing interrupted by user (pressed 'q').")
                    break

            # Progress update logged every 30 frames
            if frame_idx % 30 == 0 or (total_frames > 0 and frame_idx == total_frames):
                percent = (frame_idx / total_frames * 100) if total_frames > 0 else 0.0
                elapsed = time.time() - start_time
                current_fps = frame_idx / elapsed if elapsed > 0 else 0.0
                print(
                    f"  -> Frame {frame_idx}"
                    + (f"/{total_frames} ({percent:5.1f}%)" if total_frames > 0 else "")
                    + f" | Processing FPS: {current_fps:4.1f} | Detections: {detections_in_frame}"
                )

    finally:
        # Safely release video stream handles
        cap.release()
        out.release()
        if show_preview:
            cv2.destroyAllWindows()

    total_time = time.time() - start_time
    avg_fps = (frame_idx / total_time) if total_time > 0 else 0.0
    video_duration = round(frame_idx / fps, 2) if fps > 0 else 0.0
    pothole_count = sum(1 for d in detections_list if "pothole" in d["type"].lower())

    summary_data = {
        "totalDetections": len(detections_list),
        "potholeDetections": pothole_count,
        "framesProcessed": frame_idx,
        "videoFps": round(float(fps), 2) if fps > 0 else 25.0,
        "videoDuration": video_duration
    }

    # Save detections JSON if path provided
    if detections_json_path:
        detections_json_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "summary": summary_data,
            "detections": detections_list
        }
        with open(detections_json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print(f"Saved Detections JSON: {detections_json_path.resolve()}")

    # Save summary JSON if path provided
    if summary_json_path:
        summary_json_path.parent.mkdir(parents=True, exist_ok=True)
        with open(summary_json_path, "w", encoding="utf-8") as f:
            json.dump(summary_data, f, indent=2)
        print(f"Saved Summary JSON:    {summary_json_path.resolve()}")

    # Optimize output video container for HTML5 web streaming if ffmpeg is available
    ffmpeg_bin = shutil.which("ffmpeg") or "/Users/admin/.homebrew/bin/ffmpeg"
    if os.path.exists(ffmpeg_bin) and output_path.exists():
        temp_web_video = output_path.with_name(f"{output_path.stem}_web{output_path.suffix}")
        try:
            cmd = [
                ffmpeg_bin, "-y", "-i", str(output_path),
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(temp_web_video)
            ]
            res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if res.returncode == 0 and temp_web_video.exists() and temp_web_video.stat().st_size > 0:
                temp_web_video.replace(output_path)
                print("Optimized output video for web streaming (H.264 faststart).")
        except Exception:
            if temp_web_video.exists():
                temp_web_video.unlink(missing_ok=True)

    print("\n==================================================")
    print("           VIDEO PROCESSING COMPLETED             ")
    print("==================================================")
    print(f"Total Frames Processed: {frame_idx}")
    print(f"Total Detections:       {total_detections}")
    print(f"Pothole Detections:     {pothole_count}")
    print(f"Elapsed Time:           {total_time:.2f} seconds")
    print(f"Average Processing FPS: {avg_fps:.2f}")
    print(f"Saved Output Video:     {output_path.resolve()}")
    print("==================================================\n")

    return {
        "frames_processed": frame_idx,
        "total_detections": total_detections,
        "pothole_detections": pothole_count,
        "elapsed_seconds": total_time,
        "avg_fps": avg_fps,
        "output_path": str(output_path.resolve()),
        "detections": detections_list,
        "summary": summary_data
    }


def main():
    parser = argparse.ArgumentParser(
        description="RAAHI Pothole Detection: Video inference pipeline using OpenCV and YOLO11n."
    )
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="Path to input video file (default: searches in videos/input/)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Path to output annotated video file (default: saved to videos/output/)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="models/pothole_yolo11n.pt",
        help="Path to trained YOLO weights file (default: models/pothole_yolo11n.pt)"
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.25,
        help="Confidence threshold for detections (default: 0.25)"
    )
    parser.add_argument(
        "--iou",
        type=float,
        default=0.45,
        help="NMS IoU threshold (default: 0.45)"
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Inference compute device: 'mps', 'cuda', or 'cpu' (default: auto-detect)"
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show live video preview window during processing"
    )
    parser.add_argument(
        "--json",
        type=str,
        default="results/detections.json",
        help="Path to save detection results JSON (default: results/detections.json)"
    )
    parser.add_argument(
        "--summary-json",
        type=str,
        default="results/summary.json",
        help="Path to save summary JSON (default: results/summary.json)"
    )

    args = parser.parse_args()

    # 1. Model Existence Check (Requirement 5)
    model_path = Path(args.model).resolve()
    if not model_path.exists():
        print("=" * 65, file=sys.stderr)
        print("ERROR: Model file not found!", file=sys.stderr)
        print(f"Checked path: {model_path}", file=sys.stderr)
        print("\nPlease ensure the training run has finished and the weights", file=sys.stderr)
        print("have been saved to: models/pothole_yolo11n.pt", file=sys.stderr)
        print("=" * 65, file=sys.stderr)
        sys.exit(1)

    # 2. Select Compute Device
    device = args.device if args.device else get_default_device()

    # 3. Load YOLO Model
    print(f"Loading YOLO model from: {model_path}")
    model = YOLO(str(model_path))
    print(f"Loaded {len(model.names)} classes: {model.names}")

    # 4. Resolve Input Video File Path
    input_dir = Path("videos/input").resolve()
    output_dir = Path("videos/output").resolve()

    if args.input:
        input_path = Path(args.input).resolve()
    else:
        # Search for any video in videos/input/
        supported_exts = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
        found_videos = [
            f for f in input_dir.iterdir()
            if f.is_file() and f.suffix.lower() in supported_exts and not f.name.startswith(".")
        ] if input_dir.exists() else []

        if not found_videos:
            print("=" * 65, file=sys.stderr)
            print("ERROR: No input video specified and none found in videos/input/!", file=sys.stderr)
            print(f"Please provide an input video via --input, or place video files into:", file=sys.stderr)
            print(f"  {input_dir}", file=sys.stderr)
            print("=" * 65, file=sys.stderr)
            sys.exit(1)

        input_path = found_videos[0]
        print(f"Auto-selected video from {input_dir}: {input_path.name}")

    if not input_path.exists():
        print(f"ERROR: Input video not found at: {input_path}", file=sys.stderr)
        sys.exit(1)

    # 5. Resolve Output Video File Path
    if args.output:
        output_path = Path(args.output).resolve()
    else:
        output_dir.mkdir(parents=True, exist_ok=True)
        out_filename = f"{input_path.stem}_annotated{input_path.suffix}"
        output_path = output_dir / out_filename

    # 6. Execute Video Processing Pipeline
    detections_json_path = Path(args.json).resolve() if args.json else None
    summary_json_path = Path(args.summary_json).resolve() if args.summary_json else None

    process_video(
        input_path=input_path,
        output_path=output_path,
        model=model,
        conf_thresh=args.conf,
        iou_thresh=args.iou,
        device=device,
        show_preview=args.preview,
        detections_json_path=detections_json_path,
        summary_json_path=summary_json_path,
    )


if __name__ == "__main__":
    main()
