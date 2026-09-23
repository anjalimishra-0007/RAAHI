#!/usr/bin/env python3
"""
Test trained YOLO11 pothole detection model on the test dataset split.
Runs inference, evaluates precision/recall/mAP metrics, and saves prediction previews.
"""

import os
import sys
import argparse
from pathlib import Path
import yaml
import cv2
import numpy as np


def load_data_config(yaml_path: str):
    """Parses data.yaml and resolves test directory and classes."""
    yaml_file = Path(yaml_path)
    if not yaml_file.exists():
        raise FileNotFoundError(f"data.yaml not found at: {yaml_path}")

    with open(yaml_file, "r") as f:
        config = yaml.safe_load(f)

    base_dir = yaml_file.parent
    test_rel = config.get("test", "test/images")
    test_dir = (base_dir / test_rel).resolve()
    class_names = config.get("names", [])
    nc = config.get("nc", len(class_names))

    return {
        "config": config,
        "base_dir": base_dir,
        "test_dir": test_dir,
        "class_names": class_names,
        "nc": nc,
    }


def draw_predictions(image: np.ndarray, boxes, model_names: dict, conf_thresh: float = 0.25) -> np.ndarray:
    """Draws predicted bounding boxes, class labels, and confidence scores."""
    canvas = image.copy()
    h, w = canvas.shape[:2]

    # Color palette (BGR)
    pothole_color = (0, 140, 255)  # Orange for potholes
    generic_color = (0, 255, 128)  # Green for other classes

    for box in boxes:
        conf = float(box.conf[0])
        if conf < conf_thresh:
            continue

        cls_id = int(box.cls[0])
        cls_name = model_names.get(cls_id, f"class_{cls_id}")

        # Coordinates
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        x1 = max(0, min(w - 1, x1))
        y1 = max(0, min(h - 1, y1))
        x2 = max(0, min(w - 1, x2))
        y2 = max(0, min(h - 1, y2))

        box_color = pothole_color if "pothole" in cls_name.lower() else generic_color
        cv2.rectangle(canvas, (x1, y1), (x2, y2), box_color, 2)

        # Label tag: "pothole 0.85"
        tag_text = f"{cls_name} {conf:.2f}"
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.45
        thickness = 1
        (tw, th), baseline = cv2.getTextSize(tag_text, font, font_scale, thickness)

        tag_y1 = max(0, y1 - th - baseline - 4)
        tag_y2 = tag_y1 + th + baseline + 4
        tag_x2 = min(w, x1 + tw + 6)

        cv2.rectangle(canvas, (x1, tag_y1), (tag_x2, tag_y2), box_color, cv2.FILLED)
        cv2.putText(
            canvas,
            tag_text,
            (x1 + 3, tag_y2 - baseline - 2),
            font,
            font_scale,
            (0, 0, 0) if box_color == pothole_color else (255, 255, 255),
            thickness,
            cv2.LINE_AA,
        )

    return canvas


