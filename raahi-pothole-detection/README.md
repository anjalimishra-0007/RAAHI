# RAAHI Pothole Detection

## Planned Dataset Workflow

Raw Images
→ Annotation
→ Train/Validation/Test Split
→ YOLO Format
→ `dataset/roboflow/`
→ YOLO Training

### Workflow Description
- **Raw Images (`dataset/raw/`)**: Source road and surface images containing potholes.
- **Annotation**: Annotating pothole instances with bounding box labels.
- **Train/Validation/Test Split**: Splitting annotated data into training, validation, and testing sets.
- **YOLO Format**: Formatting images and annotations according to YOLO requirements (normalized coordinates and `data.yaml`).
- **`dataset/roboflow/`**: Destination directory for the exported Roboflow YOLO dataset.
- **YOLO Training**: Training the YOLO object detection model using the prepared dataset.

---

## Phase 16: Live Video Evidence → Google Drive Integration

### 1. Architecture Flow
```
Phone Camera
    ↓ (Wi-Fi HTTPS)
Express /api/live/frame & Stream /api/live/stream
    ↓
Python live_camera.py
    ├─ RollingFrameBuffer (~2.0s in-memory circular ring buffer)
    └─ YOLO11n Inference (Apple Silicon MPS)
         ↓
    Pothole Detection Event (conf >= 0.35)
         ↓
    POST /api/live/detection
         ↓
    GPS Match + 10m Geographical Deduplication
         ↓
    Backend checks if pothole already has videoUrl
         ├─ hasVideo == True → Skip recording
         └─ requiresEvidence == True → Trigger Evidence Capture:
              ├─ Snapshot ~2.0s PRE-BUFFER frames
              ├─ Capture ~3.0s POST-BUFFER live frames
              ├─ Assemble ~5.0s MP4 clip in videos/evidence/
              └─ Background worker:
                   ↓
                   POST /api/dev/upload-live-evidence
                   ↓
                   liveEvidenceService.js (duplicate check)
                   ↓
                   googleDriveService.js (upload to 'RAAHI-Pothole-Evidence')
                   ↓
                   Receive real Google Drive File ID & URL
                   ↓
                   Update MongoDB pothole.videoUrl
                   ↓
                   Dashboard renders verified evidence
```

### 2. Evidence Buffer Design
- **Pre-Buffer**: In-memory `RollingFrameBuffer` continuously retains ~2.0 seconds of recent live frames (e.g. ~50 frames at 25 FPS) with strict upper memory bounds (`max_capacity=80`, ~35MB RAM). Frames are not persisted to disk until a confirmed detection occurs.
- **Post-Buffer**: Captures the subsequent ~3.0 seconds of live camera frames as they arrive.
- **Total Duration**: Approximately 5.0 seconds (e.g., 2.0s pre-detection + 3.0s post-detection) at actual measured stream FPS.
- **Format**: Deterministic filename `videos/evidence/${potholeId}_detection-${detectionId}.mp4`, encoded via OpenCV `VideoWriter` (`mp4v`) and remuxed with H.264 faststart.

### 3. Google Drive Integration & MongoDB Persistence
- Reuses the existing Google Drive OAuth 2.0 integration (`googleDriveService.js`).
- Clips are uploaded directly to the dedicated private folder `RAAHI-Pothole-Evidence`.
- Canonical view URL `https://drive.google.com/file/d/${fileId}/view` is saved to `pothole.videoUrl` in MongoDB only upon confirmed upload success.

### 4. Duplicate Evidence Protection
- Before initiating any upload, `liveEvidenceService.js` queries MongoDB for the target pothole.
- If `videoUrl` is already populated (e.g., from an earlier detection by the same or different bus), the upload is skipped and the existing URL is reused.

### 5. Testing Phase 16
```bash
# Run the deterministic Phase 16 test suite:
/Users/admin/Desktop/RAAHI/venv/bin/python tests/test_live_evidence_pipeline.py

# Run the live end-to-end simulation:
/Users/admin/Desktop/RAAHI/venv/bin/python tests/test_live_e2e_pothole_pipeline.py
```

