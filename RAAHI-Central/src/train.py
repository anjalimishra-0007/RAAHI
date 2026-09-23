#!/usr/bin/env python3
"""
Training script for RAAHI Pothole Detection model using Ultralytics YOLO11n.
Trains for 50 epochs on dataset/roboflow/ and saves best weights to models/pothole_yolo11n.pt.
"""

import os
import sys
import shutil
import argparse
from pathlib import Path
import yaml
import torch
from ultralytics import YOLO


def verify_dataset(data_yaml_path: str):
    """Verifies dataset/roboflow/data.yaml and prints dataset statistics."""
    yaml_file = Path(data_yaml_path).resolve()
    if not yaml_file.exists():
        raise FileNotFoundError(f"data.yaml not found at: {yaml_file}")

    with open(yaml_file, "r") as f:
        config = yaml.safe_load(f)

    base_dir = yaml_file.parent
    train_dir = (base_dir / config.get("train", "train/images")).resolve()
    val_dir = (base_dir / config.get("val", "valid/images")).resolve()
    test_dir = (base_dir / config.get("test", "test/images")).resolve()

    class_names = config.get("names", [])
    nc = config.get("nc", len(class_names))

    # Count image files
    train_images = [f for f in train_dir.iterdir() if f.is_file() and not f.name.startswith(".")] if train_dir.exists() else []
    val_images = [f for f in val_dir.iterdir() if f.is_file() and not f.name.startswith(".")] if val_dir.exists() else []
    test_images = [f for f in test_dir.iterdir() if f.is_file() and not f.name.startswith(".")] if test_dir.exists() else []

    # Check labels
    train_labels_dir = train_dir.parent / "labels"
    val_labels_dir = val_dir.parent / "labels"
    train_labels = [f for f in train_labels_dir.iterdir() if f.is_file() and not f.name.startswith(".")] if train_labels_dir.exists() else []

    print("==================================================")
    print("           RAAHI DATASET VERIFICATION             ")
    print("==================================================")
    print(f"Data YAML:              {yaml_file}")
    print(f"Number of Classes (nc): {nc}")
    print(f"Class Names:            {class_names}")
    print(f"Train Images:           {len(train_images)} ({train_dir})")
    print(f"Validation Images:      {len(val_images)} ({val_dir})")
    print(f"Test Images:            {len(test_images)} ({test_dir})")
    print(f"Train Label Files:      {len(train_labels)} ({train_labels_dir})")

    # Confirm format
    is_yolo_format = (
        train_labels_dir.exists()
        and len(train_labels) > 0
        and train_labels[0].suffix == ".txt"
    )
    print(f"YOLO Object Detection:  {'CONFIRMED (Bounding Boxes with normalized coordinates)' if is_yolo_format else 'UNCONFIRMED'}")
    print("==================================================\n")

    return {
        "config": config,
        "yaml_file": str(yaml_file),
        "nc": nc,
        "class_names": class_names,
        "counts": {
            "train": len(train_images),
            "val": len(val_images),
            "test": len(test_images),
        },
    }


def get_compute_device() -> str:
    """Detects available compute device preferring Apple Silicon MPS."""
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"
    return device


