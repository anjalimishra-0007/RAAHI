# RAAHI-Edge: Autonomous Edge AI Perception, Traffic Telemetry & Evidence Pipeline

> **Technical Architecture, Physical Deployment & Verification Manual**  
> **Project**: RAAHI — Road Asset & Hazard Assessment Interface  
> **Repository**: [https://github.com/iUjjwalRaj/RAAHI-Edge](https://github.com/iUjjwalRaj/RAAHI-Edge)  
> **Target Version**: Phase 2 Edge Perception Architecture (Commit: `55d7aaa`)  
> **Target Hardware Platform**: Apple Silicon MPS Compute Appliance + Samsung Galaxy S23 FE (SM-S711B) Optical/GNSS Sensing Node  
> **Document Status**: Production-Grade SIH Technical Reference  

---

## Document Table of Contents

1. [RAAHI-Edge Overview](#1-raahi-edge-overview)
2. [Complete System Architecture](#2-complete-system-architecture)
3. [Edge vs. Central Responsibilities](#3-edge-vs-central-responsibilities)
4. [Hardware and Physical Deployment](#4-hardware-and-physical-deployment)
5. [Android RAAHI-Eye Integration](#5-android-raahi-eye-integration)
6. [RTSP and Video Ingestion](#6-rtsp-and-video-ingestion)
7. [Pothole Detection Subsystem](#7-pothole-detection-subsystem)
8. [Vehicle Detection Subsystem](#8-vehicle-detection-subsystem)
9. [ByteTrack Multi-Object Tracking Engine](#9-bytetrack-multi-object-tracking-engine)
10. [Traffic Intelligence Subsystem](#10-traffic-intelligence-subsystem)
11. [Traffic Congestion Event Generation](#11-traffic-congestion-event-generation)
12. [Event Engine & Packaging](#12-event-engine--packaging)
13. [GNSS / GPS Association Engine](#13-gnss--gps-association-engine)
14. [Evidence Capture & 15-Second Clip Lifecycle](#14-evidence-capture--15-second-clip-lifecycle)
15. [SQLite Local Storage Architecture & Retention](#15-sqlite-local-storage-architecture--retention)
16. [Offline-First Transmission Queue Daemon](#16-offline-first-transmission-queue-daemon)
17. [Edge-to-Central Communication Contract](#17-edge-to-central-communication-contract)
18. [Edge Operator Dashboard Architecture](#18-edge-operator-dashboard-architecture)
19. [Dashboard Telemetry & State Streaming](#19-dashboard-telemetry--state-streaming)
20. [Performance Benchmarks & Profiling Data](#20-performance-benchmarks--profiling-data)
21. [Automated & Integration Test Suites](#21-automated--integration-test-suites)
22. [Physical Device Validation (Samsung Galaxy S23 FE)](#22-physical-device-validation-samsung-galaxy-s23-fe)
23. [Reliability, Fault Tolerance & Recovery Mechanics](#23-reliability-fault-tolerance--recovery-mechanics)
24. [End-to-End Operational Data Flows](#24-end-to-end-operational-data-flows)
25. [Security, Privacy & Minimization Controls](#25-security-privacy--minimization-controls)
26. [Resource Economics & Central Cost Rationale](#26-resource-economics--central-cost-rationale)
27. [Current Architectural Limitations](#27-current-architectural-limitations)
28. [Future Engineering Roadmap](#28-future-engineering-roadmap)
29. [Repository Tree & Module Index](#29-repository-tree--module-index)
30. [Installation & Environment Setup](#30-installation--environment-setup)
31. [Operational Startup Sequence](#31-operational-startup-sequence)
32. [Diagnostic & Troubleshooting Procedures](#32-diagnostic--troubleshooting-procedures)
33. [Technical Glossary](#33-technical-glossary)
34. [Final Architecture Summary](#34-final-architecture-summary)

---

# 1. RAAHI-Edge Overview

### 1.1 Executive Summary
**RAAHI-Edge** is the autonomous, vehicle-mounted perception and telemetry core of the RAAHI intelligent transportation system. Deployed directly within moving public transit vehicles (city buses, municipal inspection fleets, and road transport utility vehicles), RAAHI-Edge transforms low-cost optical and satellite hardware into a real-time, mission-critical road surface and traffic intelligence node.

In municipal and national transit networks, maintaining road infrastructure and managing traffic flow have historically relied on manual physical surveys, expensive LiDAR trucks, or reactive public complaints. RAAHI-Edge operates continuously on everyday transit buses, converting transit fleets into real-time sensing networks.

```
       ┌─────────────────────────────────────────────────────────────┐
       │                   MOVING BUS (RAAHI-EDGE)                   │
       │                                                             │
       │  [Samsung S23 FE] ──(RTSP)──► [Edge Compute Appliance]      │
       │   - 1080p Optical Stream       - Dual YOLO11n Models        │
       │   - Hardware H.264             - ByteTrack Tracking         │
       │   - 1 Hz GNSS Telemetry        - Traffic Flow / Density     │
       │                                - 15s Evidence Recorder      │
       │                                - SQLite Offline Queue       │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
                                      │ HTTP / Cellular Uplink
                                      │ (Telemetry & Clips ONLY)
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                      RAAHI-CENTRAL                          │
       │                                                             │
       │   - Deterministic Ingestion & Schema Validation             │
       │   - 10-Meter Haversine Spatial Pothole Deduplication        │
       │   - 50m / 10min Multi-Bus Traffic Congestion Correlation    │
       │   - Fleet Aggregation & GIS Analytics Map                   │
       │   - Google Drive Evidence Synchronization                   │
       │   - ZERO AI / VLM / LLM INFERENCE (STRICTLY DETERMINISTIC)  │
       └─────────────────────────────────────────────────────────────┘
```

### 1.2 Role in the Global Architecture
Within the dual-system RAAHI ecosystem:
- **RAAHI-Edge** is responsible for **all high-bandwidth, high-frequency perception**. It ingests continuous 1080p @ 30 FPS video frames, detects asphalt distress and dynamic vehicular obstacles, executes multi-target trajectory tracking, computes road occupancy and rolling vehicle flow, anchors temporal evidence buffers, and maintains a resilient local SQLite state.
- **RAAHI-Central** is an authoritative, multi-tenant fleet aggregation cloud. It exposes canonical HTTP REST endpoints, validates metadata, enforces spatial deduplication across different transit vehicles, aggregates multi-bus congestion reports, persists records in MongoDB, syncs video clips to Google Drive, and renders a GIS dashboard for municipal transport authorities.

### 1.3 Why Perception Intelligence Belongs on Edge
The decision to execute perception exclusively on the Edge compute machine rather than streaming raw video to the cloud is rooted in three physical and economic realities:

1. **Cellular Bandwidth & Coverage Volatility**: Streaming an uncompressed 1080p @ 30 FPS camera feed requires 4.5–6.0 Mbps per vehicle. In a modest metropolitan transit fleet of 2,000 buses, continuous cloud streaming would generate $2,000 \times 5.0\text{ Mbps} = 10\text{ Gbps}$ of sustained uplink. Cellular modems in moving buses frequently cross dead zones, subways, and congested base stations, causing severe packet loss and dropping safety-critical detections.
2. **Cloud Compute & Latency Costs**: Executing object detection neural networks in the cloud across 2,000 continuous video streams would necessitate massive clusters of enterprise cloud GPUs (e.g., 250+ NVIDIA A100/H100 instances), incurring tens of thousands of dollars in monthly cloud compute bills. RAAHI-Edge leverages the vehicle's onboard compute appliance, reducing cloud perception compute costs to zero.
3. **Bandwidth Minimization & Privacy Protection**: By performing detection and tracking on-device, RAAHI-Edge transmits only lightweight JSON event payloads ($\approx 1.2\text{ KB}$ per event) and short, compressed 15-second evidence clips ($\approx 500\text{ KB}$ each) strictly when a verified anomaly occurs. Faces and non-road peripheral imagery are discarded in vehicle volatile RAM without ever leaving the bus.

### 1.4 What Edge Receives and Produces
- **Inputs Received**:
  - Raw 1080p @ 30 FPS H.264 video feed over RTSP (`rtsp://127.0.0.1:8555/live`) from the smartphone's hardware encoder.
  - 1 Hz high-precision GNSS/GPS fixes (`latitude`, `longitude`, `accuracy`, `speed`, `timestamp`) forwarded from the device's satellite receiver.
  - Operator parameters via local HTTP REST endpoints (`http://127.0.0.1:5050`).
- **Outputs Produced**:
  - Authoritative Pothole Candidate events (`EVT-YYYYMMDD-BUSID-XXXX`) with localized bounding boxes, confidence scores, and GPS fixes.
  - Traffic Congestion Incident events (`TRF-YYYYMMDD-BUSID-XXXX`) with rolling flow (Vehicles Per Minute), road occupancy ratio, and congestion state (`FREE`, `MODERATE`, `HEAVY`, `CONGESTED`).
  - 15-second H.264 evidence video clips (5.0 seconds pre-event anchored to $t_0$, 10.0 seconds post-event) and high-resolution keyframe JPEGs.
  - In-vehicle live diagnostics via WebSocket and MJPEG stream for the local driver/inspector dashboard.

---

# 2. Complete System Architecture

The end-to-end data pipeline of RAAHI-Edge is structured as an asynchronous, staged processing engine designed for deterministic frame processing and bounded memory utilization:

```
+----------------------------------------------------------------------------------------------------+
|                                    SAMSUNG GALAXY S23 FE CAMERA                                    |
|                       1080p Wide Camera (1920x1080 @ 30 FPS) + Fused GNSS (1 Hz)                    |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                      HARDWARE H.264 ENCODER                                        |
|                     Samsung Exynos / Snapdragon MediaCodec (c2.exynos.h264.encoder)                |
|                             Bitrate: 5.4 Mbps CBR, Keyframe Interval: 1.0s                         |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ RTSP (TCP Transport)
+----------------------------------------------------------------------------------------------------+
|                                  MEDIAMTX RTSP PROXY (:8555)                                       |
|                    Local low-latency RTSP muxer buffering stream on rtsp://127.0.0.1:8555/live     |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                     CAPTURE: RTSP RECEIVER                                         |
|             capture/rtsp_receiver.py: Low-latency OpenCV cv2.VideoCapture worker thread            |
|                   - Buffer Size = 1 (drops stale frames, guarantees 0 pipeline lag)                 |
|                   - Exponential backoff auto-reconnect (0.21s recovery latency)                    |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ 1080p Decoded Frame (1920x1080 BGR)
+----------------------------------------------------------------------------------------------------+
|                                   ROLLING RING BUFFER (RAM FIFO)                                   |
|                ring_buffer/rolling_buffer.py: 180-frame capacity (6.0s at 30.0 FPS)                |
|                    Stores (frame_idx, timestamp_epoch, cv2_frame) in volatile memory               |
+----------------------------------------------------------------------------------------------------+
                                                  │
                     ┌────────────────────────────┴────────────────────────────┐
                     ▼                                                         ▼
+-----------------------------------------+               +------------------------------------------+
|       POTHOLE PERCEPTION SUBSYSTEM      |               |       TRAFFIC PERCEPTION SUBSYSTEM       |
|    inference/yolo_detector.py           |               |    traffic/vehicle_tracker.py            |
|    - Model: models/pothole_yolo11n.pt   |               |    - Model: models/yolo11n.pt            |
|    - Cadence: Stride 1 (Every Frame)    |               |    - Cadence: Stride 2 (Every 2nd Frame) |
|    - Acceleration: Apple MPS (20.9 ms)  |               |    - Filtered Classes: Car, Bike, Bus,   |
|    - Target: Class 6 ("pothole")        |               |      Truck (COCO 2, 3, 5, 7)             |
|    - Conf Threshold: >= 0.35            |               |    - Acceleration: Apple MPS (26.3 ms)   |
+-----------------------------------------+               +------------------------------------------+
                     │                                                         │
                     │                                                         ▼
                     │                                    +------------------------------------------+
                     │                                    |         BYTETRACK TRACKING ENGINE        |
                     │                                    |    Multi-target Kalman state filter      |
                     │                                    |    - High & Low confidence association   |
                     │                                    |    - Trajectory smoothing (px/s speed)   |
                     │                                    |    - Session-scoped persistent Track IDs |
                     │                                    +------------------------------------------+
                     │                                                         │
                     │                                                         ▼
                     │                                    +------------------------------------------+
                     │                                    |         TRAFFIC METRICS ENGINE           |
                     │                                    |    - Flow: Virtual line crossings (VPM)  |
                     │                                    |    - Density: Polygon road ROI ratio     |
                     │                                    |    - State: FREE/MODERATE/HEAVY/CONGEST  |
                     │                                    +------------------------------------------+
                     │                                                         │
                     └────────────────────────────┬────────────────────────────┘
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                      EVENT ENGINE & DEBOUNCING                                     |
|               events/event_engine.py: Evaluates spatial & temporal thresholds                      |
|               - Potholes: 5.0s temporal debounce / 10m spatial vehicle suppression                 |
|               - Traffic: Sustained congestion (>= 90 frames / ~3.0s) + 60.0s cooldown              |
|               - Accepted Event triggers creation of canonical Event Package                        |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                     GPS & TIMESTAMP ASSOCIATION                                    |
|               gps/gps_manager.py: Queries 1 Hz sliding GNSS fix buffer                             |
|               - Interpolates nearest fix within delta threshold (<= 2000 ms)                       |
|               - Attaches latitude, longitude, accuracy, bus speed, and epoch timestamp             |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                    EVIDENCE RECORDER & ENCODER                                     |
|               evidence/evidence_recorder.py: 15.0-Second Clip Finalization                         |
|               1. Anchored to t0 (exact detection time): grabs 150 pre-event frames (5.0s)          |
|               2. Continues live background collection of 300 post-event frames (10.0s)             |
|               3. Saves high-res keyframe JPEG (1920x1080)                                          |
|               4. Encodes 450 frames @ 30 FPS to MP4 via OpenCV + FFmpeg (H.264 YUV420p faststart)  |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+----------------------------------------------------------------------------------------------------+
|                                     LOCAL PERSISTENCE & QUEUE                                      |
|               storage/sqlite_db.py: Resilient On-Disk SQLite Storage (raahi_edge.db)               |
|               - Events table: Raw metadata, coordinates, telemetry JSON, evidence paths            |
|               - Transmission Queue: State machine (RECORDING -> PENDING -> IN_FLIGHT -> SENT)      |
|               - Storage Retention Policy: 800 MB Evidence cap / 200 MB SQLite cap                  |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ Background HTTP Worker Thread
+----------------------------------------------------------------------------------------------------+
|                                  TRANSMISSION CLIENT (OFFLINE RESILIENT)                           |
|               transmission/central_client.py: Dispatches to RAAHI-Central                          |
|               1. POST /api/central/events (JSON Metadata Payload)                                  |
|               2. POST /api/central/evidence/upload (Binary Streamed MP4 Evidence)                  |
|               - Automatic exponential retry on cellular drop; updates SQLite status to SENT        |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼ Internet (Cellular LTE/5G)
+----------------------------------------------------------------------------------------------------+
|                                    RAAHI-CENTRAL CLOUD PLATFORM                                    |
|     - Deterministic 10m Spatial Pothole Deduplication (Haversine Promotion)                        |
|     - Multi-Bus Traffic Congestion Spatial-Temporal Correlation (50m / 10 min window)              |
|     - Google Drive Evidence Storage Sync (OAuth / Service Account)                                 |
|     - GIS Analytics & Operations Fleet Dashboard (Zero AI Inference on Central)                    |
+----------------------------------------------------------------------------------------------------+
```

---

# 3. Edge vs Central Responsibilities

To guarantee extreme cost efficiency and low cellular bandwidth usage, RAAHI enforces a strict separation of concerns between Edge devices and Central servers.

> [!IMPORTANT]
> **Fundamental Architectural Decision**: **RAAHI-Central performs ZERO VLM, LLM, or AI perception inference.** All pixel-level vision, neural network inference, vehicle tracking, and event classification occur exclusively on the Edge compute appliance. Central relies strictly on deterministic mathematical algorithms.

### 3.1 Responsibility Matrix

| Subsystem / Responsibility | RAAHI-Edge | RAAHI-Central | Architectural Justification |
| :--- | :---: | :---: | :--- |
| **Raw 1080p Optical Ingestion** | **YES** | **NO** | Continuous streaming of 30 FPS video over cellular is cost-prohibitive and unreliable. |
| **YOLO Neural Network Inference** | **YES** | **NO** | Running dual neural networks on 2,000+ transit buses in the cloud would require massive, expensive GPU clusters. |
| **ByteTrack Multi-Object Tracking** | **YES** | **NO** | Tracking requires high-frequency frame continuity (30 FPS); cannot be performed over erratic network uplinks. |
| **Traffic Flow (VPM) & Occupancy** | **YES** | **NO** | Derived in real-time from pixel coordinate geometry and virtual tripwires. |
| **Congestion Regime Classification** | **YES** | **NO** | Classified on Edge based on immediate moving windows of vehicle density and speed. |
| **Local Frame Ring Buffer (RAM)** | **YES** | **NO** | High-throughput in-memory volatile FIFO; Central never sees intermediate frames. |
| **Evidence Video Encoding (15s MP4)** | **YES** | **NO** | Packaged and compressed to H.264 MP4 locally; Central receives finished artifacts. |
| **Local Offline Queue Management** | **YES** | **NO** | Ensures 100% zero data loss during cellular network blackouts. |
| **Local Disk Space Retention** | **YES** | **NO** | Enforces 800MB/200MB safety quotas to prevent MacBook disk exhaustion. |
| **API Authentication & Tokens** | **NO** | **YES** | Validates client tokens, vehicle certificates, and authorized fleets. |
| **10-Meter Spatial Deduplication** | **NO** | **YES** | Central correlates observations from multiple independent buses passing the same road defect. |
| **Cross-Bus Traffic Correlation** | **NO** | **YES** | Correlates congestion reports when two or more buses encounter the same traffic bottleneck. |
| **Fleet Tracking & GIS Map** | **NO** | **YES** | Renders unified fleet telematics across hundreds of active buses on a centralized dashboard. |
| **Google Drive Evidence Archival** | **NO** | **YES** | Central authorizes and stores evidence clips in enterprise cloud drives. |
| **Central MongoDB Persistence** | **NO** | **YES** | Provides authoritative persistence for municipal work orders and public transit reporting. |

---

# 4. Hardware and Physical Deployment

The physical prototype implementation of RAAHI-Edge operates across two tightly integrated hardware units deployed inside the vehicle cabin:

```
+-----------------------------------------------------------------------------------+
|                            IN-VEHICLE CABIN DEPLOYMENT                            |
|                                                                                   |
|  [ Windshield Mount ]                                                             |
|  Samsung Galaxy S23 FE (SM-S711B)                                                 |
|  - 50 MP Main Camera (f/1.8, OIS)                                                 |
|  - Hardware H.264 Encoder (c2.exynos.h264.encoder)                               |
|  - Multi-GNSS Receiver (GPS, GLONASS, Galileo, BeiDou)                             |
|  - USB-C Tethering + Wi-Fi Hotspot (10.147.108.x)                                 |
|                         │                                                         |
|                         │ High-Speed TCP Stream (RTSP 5.4 Mbps)                   |
|                         │ ADB Control & Reverse Port Forwarding                   |
|                         ▼                                                         |
|  [ Vehicle Under-Dash / Secure Enclosure ]                                        |
|  MacBook Air M2 (Edge Compute Appliance)                                          |
|  - Apple M2 SoC (8-core CPU, 10-core GPU, 16-core Neural Engine)                  |
|  - 16 GB Unified Memory (LPDDR5, 100 GB/s bandwidth)                              |
|  - Apple Silicon Metal Performance Shaders (MPS) Backend                          |
|  - MediaMTX RTSP Server (:8555)                                                   |
|  - Edge FastAPI Pipeline Coordinator (:5050)                                      |
|  - Local SQLite Database & Evidence Storage                                       |
+-----------------------------------------------------------------------------------+
```

### 4.1 Smartphone Appliance Specifications
- **Device Model**: Samsung Galaxy S23 FE (`SM-S711B / RZCX40AG4LP`).
- **Operating System**: Android 14 (One UI 6.1).
- **Camera Sensor**: 50 MP $f/1.8$ wide optical sensor with Optical Image Stabilization (OIS), locked to continuous autofocus at infinity and fixed exposure for windshield road capture.
- **Hardware Encoder**: Hardware-accelerated `c2.exynos.h264.encoder` producing an H.264 Baseline Profile video stream at $1920 \times 1080$ @ 30.0 FPS.
- **Positioning**: Multi-constellation GNSS (GPS L1, GLONASS G1, Galileo E1, BeiDou B1) managed through Android `FusedLocationProviderClient`.

### 4.2 Edge Compute Appliance Specifications
- **Hardware**: Apple MacBook Air 13-inch (M2, 2022).
- **Processing Architecture**: Apple Silicon ARM64, 8 CPU cores (4 performance, 4 efficiency), 10 GPU cores.
- **Accelerated Inference Framework**: PyTorch 2.14.0 compiling YOLO11n models to the **Metal Performance Shaders (MPS)** device backend, leveraging high-bandwidth unified memory for low memory-copy latency.
- **Cooling / Thermal Profile**: Passive cooling with bounded GPU utilization (cadence stride 2 throttles thermal generation, sustaining steady 28–30 FPS processing without throttling).

### 4.3 Network Topology & Port Mapping
Communication between the sensing appliance and edge compute unit uses a dedicated physical USB connection and local high-speed Wi-Fi hotspot:
- **`rtsp://127.0.0.1:8555/live`**: MediaMTX RTSP proxy receiving S23 FE hardware H.264 video.
- **`http://127.0.0.1:5050`**: Edge FastAPI REST server and pipeline status telemetry.
- **`http://127.0.0.1:5174`**: Edge Operator React/Vite dashboard.
- **`http://127.0.0.1:5001`**: Canonical RAAHI-Central API server and municipal GIS dashboard.
- **`http://127.0.0.1:27017`**: Central MongoDB database instance.

### 4.4 Rationale for Dual-Device Architecture
Deploying the smartphone as an optical/GNSS appliance while using a dedicated laptop/embedded computer for inference is intentional:
1. **Separation of Thermal Loads**: Executing continuous dual-YOLO neural networks on an Android phone windshield mount under direct sunlight causes thermal throttling, battery degradation, and camera shutdowns. Offloading inference to an interior edge appliance preserves continuous operation.
2. **Optics & GNSS Availability**: Modern smartphones offer high-quality optical stabilization, multi-band GNSS, and hardware video encoders in an off-the-shelf, ruggedized enclosure, avoiding expensive industrial camera and GPS breakout hardware.

---

# 5. Android RAAHI-Eye Integration

The smartphone runs **RAAHI-Eye**, a purpose-built native Android Kotlin background telemetry application (`com.example.raahieye`).

### 5.1 Architecture & Media Pipeline
- **Video Capture Engine**: Utilizes **RootEncoder 2.8.1** interfacing with the Android `Camera2` API.
- **Hardware Encoding**: Directly accesses the `MediaCodec` subsystem to bind the camera output surface to `c2.exynos.h264.encoder`.
- **RTSP Streaming Protocol**: Publishes raw RTP/AVP/TCP packets over an embedded RTSP client. Transport is forced to **TCP** to prevent visual tearing, packet loss, and frame jitter commonly experienced with UDP over Wi-Fi.

### 5.2 GNSS / Satellite Tracking Engine
- **Provider**: Android `FusedLocationProviderClient` requesting high-accuracy updates (`PRIORITY_HIGH_ACCURACY`).
- **Polling Interval**: Fast 1.0-second interval (`setIntervalMillis(1000)` with `setMinUpdateIntervalMillis(500)`).
- **Payload Generation**: Packages satellite telemetry into JSON payloads transmitted to Central / Edge:
  ```json
  {
    "busId": "RAAHI-001",
    "latitude": 28.648740,
    "longitude": 77.504140,
    "accuracy": 4.5,
    "speed": 32.0,
    "timestamp": "2026-09-18T20:33:05.580Z"
  }
  ```

### 5.3 Reliability, Reconnection & Watchdog
- **Auto-Reconnect Loop**: If the RTSP TCP socket drops (due to USB disconnection or Wi-Fi handshake renegotiation), RAAHI-Eye enters an exponential retry state every 3.0 seconds.
- **Maximum Reconnect Window**: Sustains automated reconnect attempts for a 15-minute window before alerting the in-cabin driver.
- **Wakelock & Foreground Service**: Operates under a sticky foreground service (`android.permission.FOREGROUND_SERVICE_CAMERA`) holding `PARTIAL_WAKE_LOCK` to prevent Android OS battery optimization from killing stream processing.

---

# 6. RTSP and Video Ingestion

Video ingestion is managed by `capture/rtsp_receiver.py`, which bridges the network video stream and the local computer vision pipeline.

```
                  +----------------------------------------------+
                  |           S23 FE Android RootEncoder         |
                  +----------------------------------------------+
                                         │  RTSP over TCP (Port 8555)
                                         ▼
                  +----------------------------------------------+
                  |         MediaMTX RTSP Server (Local)         |
                  +----------------------------------------------+
                                         │
                                         ▼
+--------------------------------------------------------------------------------+
|                        capture/rtsp_receiver.py (Worker Thread)                |
|                                                                                |
|  cv2.VideoCapture("rtsp://127.0.0.1:8555/live", cv2.CAP_FFMPEG)                |
|  - CAP_PROP_BUFFERSIZE = 1                                                     |
|  - Low-Latency FFmpeg Parameters:                                              |
|      * fflags=nobuffer                                                         |
|      * max_delay=500000 (0.5s max network packet delay)                        |
|      * rtsp_transport=tcp                                                      |
|                                                                                |
|  +--------------------------------------------------------------------------+  |
|  | Single-Slot Latest-Frame Buffer (Atomic Lock)                            |  |
|  | [ Frame N ]  <-- Overwrites immediately if processing thread is busy.     |  |
|  +--------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------+
                                         │
                                         ▼ Latest Decoded Frame (Zero Lag)
                                  Pipeline Coordinator
```

### 6.1 Zero-Lag Single-Frame Buffer Design
Standard OpenCV video capture configurations allocate an internal 30-to-60 frame decoding queue. When neural network inference takes 30 ms per frame, an unmanaged capture queue steadily accumulates backlogged frames, resulting in seconds of artificial latency.

`RTSPReceiver` addresses this via a **Single-Slot Atomic Frame Buffer**:
1. A dedicated reader thread runs a tight loop executing `self.cap.read()`.
2. When a frame arrives, it overwrites the single internal memory slot `self.latest_frame` under an atomic thread lock.
3. If the inference pipeline is busy, intermediate frames are intentionally overwritten rather than buffered.
4. When `coordinator.get_latest_frame()` is called, it always receives the exact physical frame captured milliseconds prior.
5. Result: **Zero pipeline backlog and stable live stream synchronization.**

### 6.2 Stream Stall Detection and Automated Recovery
The receiver continuously monitors ingestion timestamps:
- If no valid frame is decoded for `read_timeout_sec: 5.0s`, the stream is flagged as `STALLED`.
- The worker releases the OpenCV capture instance, flushes memory, and executes automated reconnection attempts every 2.0 seconds.
- **Physical Verification**: In automated network interruption tests (`tests/test_network_interruption.py`), simulated publisher disconnects recovered in **0.21 seconds** upon network restoration.

---

# 7. Pothole Detection Subsystem

Pothole perception is implemented in `inference/yolo_detector.py` utilizing an optimized Ultralytics YOLO11n neural network.

```
                    Input Video Frame (1920x1080 BGR)
                                  │
                                  ▼
                    Letterbox Resizing to 640x640
                                  │
                                  ▼
+-------------------------------------------------------------------+
|               YOLO11n Neural Network (MPS Accelerated)            |
|               Model Weights: models/pothole_yolo11n.pt             |
|               Parameters: 2.6M | Precision: Float32               |
+-------------------------------------------------------------------+
                                  │
                                  ▼
               Raw Detections Across 8 Surface Classes
                                  │
                                  ▼
+-------------------------------------------------------------------+
|                     Class Filtering & Suppression                 |
|               Target Class: 6 ("pothole")                         |
|               Confidence Threshold: >= 0.35                       |
|               Non-Maximum Suppression (IoU >= 0.45)               |
+-------------------------------------------------------------------+
                                  │
                                  ▼
                     Accepted Pothole Candidate Bounding Boxes
```

### 7.1 Model Architecture & Weights
- **Checkpoint Location**: `models/pothole_yolo11n.pt` (5.2 MB).
- **Architecture**: Ultralytics YOLO11 Nano object detection architecture, featuring C3k2 feature extraction blocks and a decoupled anchor-free detection head.
- **Classes**: 8 distinct asphalt surface feature classes:
  - `0: Drain Hole`
  - `1: circle-drain-clean-`
  - `2: drain-clean-`
  - `3: drain-not clean-`
  - `4: hole`
  - `5: manhole`
  - **`6: pothole` (Active Primary Target)**
  - `7: sewer cover`

### 7.2 Training & Evaluation Metrics
The deployed model weights were trained and evaluated on a benchmark asphalt distress dataset:
- **Dataset Partitioning**: 5,214 training images, 491 validation images, 246 testing images (5,951 total images).
- **Image Input Size**: $640 \times 640$ pixels.
- **Training Epochs**: 50 epochs with stochastic gradient descent and dynamic data augmentations (mosaic, HSV jitter, horizontal flips).
- **Model Evaluation Metrics**:
  - **$\text{mAP}_{50-95}$**: `0.47972`
  - **$\text{mAP}_{50}$**: `0.65810`
  - **Precision**: `0.60993`
  - **Recall**: `0.62824`

> [!NOTE]
> These figures represent controlled training and validation benchmark metrics. In real-world physical road deployments, factors such as water reflections, night shadows, and sun glare can impact optical precision.

### 7.3 Acceleration & Cadence
- **Device Backend**: Apple Silicon MPS (`torch.device("mps")`).
- **Inference Latency**: Sustained **20.9 ms** per frame ($\approx 47\text{ FPS}$ maximum hardware capacity).
- **Operational Cadence**: Executed on **Stride 1** (every single incoming video frame) to guarantee that high-speed vehicle passes never skip road surface defects.

---

# 8. Vehicle Detection Subsystem

Vehicle recognition is integrated within `traffic/vehicle_tracker.py` to enable dual-model road understanding alongside pothole detection.

### 8.1 Model Specifications
- **Checkpoint Location**: `models/yolo11n.pt` (5.4 MB).
- **Dataset / Pretraining**: COCO (Common Objects in Context) 80-class dataset.
- **Filtered Vehicle Classes**: Detections are strictly filtered to the four primary motorized road transport classes, discarding all other 76 COCO categories:
  - `Class ID 2`: **`car`**
  - `Class ID 3`: **`motorcycle`**
  - `Class ID 5`: **`bus`**
  - `Class ID 7`: **`truck`**

### 8.2 Operational Configuration & Stride Rationale
- **Confidence Threshold**: Set to `0.30` for vehicles. This slightly lower threshold ensures distant or partially occluded vehicles entering the horizon are picked up by the Kalman filter before reaching the primary road region of interest (ROI).
- **Execution Cadence (Stride 2)**: Vehicle detection and ByteTrack tracking run on **every 2nd frame** ($15\text{ FPS}$ tracking rate) while pothole detection runs on every frame ($30\text{ FPS}$).
  - *Engineering Justification*: Vehicles possess physical mass and inertia; their pixel displacement between two $33\text{ ms}$ frames is minimal. Running vehicle detection every $66\text{ ms}$ provides identical tracking stability while reducing GPU load by 50%, leaving substantial compute headroom for the pothole perception engine.

---

# 9. ByteTrack Multi-Object Tracking Engine

Object detection alone merely identifies bounding boxes in individual frames without continuity. To calculate vehicle speed, track directional flow, and measure density, RAAHI-Edge integrates **ByteTrack**.

```
Frame N Detections                     Track Predictions (Kalman Filter)
┌───────────────────────┐              ┌────────────────────────┐
│ High Conf Detections  │ ──(IoU Match)─► [Active Tracks Updated]│
│ (Score >= 0.50)       │              └────────────────────────┘
└───────────────────────┘                         │
                                                  ▼ Unmatched Tracks
┌───────────────────────┐              ┌────────────────────────┐
│ Low Conf Detections   │ ──(IoU Match)─► [Recovered Tracks]     │
│ (0.10 <= Score < 0.50)│              └────────────────────────┘
└───────────────────────┘                         │
                                                  ▼ Still Unmatched
                                       ┌────────────────────────┐
                                       │ Lost Tracks (Kept 30f) │
                                       │ Deleted if > 30 frames │
                                       └────────────────────────┘
```

### 9.1 Detection vs. Tracking: The ByteTrack Principle
Standard trackers discard all low-confidence bounding boxes ($< 0.50$), which frequently breaks tracks when vehicles pass under tree shadows or experience motion blur. 
ByteTrack utilizes a **two-stage matching algorithm**:
1. **Stage 1 (High-Score Association)**: High-confidence detections are matched against existing Kalman filter track predictions using Intersection over Union (IoU) distance.
2. **Stage 2 (Low-Score Recovery)**: Unmatched tracks are compared against *low-confidence* detections ($0.10 \le \text{score} < 0.50$). This recovers occluded or blurred vehicles without introducing background noise false positives.

### 9.2 Kalman Filter & Trajectory History
Each tracked vehicle is assigned an 8-dimensional state vector $[x, y, a, h, \dot{x}, \dot{y}, \dot{a}, \dot{h}]$ representing box center coordinates, aspect ratio, height, and their respective velocities.
- Trajectory centroids are tracked in `traffic/track_history.py` over a rolling 30-frame window.
- Centroid displacements are smoothed using moving average filters, providing stable velocity vectors.

### 9.3 Lifecycle & Identity Scope
- **Session-Scoped IDs**: Track IDs (`track_id: 1, 2, 3...`) are strictly ephemeral and session-scoped. When a vehicle leaves the camera frame, its track state is maintained for 30 frames before being pruned from memory.
- **Privacy Enforcement**: Track IDs do **not** represent permanent vehicle identities (no license plate recognition or re-identification). Track IDs are utilized locally to prevent double-counting and are never transmitted to Central as persistent vehicle records.

---

# 10. Traffic Intelligence Subsystem

The traffic intelligence engine resides in the `traffic/` package, organized into focused, modular components:

```
traffic/
├── __init__.py           # Package exports
├── metrics.py            # Data structures, TrafficState enum, TrackedVehicle dataclass
├── vehicle_tracker.py    # Main facade orchestrating YOLO11n + ByteTrack + metrics
├── track_history.py      # Trajectory FIFO buffers, centroid displacement speed
├── flow.py               # Virtual tripwire line crossing, rolling VPM calculations
├── density.py            # Road ROI polygon containment, bounding box occupancy ratio
├── congestion.py         # Deterministic 4-tier congestion classification rules
└── visualizer.py         # Real-time HUD, bounding box, and trajectory drawing
```

### 10.1 Active Vehicle Counting & Class Breakdown
- `traffic/metrics.py` tracks active objects currently detected within the scene.
- Categorized by type:
  - `activeVehicles`: Total active tracked vehicles.
  - `vehiclesInRoi`: Vehicles located within the designated road corridor.
  - `perClassCount`: Real-time dictionary tracking counts for `car`, `motorcycle`, `bus`, and `truck`.

### 10.2 Road Corridor Region of Interest (ROI) & Density
- **Polygon Road Corridor**: Defined in normalized frame coordinates to isolate the active vehicular roadway from sidewalks, storefronts, and oncoming opposing traffic lanes:
  $$\text{ROI} = [(0.15, 0.45), (0.85, 0.45), (1.00, 0.95), (0.00, 0.95)]$$
- **Occupancy Ratio Calculation**: Implemented in `traffic/density.py`. Calculates the geometric union area of all vehicle bounding boxes residing within the road polygon divided by the total area of the road corridor:
  $$\text{Occupancy Ratio} = \frac{\text{Area}(\bigcup_{i} \text{BBox}_i \cap \text{ROI})}{\text{Area}(\text{ROI})}$$
- Overlapping bounding boxes are properly merged via shapely/contour polygon unions to prevent artificial ratios exceeding $1.0$.

### 10.3 Virtual Tripwire Line Crossing & Flow (VPM)
- Implemented in `traffic/flow.py`. A virtual horizontal counting line is anchored across the road surface at $y = 0.65 \times \text{Height}$.
- When a vehicle's centroid trajectory vector crosses this line from top-to-bottom or bottom-to-top, a line-crossing event is recorded once for that `track_id`.
- **Vehicles Per Minute (VPM)** is calculated across three rolling temporal windows:
  - `flow10s`: Normalized 10-second instantaneous surge rate.
  - `flow30s`: Rolling 30-second standard rate.
  - `flow60s`: Stable 60-second flow metric:
    $$\text{Flow VPM} = \frac{\text{Crossings within Window}}{\text{Window Duration (sec)}} \times 60.0$$

### 10.4 Displacement Speed Measurement
- Implemented in `traffic/track_history.py`. Calculates the euclidean pixel displacement of the vehicle's bottom-center bounding box point over time:
  $$\text{Displacement Speed} = \frac{\sqrt{(x_t - x_{t-\Delta t})^2 + (y_t - y_{t-\Delta t})^2}}{\Delta t} \quad [\text{pixels/second}]$$

> [!WARNING]
> **Measurement Notice**: Current speed measurements represent **pixel-space displacement** within the 2D image plane. Because camera pitch, lens distortion, and vanishing-point perspective transformations are not calibrated to physical road meters, **this value does not represent true real-world vehicle speed in km/h.**

### 10.5 Deterministic Congestion Classification Regimes
Implemented in `traffic/congestion.py`. Maps real-time road occupancy and vehicle displacement into four operational regimes:

| Traffic State | Occupancy Ratio | Flow VPM | Mean Speed (px/s) | Description |
| :--- | :---: | :---: | :---: | :--- |
| **`FREE`** | $< 0.20$ | Any | $> 120\text{ px/s}$ | Unrestricted traffic flow; road corridor clear. |
| **`MODERATE`** | $0.20 - 0.45$ | $\ge 15$ | $> 60\text{ px/s}$ | Steady traffic with normal urban density. |
| **`HEAVY`** | $0.45 - 0.65$ | Any | $\le 60\text{ px/s}$ | High density; vehicle spacing significantly compressed. |
| **`CONGESTED`** | $> 0.65$ | $< 10$ | $\le 25\text{ px/s}$ | Severe traffic bottleneck / gridlock; vehicles stationary. |

---

# 11. Traffic Congestion Event Generation

To avoid overwhelming Central with continuous telemetry frames, sustained traffic bottlenecks are converted into structured **Traffic Incidents**.

```
Frame Loop Evaluates Traffic State
              │
              ▼
Is State == "CONGESTED"?
       │
       ├──── No ──► Reset consecutive congested frame counter to 0
       │
       └─── Yes ──► Increment consecutive congested frame counter
                          │
                          ▼
            Consecutive Frames >= 90 (~3.0 seconds)?
                          │
                          ├──── No ──► Continue evaluation
                          │
                          └─── Yes ──► Check cooldown timer (>= 60.0s elapsed?)
                                             │
                                             ├──── No ──► Suppress event (cooldown active)
                                             │
                                             └─── Yes ──► [ TRIGGER TRAFFIC INCIDENT ]
                                                           - Capture 15s Evidence Clip
                                                           - Anchor GNSS Fix
                                                           - Package Telemetry JSON
                                                           - Insert into SQLite Queue
```

### 11.1 Sustained Congestion Threshold & Debouncing
- **Temporal Sustained Rule**: A traffic state must remain continuously classified as `CONGESTED` for **at least 90 consecutive frames** ($\approx 3.0\text{ seconds}$ at 30 FPS). Brief stops at pedestrian crosswalks or red traffic signals do not trigger an immediate incident.
- **Incident Cooldown**: Once a congestion event is accepted, a mandatory **60.0-second cooldown timer** is initiated for that geographic vicinity. This prevents an inspection bus caught in a traffic jam from generating duplicate events every few seconds.

### 11.2 Traffic Event Payload Schema
```json
{
  "eventId": "TRF-20260919-001-A9F2",
  "eventType": "congestion",
  "className": "traffic_congestion",
  "busId": "RAAHI-001",
  "timestamp": "2026-09-19T02:21:10.778Z",
  "latitude": 28.649000,
  "longitude": 77.504500,
  "gpsAccuracy": 4.0,
  "edgeModel": "yolo11n-bytetrack",
  "edgeConfidence": 0.87,
  "trafficTelemetry": {
    "trafficState": "CONGESTED",
    "activeVehicles": 16,
    "vehiclesInRoi": 11,
    "occupancyRatio": 0.65,
    "flowVpm": 38.2
  }
}
```

---

# 12. Event Engine & Packaging

The `events/event_engine.py` module acts as the authoritative intake authority for all raw perception inferences before persistence or transmission.

### 12.1 The Perception-to-Transmission Lifecycle
RAAHI-Edge strictly distinguishes between five stages of a detection:
1. **Raw Detection**: A neural network bounding box output on a single frame.
2. **Accepted Event**: A detection that has satisfied confidence thresholds, spatial deduplication, and debouncing.
3. **Evidence Artifact**: A finalized 15-second H.264 video clip and JPEG keyframe written to disk.
4. **Queued Package**: An event record committed to SQLite with queue state `PENDING`.
5. **Transmitted Event**: A package confirmed received by Central and marked `SENT`.

### 12.2 Pothole Debouncing & Spatial Deduplication
When an inspection vehicle passes over a pothole at $40\text{ km/h}$, the camera observes the defect across 15 to 45 consecutive frames. Generating 45 separate alerts for a single pothole would flood the system.
`EventEngine` enforces two-tier debouncing:
- **Spatial Suppression**: When a pothole is detected at coordinate $(lat, lon)$, any subsequent pothole detection within a **10.0-meter Haversine radius** is suppressed for that vehicle pass.
- **Temporal Fallback**: If GNSS lock is temporarily unavailable (`lat: 0.0, lon: 0.0`), a temporal cooldown suppresses duplicate events for **5.0 seconds**.

---

# 13. GNSS / GPS Association Engine

Accurate spatial indexing is essential for municipal repair crews and fleet managers. `gps/gps_manager.py` implements the spatial-temporal correlation engine.

```
       1 Hz GNSS Receiver                           Edge Inference Loop
+-----------------------------+               +------------------------------+
| GPS Sample: 14:02:10.000    |               | Pothole Detection:           |
| GPS Sample: 14:02:11.000    |               | Exact Frame Time:            |
| GPS Sample: 14:02:12.000    |               |   t0 = 14:02:11.140          |
+-----------------------------+               +------------------------------+
               │                                              │
               └──────────────────────┬───────────────────────┘
                                      ▼
                      [ Nearest Fix Interpolation ]
                 Delta Time = |14:02:11.140 - 14:02:11.000| = 140 ms
                 Threshold Check: 140 ms <= 2000 ms (VALID LOCK)
                                      │
                                      ▼
                        Associated Event Metadata:
                        Latitude:  28.648740
                        Longitude: 77.504140
                        Accuracy:  ±4.5 meters
                        Age:       140 ms
```

### 13.1 Sliding Temporal Buffer & Nearest-Neighbor Match
- The GNSS manager maintains a time-ordered FIFO buffer of recent satellite fixes.
- When an event is triggered at timestamp $t_0$, the engine searches the buffer for the closest fix where $|t_{\text{gps}} - t_0| \le 2000\text{ ms}$.
- If the delta is within 2.0 seconds, the fix is accepted and marked `matched: True`.
- If the vehicle enters an urban canyon or tunnel where satellite reception is lost for $> 2.0\text{ seconds}$, the engine falls back to the last known position, flagging `isFresh: False` and `matched: False` to indicate degraded telemetry.

---

# 14. Evidence Capture & 15-Second Clip Lifecycle

A core requirement of RAAHI is verifiable proof of road hazards. The system captures **15-second evidence clips** for every accepted incident.

```
                       t0: Event Detected
                              │
  <--- 5.0s Pre-Buffer --->   │   <------- 10.0s Post-Buffer ------->
 [ 150 Frames from Ring ]     │   [ 300 Frames Pumped Live ]
──────────────────────────────┼────────────────────────────────────────
 -5.0s                        0.0s                                   +10.0s
```

### 14.1 The $t_0$-Anchored Pre-Buffer Architecture
- In standard ring buffer designs, if a system executes database writes *before* extracting frames from memory, the buffer continues advancing during disk I/O. A $300\text{ ms}$ database write would cause the pre-buffer to capture only $4.7\text{ seconds}$ instead of the configured $5.0\text{ seconds}$.
- **RAAHI $t_0$ Anchoring**: When an event is accepted, RAAHI-Edge instantly records the exact floating-point epoch timestamp $t_0$. Frame extraction calls `get_pre_buffer_frames(reference_time=t0, duration=5.0)`, guaranteeing that **exactly 150 pre-event frames ($5.00\text{ seconds}$ at 30 FPS)** are captured, completely isolated from subsequent disk or network delays.

### 14.2 Evidence Lifecycle State Transitions
1. **Trigger ($t_0$)**: Event accepted. Extract 150 frames from `RollingFrameBuffer`. Save high-resolution keyframe JPEG (`EVT_keyframe.jpg`).
2. **Session Start ($t_1$)**: Background `EvidenceSession` thread opens and begins buffering live incoming post-roll frames.
3. **Capture End ($t_2$)**: Post-roll frame count reaches 300 frames ($10.0\text{ seconds}$). Raw video frames closed.
4. **Finalization ($t_3$)**: Background FFmpeg process remuxes the clip to H.264 (`yuv420p`, `-movflags +faststart`). Verified clip duration: **15.00 seconds (450 frames @ 30.0 FPS)**.
5. **Database Commit ($t_4$)**: Evidence paths and clip dimensions updated in SQLite; queue item marked `PENDING`.

---

# 15. SQLite Local Storage Architecture & Retention

On-device persistence is implemented in `storage/sqlite_db.py` (`data/raahi_edge.db`).

### 15.1 Relational Schema Design
```sql
-- Core Events Table
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,          -- 'pothole' or 'congestion'
    class_name TEXT NOT NULL,
    bus_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,           -- ISO 8601 UTC
    latitude REAL,
    longitude REAL,
    gps_accuracy REAL,
    gps_timestamp TEXT,
    edge_model TEXT,
    edge_confidence REAL,
    bbox_json TEXT,                    -- JSON: {x1, y1, x2, y2}
    traffic_telemetry_json TEXT,       -- JSON: {activeVehicles, flowVpm, occupancyRatio, state}
    evidence_clip_path TEXT,
    keyframe_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Evidence Media Tracking
CREATE TABLE IF NOT EXISTS evidence_records (
    event_id TEXT PRIMARY KEY,
    clip_path TEXT NOT NULL,
    keyframe_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_sec REAL NOT NULL,
    fps REAL NOT NULL,
    resolution TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(event_id)
);

-- Offline Transmission State Machine
CREATE TABLE IF NOT EXISTS transmission_queue (
    event_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,              -- 'RECORDING', 'PENDING', 'IN_FLIGHT', 'SENT', 'FAILED'
    retry_count INTEGER DEFAULT 0,
    last_attempt TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(event_id) REFERENCES events(event_id)
);
```

> [!IMPORTANT]
> **Zero Raw Video in SQLite**: SQLite strictly stores structured numerical metadata, JSON payloads, and filesystem path references. High-throughput video frames are written directly to MP4 files via the OS filesystem, preventing SQLite write lock contention and database bloat.

### 15.2 Automated Storage Retention Policy
Implemented in `storage/retention_manager.py`. Development inspection vehicles generate substantial video artifacts. The retention manager protects host disk space:
- **Configurable Limits**:
  - `max_evidence_mb: 800.0` (Maximum 800 MB allocated to evidence MP4 clips).
  - `max_database_mb: 200.0` (Maximum 200 MB allocated to SQLite database).
- **Protected Filesystem Invariants**:
  - Files actively being recorded (`status = 'RECORDING'`) are **never** deleted.
  - Files awaiting cloud upload (`status = 'PENDING'` or `'IN_FLIGHT'`) are **strictly protected**.
  - Only confirmed transmitted evidence (`status = 'SENT'`) or orphaned files are eligible for pruning.
- **Eviction Strategy**: Oldest eligible clips are evicted first (FIFO by timestamp) until total disk usage falls below 90% of the threshold, followed by an automated `VACUUM` to reclaim database pages.

---

# 16. Offline / Transmission Queue

Public transport vehicles continuously traverse cellular dead zones. The transmission queue (`storage/sqlite_db.py` & `pipeline_coordinator.py`) implements an **offline-first queue daemon**.

```
Event Accepted (t0) ──► Queue Status: RECORDING (Protected from retention)
                               │
Clip Finalized (t3) ──► Queue Status: PENDING (Ready for transmission)
                               │
Worker Picks Up     ──► Queue Status: IN_FLIGHT (Locks record against worker races)
                               │
              ┌────────────────┴────────────────┐
       Upload Success                    Network Outage / Error
              │                                 │
              ▼                                 ▼
      Queue Status: SENT               Increment Retry Count
      (Eligible for retention)         Exponential Backoff Delay (2s, 4s, 8s...)
                                       Revert Status to PENDING
```

- When connectivity drops, the queue holds all items safely on disk.
- When cellular connectivity returns, the background worker daemon automatically drains the backlog in chronological order without dropping events.

---

# 17. Edge → Central Communication Contract

Edge communication with RAAHI-Central is managed by `transmission/central_client.py`.

### 17.1 Candidate Event Metadata Ingestion
- **Endpoint**: `POST /api/central/events`
- **Headers**: `Content-Type: application/json`, `User-Agent: RAAHI-Edge/1.0`
- **Request Payload**:
  ```json
  {
    "eventId": "EVT-20260918-001-B7AE",
    "eventType": "pothole",
    "className": "pothole",
    "busId": "RAAHI-001",
    "timestamp": "2026-09-18T20:33:05.580Z",
    "latitude": 28.648740,
    "longitude": 77.504140,
    "gpsAccuracy": 4.5,
    "gpsTimestamp": "2026-09-18T20:33:05.580Z",
    "edgeModel": "YOLO11n",
    "edgeConfidence": 0.91,
    "bbox": { "x1": 450, "y1": 600, "x2": 650, "y2": 780 },
    "frameNumber": 1250,
    "source": "RAAHI-Eye-S23FE"
  }
  ```
- **Central Response (`201 Created` or `200 OK`)**:
  ```json
  {
    "success": true,
    "candidateId": "CAN-000005",
    "promotion": {
      "promoted": true,
      "action": "created",
      "potholeId": "POT-000002"
    }
  }
  ```

### 17.2 Binary Video Evidence Streaming
- **Endpoint**: `POST /api/central/evidence/upload`
- **Headers**:
  - `Content-Type: video/mp4`
  - `X-Event-ID: EVT-20260918-001-B7AE`
  - `X-File-Name: EVT-20260918-001-B7AE_evidence.mp4`
- **Body**: Raw binary chunked MP4 video stream.
- **Central Handling**: Central stages the raw binary stream to its local filesystem (`videos/evidence/`), initiates an OAuth upload to Google Drive, generates a public web view link, and updates the Candidate / Pothole record in MongoDB.

---

# 18. Edge Operator Dashboard Architecture

The in-cabin operator dashboard (`dashboard/`) is a React 18 single-page application built on Vite.

```
dashboard/
├── index.html
├── vite.config.js               # Dev server bound to port 5174
├── package.json
└── src/
    ├── App.jsx                  # Main container & top-level tab navigation
    ├── hooks/
    │   └── usePipelineStatus.js # 1-second auto-refresh polling hook
    └── components/
        ├── stream/
        │   └── StreamPreview.jsx    # Live MJPEG 15 FPS tactical stream view
        ├── telemetry/
        │   ├── TelemetryGrid.jsx    # FPS, latency, frame counters, uptime
        │   └── TrafficTelemetry.jsx # Active cars, VPM flow, ROI occupancy, state
        ├── events/
        │   └── EventHistory.jsx     # Recent detections, confidence, thumbnails
        └── storage/
            └── StoragePanel.jsx     # SQLite/Evidence disk usage & manual cleanup
```

To maintain code clarity, `App.jsx` serves solely as a high-level layout shell rather than a monolithic script, delegating state and rendering to focused sub-components.

---

# 19. Dashboard Telemetry & State Streaming

The dashboard communicates with the local FastAPI backend (`server/api_server.py`) over two high-performance channels:
1. **REST Telemetry Polling (`GET /api/pipeline/status`)**: Polled at $1.0\text{ Hz}$. Returns complete pipeline health, component statuses (`LIVE`, `STANDBY`, `OFFLINE`, `DEGRADED`), and metrics:
   ```json
   {
     "busId": "RAAHI-001",
     "pipelineRunning": true,
     "components": {
       "camera": "LIVE",
       "rtsp": "LIVE",
       "mediamtx": "LIVE",
       "opencv": "LIVE",
       "yolo11n": "LIVE",
       "trafficTracker": "LIVE",
       "gps": "LIVE",
       "eventEngine": "LIVE",
       "localDb": "LIVE",
       "centralConnection": "LIVE"
     },
     "metrics": {
       "inputFps": 30.2,
       "processingFps": 28.0,
       "inferenceLatencyMs": 20.9,
       "vehicleFps": 14.5,
       "vehicleLatencyMs": 7.6,
       "bytetrackLatencyMs": 17.5,
       "framesReceived": 7607,
       "droppedFrames": 0,
       "resolution": "1920x1080"
     }
   }
   ```
2. **MJPEG Stream Broadcast (`GET /api/stream/preview.mjpg`)**: Encodes the latest annotated OpenCV frame into a JPEG stream at $15\text{ FPS}$ ($960 \times 540$ downscaled, JPEG quality 85), allowing vehicle operators to view real-time detections with under $80\text{ ms}$ display lag.

---

# 20. Performance Benchmarks & Profiling Data

The dual-perception pipeline was benchmarked using real physical 1080p camera frames on an Apple M2 appliance running macOS:

### 20.1 Perception Pipeline Hardware Benchmark

| Metric / Stage | Measured Benchmark | Operational Capacity |
| :--- | :---: | :---: |
| **Physical RTSP Stream Decoded** | `1920x1080 @ 30.2 FPS` | 30.0 FPS native hardware limit |
| **Pothole YOLO11n Inference (MPS)** | `20.9 ms` per frame | $\approx 47.8\text{ FPS}$ raw capacity |
| **Vehicle YOLO11n Inference (MPS)** | `7.6 ms` per frame | $\approx 131.5\text{ FPS}$ raw capacity |
| **ByteTrack State Association** | `17.5 ms` per frame | $\approx 57.1\text{ FPS}$ raw capacity |
| **Total Vehicle Pipeline (YOLO + Tracker)** | `26.3 ms` per frame | $\approx 38.0\text{ FPS}$ raw capacity |
| **Cadence Stride 2 Cycle Time** | `28.0 ms` average | Real-time 30 FPS sustainable |
| **Frame Drop Rate** | **`0.0%` (Zero dropped frames)** | No internal queue backlog |
| **Total RAM Utilization** | `1,171 MB` (Stable) | Zero memory leak over sustained runs |
| **Stream Interruption Recovery** | `0.21 seconds` | Automatic socket reconnect |
| **15-Second Evidence Finalization** | Exactly `450 frames` (15.00s) | $150\text{ pre} + 300\text{ post}$ frames |

### 20.2 Cadence Stride Comparison

- **Stride 1 (Run both models every frame)**: Cycle latency $= 20.9\text{ ms} + 26.3\text{ ms} = 47.2\text{ ms}$ ($21.1\text{ FPS}$). Causes frame drops on a 30 FPS camera feed.
- **Stride 2 (Recommended: Pothole every frame, Vehicle every 2nd frame)**: Effective average cycle latency $= 20.9\text{ ms} + (0.5 \times 26.3\text{ ms}) = 34.0\text{ ms}$. Perfectly matches physical 30 FPS input without backlog.
- **Stride 3 (Vehicle every 3rd frame)**: Cycle latency $= 29.6\text{ ms}$. Saves additional compute, but rapid turning vehicles can skip virtual line tripwires.

---

# 21. Automated & Integration Test Suites

The codebase includes an extensive suite of unit and integration tests:

| Test Script | Test Target | Result | Scope & Invariants Verified |
| :--- | :--- | :---: | :--- |
| `tests/test_traffic_pipeline.py` | Complete traffic subsystem | **13/13 PASS** | COCO mapping, ByteTrack synthetic tracking, line crossing, VPM flow, ROI occupancy, 4-tier congestion, session reset. |
| `scripts/test_retention_manager.py` | Storage retention manager | **15/15 PASS** | Evaluates 15 edge cases: below-limit preservation, protected file invariants, oldest-first pruning, database vacuum, idempotency. |
| `scripts/test_manual_cleanup.py` | Operator dev cleanup CLI | **4/4 PASS** | Safe manual execution, dry-run reporting, confirmation checks, vacuum integrity. |
| `tests/test_stream.py` | Physical RTSP smoke test | **PASS** | Evaluates 60 frames from S23 FE: 0 read failures, 30.4 FPS, $1920 \times 1080$. |
| `tests/test_network_interruption.py` | RTSP reconnect recovery | **PASS** | Simulates publisher drop for 4.0s; confirms reconnect latency of **0.21s**. |
| `scripts/test_evidence_lifecycle.py` | $t_0$ evidence anchoring | **PASS** | Verifies via FFprobe: exactly 450 frames @ 30 FPS = 15.00s H.264 video. |
| `scripts/test_end_to_end_physical.py` | Physical hardware integration | **PASS** | Full 9-step physical hardware verification (S23 FE $\to$ Edge $\to$ Central $\to$ Drive). |

---

# 22. Physical Device Validation (Samsung Galaxy S23 FE)

Physical verification was executed continuously using the connected Samsung Galaxy S23 FE:
- **Optical Stream Proof**: Decoded continuous $1920 \times 1080$ @ 30 FPS video frames through OpenCV.
- **Encoder Identification**: `dumpsys media.codec` confirms active use of `c2.exynos.h264.encoder` operating at an average bitrate of $5.4\text{ Mbps}$ (I-frame interval: 1.0s).
- **Physical Evidence Sample**: Verified physical clip `EVT-PHYSICAL-1789763834_evidence.mp4` encoded from live physical camera frames, successfully uploaded to Central, and backed up to Google Drive (`File ID: 1xJ1VjHH090ZGbeAyUDZL3LnRcutO_8RA`).
- **Satellite Fix**: Physical GPS samples logged at latitude $28.648740^\circ\text{N}$, longitude $77.504140^\circ\text{E}$ with $4.5\text{ m}$ accuracy.

---

# 23. Reliability, Fault Tolerance & Recovery Mechanics

| Failure Mode | Detection Mechanism | Automated Edge Recovery Action |
| :--- | :--- | :--- |
| **RTSP Stream Interruption** | No frames decoded for $> 5.0\text{ s}$ | Releases capture device; reconnects via exponential backoff ($2\text{s}, 4\text{s}...$). |
| **Cellular Network Blackout** | HTTP upload connection refused | Queue state machine holds events in `PENDING`; retries periodically without loss. |
| **Disk Space Exhaustion** | Storage exceeds 800 MB / 200 MB | Retention manager triggers pruning of oldest `SENT` evidence; active/pending clips preserved. |
| **GNSS Lock Lost (Tunnels)** | Fix age delta $> 2000\text{ ms}$ | Reverts to last-known position; flags `matched: False` to signal degraded telemetry. |
| **Transient False Positives** | Isolated single-frame detections | Suppressed by spatial-temporal debouncer and persistence windows. |
| **Sudden Power Outage** | Physical reboot | SQLite WAL journal automatically recovers uncommitted writes; in-flight items reset to `PENDING`. |

---

# 24. End-to-End Operational Data Flows

### Flow 1: Pothole Detection and Spatial Deduplication
1. Inspection vehicle passes over a pothole at $35\text{ km/h}$.
2. `inference/yolo_detector.py` detects class 6 (`pothole`, confidence $0.91$).
3. `events/event_engine.py` validates that no pothole was recorded within $10\text{ m}$ in the last $5\text{ s}$. Event accepted: `EVT-20260918-001`.
4. `gps/gps_manager.py` matches nearest GNSS fix $(28.64874, 77.50414)$ with $4.5\text{ m}$ accuracy.
5. `evidence/evidence_recorder.py` anchors to $t_0$, extracts 150 pre-buffer frames, captures 300 post-buffer frames, and encodes `EVT-20260918-001_evidence.mp4`.
6. Event metadata and evidence paths committed to local SQLite; queue status set to `PENDING`.
7. `transmission/central_client.py` dispatches metadata to Central (`POST /api/central/events`) and streams MP4 (`POST /api/central/evidence/upload`).
8. Central executes 10m Haversine deduplication:
   - If novel, promotes to authoritative `POT-000001`.
   - If another bus reported it earlier, increments `detectionCount` and appends `busId` to `busesDetectedBy`.
9. Central uploads MP4 to Google Drive folder `RAAHI-Pothole-Evidence` and updates MongoDB.

### Flow 2: Sustained Traffic Congestion and Multi-Bus Correlation
1. Vehicle encounters gridlock; road corridor occupancy ratio rises to $0.72$ with speed $< 20\text{ px/s}$.
2. State classified as `CONGESTED` for 90 consecutive frames ($3.0\text{ s}$).
3. Cooldown check passes; traffic event `TRF-20260919-001` triggered with telemetry payload (`occupancy: 0.72, vpm: 44.0`).
4. Evidence recorder packages 15-second contextual video clip.
5. Central receives incident and queries active incidents within $50\text{ m}$ and $10\text{ minutes}$.
6. Central correlates reports from Bus A and Bus B, merges event IDs, and escalates incident severity to `critical`.

### Flow 3: Complete Offline Cellular Blackout Recovery
1. Vehicle enters an underground underpass; cellular link drops.
2. An incident occurs; event and 15-second evidence clip are committed to local SQLite (`status = 'PENDING'`).
3. Transmission worker attempts HTTP upload; connection fails. Queue safely retains item.
4. Retention manager runs; sees `status = 'PENDING'` and preserves the clip even if disk space is low.
5. Vehicle exits underpass 8 minutes later; cellular link re-establishes.
6. Transmission daemon detects Central health (`GET /api/status`), drains queued items chronologically, uploads metadata and video clips, and marks status `SENT`.

---

# 25. Security, Privacy & Minimization Controls

- **Data Minimization at the Edge**: Millions of raw video frames captured throughout the day are analyzed in vehicle volatile memory and overwritten immediately. Only confirmed distress events trigger storage.
- **Privacy Preservation**: License plate recognition and facial identification models are deliberately absent from the software stack.
- **Local Network Isolation**: Edge services bind to loopback interfaces (`127.0.0.1`) and local vehicle subnets (`10.147.108.x`), preventing unauthorized remote access.
- **Credential Protection**: Git repositories and client payloads contain zero hardcoded credentials, private keys, or cloud storage tokens.

---

# 26. Resource Economics & Central Cost Rationale

The RAAHI-Edge architecture is engineered for municipal cost efficiency:
- **Bandwidth Consumption**: A traditional streaming setup consumes $\approx 54\text{ GB}$ per bus per 8-hour shift. RAAHI-Edge consumes $\approx 25\text{ MB}$ per shift (a **99.95% reduction in cellular data costs**).
- **Cloud Compute Avoidance**: Because perception runs on existing edge hardware, Central operates comfortably on modest, low-cost servers without expensive GPU instances.
- **Scalability**: New transit vehicles can be onboarded into the fleet without linearly increasing Central server compute loads.

---

# 27. Current Architectural Limitations

Transparency regarding operational constraints is vital for production deployments:
1. **Pixel-Space vs. Calibrated Speed**: Measured vehicle velocities represent 2D image plane pixel displacement ($\text{px/s}$). Without per-vehicle camera pitch, focal length, and perspective homography calibration, velocities cannot be reported as true ground-truth $\text{km/h}$.
2. **Optical Environmental Sensitivities**: Extreme weather (heavy rain obscuring windshields, thick fog, direct sunset solar glare) can degrade detection recall and produce false negatives.
3. **GNSS Accuracy in Urban Canyons**: Standard smartphone GNSS accuracy degrades to $\pm 15\text{ m}$ in narrow urban corridors with tall skyscrapers.
4. **Single Forward-Facing Perspective**: The prototype utilizes a single front-facing camera, monitoring only the road ahead and blind to rear/side traffic.
5. **Compute Hardware Prototype**: The current prototype utilizes a MacBook Air M2 host. Production deployments require migration to dedicated automotive-grade embedded hardware (e.g., NVIDIA Jetson Orin Nano or Raspberry Pi 5 with Hailo-8 AI accelerator).

---

# 28. Future Engineering Roadmap

> [!NOTE]
> The following items represent planned engineering developments and are **not currently implemented** in the active codebase:
> - **Perspective Homography Calibration**: Adding interactive vanishing-point calibration to convert pixel displacement into certified $\text{km/h}$.
> - **INT8 Model Quantization**: Exporting YOLO11n weights to CoreML / TensorRT INT8 to reduce inference latency to $< 10\text{ ms}$.
> - **Multi-Camera 360° Surround**: Integrating side-facing and rear-facing optical sensors for comprehensive lane coverage.
> - **Over-The-Air (OTA) Weight Updates**: Secure differential distribution of fine-tuned model checkpoints from Central to Edge fleets.
> - **Hardware Acceleration on Dedicated SBCs**: Packaging the edge pipeline as an embedded container for automotive ARM platforms.

---

# 29. Repository Tree & Module Index

```
RAAHI-Edge/
├── capture/
│   ├── __init__.py
│   └── rtsp_receiver.py              # Low-latency OpenCV RTSP ingestion worker
├── config.yaml                       # Stream, camera, and display parameters
├── dashboard/                        # React 18 / Vite in-cabin operator dashboard
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                   # Modular layout shell
│       ├── components/               # Telemetry, stream, event, and storage views
│       └── hooks/usePipelineStatus.js
├── data/
│   ├── evidence/                     # On-disk 15s MP4 clips and keyframe JPEGs
│   └── raahi_edge.db                 # Primary SQLite state database
├── events/
│   ├── __init__.py
│   └── event_engine.py               # Incident debouncing, packaging, and validation
├── evidence/
│   ├── __init__.py
│   └── evidence_recorder.py          # t0-anchored 15s video clip recorder & FFmpeg remuxer
├── gps/
│   ├── __init__.py
│   └── gps_manager.py                # 1 Hz GNSS sliding buffer & nearest-neighbor match
├── inference/
│   ├── __init__.py
│   └── yolo_detector.py              # Pothole YOLO11n MPS inference wrapper
├── models/
│   ├── pothole_yolo11n.pt            # Custom 8-class pothole model checkpoint (5.2 MB)
│   └── yolo11n.pt                    # Pretrained COCO vehicle model checkpoint (5.4 MB)
├── pipeline_coordinator.py           # Primary controller orchestrating threads and services
├── ring_buffer/
│   ├── __init__.py
│   └── rolling_buffer.py             # Volatile RAM FIFO ring buffer (180 frames)
├── scripts/                          # Verification, test, and benchmark scripts
│   ├── benchmark_traffic_perception.py
│   ├── manual_dev_cleanup.py
│   ├── test_end_to_end_physical.py
│   ├── test_evidence_lifecycle.py
│   ├── test_manual_cleanup.py
│   └── test_retention_manager.py
├── server/
│   ├── __init__.py
│   └── api_server.py                 # FastAPI backend exposing REST and MJPEG streams (:5050)
├── storage/
│   ├── __init__.py
│   ├── manual_cleanup.py             # CLI operator maintenance engine
│   ├── retention_manager.py          # Automated 800MB/200MB retention policy daemon
│   └── sqlite_db.py                  # SQLite schema, queue transitions, and queries
├── tests/
│   ├── __init__.py
│   ├── test_network_interruption.py  # Automated stream drop and reconnect test
│   ├── test_stream.py                # Live physical RTSP smoke test
│   └── test_traffic_pipeline.py      # Unit test suite for traffic perception (13 tests)
├── traffic/
│   ├── __init__.py
│   ├── congestion.py                 # 4-tier congestion regime classification
│   ├── density.py                    # Polygon road corridor occupancy calculation
│   ├── flow.py                       # Virtual line crossing flow (VPM)
│   ├── metrics.py                    # Dataclasses and traffic state structures
│   ├── track_history.py              # Trajectory centroid smoothing and displacement speed
│   ├── vehicle_tracker.py            # Facade integrating YOLO11n + ByteTrack
│   └── visualizer.py                 # HUD, bounding box, and trajectory drawing
└── transmission/
    ├── __init__.py
    └── central_client.py             # Canonical REST client for Central API communication
```

---

# 30. Installation & Environment Setup

### 30.1 Prerequisites
- **Operating System**: macOS (Apple Silicon M1/M2/M3 recommended) or Linux (Ubuntu 22.04+).
- **Python**: Version `3.10`, `3.11`, or `3.12`.
- **Node.js**: Version `18+` or `20+` LTS.
- **MediaMTX**: Lightweight open-source RTSP proxy server.
- **FFmpeg**: Compiled with H.264 support (`brew install ffmpeg`).

### 30.2 Virtual Environment & Dependencies
```bash
# Clone the repository
git clone https://github.com/iUjjwalRaj/RAAHI-Edge.git
cd RAAHI-Edge

# Create and activate Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install core dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Verify accelerated PyTorch MPS support
python3 -c "import torch; print('MPS Available:', torch.backends.mps.is_available())"
```

### 30.3 Dashboard Frontend Setup
```bash
cd dashboard
npm install
cd ..
```

---

# 31. Operational Startup Sequence

To start the complete vehicle perception environment, launch the services in the following order:

### Terminal 1: MediaMTX RTSP Server
```bash
cd RAAHI-Edge
PATH="/opt/homebrew/bin:$PATH" mediamtx mediamtx.yml
```
*(Listening on `rtsp://127.0.0.1:8555`)*

### Terminal 2: Android RAAHI-Eye Camera Feed
1. Mount the Samsung S23 FE to the vehicle windshield.
2. Connect the phone via USB or connect to the vehicle Wi-Fi hotspot.
3. Launch the **RAAHI Eye** application (`com.example.raahieye`).
4. Tap **Start Streaming**. Verify the status indicates `Streaming (1080p @ 30 FPS)`.

### Terminal 3: Edge Pipeline Coordinator & API Server
```bash
cd RAAHI-Edge
source venv/bin/activate
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" python -m uvicorn server.api_server:app --host 0.0.0.0 --port 5050
```

### Terminal 4: Edge Operator Dashboard UI
```bash
cd RAAHI-Edge/dashboard
npm run dev
```
*(Access dashboard at `http://localhost:5174`)*

### Terminal 5: Automated Verification (Optional Sanity Check)
```bash
cd RAAHI-Edge
source venv/bin/activate
python scripts/test_end_to_end_physical.py
```

---

# 32. Diagnostic & Troubleshooting Procedures

### 32.1 RTSP Stream Disconnected or Stalled
- **Symptom**: `components.rtsp` or `components.camera` reports `OFFLINE` or `STALLED`.
- **Diagnosis**: Verify MediaMTX is active (`lsof -i :8555`). Confirm the phone can reach the host IP.
- **Resolution**: Toggle streaming off and on within the Android app. Check USB tethering settings.

### 32.2 Low Processing FPS ($< 25\text{ FPS}$)
- **Symptom**: `processingFps` drops below camera input rate.
- **Diagnosis**: Check device backend in API status (`inferenceDevice`). If it says `cpu` instead of `mps`, PyTorch cannot access Apple Metal acceleration.
- **Resolution**: Verify macOS version and reinstall PyTorch with MPS support. Ensure cadence stride is set to `2`.

### 32.3 Central Connection Reporting Offline
- **Symptom**: `components.centralConnection` indicates `OFFLINE`.
- **Diagnosis**: Check if Central server is running on port 5001 (`curl -i http://localhost:5001/api/status`).
- **Resolution**: Start the RAAHI-Central server (`node dashboard/server/index.js`).

### 32.4 Storage Cap Reached Alert
- **Symptom**: Dashboard warns of storage limit reached (`LIMIT_REACHED_PROTECTED`).
- **Diagnosis**: Numerous un-transmitted events are filling the disk because the vehicle has been offline.
- **Resolution**: Connect the vehicle to Wi-Fi to allow the transmission queue to drain. Alternatively, run manual development cleanup:
  ```bash
  python scripts/manual_dev_cleanup.py --force
  ```

---

# 33. Technical Glossary

- **Edge AI**: Executing neural network perception algorithms directly on localized embedded compute hardware on the vehicle, rather than sending uncompressed raw data to cloud servers.
- **RTSP (Real-Time Streaming Protocol)**: Network control protocol designed for multiplexing and streaming real-time multimedia content over IP networks.
- **H.264 / AVC**: Highly efficient video compression standard utilizing motion compensation and discrete cosine transforms to minimize streaming bitrates.
- **YOLO (You Only Look Once)**: State-of-the-art single-stage anchor-free convolutional object detection architecture capable of real-time multi-scale inference.
- **ByteTrack**: Tracking-by-detection algorithm that preserves low-score detection bounding boxes to recover partially occluded object trajectories.
- **Region of Interest (ROI)**: A defined spatial polygon within the video camera's coordinate plane isolating the target analysis zone (the road corridor).
- **Occupancy Ratio**: The proportion of the road ROI surface area physically covered by vehicle bounding boxes at any given point in time.
- **Vehicles Per Minute (VPM)**: Normalized dynamic flow rate measuring how many vehicles cross a designated virtual tripwire per unit time.
- **$t_0$ Pre-Buffer Anchoring**: The engineering technique of locking pre-event frame extraction to the exact timestamp of detection acceptance, isolating evidence duration from filesystem write latency.
- **Haversine Formula**: Mathematical spherical trigonometry formula calculating great-circle distances between two coordinate points on Earth from their latitudes and longitudes.
- **MediaMTX**: Ultra-low-latency, zero-dependency real-time video streaming proxy and message broker.

---

# 34. Final Architecture Summary

RAAHI-Edge delivers an enterprise-grade, offline-first vehicular perception stack tailored for municipal and national transit networks:
1. **Intelligent at the Edge**: Dual YOLO11n models (Pothole + Vehicle) and ByteTrack execute directly on vehicle hardware, guaranteeing sub-30ms latencies without cloud compute costs.
2. **Deterministic at the Core**: Central performs zero AI inference, relying entirely on deterministic Haversine spatial deduplication (10m), cross-bus traffic correlation, and automated Google Drive evidence archival.
3. **Data & Bandwidth Minimized**: Continuous 30 FPS video remains in local volatile RAM; only high-value $t_0$-anchored 15-second evidence clips and compact telemetry JSON payloads are transmitted.
4. **Resilient to Reality**: Equipped with a 60-second storage retention engine, an offline-first SQLite transmission queue, and sub-second stream reconnection mechanics, RAAHI-Edge operates reliably under real-world transit conditions.