### 6. Required Environment Variables (in `dashboard/.env`)
- `GOOGLE_DRIVE_CLIENT_ID`: Google Cloud OAuth Client ID
- `GOOGLE_DRIVE_CLIENT_SECRET`: Google Cloud OAuth Client Secret
- `GOOGLE_DRIVE_REFRESH_TOKEN`: Authorized OAuth Refresh Token
- `GOOGLE_DRIVE_REDIRECT_URI`: Registered OAuth Redirect URI (`http://localhost:5001/api/dev/auth/google/callback`)
- `GOOGLE_DRIVE_FOLDER_NAME`: Target Drive folder (defaults to `RAAHI-Pothole-Evidence`)

---

## Phase 17: Real-Time Incident Management & Dashboard Synchronization

### 1. Architecture
```
Phone Camera
    ↓ (Wi-Fi HTTPS)
YOLO11n Inference
    ↓
Pothole Detection Event
    ↓
GPS Match + 10m Deduplication
    ↓
MongoDB (source of truth)
    ↓ (5-second polling)
Dashboard auto-refreshes
    ├─ Incident list updates
    ├─ Map markers update
    ├─ Statistics update
    └─ Evidence appears when videoUrl available
```

### 2. MongoDB as Source of Truth
- All pothole incidents originate from the live detection pipeline and are stored in MongoDB.
- The dashboard frontend polls the backend every **5 seconds** for updated data.
- Browser refresh reconstructs the entire incident list from `GET /api/potholes`.
- No separate frontend incident database is maintained.

### 3. Dashboard Synchronization
- **Polling interval**: 5 seconds (configurable, reduced from 20s for near-real-time)
- **Stats endpoint**: `GET /api/potholes/stats` — returns aggregated counts by status
- **Potholes endpoint**: `GET /api/potholes` — returns full incident list with optional `?status=` filter
- React cleanup: All polling timers are properly cleared on component unmount (no memory leaks)

### 4. Incident Status Workflow
Potholes follow a 4-state lifecycle managed through the PATCH API:

```
open → investigating → repaired
  ↓                       ↑
  └──── ignored ──────────┘
```

**API**: `PATCH /api/potholes/:potholeId/status`

Request:
```json
{
  "status": "investigating"
}
```

Allowed values: `open`, `investigating`, `repaired`, `ignored`

Invalid values return HTTP 400 and MongoDB remains unchanged.

### 5. Available APIs (Phase 17 additions)
| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/potholes/:potholeId/status` | Update incident status |
| GET | `/api/potholes/stats` | Aggregated statistics by status |

All previous APIs remain unchanged and functional:
- `GET /api/status`, `GET /api/detections`, `GET /api/potholes`, `GET /api/potholes/:id`
- `GET /api/gps`, `GET /api/gps/history`, `GET /api/live/status`, `GET /api/live/stream`
- `GET /api/live/evidence/status`, `GET /api/video`

### 6. Testing Phase 17
```bash
# Ensure MongoDB and Express server are running first:
cd dashboard && node server/index.js