def main():
    parser = argparse.ArgumentParser(description="Evaluate trained YOLO11 model on test split.")
    parser.add_argument(
        "--model",
        default="models/pothole_yolo11n.pt",
        help="Path to trained model weights (default: models/pothole_yolo11n.pt)",
    )
    parser.add_argument(
        "--data-yaml",
        default="dataset/roboflow/data.yaml",
        help="Path to data.yaml (default: dataset/roboflow/data.yaml)",
    )
    parser.add_argument(
        "--output-dir",
        default="results/images/test_predictions",
        help="Directory to save prediction images (default: results/images/test_predictions)",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Image size for inference and evaluation (default: 640)",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.25,
        help="Confidence threshold for detection (default: 0.25)",
    )
    parser.add_argument(
        "--num-preview",
        type=int,
        default=10,
        help="Number of test images to save predictions for (default: 10)",
    )
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        print(f"Error: Model weights file not found: {model_path.resolve()}", file=sys.stderr)
        print("Please ensure the trained model exists before running evaluation.", file=sys.stderr)
        sys.exit(1)

    data_cfg = load_data_config(args.data_yaml)
    test_dir = data_cfg["test_dir"]
    class_names = data_cfg["class_names"]

    if not test_dir.exists():
        print(f"Error: Test directory not found: {test_dir}", file=sys.stderr)
        sys.exit(1)

    test_images = sorted([
        f for f in test_dir.iterdir()
        if f.is_file() and f.suffix.lower() in [".jpg", ".jpeg", ".png"]
    ])
    total_test_images = len(test_images)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("==================================================")
    print("       RAAHI YOLO11 Model Test & Evaluation       ")
    print("==================================================")
    print(f"Model Path:            {model_path.resolve()}")
    print(f"Data Configuration:    {Path(args.data_yaml).resolve()}")
    print(f"Test Directory:        {test_dir}")
    print(f"Total Test Images:     {total_test_images}")
    print(f"Confidence Threshold:  {args.conf}")
    print(f"Image Size:            {args.imgsz}")
    print(f"Output Directory:      {out_dir.resolve()}")
    print("--------------------------------------------------")

    # Import Ultralytics inside main so that CLI help / parse works anywhere
    from ultralytics import YOLO
    import torch

    # Check device
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"
    print(f"Compute Device:        {device}")

    # Load Model
    print("\nLoading model...")
    model = YOLO(str(model_path))

    # 1. Quantitative Evaluation on Test Split
    print("\nRunning formal test split evaluation (model.val)...")
    val_results = model.val(
        data=args.data_yaml,
        split="test",
        imgsz=args.imgsz,
        conf=args.conf,
        device=device,
        verbose=False,
    )

    metrics = val_results.results_dict
    precision = metrics.get("metrics/precision(B)", 0.0)
    recall = metrics.get("metrics/recall(B)", 0.0)
    map50 = metrics.get("metrics/mAP50(B)", 0.0)
    map50_95 = metrics.get("metrics/mAP50-95(B)", 0.0)

    # 2. Qualitative Prediction on 10 Selected Test Images
    print(f"\nGenerating predictions on {args.num_preview} test images...")
    preview_images = test_images[:args.num_preview]
    qualitative_results = []

    for idx, img_path in enumerate(preview_images, start=1):
        image = cv2.imread(str(img_path))
        if image is None:
            continue

        results = model.predict(
            source=image,
            imgsz=args.imgsz,
            conf=args.conf,
            device=device,
            verbose=False,
        )[0]

        boxes = results.boxes
        model_names = model.names if hasattr(model, "names") else {i: name for i, name in enumerate(class_names)}
        drawn_image = draw_predictions(image, boxes, model_names, conf_thresh=args.conf)

        out_name = f"test_pred_{idx:02d}.jpg"
        out_path = out_dir / out_name
        cv2.imwrite(str(out_path), drawn_image)

        # Inspect detections
        detected_potholes = 0
        detected_classes = []
        confs = []
        for box in boxes:
            c_id = int(box.cls[0])
            c_name = model_names.get(c_id, f"class_{c_id}")
            c_score = float(box.conf[0])
            confs.append(round(c_score, 3))
            detected_classes.append(c_name)
            if "pothole" in c_name.lower():
                detected_potholes += 1

        qualitative_results.append({
            "index": idx,
            "preview_file": out_name,
            "source_image": img_path.name,
            "pothole_detected": detected_potholes > 0,
            "pothole_count": detected_potholes,
            "total_detections": len(boxes),
            "confidence_scores": confs,
            "classes": detected_classes,
        })

    # Print Evaluation Summary
    print("\n==================================================")
    print("               TEST EVALUATION REPORT             ")
    print("==================================================")
    print(f"Model:                 {model_path.resolve()}")
    print(f"Total Test Images:     {total_test_images}")
    print(f"Precision:             {precision:.4f}")
    print(f"Recall:                {recall:.4f}")
    print(f"mAP@50:                {map50:.4f}")
    print(f"mAP@50-95:             {map50_95:.4f}")
    print("--------------------------------------------------")
    print("Qualitative Predictions (10 Preview Images):")
    for r in qualitative_results:
        status = "YES" if r["pothole_detected"] else "NO"
        print(
            f" [{r['index']:02d}] {r['preview_file']} <- {r['source_image']}\n"
            f"      Pothole Detected: {status} (Count: {r['pothole_count']}, Total Objects: {r['total_detections']})\n"
            f"      Confidence Scores: {r['confidence_scores']}\n"
            f"      Detected Classes: {r['classes']}"
        )

    print("\nPrediction previews saved to:")
    print(f"  {out_dir.resolve()}/")
    print("==================================================")


if __name__ == "__main__":
    main()
