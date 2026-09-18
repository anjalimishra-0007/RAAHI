#!/usr/bin/env python3
"""
scripts/benchmark_traffic_perception.py
======================================
Comprehensive benchmark suite for RAAHI-Edge Dual Perception Pipeline:
- Pothole YOLO11n (models/pothole_yolo11n.pt) on Apple MPS
- Vehicle YOLO11n (models/yolo11n.pt) + ByteTrack on Apple MPS
- Cadence evaluation (Stride 1=every frame, Stride 2=every 2nd frame, Stride 3=every 3rd frame)
- Hardware metrics: CPU, RAM, Latency (mean, median, p95), FPS throughput
"""

import os
import sys
import time
from pathlib import Path
import numpy as np
import psutil
import torch
import cv2

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from inference.yolo_detector import YOLODetector
from traffic.vehicle_tracker import VehicleTracker
from traffic.metrics import TrafficMetrics
from ring_buffer.rolling_buffer import RollingFrameBuffer
from events.event_engine import EventEngine
from gps.gps_manager import GpsManager

NUM_WARMUP = 10
NUM_BENCH_FRAMES = 120
FRAME_SHAPE = (1080, 1920, 3)

def generate_test_frames(count=120):
    """Generates synthetic 1080p frames containing simulated vehicles."""
    frames = []
    for i in range(count):
        # Base road frame
        frame = np.full(FRAME_SHAPE, 40, dtype=np.uint8)
        # Draw road asphalt area
        cv2.rectangle(frame, (100, 400), (1820, 1080), (60, 60, 60), -1)
        # Moving vehicle 1 (car moving downwards)
        y1 = 450 + (i * 4) % 500
        cv2.rectangle(frame, (800, y1), (980, y1 + 140), (180, 180, 180), -1)
        # Moving vehicle 2 (truck on right lane)
        y2 = 500 + (i * 3) % 450
        cv2.rectangle(frame, (1200, y2), (1450, y2 + 200), (120, 140, 160), -1)
        # Static parked car on left
        cv2.rectangle(frame, (250, 700), (450, 840), (200, 150, 100), -1)
        frames.append(frame)
    return frames