# Run the Phase 17 test suite:
node dashboard/server/test_phase17_incident_management.js
```

Tests cover:
1. Pothole retrieval from MongoDB
2. Dashboard API visibility
3. Status transitions (open → investigating → repaired) + invalid status rejection (400)
4. Statistics accuracy against MongoDB data
5. No duplicate potholeIds
6. One map marker per potholeId
7. POT-000002 Phase 12 Drive evidence preserved
8. POT-000004 Phase 16 Drive evidence preserved
9. All existing API endpoints respond correctly

---

## Phase 18 — Multi-Bus Fleet Simulation & Cross-Bus Deduplication

Phase 18 demonstrates the real-world fleet scenario where multiple RAAHI transit buses travel through the same road network and detect the same physical pothole. The backend uses the 10-meter spherical Haversine geographical deduplication engine to maintain a single MongoDB incident record, increment `detectionCount`, and maintain an accurate, unique `busesDetectedBy` array. At the same time, genuinely different potholes create separate incidents.

### 1. Multi-Bus Architecture & Deduplication Semantics
- **Simulated Fleet Buses**: `RAAHI-01`, `RAAHI-02`, and `RAAHI-03`.
- **Same Physical Pothole Test**:
  - Base coordinate: `(28.613905, 77.209008)`
  - Bus 1 (`RAAHI-01`): `(28.613905, 77.209008)` [d = 0.00m] → Creates initial incident (`POT-000002`), `detectionCount: 1`, `busesDetectedBy: ['RAAHI-01']`.
  - Bus 2 (`RAAHI-02`): `(28.613912, 77.209015)` [d = 1.04m, < 10m] → Deduplicated into `POT-000002`, `detectionCount: 2`, `busesDetectedBy: ['RAAHI-01', 'RAAHI-02']`.
  - Bus 3 (`RAAHI-03`): `(28.613920, 77.209012)` [d = 1.71m, < 10m] → Deduplicated into `POT-000002`, `detectionCount: 3`, `busesDetectedBy: ['RAAHI-01', 'RAAHI-02', 'RAAHI-03']`.
- **Far-Away Pothole Test**:
  - Location: `(28.704100, 77.102500)` [d = 14,442m, > 10m threshold].
  - Bus 1 (`RAAHI-01`) → Creates distinct incident (`POT-000003`), `detectionCount: 1`, `busesDetectedBy: ['RAAHI-01']`.
- **Bus Duplicate Protection**:
  - Repeat detection by `RAAHI-01` on base pothole → Increments `detectionCount` to 4, while `busesDetectedBy` retains strict uniqueness: `['RAAHI-01', 'RAAHI-02', 'RAAHI-03']`.

### 2. Running the Multi-Bus Fleet Simulator
Ensure MongoDB and Express server are running (`node dashboard/server/index.js`), then run:

```bash
# Run the controlled fleet simulation:
node dashboard/server/simulate_multi_bus.js

# Optional: Safely clean previous simulation records before re-running
node dashboard/server/simulate_multi_bus.js --clean
```

### 3. Automated Multi-Bus Tests
Two independent automated test suites are provided:

```bash
# Node.js automated test suite (33 assertions):
node dashboard/server/test_multi_bus_simulation.js

# Python automated test suite (34 assertions):
python3 tests/test_multi_bus_simulation.py
```

### 4. Verification Coverage
1. **TEST 1**: First bus (`RAAHI-01`) creates incident document.
2. **TEST 2**: Second bus (`RAAHI-02`) detects within 10m → same `potholeId`.
3. **TEST 3**: Third bus (`RAAHI-03`) detects within 10m → same `potholeId`.
4. **TEST 4**: `detectionCount` becomes 3.
5. **TEST 5**: `busesDetectedBy` contains all three buses.
6. **TEST 6**: Exactly ONE document created within 10m of physical pothole.
7. **TEST 7**: Far-away pothole (>10m) creates a separate `potholeId`.
8. **TEST 8**: Repeat detection by same bus does not duplicate bus ID.

---

## Phase 1 Architecture Migration: Canonical Central Event Ingestion

### 1. Final Architecture & Responsibilities
```
RAAHI-EDGE:
Samsung S23 FE
→ H.264
→ RTSP / MediaMTX
→ OpenCV
→ YOLO11n
→ ByteTrack where required
→ Event filtering
→ Phone GPS + timestamp association
→ Evidence capture
→ SQLite / offline queue
→ Event Package
→ 4G/5G
→ RAAHI CENTRAL