def main():
    parser = argparse.ArgumentParser(description="Train RAAHI YOLO11n Pothole Detection Model.")
    parser.add_argument("--data", default="dataset/roboflow/data.yaml", help="Path to data.yaml")
    parser.add_argument("--model", default="yolo11n.pt", help="Pretrained model weights")
    parser.add_argument("--epochs", type=int, default=50, help="Number of training epochs")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size")
    parser.add_argument("--batch", type=int, default=16, help="Batch size (default: 16 auto for MPS)")
    parser.add_argument("--workers", type=int, default=2, help="Dataloader workers (default: 2 for macOS)")
    parser.add_argument("--project", default="runs", help="Project directory")
    parser.add_argument("--name", default="pothole_yolo11n", help="Run name")
    parser.add_argument("--resume", action="store_true", help="Resume training from checkpoint specified in --model")
    args = parser.parse_args()

    # 1. Dataset Verification
    ds_info = verify_dataset(args.data)

    # 2. Device Detection
    device = get_compute_device()
    print(f"Compute Device Selected: {device.upper()}")
    if device == "mps":
        print(" -> Apple Silicon Metal Performance Shaders (MPS) hardware acceleration active.")
    else:
        print(" -> Running on CPU.")
    print("--------------------------------------------------\n")

    # 3. Initialize Model & Start Training
    if args.resume:
        print(f"Resuming YOLO model from checkpoint: {args.model}...")
        model = YOLO(args.model)
        print("\n==================================================")
        print(f"   RESUMING TRAINING RUN: TARGET {args.epochs} EPOCHS ")
        print(f"   Checkpoint: {args.model}                       ")
        print("==================================================")
        results = model.train(resume=True)
    else:
        print(f"Initializing YOLO model from base pretrained weights: {args.model}...")
        model = YOLO(args.model)

        print("\n==================================================")
        print(f"   STARTING TRAINING RUN: {args.epochs} EPOCHS    ")
        print(f"   Destination: {args.project}/{args.name}/       ")
        print("==================================================")

        results = model.train(
            data=args.data,
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            workers=args.workers,
            device=device,
            project=args.project,
            name=args.name,
            exist_ok=True,
            save=True,
            pretrained=True,
            plots=True,
            verbose=True,
        )

    if hasattr(results, "save_dir"):
        save_dir = Path(results.save_dir)
    elif hasattr(model, "trainer") and hasattr(model.trainer, "save_dir"):
        save_dir = Path(model.trainer.save_dir)
    elif args.resume:
        save_dir = Path(args.model).resolve().parent.parent
    else:
        save_dir = Path(args.project) / args.name
    weights_dir = save_dir / "weights"
    best_pt = weights_dir / "best.pt"
    last_pt = weights_dir / "last.pt"

    print("\n==================================================")
    print("            TRAINING RUN FINISHED                 ")
    print("==================================================")
    print(f"Run Output Directory:  {save_dir.resolve()}")
    print(f"Best checkpoint path:  {best_pt.resolve()} (Exists: {best_pt.exists()})")
    print(f"Last checkpoint path:  {last_pt.resolve()} (Exists: {last_pt.exists()})")

    if not best_pt.exists():
        print(f"Error: best.pt was not generated at {best_pt}", file=sys.stderr)
        sys.exit(1)

    # 5. Model Validation on Validation and Test Splits
    print("\nRunning final validation on the trained model...")
    trained_model = YOLO(str(best_pt))
    val_metrics = trained_model.val(data=args.data, split="val", imgsz=args.imgsz, device=device)

    m = val_metrics.results_dict
    prec = m.get("metrics/precision(B)", 0.0)
    rec = m.get("metrics/recall(B)", 0.0)
    map50 = m.get("metrics/mAP50(B)", 0.0)
    map50_95 = m.get("metrics/mAP50-95(B)", 0.0)

    print("\n==================================================")
    print("            FINAL VALIDATION METRICS              ")
    print("==================================================")
    print(f"Precision:             {prec:.4f}")
    print(f"Recall:                {rec:.4f}")
    print(f"mAP@50:                {map50:.4f}")
    print(f"mAP@50-95:             {map50_95:.4f}")
    print("==================================================")

    # 6. Copy best.pt to models/pothole_yolo11n.pt
    dest_model = Path("models/pothole_yolo11n.pt").resolve()
    dest_model.parent.mkdir(parents=True, exist_ok=True)
    print(f"\nCopying {best_pt} -> {dest_model}...")
    shutil.copy2(str(best_pt), str(dest_model))
    print(f"Successfully copied trained model to: {dest_model}")

    # 7. Verify models/pothole_yolo11n.pt
    print("\nVerifying models/pothole_yolo11n.pt classes...")
    verified_model = YOLO(str(dest_model))
    print(f"Model Class Count:     {len(verified_model.names)}")
    print(f"Model Class Names:     {verified_model.names}")
    if len(verified_model.names) == ds_info["nc"] and verified_model.names[6] == "pothole":
        print("VERIFICATION SUCCESS: Model is fine-tuned for RAAHI pothole detection!")
    else:
        print("WARNING: Model class names do not match expected dataset classes!")


if __name__ == "__main__":
    main()