def run_benchmark():
    print("=================================================================")
    print("      RAAHI-EDGE DUAL PERCEPTION & CADENCE BENCHMARK")
    print("=================================================================")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Platform:         macOS (Apple Silicon)")
    print(f"PyTorch Device:   {device.upper()}")
    print(f"Test Resolution:  {FRAME_SHAPE[1]}x{FRAME_SHAPE[0]} (1080p full physical frame)")
    print(f"Sample Count:     {NUM_BENCH_FRAMES} frames per scenario")
    print("=================================================================\n")

    frames = generate_test_frames(NUM_BENCH_FRAMES + NUM_WARMUP)

    # 1. Standalone Pothole YOLO
    print("[1/5] Benchmarking Standalone Pothole YOLO11n...")
    pothole_detector = YOLODetector(model_path="models/pothole_yolo11n.pt", conf_threshold=0.35)
    
    # Warmup
    for f in frames[:NUM_WARMUP]:
        _ = pothole_detector.detect(f)
        
    pothole_latencies = []
    t_start = time.perf_counter()
    for f in frames[NUM_WARMUP:]:
        t0 = time.perf_counter()
        _ = pothole_detector.detect(f)
        pothole_latencies.append((time.perf_counter() - t0) * 1000.0)
    pothole_total_sec = time.perf_counter() - t_start
    pothole_fps = len(pothole_latencies) / pothole_total_sec

    # 2. Standalone Vehicle YOLO + ByteTrack
    print("[2/5] Benchmarking Standalone Vehicle YOLO11n + ByteTrack...")
    vehicle_tracker = VehicleTracker(model_path="models/yolo11n.pt", conf=0.30)
    
    # Warmup
    for f in frames[:NUM_WARMUP]:
        _ = vehicle_tracker.track(f)
        
    vehicle_tracker.reset_session()
    vehicle_infer_latencies = []
    bytetrack_latencies = []
    vehicle_total_latencies = []
    t_start = time.perf_counter()
    for f in frames[NUM_WARMUP:]:
        t0 = time.perf_counter()
        tracks, metrics = vehicle_tracker.track(f)
        vehicle_total_latencies.append((time.perf_counter() - t0) * 1000.0)
        vehicle_infer_latencies.append(vehicle_tracker.last_inference_ms)
        bytetrack_latencies.append(vehicle_tracker.last_bytetrack_ms)
    vehicle_total_sec = time.perf_counter() - t_start
    vehicle_standalone_fps = len(vehicle_total_latencies) / vehicle_total_sec

    # 3. Concurrent Pipeline at Cadence Stride 1 (Every Frame)
    print("[3/5] Benchmarking Concurrent Pipeline: Stride 1 (Both models on every frame)...")
    vehicle_tracker.reset_session()
    s1_cycle_latencies = []
    t_start = time.perf_counter()
    for f in frames[NUM_WARMUP:]:
        t0 = time.perf_counter()
        _ = pothole_detector.detect(f)
        _ = vehicle_tracker.track(f)
        s1_cycle_latencies.append((time.perf_counter() - t0) * 1000.0)
    s1_total_sec = time.perf_counter() - t_start
    s1_fps = len(s1_cycle_latencies) / s1_total_sec

    # 4. Concurrent Pipeline at Cadence Stride 2 (Pothole @ 30fps, Vehicle @ 15fps)
    print("[4/5] Benchmarking Concurrent Pipeline: Stride 2 (Vehicle every 2nd frame)...")
    vehicle_tracker.reset_session()
    s2_cycle_latencies = []
    t_start = time.perf_counter()
    for idx, f in enumerate(frames[NUM_WARMUP:]):
        t0 = time.perf_counter()
        _ = pothole_detector.detect(f)
        if idx % 2 == 0:
            _ = vehicle_tracker.track(f)
        s2_cycle_latencies.append((time.perf_counter() - t0) * 1000.0)
    s2_total_sec = time.perf_counter() - t_start
    s2_fps = len(s2_cycle_latencies) / s2_total_sec

    # 5. Concurrent Pipeline at Cadence Stride 3 (Pothole @ 30fps, Vehicle @ 10fps)
    print("[5/5] Benchmarking Concurrent Pipeline: Stride 3 (Vehicle every 3rd frame)...")
    vehicle_tracker.reset_session()
    s3_cycle_latencies = []
    t_start = time.perf_counter()
    for idx, f in enumerate(frames[NUM_WARMUP:]):
        t0 = time.perf_counter()
        _ = pothole_detector.detect(f)
        if idx % 3 == 0:
            _ = vehicle_tracker.track(f)
        s3_cycle_latencies.append((time.perf_counter() - t0) * 1000.0)
    s3_total_sec = time.perf_counter() - t_start
    s3_fps = len(s3_cycle_latencies) / s3_total_sec

    # System resources
    proc = psutil.Process(os.getpid())
    rss_mb = proc.memory_info().rss / (1024 * 1024)
    cpu_pct = proc.cpu_percent(interval=0.1)

    print("\n=================================================================")
    print("                    PERFORMANCE BENCHMARK RESULTS")
    print("=================================================================")
    print("1. STANDALONE POTHOLE YOLO11n (Apple MPS):")
    print(f"   Mean Latency:       {np.mean(pothole_latencies):.2f} ms")
    print(f"   Median Latency:     {np.median(pothole_latencies):.2f} ms")
    print(f"   p95 Latency:        {np.percentile(pothole_latencies, 95):.2f} ms")
    print(f"   Pure Throughput:    {pothole_fps:.1f} FPS")

    print("\n2. STANDALONE VEHICLE YOLO11n + BYTETRACK (Apple MPS):")
    print(f"   YOLO Inference:     {np.mean(vehicle_infer_latencies):.2f} ms (p95: {np.percentile(vehicle_infer_latencies, 95):.2f} ms)")
    print(f"   ByteTrack Overhead: {np.mean(bytetrack_latencies):.2f} ms (p95: {np.percentile(bytetrack_latencies, 95):.2f} ms)")
    print(f"   Combined Mean:      {np.mean(vehicle_total_latencies):.2f} ms (p95: {np.percentile(vehicle_total_latencies, 95):.2f} ms)")
    print(f"   Pure Throughput:    {vehicle_standalone_fps:.1f} FPS")

    print("\n3. PIPELINE CADENCE COMPARISON (Apple MPS Contention Profile):")
    print(f"   [Stride 1 - 100% Every Frame]:  Cycle: {np.mean(s1_cycle_latencies):.2f} ms | Max FPS: {s1_fps:.1f} FPS")
    print(f"   [Stride 2 - 50% Alternate]:     Cycle: {np.mean(s2_cycle_latencies):.2f} ms | Max FPS: {s2_fps:.1f} FPS (RECOMMENDED)")
    print(f"   [Stride 3 - 33% Every 3rd]:     Cycle: {np.mean(s3_cycle_latencies):.2f} ms | Max FPS: {s3_fps:.1f} FPS (LIGHTWEIGHT)")

    print("\n4. SYSTEM RESOURCE UTILIZATION:")
    print(f"   Process RSS Memory: {rss_mb:.1f} MB")
    print(f"   Process CPU Usage:  {cpu_pct:.1f}%")
    print("=================================================================")

if __name__ == "__main__":
    run_benchmark()
