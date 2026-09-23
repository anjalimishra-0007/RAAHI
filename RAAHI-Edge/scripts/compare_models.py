import hashlib
import os
import torch
from ultralytics import YOLO

MODEL_A_PATH = "/Users/ujjwalraj/Desktop/RAAHIback/raahi-pothole-detection/models/pothole_yolo11n.pt"
MODEL_B_PATH = "/Users/ujjwalraj/Desktop/RAAHI/raahi-pothole-detection/runs/detect/runs/pothole_yolo11n/weights/best.pt"
TEST_IMG = "/Users/ujjwalraj/.gemini/antigravity-ide/brain/fefff03a-0dc8-499b-96e5-2af0e971252e/live_test_frame.jpg"

def sha256_file(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

print("=== 1. FILE & CHECKPOINT INSPECTION ===")
for name, path in [("Model A (RAAHIback)", MODEL_A_PATH), ("Model B (Canonical RAAHI)", MODEL_B_PATH)]:
    print(f"\n--- {name} ---")
    print(f"Path: {path}")
    size = os.path.getsize(path)
    print(f"Size: {size:,} bytes ({size / (1024*1024):.2f} MB)")
    print(f"SHA256: {sha256_file(path)}")
    
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    print(f"Checkpoint keys: {list(ckpt.keys())}")
    print(f"Epoch: {ckpt.get('epoch')}")
    print(f"Best fitness: {ckpt.get('best_fitness')}")
    print(f"Date: {ckpt.get('date')}")
    print(f"Version: {ckpt.get('version')}")
    
    train_args = ckpt.get("train_args")
    if train_args:
        print(f"Train Args:")
        for k in ["model", "data", "epochs", "batch", "imgsz", "device", "optimizer"]:
            print(f"  {k}: {train_args.get(k)}")
            
    # Check model architecture
    model_obj = ckpt.get("model")
    if model_obj:
        params = sum(p.numel() for p in model_obj.parameters())
        print(f"Parameters: {params:,}")
        if hasattr(model_obj, "names"):
            print(f"Class names: {model_obj.names}")

print("\n=== 2. WEIGHT COMPARISON ===")
ckpt_a = torch.load(MODEL_A_PATH, map_location="cpu", weights_only=False)
ckpt_b = torch.load(MODEL_B_PATH, map_location="cpu", weights_only=False)

model_a = ckpt_a["model"]
# model_b might be in ckpt_b["ema"] or ckpt_b["model"]
model_b = ckpt_b.get("ema") or ckpt_b["model"]

state_a = model_a.state_dict()
state_b = model_b.state_dict()

print(f"State dict keys: A={len(state_a)}, B={len(state_b)}")
common_keys = set(state_a.keys()).intersection(set(state_b.keys()))
print(f"Common parameter keys: {len(common_keys)}")

max_diff = 0.0
total_diff = 0.0
total_elements = 0
differing_keys = 0

for k in common_keys:
    t_a = state_a[k].float()
    t_b = state_b[k].float()
    if t_a.shape != t_b.shape:
        print(f"Shape mismatch in {k}: {t_a.shape} vs {t_b.shape}")
        continue
    diff = (t_a - t_b).abs()
    curr_max = diff.max().item()
    if curr_max > max_diff:
        max_diff = curr_max
    if curr_max > 1e-5:
        differing_keys += 1
    total_diff += diff.sum().item()
    total_elements += diff.numel()

print(f"Differing keys (>1e-5): {differing_keys} / {len(common_keys)}")
print(f"Max absolute parameter difference: {max_diff}")
print(f"Mean absolute parameter difference: {total_diff / max(1, total_elements)}")

print("\n=== 3. MPS INFERENCE & BENCHMARK ON REAL FRAME ===")
import time
import numpy as np
import cv2

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Benchmark Device: {device}")

img = cv2.imread(TEST_IMG)
if img is None:
    print("Warning: TEST_IMG not found, creating synthetic 1080p frame for speed comparison")
    img = np.zeros((1080, 1920, 3), dtype=np.uint8)

yolo_a = YOLO(MODEL_A_PATH)
yolo_b = YOLO(MODEL_B_PATH)

# Warmup
for _ in range(10):
    _ = yolo_a(img, device=device, verbose=False)
    _ = yolo_b(img, device=device, verbose=False)

N = 50
t0 = time.perf_counter()
for _ in range(N):
    res_a = yolo_a(img, device=device, verbose=False)
t1 = time.perf_counter()
lat_a = (t1 - t0) / N * 1000

t0 = time.perf_counter()
for _ in range(N):
    res_b = yolo_b(img, device=device, verbose=False)
t1 = time.perf_counter()
lat_b = (t1 - t0) / N * 1000

print(f"Model A Inference Latency: {lat_a:.2f} ms ({1000/lat_a:.1f} FPS)")
print(f"Model B Inference Latency: {lat_b:.2f} ms ({1000/lat_b:.1f} FPS)")

# Compare detections
boxes_a = res_a[0].boxes
boxes_b = res_b[0].boxes

print(f"\nModel A detections on test frame: {len(boxes_a)}")
for box in boxes_a:
    print(f"  Class {int(box.cls[0])}: conf={float(box.conf[0]):.4f}, xyxy={box.xyxy[0].tolist()}")

print(f"\nModel B detections on test frame: {len(boxes_b)}")
for box in boxes_b:
    print(f"  Class {int(box.cls[0])}: conf={float(box.conf[0]):.4f}, xyxy={box.xyxy[0].tolist()}")