RAAHI-CENTRAL:
Event Ingestion API (POST /api/central/events)
→ Candidate Event (status: 'pending')
→ Central Promotion Engine
→ Cross-bus data fusion
→ 10m Haversine spatial deduplication
→ MongoDB Authoritative Persistence
→ Google Drive Evidence Vault
→ Central Command Center
```

### 2. Architectural Constraints
- **Central does NOT run real-time camera inference**: No YOLO, no OpenCV frame inference, no ByteTrack, and no Central-side GPS timestamp matching.
- **GPS association occurs on Edge**: Central receives pre-associated GPS latitude, longitude, and accuracy inside the canonical Event Package.
- **No Central VLM**: In Phase 7B, the VLM layer was permanently removed. Edge YOLO11n provides the authoritative detector; Central performs deterministic candidate review, promotion, and 10m Haversine spatial fusion.
- **Legacy Endpoints Preserved**: Continuous raw frame ingestion (`/api/live/frame`, `/api/live/stream`) and in-memory GPS telemetry buffers (`/api/gps`, `/api/gps/history`) remain operational strictly as backward-compatible prototype endpoints.

### 3. Canonical Ingestion Contract (`POST /api/central/events`)

Request body:
```json
{
  "eventId": "EVT-000123",
  "eventType": "pothole",
  "busId": "RAAHI-01",
  "timestamp": "2026-09-15T10:30:00.000Z",
  "latitude": 28.613905,
  "longitude": 77.209008,
  "accuracy": 3.5,
  "edgeModel": "YOLO11n",
  "confidence": 0.88,
  "class": "pothole",
  "boundingBox": { "x1": 120, "y1": 240, "x2": 210, "y2": 320 },
  "evidenceReference": "https://drive.google.com/file/d/sample-evidence/view",
  "centralDeliveryStatus": "received"
}
```

Response (HTTP 201 Created on new event, HTTP 200 OK on idempotent retry):
```json
{
  "success": true,
  "created": true,
  "duplicate": false,
  "message": "Candidate event ingested successfully (pending review).",
  "candidateId": "CAN-000001",
  "edgeEventId": "EVT-000123",
  "status": "pending",
  "candidate": { ... }
}
```

---

## Phase 2 Architecture: CandidateEvent Decoupling

### 1. Clean Separation of Candidate Events & Authoritative Incidents
- **CandidateEvent (`models/CandidateEvent.js`)**:
  - Edge detections are stored in the dedicated `candidate_events` collection.
  - Identified by sequential `candidateId` (`CAN-XXXXXX`) and canonical `edgeEventId`.
  - Stores complete Edge Event Package verbatim.
  - Strict initial lifecycle status: `status = 'pending'`.
  - Does **NOT** create or touch authoritative records in `potholes` upon ingestion.
- **Authoritative Potholes (`models/Pothole.js`)**:
  - Stores promoted, 10m-deduplicated physical road defects (`POT-XXXXXX`).
  - Protected from unpromoted candidate pollution.
  - `GET /api/potholes` and `GET /api/potholes/stats` query the `potholes` collection exclusively.

### 2. Internal Candidate Inspection APIs
- `GET /api/central/candidates`: List candidate events with query filters:
  - `?status=pending|promoted`
  - `?busId=RAAHI-01`
  - `?eventType=pothole`
  - `?limit=100&sort=-createdAt`
- `GET /api/central/candidates/:candidateId`: Retrieve a specific candidate event by `candidateId` (`CAN-XXXXXX`) or `edgeEventId`.

### 3. Running Phase 2 Automated Tests
```bash
node dashboard/server/test_central_event_ingestion.js
```

---

## Phase 7B Architecture: Central Event Promotion & 10m Geospatial Deduplication (Non-VLM)

### 1. Architecture Flow
```
RAAHI Eye (Samsung S23 FE)
    ↓
RTSP Stream
    ↓
MediaMTX RTSP Server
    ↓
RAAHI-Edge (OpenCV + YOLO11n + GPS + Evidence)
    ↓
Canonical Event Package
    ↓
POST /api/central/events
    ↓
CandidateEvent (candidate_events collection, status: 'pending')
    ↓
POST /api/central/candidates/:candidateId/promote
    ↓
Central Event Promotion Layer (services/centralEventPromotionService.js)
    ├─ Strict Eligibility Check (Supported class: 'pothole', 'road_damage')
    ├─ Idempotency Check (If already promoted, returns existing record)
    ├─ Normalization Adapter (Preserves Edge GPS, class, confidence verbatim)
    └─ Existing 10m Geospatial Deduplication Engine (services/potholeDeduplicationService.js)
         ├─ Within <= 10m of existing incident → Aggregates into existing Pothole (POT-XXXXXX)
         │    ├─ Increments detectionCount
         │    ├─ Appends new busId to busesDetectedBy
         │    └─ Updates lastDetectedAt & latest confidence
         └─ Beyond > 10m → Creates new Authoritative Pothole (POT-XXXXXX)
              └─ Saves edgeEventId, sourceCandidateId, class, confidence, evidence
    ↓
CandidateEvent.promotedToPotholeId updated & status set to 'promoted'
    ↓
