import time
import numpy as np
import cv2
import torch
import psutil
import os
from ultralytics import YOLO
from capture.rtsp_receiver import RTSPReceiver
from ring_buffer.rolling_buffer import RollingFrameBuffer
from gps.gps_manager import GpsManager
from events.event_engine import EventEngine

RTSP_URL = "rtsp://127.0.0.1:8555/live"
MODEL_PATH = "models/pothole_yolo11n.pt"
NUM_FRAMES = 150

def run_live_pipeline_benchmark():
    print("==================================================")
    print("      RAAHI-EDGE LIVE PIPELINE BENCHMARK")
    print("==================================================")
    print(f"RTSP Source: {RTSP_URL}")
    print(f"Model: {MODEL_PATH}")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Inference Device: {device}")
    
    # 1. Initialize components
    receiver = RTSPReceiver(rtsp_url=RTSP_URL, transport="tcp")
    ring_buffer = RollingFrameBuffer(target_duration_sec=2.0, max_capacity=90)
    gps_mgr = GpsManager(default_bus_id="RAAHI-001")
    event_eng = EventEngine(default_bus_id="RAAHI-001", spatial_radius_meters=10.0)
    detector = YOLO(MODEL_PATH)
    
    # Ingest a live GPS fix
    gps_mgr.ingest_sample(latitude=28.64878, longitude=77.50409, accuracy=10.0, speed=15.0, bus_id="RAAHI-001")
    
    # Start receiver
    print("\n[1/4] Starting RTSP receiver...")
    receiver.start()
    
    # Wait for first live frame
    t_wait_start = time.time()
    frame_ready = False
    while time.time() - t_wait_start < 5.0:
        ret, frame, meta = receiver.read(wait_for_new=True, timeout=1.0)
        if ret and frame is not None:
            frame_ready = True
            break
        time.sleep(0.05)
        
    if not frame_ready:
        print("FAIL: Could not receive live frame from RTSP stream within 5 seconds.")
        receiver.stop()
        return
        
    h, w, c = frame.shape
    print(f"PASS: Live RTSP Stream connected: {w}x{h} ({c} channels)")
    
    # Benchmark metrics
    frame_intervals = []
    ring_push_latencies = []
    yolo_latencies = []
    gps_match_latencies = []
    e2e_latencies = []
    
    last_frame_ts = time.perf_counter()
    process = psutil.Process(os.getpid())
    
    print(f"\n[2/4] Benchmarking {NUM_FRAMES} consecutive LIVE frames through full pipeline...")
    
    for i in range(NUM_FRAMES):
        t_cycle_start = time.perf_counter()
        
        # 1. Ingest frame
        ret, frame, meta = receiver.read(wait_for_new=True, timeout=1.0)
        t_after_read = time.perf_counter()
        
        if not ret or frame is None:
            continue
            
        inter_arrival = (t_after_read - last_frame_ts) * 1000.0
        last_frame_ts = t_after_read
        if i > 0:  # Skip first interval
            frame_intervals.append(inter_arrival)
            
        # 2. Ring buffer push
        t0 = time.perf_counter()
        ring_buffer.push(frame)
        ring_push_latencies.append((time.perf_counter() - t0) * 1000.0)
        
        # 3. YOLO11n inference on live frame
        t0 = time.perf_counter()
        results = detector(frame, device=device, verbose=False, conf=0.25)
        yolo_lat = (time.perf_counter() - t0) * 1000.0
        yolo_latencies.append(yolo_lat)
        
        # 4. GPS association & event package generation
        t0 = time.perf_counter()
        gps_match = gps_mgr.match_detection(detection_timestamp=time.time(), bus_id="RAAHI-001")
        pkg, suppressed, reason = event_eng.create_candidate_event(
            event_type="pothole",
            class_name="pothole",
            confidence=0.85,
            bbox={"x1": 100, "y1": 200, "x2": 300, "y2": 400},
            frame_number=i,
            gps_match=gps_match,
            bus_id="RAAHI-001"
        )
        gps_match_latencies.append((time.perf_counter() - t0) * 1000.0)
        
        # Total E2E
        t_cycle_end = time.perf_counter()
        e2e_latencies.append((t_cycle_end - t_cycle_start) * 1000.0)
        
        if (i + 1) % 30 == 0:
            print(f"  Processed {i+1}/{NUM_FRAMES} frames | Current YOLO: {yolo_lat:.1f}ms | Ring: {len(ring_buffer)} frames")

    # Clean up
    receiver.stop()
    
    print("\n[3/4] Ring Buffer Pre-buffer Extraction Benchmark...")
    t0 = time.perf_counter()
    extracted_frames = ring_buffer.get_pre_buffer_frames(duration_sec=2.0)
    extract_lat_ms = (time.perf_counter() - t0) * 1000.0
    print(f"Extracted {len(extracted_frames)} frames (2.0s pre-buffer) in {extract_lat_ms:.2f} ms")

    # 4. Results
    print("\n==================================================")
    print("              BENCHMARK RESULTS")
    print("==================================================")
    print(f"Resolution:                   {w}x{h}")
    print(f"Total Live Frames Analyzed:   {len(yolo_latencies)}")
    print("--- RTSP Stream Ingestion ---")
    print(f"Inter-frame Arrival (Mean):   {np.mean(frame_intervals):.2f} ms ({1000.0/np.mean(frame_intervals):.1f} FPS)")
    print(f"Inter-frame Jitter (StdDev): {np.std(frame_intervals):.2f} ms")
    print(f"Receiver Min / Max Interval:  {np.min(frame_intervals):.1f} ms / {np.max(frame_intervals):.1f} ms")
    
    print("\n--- Ring Buffer Operations ---")
    print(f"Push Latency (Mean):          {np.mean(ring_push_latencies):.3f} ms")
    print(f"Pre-buffer Extraction (2.0s): {extract_lat_ms:.2f} ms ({len(extracted_frames)} frames)")
    
    print("\n--- YOLO11n Inference (Apple Silicon MPS) ---")
    print(f"Mean Latency:                 {np.mean(yolo_latencies):.2f} ms")
    print(f"Median Latency:               {np.median(yolo_latencies):.2f} ms")
    print(f"95th Percentile:              {np.percentile(yolo_latencies, 95):.2f} ms")
    print(f"Min / Max:                    {np.min(yolo_latencies):.2f} ms / {np.max(yolo_latencies):.2f} ms")
    print(f"Pure Inference Throughput:    {1000.0/np.mean(yolo_latencies):.1f} FPS")
    
    print("\n--- GPS & Event Packaging ---")
    print(f"GPS Match & Debounce (Mean):  {np.mean(gps_match_latencies):.3f} ms")
    
    print("\n--- Complete Pipeline End-to-End ---")
    print(f"E2E Processing Latency:       {np.mean(e2e_latencies):.2f} ms")
    print(f"Full Pipeline Max Throughput: {1000.0/np.mean(e2e_latencies):.1f} FPS")
    
    mem_info = process.memory_info()
    print(f"\n--- System Resources ---")
    print(f"Process Resident Memory (RSS):{mem_info.rss / (1024*1024):.1f} MB")
    print(f"CPU Utilization:              {process.cpu_percent(interval=0.1):.1f}%")
    print("==================================================")

if __name__ == "__main__":
    run_live_pipeline_benchmark()
