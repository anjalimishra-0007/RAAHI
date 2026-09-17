#!/usr/bin/env python3
"""
Visualizes YOLO-formatted annotations on sample images from the RAAHI dataset.
Draws bounding boxes and labels with class names and IDs, validating coordinates
and saving preview images to results/images/dataset_preview/.
"""

import os
import sys
import random
import argparse
from pathlib import Path
import yaml
import cv2
import numpy as np


def load_dataset_config(yaml_path: str):
    """Load and parse the dataset configuration yaml."""
    yaml_file = Path(yaml_path)
    if not yaml_file.exists():
        raise FileNotFoundError(f"Configuration file not found: {yaml_path}")

    with open(yaml_file, "r") as f:
        config = yaml.safe_load(f)

    base_dir = yaml_file.parent
    train_dir = (base_dir / config.get("train", "train/images")).resolve()
    val_dir = (base_dir / config.get("val", "valid/images")).resolve()
    test_dir = (base_dir / config.get("test", "test/images")).resolve()

    class_names = config.get("names", [])
    nc = config.get("nc", len(class_names))

    return {
        "config": config,
        "base_dir": base_dir,
        "train_dir": train_dir,
        "val_dir": val_dir,
        "test_dir": test_dir,
        "class_names": class_names,
        "nc": nc,
    }


def get_color_palette(num_classes: int):
    """Generate visually distinct colors for each class."""
    colors = [
        (31, 119, 180),   # Blue
        (255, 127, 14),   # Orange
        (44, 160, 44),    # Green
        (214, 39, 40),    # Red
        (148, 103, 189),  # Purple
        (140, 86, 75),    # Brown
        (0, 165, 255),    # Vibrant Orange (Pothole)
        (23, 190, 207),   # Cyan
    ]
    while len(colors) < num_classes:
        colors.append(tuple(random.randint(50, 220) for _ in range(3)))
    return colors


def validate_and_parse_annotations(
    label_path: Path, img_w: int, img_h: int, num_classes: int, class_names: list
):
    """
    Parses and validates label lines from a YOLO format annotation file.
    Returns parsed_boxes, valid_count, invalid_count, problems.
    """
    parsed_boxes = []
    valid_count = 0
    invalid_count = 0
    problems = []

    if not label_path.exists():
        problems.append(f"Missing label file: {label_path.name}")
        return parsed_boxes, valid_count, invalid_count, problems

    with open(label_path, "r") as f:
        lines = [line.strip() for line in f if line.strip()]

    for line_idx, line in enumerate(lines, start=1):
        parts = line.split()

        # YOLO standard detection format: class_id x_center y_center width height (5 elements)
        if len(parts) != 5:
            invalid_count += 1
            problems.append(
                f"{label_path.name}: Line {line_idx} has {len(parts)} values (expected 5 for YOLO detection bbox)."
            )
            continue

        try:
            class_id = int(parts[0])
            x_center = float(parts[1])
            y_center = float(parts[2])
            width = float(parts[3])
            height = float(parts[4])
        except ValueError as err:
            invalid_count += 1
            problems.append(
                f"{label_path.name}: Line {line_idx} parsing error: {err}"
            )
            continue

        # Check class_id range
        if class_id < 0 or class_id >= num_classes:
            invalid_count += 1
            problems.append(
                f"{label_path.name}: Line {line_idx} class ID {class_id} outside valid range [0, {num_classes - 1}]."
            )
            continue

        # Check normalized range
        coords = [("x_center", x_center), ("y_center", y_center), ("width", width), ("height", height)]
        out_of_range = [name for name, val in coords if not (0.0 <= val <= 1.0)]
        if out_of_range:
            invalid_count += 1
            problems.append(
                f"{label_path.name}: Line {line_idx} coordinates outside [0.0, 1.0]: {out_of_range}"
            )
            continue

        # Check positive width and height
        if width <= 0 or height <= 0:
            invalid_count += 1
            problems.append(
                f"{label_path.name}: Line {line_idx} non-positive dimensions (w={width}, h={height})."
            )
            continue

        # Convert to pixel coordinates
        x_min = (x_center - width / 2.0) * img_w
        y_min = (y_center - height / 2.0) * img_h
        x_max = (x_center + width / 2.0) * img_w
        y_max = (y_center + height / 2.0) * img_h

        # Check boundary adherence
        boundary_flags = []
        if x_min < 0 or y_min < 0 or x_max > img_w or y_max > img_h:
            boundary_flags.append(
                f"Box exceeds boundary: xmin={x_min:.1f}, ymin={y_min:.1f}, xmax={x_max:.1f}, ymax={y_max:.1f} (image {img_w}x{img_h})"
            )

        # Clamped pixel coordinates for rendering
        px_x1 = max(0, min(img_w - 1, int(round(x_min))))
        px_y1 = max(0, min(img_h - 1, int(round(y_min))))
        px_x2 = max(0, min(img_w - 1, int(round(x_max))))
        px_y2 = max(0, min(img_h - 1, int(round(y_max))))

        cls_name = class_names[class_id] if class_id < len(class_names) else f"class_{class_id}"

        valid_count += 1
        parsed_boxes.append({
            "class_id": class_id,
            "class_name": cls_name,
            "x_center": x_center,
            "y_center": y_center,
            "width": width,
            "height": height,
            "px_box": (px_x1, px_y1, px_x2, px_y2),
            "boundary_warnings": boundary_flags,
        })

    return parsed_boxes, valid_count, invalid_count, problems