Authoritative Pothole exposed in Municipal Dashboard (GET /api/potholes, /stats)
```

### 2. Strict Architectural Boundaries & Principles
- **CandidateEvent is the audit / source event**: Stored permanently in `candidate_events`. It is never deleted upon promotion.
- **Direct Promotion without VLM**: Promotion does not require or call any VLM service. Supported classifications (`pothole`, `road_damage`) are validated directly against the Edge detection payload.
- **Unsupported classes are refused**:
  - Classes outside supported authoritative road defects (e.g. `speed_breaker`, `manhole_cover`) return status `UNSUPPORTED_CLASSIFICATION` and create zero authoritative potholes.
- **Edge telemetry immutability**:
  - GPS coordinates and accuracy from Edge are passed directly to deduplication.
  - Central performs zero GPS-to-detection matching.
  - Edge confidence is preserved verbatim in `Pothole.confidence`.
  - Edge class is preserved verbatim in `Pothole.class`.
- **Existing 10m Haversine algorithm preserved**: The existing spherical distance formula and 10-meter clustering radius are maintained without modification.
- **Idempotency**: Multiple promotion calls for the same candidate return the existing Pothole without rerunning deduplication or incrementing counters.

### 3. Promotion APIs
- `POST /api/central/candidates/:candidateId/promote`: Promotes an eligible candidate (`CAN-XXXXXX` or `edgeEventId`) to an authoritative incident.

### 4. Running Central Automated Tests
```bash
node dashboard/server/test_central_event_ingestion.js
node dashboard/server/test_central_event_promotion.js
node dashboard/server/test_geographical_deduplication.js
node dashboard/server/test_phase17_incident_management.js
```

---

## Phase 8B: Edge Vehicle Detection & ByteTrack Intelligence

### 1. Overview & Dual Pipeline Architecture
Phase 8B introduces the first, minimal Edge Traffic Intelligence capability for RAAHI alongside the existing pothole pipeline.

```
Samsung S23 FE / RAAHI Eye
        ↓
    H.264 / RTSP
        ↓
    MediaMTX
        ↓
    RAAHI-Edge (src/live_camera.py)
    ├── Custom YOLO11n → Pothole Pipeline (8 road defect classes)
    │       ↓
    │   Pothole Event + GPS + Evidence → Central Ingestion → Authoritative Pothole
    │
    └── COCO YOLO11n (yolo11n.pt) → ByteTrack → Local Traffic Metrics
            ↓
        Vehicle Detection (car, motorcycle, bus, truck)
            ↓
        ByteTrack (Local Track IDs)
            ↓
        Active Counting & Class Breakdown
            ↓
        Local OpenCV HUD Overlay (Edge Diagnostic Only)
```

### 2. Execution Modes
The Edge pipeline supports three execution modes:
- `--mode pothole` (Default): Runs only the primary pothole detection pipeline using the custom trained model.
- `--mode traffic`: Runs only vehicle detection and ByteTrack tracking using base COCO YOLO11n. API dispatch is disabled.
- `--mode dual`: Runs both models concurrently. Pothole inference runs on every frame; traffic inference runs at a configurable cadence (`--traffic-cadence 3`, ~8–10 FPS) to conserve Apple Silicon compute resources.

### 3. Track ID Semantics & Boundaries
- **Strictly Local IDs**: ByteTrack IDs (e.g. Track #12) are scoped exclusively to the local camera session. They are NEVER treated as global vehicle IDs, cross-bus identities, or permanent vehicle identifiers.
- **Local Metrics**: Active vehicle count, per-class breakdown (cars, motorcycles, buses, trucks), and session unique track IDs observed.
- **No Central Traffic API**: No traffic data or vehicle tracks are transmitted to Central Command in Phase 8B (`POST /api/central/traffic` is NOT implemented).
- **Features Explicitly Out of Scope**: Speed estimation, congestion detection, traffic density heatmaps, and cross-bus vehicle Re-ID.

### 4. Running & Testing Phase 8B
```bash
# Unit test suite (7 tests):
./venv/bin/python tests/test_traffic_tracker.py

# Run Traffic Mode:
./venv/bin/python src/live_camera.py --mode traffic --source videos/input/cityRoad_potHoles-side.mp4

# Run Dual Mode:
./venv/bin/python src/live_camera.py --mode dual --traffic-cadence 3 --source videos/input/cityRoad_potHoles-side.mp4

# Run Pothole Mode (Default):
./venv/bin/python src/live_camera.py --mode pothole --source videos/input/cityRoad_potHoles-side.mp4
```

---

## Phase 8C: Edge Traffic Density, Flow & Congestion

### 1. Overview & Architecture
Phase 8C introduces meaningful, localized traffic measurements on the Edge, building upon the Phase 8B ByteTrack baseline:

```
Samsung S23 FE / RAAHI Eye
        ↓
    H.264 / RTSP
        ↓
    MediaMTX
        ↓
    RAAHI Edge (src/live_camera.py)
        │
        ├── Custom YOLO11n
        │       ↓
        │   Pothole Pipeline (8 Defect Classes)
        │       ↓
        │   Event + GPS + Evidence → Central Ingestion → Authoritative Pothole
        │
        └── COCO YOLO11n (yolo11n.pt)
                ↓
             ByteTrack
                ↓
          Local Track History (src/traffic/track_history.py)
                ↓
        ┌───────┼────────┐
        ↓       ↓        ↓
      Flow   Density  Traffic State
        │       │        │
        └───────┼────────┘
                ↓
           Local Edge HUD (OpenCV)
```

### 2. Traffic Flow Measurement
- **Definition**: Flow counts vehicles that physically crossed a virtual counting line across the roadway. Active tracks on screen are NOT counted as flow.
- **Virtual Counting Line**: Configurable via `--count-line x1,y1,x2,y2` (normalized coordinates; default: `((0.05, 0.65), (0.95, 0.65))`).
- **Crossing Logic**: 2D line segment intersection against vehicle center displacement vectors ($P_{prev} \rightarrow P_{curr}$).
- **Single Count Guard**: Each vehicle crossing event is counted strictly once per vehicle track ID with debounce guards to prevent duplicate counts while hovering near the line.
- **Directions**: `IN`, `OUT`, and `UNKNOWN` (ambiguous/near-zero displacement).
- **Rolling Windows**: Exposes counts over the last 10s, 30s, and 60s, alongside normalized vehicles-per-minute (VPM).

### 3. Camera-Relative Road Density & Occupancy
- **Road ROI**: Configurable road surface polygon via `--traffic-roi x1,y1,x2,y2,...` (normalized coordinates; default: road trapezoid `[(0.10, 0.95), (0.32, 0.45), (0.68, 0.45), (0.90, 0.95)]`).
- **Vehicles in ROI**: Count of active tracked vehicles whose center falls inside the ROI polygon (`cv2.pointPolygonTest`).
- **Occupancy Ratio**: Camera-relative fraction of ROI surface area covered by vehicle bounding boxes. Uses downscaled binary mask rasterization to guarantee exact pixel unions and safeguard against overlapping boxes.
- **Density Levels**:
  - `LOW`: Occupancy < 15%
  - `MEDIUM`: 15% <= Occupancy < 35%
  - `HIGH`: Occupancy >= 35%
- **Calibration Note**: Density and occupancy are strictly camera-relative metrics based on visible perspective pixels. They must NOT be interpreted as physical units (e.g. vehicles/km²) without camera calibration and road homography.

### 4. Rule-Based Traffic State Classification
Classifies local traffic into four regimes without any ML classifier:
- `CONGESTED`: High occupancy (>= 35%) with low/stalled flow (<= 3 VPM), OR extreme occupancy (>= 45%), OR >= 6 vehicles crowded in ROI.
- `HEAVY`: Significant occupancy (>= 25%) or >= 4 vehicles in ROI with active flow.
- `MODERATE`: Moderate vehicle presence (occupancy >= 10% or >= 2 vehicles in ROI).
- `FREE`: Sparse or zero vehicles, low occupancy (< 10%), unobstructed road.

### 5. Running & Testing Phase 8C
```bash
# Run Phase 8C unit test suite (13 tests):
./venv/bin/python tests/test_traffic_phase8c.py

# Run Traffic Mode with Phase 8C Flow, Density, and HUD Overlays:
./venv/bin/python src/live_camera.py --mode traffic --source videos/input/cityRoad_potHoles-side.mp4

# Run Dual Mode (Pothole + Cadenced Traffic Intelligence):
./venv/bin/python src/live_camera.py --mode dual --traffic-cadence 3 --source videos/input/cityRoad_potHoles-side.mp4

# Run Pothole Mode (Default, 100% untouched):
./venv/bin/python src/live_camera.py --mode pothole --source videos/input/cityRoad_potHoles-side.mp4
```