def draw_bounding_boxes(image: np.ndarray, boxes: list, colors: list) -> np.ndarray:
    """Renders high-visibility bounding boxes and tags on the image."""
    canvas = image.copy()

    for item in boxes:
        cid = item["class_id"]
        cname = item["class_name"]
        x1, y1, x2, y2 = item["px_box"]
        color = colors[cid % len(colors)]

        # Draw box
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, thickness=2)

        # Draw tag with class name and ID
        label_text = f"{cname} [{cid}]"
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.5
        font_thickness = 1
        (tw, th), baseline = cv2.getTextSize(label_text, font, font_scale, font_thickness)

        tag_y1 = max(0, y1 - th - baseline - 4)
        tag_y2 = tag_y1 + th + baseline + 4
        tag_x2 = min(canvas.shape[1], x1 + tw + 6)

        # Tag background
        cv2.rectangle(canvas, (x1, tag_y1), (tag_x2, tag_y2), color, cv2.FILLED)

        # Tag text in white or dark depending on color brightness
        brightness = (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000
        text_color = (0, 0, 0) if brightness > 150 else (255, 255, 255)

        cv2.putText(
            canvas,
            label_text,
            (x1 + 3, tag_y2 - baseline - 2),
            font,
            font_scale,
            text_color,
            font_thickness,
            cv2.LINE_AA,
        )

    return canvas


def main():
    parser = argparse.ArgumentParser(description="Dataset preview and validation utility for RAAHI.")
    parser.add_argument(
        "--data-yaml",
        default="dataset/roboflow/data.yaml",
        help="Path to data.yaml file (default: dataset/roboflow/data.yaml)",
    )
    parser.add_argument(
        "--output-dir",
        default="results/images/dataset_preview",
        help="Directory to save preview images",
    )
    parser.add_argument(
        "--num-samples",
        type=int,
        default=10,
        help="Number of images to randomly visualize (default: 10)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    args = parser.parse_args()

    random.seed(args.seed)

    print("==================================================")
    print("      RAAHI Dataset Visualization & Validation     ")
    print("==================================================")

    # 1. Load config
    cfg = load_dataset_config(args.data_yaml)
    class_names = cfg["class_names"]
    nc = cfg["nc"]
    train_img_dir = Path(cfg["train_dir"])
    train_lbl_dir = train_img_dir.parent / "labels"

    print(f"Data YAML:               {Path(args.data_yaml).resolve()}")
    print(f"Number of Classes:       {nc}")
    print(f"Class Names:             {class_names}")
    print(f"Train Image Directory:   {train_img_dir}")
    print(f"Validation Image Dir:    {cfg['val_dir']}")
    print(f"Test Image Directory:    {cfg['test_dir']}")
    print(f"Train Label Directory:   {train_lbl_dir}")
    print("--------------------------------------------------")

    if not train_img_dir.exists():
        print(f"Error: Train image directory does not exist: {train_img_dir}", file=sys.stderr)
        sys.exit(1)
    if not train_lbl_dir.exists():
        print(f"Error: Train label directory does not exist: {train_lbl_dir}", file=sys.stderr)
        sys.exit(1)

    # Output directory setup
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Collect candidate image files
    all_img_files = sorted([
        f for f in train_img_dir.iterdir()
        if f.is_file() and f.suffix.lower() in [".jpg", ".jpeg", ".png"]
    ])

    print(f"Total training images found: {len(all_img_files)}")

    # Prefer images with non-empty annotations
    annotated_candidates = []
    for img_f in all_img_files:
        lbl_f = train_lbl_dir / f"{img_f.stem}.txt"
        if lbl_f.exists() and lbl_f.stat().st_size > 0:
            annotated_candidates.append(img_f)

    print(f"Images with non-empty label files: {len(annotated_candidates)}")

    pool = annotated_candidates if len(annotated_candidates) >= args.num_samples else all_img_files
    selected_images = sorted(random.sample(pool, min(args.num_samples, len(pool))))

    print(f"Randomly selected {len(selected_images)} images for preview (seed={args.seed}).")
    print("--------------------------------------------------")

    colors = get_color_palette(nc)

    total_images_checked = 0
    total_labels_checked = 0
    total_valid_annotations = 0
    total_invalid_annotations = 0
    all_problems = []
    preview_summary = []

    for idx, img_path in enumerate(selected_images, start=1):
        total_images_checked += 1
        label_path = train_lbl_dir / f"{img_path.stem}.txt"

        # Check label existence
        if label_path.exists():
            total_labels_checked += 1
        else:
            all_problems.append(f"{img_path.name}: Corresponding label file missing!")

        # Load image with OpenCV
        image = cv2.imread(str(img_path))
        if image is None:
            all_problems.append(f"{img_path.name}: Failed to read image with OpenCV.")
            continue

        img_h, img_w = image.shape[:2]

        # Validate & parse annotations
        boxes, val_cnt, inval_cnt, problems = validate_and_parse_annotations(
            label_path, img_w, img_h, nc, class_names
        )

        total_valid_annotations += val_cnt
        total_invalid_annotations += inval_cnt
        all_problems.extend(problems)

        # Collect any boundary warnings
        for b in boxes:
            if b["boundary_warnings"]:
                all_problems.extend(b["boundary_warnings"])

        # Render bounding boxes
        visualized = draw_bounding_boxes(image, boxes, colors)

        # Add image filename watermark on top-left
        watermark = f"{img_path.name} | {img_w}x{img_h} | {len(boxes)} obj"
        cv2.putText(
            visualized,
            watermark,
            (10, 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 255, 255),
            1,
            cv2.LINE_AA,
        )

        out_name = f"preview_{idx:02d}.jpg"
        out_path = out_dir / out_name
        cv2.imwrite(str(out_path), visualized)

        class_counts = {}
        for b in boxes:
            c = b["class_name"]
            class_counts[c] = class_counts.get(c, 0) + 1
        class_summary_str = ", ".join([f"{k}: {v}" for k, v in class_counts.items()]) if class_counts else "no objects"

        preview_summary.append({
            "index": idx,
            "file": out_name,
            "source_image": img_path.name,
            "dimensions": f"{img_w}x{img_h}",
            "objects": len(boxes),
            "classes": class_summary_str,
        })

    # Summary Report
    print("\n==================================================")
    print("                 VALIDATION REPORT                ")
    print("==================================================")
    print(f"Images Checked:           {total_images_checked}")
    print(f"Labels Checked:           {total_labels_checked}")
    print(f"Valid Annotations:        {total_valid_annotations}")
    print(f"Invalid Annotations:      {total_invalid_annotations}")
    print(f"Problems Found:           {len(all_problems)}")

    if all_problems:
        print("\nProblems Detail:")
        for p in all_problems:
            print(f" - {p}")
    else:
        print("\nNo format, coordinate, or boundary problems found in selected samples!")

    print("\nGenerated Previews:")
    for s in preview_summary:
        print(f"  [{s['index']:02d}] {s['file']} <- {s['source_image']} ({s['dimensions']}) - {s['objects']} objects ({s['classes']})")

    print(f"\nAll preview images saved to: {out_dir.resolve()}/")
    print("==================================================")


if __name__ == "__main__":
    main()
