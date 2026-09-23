# RAAHI Central: Authoritative Fleet Intelligence & Municipal GIS Platform

> **Project RAAHI (Road Assessment and Hazard Intelligence)**
> **Central Aggregation, Spatial Deduplication, and Civic Infrastructure System**
> Repository: `https://github.com/iUjjwalRaj/RAAHI-Central.git`
> Primary Production Host: `https://raahi.feminismindia.com`
<br>
> Secondary Alias Host: `https://raahi.ujjwalraj.online`
<br>
> Edge Companion: `https://github.com/iUjjwalRaj/RAAHI-Edge.git`

---

## Executive Architectural Notice: Zero Central AI / VLM / LLM Inference

```
+---------------------------------------------------------------------------------------+
|                       STRICT ARCHITECTURAL INVARIANT                                   |
|                                                                                       |
|   RAAHI-Central performs ZERO artificial intelligence, VLM, LLM, or YOLO inference.   |
|   All visual perception and deep learning occurs exclusively on RAAHI-Edge.           |
|                                                                                       |
|   Central intelligence is 100% deterministic and software-based:                     |
|     * Schema sanitization & defensive validation                                     |
|     * Candidate event staging & historical audit trail                                |
|     * Mathematical Haversine 10-meter geospatial deduplication                        |
|     * Temporal & spatial cross-bus traffic correlation (50m / 10min window)           |
|     * Multi-bus fleet aggregation & severity escalation                               |
|     * Request-driven Google Drive OAuth2 digital evidence synchronization             |
|     * Authoritative application state persistence ('candidate_events', 'potholes')    |
|     * Leaflet GIS cartography & municipal dashboard visualization                     |
+---------------------------------------------------------------------------------------+
```

---

## Table of Contents

1. [RAAHI Central Overview](#1-raahi-central-overview)
2. [Complete RAAHI Architecture](#2-complete-raahi-architecture)
3. [Edge vs Central Responsibilities](#3-edge-vs-central-responsibilities)
4. [Central Design Philosophy](#4-central-design-philosophy)
5. [Repository Architecture](#5-repository-architecture)
6. [Central Server](#6-central-server)
7. [Event Ingestion](#7-event-ingestion)
8. [Candidate Event Architecture](#8-candidate-event-architecture)
9. [Pothole Deduplication](#9-pothole-deduplication)
10. [Multi-Bus Traffic Correlation](#10-multi-bus-traffic-correlation)
11. [Data Validation and Cleaning](#11-data-validation-and-cleaning)
12. [GPS and Timestamp Correlation](#12-gps-and-timestamp-correlation)
13. [Fleet Registry](#13-fleet-registry)
14. [Traffic Incident API](#14-traffic-incident-api)
15. [Evidence Upload Pipeline](#15-evidence-upload-pipeline)
16. [Google Drive Integration](#16-google-drive-integration)
17. [MongoDB Data Model](#17-mongodb-data-model)
18. [Central Dashboard](#18-central-dashboard)
19. [GIS / Map Intelligence](#19-gis--map-intelligence)
20. [Central API Reference](#20-central-api-reference)
21. [End-to-End Data Flows](#21-end-to-end-data-flows)
22. [Central Reliability & Process Supervision](#22-central-reliability--process-supervision)
23. [Security & Network Isolation](#23-security--network-isolation)
24. [Performance / Scalability](#24-performance--scalability)
25. [Cost Architecture](#25-cost-architecture)
26. [Testing](#26-testing)
27. [Physical End-to-End Validation](#27-physical-end-to-end-validation)
28. [Current Limitations](#28-current-limitations)
29. [Future Improvements](#29-future-improvements)
30. [Production Deployment Architecture](#30-production-deployment-architecture)
31. [Local Installation & Development Setup](#31-local-installation--development-setup)
32. [Environment Configuration](#32-environment-configuration)
33. [Production Persistence & Service Management](#33-production-persistence--service-management)
34. [Running in Production & Operational Runbook](#34-running-in-production--operational-runbook)
35. [Troubleshooting](#35-troubleshooting)
36. [Repository / GitHub](#36-repository--github)
37. [Technical Glossary](#37-technical-glossary)
38. [Final Architecture Summary](#38-final-architecture-summary)

---

# 1. RAAHI Central Overview

**RAAHI Central** (Road Assessment and Hazard Intelligence) is the authoritative municipal fleet aggregation hub and civic GIS platform for Project RAAHI. Built with Node.js (v22.23.2), Express (v4.21.2), and MongoDB Atlas via Mongoose (v9.10.0), Central provides deterministic 10-meter geospatial deduplication, multi-bus traffic congestion correlation, fleet telemetry ingestion, digital video evidence archival via Google Drive, and interactive Leaflet GIS cartography.

Central is deployed in production on Microsoft Azure (Ubuntu Server 24.04 LTS Gen2, Standard_B2ats_v2 in Central India) backed by a managed MongoDB Atlas cluster (database: `raahi`). Central is exposed publicly through Cloudflare Zero-Trust Tunnel routing to `http://localhost:5001`. Public traffic is served over HTTPS via the primary canonical production hostname **`https://raahi.feminismindia.com`** and a secondary alias **`https://raahi.ujjwalraj.online`** *(note: `raahi.feminismindia.com` is the canonical domain; `ujjwalraj.online` is an active deployment alias that may not be renewed in the future)*.

Central operates as the authoritative counterpart to **RAAHI-Edge**. While edge units in public transit buses execute on-device computer vision and tracking, Central aggregates observations across time, geographic space, and transit fleets into an authoritative database state.

```
+-------------------------------------------------------------------------+
|                               RAAHI-EDGE                                |
|  Samsung S23 FE Camera -> MediaMTX RTSP -> Dual YOLO11n (MPS/NPU)       |
|  -> ByteTrack Tracker -> Event Engine -> GPS Association (~1 Hz GNSS)   |
|  -> 15s Evidence Extraction (5.0s pre-event + 10.0s post-event)         |
+-------------------------------------------------------------------------+
                                     │
               Event JSON Metadata   │   15-Second MP4 Evidence
           (POST /api/central/events) │ (POST /api/central/evidence/upload)
                                     ▼ HTTPS Cellular Uplink
+-------------------------------------------------------------------------+
|                 CLOUDFLARE EDGE & ZERO-TRUST TUNNEL                     |
|  Canonical: https://raahi.feminismindia.com                             |
|  Alias:     https://raahi.ujjwalraj.online                              |
|  DDoS Mitigation & Edge TLS Termination -> cloudflared.service          |
+-------------------------------------------------------------------------+
                                     │ (Outbound Encrypted Tunnel)
                                     ▼
+-------------------------------------------------------------------------+
|                 AZURE VM: raahi-central (Ubuntu 24.04)                  |
|  Loopback Ingestion Gateway: http://localhost:5001 (systemd persistent) |
|  -> Schema Sanitization & Idempotency Enforcement (edgeEventId)         |
|  -> Candidate Event Staging ('candidate_events' collection)             |
|  -> Haversine Mathematical Spatial Deduplication (10m Proximity Radius) |
|  -> Spatial-Temporal Traffic Incident Correlation (50m / 10min Window)  |
|  -> Request-Driven Video Evidence Sync -> Google Drive API (OAuth 2.0)  |
|  -> Authoritative Municipal State ('potholes' & 'trafficincidents')     |
|  -> Production React 18 + Leaflet 1.9 Municipal Command Center          |
+-------------------------------------------------------------------------+
                                     │
                                     ▼ (TLS Mongoose Connection)
+-------------------------------------------------------------------------+
|                          MONGODB ATLAS CLUSTER                          |
|  Authoritative Cloud Database ('raahi')                                 |
+-------------------------------------------------------------------------+
```

### Why Central Exists Separately from Edge

1. **Global Fleet Visibility vs. Local Vehicle Vision**: An edge device in a bus possesses purely local visibility of the roadway ahead. Central maintains fleet-wide visibility, synthesizing disparate observations across transit routes to identify longitudinal road degradation and recurring congestion bottlenecks.
2. **Bandwidth Economics & Network Conservation**: Continuous video streaming over cellular uplinks requires sustained high bandwidth and incurs heavy ongoing cellular costs. Central receives **zero continuous video streams for perception**. Instead, buses transmit lightweight JSON event packages and upload targeted, 15.0-second MP4 evidence clips (5 seconds before the event and 10 seconds after the event, 15s total) only when physical road hazards or severe traffic conditions are verified.
3. **Architectural Privacy Considerations**: Continuous video uploads to cloud servers capture private citizen faces and license plates. RAAHI addresses this through edge perception: raw video frames remain in volatile memory buffers on the vehicle and are discarded. Central receives only structured metadata and event-triggered 15-second evidence clips when anomalies occur, minimizing privacy exposure.
4. **Authoritative Application State**: Municipal public works and transit agencies require a verified, single source of truth to schedule repairs and evaluate infrastructure. Central transforms raw edge detections into auditable civic records with lifecycle status tracking (`open`, `investigating`, `repaired`, `ignored`).

### Data Ingestion and Processing Lifecycle

RAAHI Central receives two discrete streams from connected edge units:
1. **Lightweight Event Packages (`POST /api/central/events`)**: Structured JSON containing `eventId`, `busId`, `eventType` (`pothole`, `congestion`), UTC `timestamp` ($t_0$), high-precision `location` (`latitude`, `longitude`, `accuracy`), `edgeModel` (`YOLO11n`), `confidence`, `class`, `boundingBox` (`x1, y1, x2, y2`), optional `trafficTelemetry`, and `evidenceReference`.
2. **Binary Video Evidence Clips (`POST /api/central/evidence/upload`)**: Targeted 15.0-second MP4 clips ($t_0 - 5.0\text{s}$ to $t_0 + 10.0\text{s}$) providing visual verification of detected road defects or congestion bottlenecks.
3. **Live GPS Telemetry (`POST /api/gps`)**: Periodic vehicle coordinate updates that populate Central's fleet tracking map.

Upon receiving edge data, Central validates schemas, enforces idempotency, stages candidates in `candidate_events`, executes 10-meter Haversine deduplication for potholes, correlates multi-bus traffic reports within 50m / 10-minute windows, syncs evidence to Google Drive, and updates the GIS dashboard. When multiple buses detect the same pothole, Central fuses them into a single record with incremented observation counts and combined reporting bus IDs.

---

# 2. Complete RAAHI Architecture

The complete RAAHI system bridges edge perception on transit vehicles with central fleet intelligence across the cloud. Perception occurs exclusively at the vehicle edge; aggregation, correlation, and authoritative state management occur exclusively at Central.

```
   VEHICLE CABIN (SAMSUNG GALAXY S23 FE)
   +-------------------------------------------------------------------------+
   |  Physical S23 FE Camera (1080p @ 30 FPS Optical Ingestion)              |
   |  Hardware Exynos Encoder (c2.exynos.h264.encoder, 6.0 Mbps)             |
   |  RAAHI Eye Android Application (com.example.raahieye)                   |
   +-------------------------------------------------------------------------+
                                      │
                                      ▼ (Hardware H.264 / RTSP Stream)
   ON-VEHICLE EDGE NODE (RAAHI-EDGE)
   +-------------------------------------------------------------------------+
   |  MediaMTX RTSP Server & Low-Latency Video Receiver                      |
   |  Decoded Frames -> Rolling Ring Buffer (180 Frames Memory Retention)    |
   |  Dual YOLO11n Models (Pothole & Vehicle Perception on MPS/NPU)          |
   |  ByteTrack Multi-Object Tracking & Road ROI Telemetry Engine            |
   |  GPS Synchronization (~1 Hz GNSS Updates Associated at Detection Instant)|
   |  Evidence Capture: 15.0s Clip (5.0s Pre-Event + 10.0s Post-Event)       |
   |  Local SQLite Buffer & Offline Queue (data/raahi_edge.db)               |
   +-------------------------------------------------------------------------+
                                      │
                                      ▼ HTTPS Cellular Uplink
   EDGE CLOUD TRANSIT (CLOUDFLARE)
   +-------------------------------------------------------------------------+
   |  Public Ingestion Hostnames:                                            |
   |    * Primary Canonical: https://raahi.feminismindia.com                 |
   |    * Secondary Alias:   https://raahi.ujjwalraj.online                  |
   |  Cloudflare Edge Network (DDoS Mitigation, TLS Termination)             |
   |  Cloudflare Zero-Trust Tunnel Connector (cloudflared.service)           |
   +-------------------------------------------------------------------------+
                                      │
                                      ▼ (Outbound-Only Encrypted Tunnel)
   AZURE CLUSTER / SERVER (RAAHI-CENTRAL)
   +-------------------------------------------------------------------------+
   |  Azure Virtual Machine: raahi-central (Standard_B2ats_v2, Ubuntu 24.04) |
   |  Azure NSG: Port 22 (SSH) Only; Port 5001 Private on localhost          |
   |  RAAHI Central Production Service (systemd: raahi-central.service)      |
   |  Express.js HTTP Ingestion Gateway (:5001, Node.js v22.23.2)            |
   |  POST /api/central/events  &  POST /api/central/evidence/upload         |
   |  POST /api/gps  &  GET /api/status                                      |
   +-------------------------------------------------------------------------+
                                      │
                                      ▼
   +-------------------------------------------------------------------------+
   |  Deterministic Cleaning & Validation (services/centralEventService.js)  |
   |  Candidate Event Staging ('candidate_events' Collection)                |
   |  Haversine 10-Meter Spatial Deduplication ('potholes' Collection)       |
   |  Multi-Bus 50m / 10-Minute Traffic Correlation ('trafficincidents')     |
   |  Dual-Tier Evidence Storage (Local Staging + Google Drive Sync)         |
   |  Production React 18 + Leaflet 1.9 Municipal Command Center          |
   +-------------------------------------------------------------------------+
                                      │
                                      ▼ (TLS Mongoose Connection)
   DATABASE (MONGODB ATLAS)
   +-------------------------------------------------------------------------+
   |  MongoDB Atlas Cluster (Remote Cloud Database: 'raahi')                 |
   |  Collections: candidate_events, potholes, trafficincidents              |
   +-------------------------------------------------------------------------+
```

### The Edge / Central Architectural Boundary

1. **The Perception Invariant**: High-frequency frame processing, object detection, and feature tracking belong 100% to the edge. Central never performs video perception and does not receive continuous raw video streams.
2. **The Telemetry Association Invariant**: Edge devices are physically co-located with vehicle sensors. Video frame detections and GPS coordinates are associated locally at detection time ($t_0$). Central validates coordinate boundaries and records timestamps, but does not alter or increase raw GNSS receiver precision.
3. **The State Authority Invariant**: While Edge owns the immediate observation, Central owns the authoritative application and database state for the system. Only Central determines whether an observation creates a new road defect or updates an existing record.


---

# 3. Edge vs Central Responsibilities

| Architectural Dimension | RAAHI-Edge (Vehicle Node) | RAAHI-Central (Cloud / Server Node) |
| :--- | :--- | :--- |
| **Physical Location** | Vehicle cabin (windshield mount) | Microsoft Azure Cloud (`raahi-central`, Central India) |
| **Hardware Platform** | Samsung S23 FE / Apple Silicon Edge Node | Azure Standard_B2ats_v2 VM (2 vCPU, 1 GiB RAM, Ubuntu 24.04) |
| **Database** | Local SQLite (`data/raahi_edge.db`) | Remote MongoDB Atlas Cluster (`raahi` database) |
| **Video Camera Ingestion** | Hardware 1080p @ 30 FPS ingestion via RTSP | **Zero continuous video ingestion** (receives 15s MP4 clips only) |
| **AI / Machine Learning** | **100% of AI Inference** (Dual YOLO11n on MPS/NPU) | **0% AI Inference** (Strictly zero VLM, LLM, or YOLO) |
| **Object Detection** | Potholes, road cracks, vehicles, obstacles | None |
| **Multi-Object Tracking** | ByteTrack tracking vehicle bounding boxes | None |
| **Traffic Perception** | ROI polygon occupancy, vehicle counting, flow rate | None |
| **Evidence Extraction** | Slices $t_0 - 5.0\text{s}$ to $t_0 + 10.0\text{s}$ clips (15s total) | Receives, stages to disk, and uploads MP4 to Google Drive |
| **GPS Association** | Associates GPS (~1 Hz) at event trigger instant $t_0$ | Validates coordinate bounds and stores telemetry |
| **Offline Buffering** | Local SQLite queue with retry backoff | None (assumes available Central HTTP endpoint) |
| **Data Ingestion Gateway** | HTTP client transmitting event payloads | Express REST endpoints (`/api/central/events`, `/upload`) |
| **Data Validation** | Local schema encoding | Authoritative structural and coordinate sanitization |
| **Spatial Deduplication** | None (reports all verified local detections) | **Haversine 10m clustering** fusing multi-bus passes |
| **Traffic Correlation** | Local road segment congestion calculation | **50m / 10min multi-bus fusion** and severity escalation |
| **Authoritative State** | None (ephemeral local observation state) | **Authoritative database records** (`potholes`, `trafficincidents`) |
| **Incident Lifecycle** | None | Status mutation (`open`, `investigating`, `repaired`) |
| **Storage Engine** | SQLite (`storage/raahi_local.db`) | MongoDB (`candidate_events`, `potholes`, `trafficincidents`) |
| **Cloud Evidence Storage** | None | Google Drive API v3 (OAuth 2.0 integration) |
| **Cartography / GIS** | Local development view | **Leaflet 1.9 GIS Dashboard** with full municipal overlay |
| **Fleet Monitoring** | Transmits periodic GPS breadcrumbs | Maintains in-memory active fleet registry and status |
| **Inference Cost** | Local vehicle power consumption | $0.00 cloud GPU fees (runs on standard CPU) |

> [!IMPORTANT]
> **Zero AI / VLM / LLM Invariant**: RAAHI-Central performs **ZERO** artificial intelligence inference. Central does not execute computer vision models, Vision-Language Models (VLMs), Large Language Models (LLMs), or cloud YOLO networks. Central's intelligence is completely deterministic and algorithmic, relying on spherical trigonometry, temporal window comparisons, schema validation, and relational state graphs.


---

# 4. Central Design Philosophy

RAAHI Central is intentionally architected as a **100% deterministic software system**. Project RAAHI deliberately rejects cloud-side VLM/LLM inference in favor of mathematical rigor, deterministic algorithms, and edge-first perception.

### 1. Mathematical Reproducibility & Verifiability
Geographic space on planet Earth is governed by spherical geometry. If Bus `RAAHI-01` detects a road hazard at $(28.64874^{\circ}, 77.50414^{\circ})$ and Bus `RAAHI-02` detects a hazard at $(28.64877^{\circ}, 77.50417^{\circ})$, the great-circle distance between these two detections is approximately $4.21$ meters. Because $4.21\text{ m} \le 10.00\text{ m}$, they deterministically represent the same physical pothole.

A probabilistic Vision-Language Model introduces non-deterministic sampling, temperature variance, prompt sensitivity, and hallucination risk. Central's Haversine deduplication algorithm produces verifiable, mathematically provable results across executions.

### 2. Predictable Behavior & Civic Verification
Municipal civil engineering departments require deterministic workflows. A municipal repair order cannot be generated based on a probabilistic output score that may fluctuate across model versions. By anchoring Central's intelligence in explicit boundary checks, defined spatial thresholds, and strict enum state machines (`open` $\rightarrow$ `investigating` $\rightarrow$ `repaired`), system behavior remains completely predictable under all operational conditions.

### 3. Architectural Cost Rationale
Deploying cloud-side AI inference for transit fleets introduces significant infrastructure overhead:
- **Cloud GPU Rationale**: Continuous VLM or YOLO inference on cloud GPU instances requires continuous high-end hardware. Central eliminates cloud GPU requirements entirely, operating on standard CPU infrastructure.
- **Bandwidth Rationale**: Eliminating continuous raw video ingestion in favor of lightweight JSON packages and event-triggered 15-second clips drastically reduces cellular data transfer requirements.

### 4. Transparent Auditability
Civic authorities must be capable of auditing why a specific pothole was prioritized. Central provides an explainable audit trail:
$$\text{Pothole } POT-000042 \leftarrow \text{Fused from Candidates } [CAN-000102, CAN-000189, CAN-000244]$$
Each candidate references the vehicle ID, UTC timestamp, GPS coordinates, edge detector confidence, and associated Google Drive video clip. Any civil engineer can independently verify the calculations without black-box opacity.

### 5. Algorithmic Efficiency
Evaluating Haversine distance, updating Mongoose schemas, and executing multi-bus correlation involves lightweight arithmetic operations that execute rapidly on standard CPU threads, avoiding external cloud model invocation latencies.

### 6. Clean Separation of Concerns
Edge computing solves the **perception problem** (extracting structured hazard vectors from optical frames). Central computing solves the **aggregation problem** (synthesizing structured hazard vectors across time and space into actionable municipal intelligence).


---

# 5. Repository Architecture

The RAAHI Central repository contains the Node.js/Express backend server, MongoDB data schemas, deterministic service libraries, test suites, and the React/Vite web dashboard.

```
/Users/ujjwalraj/Desktop/RAAHI22/
├── README.md                                          # Authoritative RAAHI Central Manual
├── .gitignore                                         # Git ignore rules
├── .gitattributes                                     # Git LFS tracking configuration
│
└── raahi-pothole-detection/
    ├── package.json                                   # Root project metadata
    ├── requirements.txt                               # Legacy dependencies
    ├── auto.crt / auto.key                            # Self-signed SSL certificates
    ├── mediamtx.yml                                   # RTSP server config
    │
    ├── models/                                        # Reference weights (Git LFS)
    │   └── pothole_yolo11n.pt
    │
    ├── dataset/                                       # Reference dataset (Git LFS)
    │   └── Pothole Detection.v1i.yolov11.zip
    │
    ├── videos/                                        # Local video assets and evidence staging
    │   ├── input/                                     # Reference input test videos
    │   ├── output/                                    # Processed annotated benchmark videos
    │   └── evidence/                                  # Staging directory for received 15s MP4 clips
    │
    ├── results/                                       # Benchmark outputs
    │   ├── detections.json
    │   └── summary.json
    │
    ├── src/                                           # Legacy perception scripts (migrated to Edge)
    │   ├── detect.py
    │   ├── live_camera.py
    │   └── traffic/
    │
    └── dashboard/                                     # Canonical Central Server & Web Application
        ├── package.json                               # Node.js dependencies & scripts
        ├── package-lock.json                          # Pinned dependency tree
        ├── vite.config.js                             # Vite bundler configuration (Port 5173, proxy /api)
        ├── index.html                                 # HTML5 application entry point
        ├── .env.example                               # Canonical environment variable template
        │
        ├── server/                                    # Express.js Central Backend (Port 5001)
        │   ├── index.js                               # Express server entry point & routes
        │   ├── db.js                                  # Mongoose connection & lifecycle manager
        │   ├── config/drive_token.json                # Persisted Google OAuth2 tokens (gitignored)
        │   ├── models/                                # Mongoose MongoDB Schemas
        │   │   ├── CandidateEvent.js                  # Candidate Event schema (candidate_events)
        │   │   ├── Pothole.js                         # Authoritative Pothole schema (potholes)
        │   │   └── TrafficIncident.js                 # Authoritative Traffic Incident schema
        │   ├── services/                              # Deterministic Central Business Logic
        │   │   ├── centralEventService.js             # Event package validation, ingest & idempotency
        │   │   ├── centralEventPromotionService.js    # Candidate promotion adapter
        │   │   ├── potholeDeduplicationService.js     # 10m spherical Haversine deduplication
        │   │   ├── trafficIncidentService.js          # 50m / 10min multi-bus traffic correlation
        │   │   ├── googleDriveService.js              # Google Drive API v3 OAuth2 video upload
        │   │   ├── potholeService.js                  # Pothole CRUD operations
        │   │   ├── geocodingService.js                # Nominatim reverse geocoding client
        │   │   ├── liveEvidenceService.js             # Live evidence staging helper
        │   │   └── videoEvidenceService.js            # Video evidence attachment utility
        │   ├── utils/gpsMatcher.js                    # Coordinate sanitization & distance utils
        │   └── test_*.js                              # Automated Central Test Suites
        │
        └── src/                                       # React 18 / Vite Central Web Dashboard
            ├── main.jsx                               # React application DOM bootstrap
            ├── App.jsx                                # Master dashboard layout, state & polling loop
            ├── styles.css                             # Unified dark-mode stylesheet
            ├── components/                            # MapView, IncidentList, StatCard, etc.
            ├── services/api.js                        # API client communicating with Port 5001
            └── data/mockData.js                       # Fallback demo fleet markers
```


---

# 6. Central Server

The Central server is implemented in `raahi-pothole-detection/dashboard/server/index.js` using Node.js (ES Module syntax) and Express 4.21.2. It acts as the ingestion and API gateway for all RAAHI edge devices and web dashboard clients.

### Server Architecture & Startup Lifecycle

When started via `systemctl start raahi-central` (in production) or `node server/index.js` (in local development), the server executes:
1. **Environment Configuration**: Loads variables from `dashboard/.env` via `dotenv.config()` and systemd's `EnvironmentFile`.
2. **Database Connection**: Invokes `connectDB()` from `server/db.js` to establish a persistent TLS connection to MongoDB Atlas (database: `raahi`).
3. **Middleware Initialization**:
   - `cors()`: Configures Cross-Origin Resource Sharing for API consumers and the dashboard.
   - `express.json()`: Body parser for JSON metadata payloads.
   - `express.static()`: Mounts `videos/evidence/` at `/evidence` (local playback fallback) and `dist/` at root `/` (serving the compiled React 18 production bundle).
4. **In-Memory State Initialization**:
   - `activeFleet = new Map()`: In-memory registry tracking connected edge devices, coordinates, speeds, and liveness.
   - `latestGps`: Stores the latest received GPS breadcrumb from active vehicles.
   - `gpsHistory`: Rolling circular array of the last 1,000 GPS breadcrumbs (`MAX_GPS_HISTORY`).
5. **Port Binding**: Binds to `process.env.PORT || 5001` on loopback `localhost:5001` and begins listening for HTTP requests routed through Cloudflare Tunnel.

```javascript
// raahi-pothole-detection/dashboard/server/index.js (Excerpts)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB, isDbConnected, getDbInfo } from './db.js';
import * as centralEventService from './services/centralEventService.js';
import * as googleDriveService from './services/googleDriveService.js';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

connectDB();

app.use(cors());
app.use(express.json());
app.use('/evidence', express.static(path.join(PROJECT_ROOT, 'videos/evidence')));
```

### Database Lifecycle Management (`db.js`)

Central encapsulates all database interactions in `server/db.js`. It configures Mongoose 9.10.0 with strict schema validation and attaches connection lifecycle listeners (`connected`, `error`, `disconnected`) with a 5000ms server selection timeout against the remote MongoDB Atlas cluster.

```javascript
export function isDbConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}
```

If MongoDB is temporarily unreachable, Central returns HTTP `503 Service Unavailable` on ingestion requests rather than crashing. The `GET /api/status` endpoint provides real-time operational status (`connected: true`, `readyState: 1`, `databaseName: "raahi"`).

---

# 7. Event Ingestion

The canonical ingestion entry point for RAAHI Central is:

```http
POST /api/central/events
Content-Type: application/json
```

This endpoint receives structured Event Packages from RAAHI-Edge devices operating on buses. It implements end-to-end validation, normalization, idempotency checking, candidate staging, and automatic deterministic promotion.

```
Edge Event Package (JSON)
           │
           ▼
[POST /api/central/events]
           │
           ├─► Database Connected? ──(No)──► Return HTTP 503 Service Unavailable
           │
           ├─► Schema Validation ────(Invalid)──► Return HTTP 400 Bad Request
           │
           ├─► Normalize Payload (Cast numbers, parse ISO dates, format bounding box)
           │
           ├─► Idempotency Check (edgeEventId in candidate_events)
           │         │
           │         └──(Exists)──► Return HTTP 200 OK (duplicate: true, candidateId)
           │
           ├─► Generate Candidate ID (CAN-XXXXXX)
           │
           ├─► Persist to MongoDB ('candidate_events' collection)
           │
           ├─► Update In-Memory Active Fleet Registry (activeFleet Map)
           │
           ├─► Event Type Routing:
           │         │
           │         ├─► 'pothole' ──► promoteCandidate() ──► Haversine 10m Deduplication
           │         │                                        └──► Create/Update 'potholes'
           │         │
           │         └─► 'congestion' ──► createOrUpdateTrafficIncident()
           │                                 └──► Spatial-Temporal Correlation (50m / 10min)
           │                                 └──► Create/Update 'trafficincidents'
           ▼
Return HTTP 201 Created (candidateId, promotion/correlation results)
```

### Canonical Request Payload Schema

```json
{
  "eventId": "EVT-20260919-RAAHI01-00042",
  "eventType": "pothole",
  "busId": "RAAHI-01",
  "timestamp": "2026-09-19T08:34:12.450Z",
  "location": {
    "latitude": 28.648740,
    "longitude": 77.504140,
    "accuracy": 3.2
  },
  "edgeModel": "YOLO11n",
  "confidence": 0.89,
  "class": "pothole",
  "boundingBox": {
    "x1": 340,
    "y1": 520,
    "x2": 490,
    "y2": 660
  },
  "evidenceReference": "EVT-20260919-RAAHI01-00042_evidence.mp4",
  "trafficTelemetry": null
}
```

### Ingestion Execution Details

1. **Payload Normalization (`normalizeEventPackage`)**: Supports flat coordinates (`latitude`, `longitude`) or nested objects (`location.latitude`). Normalizes bounding boxes into standard `{x1, y1, x2, y2}`. Rounds confidence to 2 decimal places and parses timestamps into `Date` objects.
2. **Idempotency Enforcement**: Checks `CandidateEvent.findOne({ edgeEventId })`. If an edge device re-transmits an event after a network drop, Central returns `HTTP 200 OK` with `duplicate: true`, preventing duplicate database entries.
3. **Sequential Candidate ID Generation (`getNextCandidateId`)**: Generates unique zero-padded IDs (e.g., `CAN-000042`).
4. **Candidate Staging**: Inserts into MongoDB `candidate_events` with initial state `status: 'pending'`.
5. **Deterministic Routing**: Potholes trigger `promoteCandidate()` for 10m Haversine deduplication; traffic events trigger `createOrUpdateTrafficIncident()` for 50m / 10-minute multi-bus correlation.
6. **Active Fleet Update**: Updates `activeFleet` in RAM so the bus appears on the live map.


---

# 8. Candidate Event Architecture

In RAAHI Central, incoming edge observations are staged before authoritative promotion. Central implements a formal **Candidate Event Architecture** in `models/CandidateEvent.js` and `services/centralEventPromotionService.js`.

### Why Candidate Events Exist

1. **Buffer Between Raw Sensor Data and Civic Records**: Edge detections are sensor observations subject to road vibration, temporary glare, or transient obstacles. Candidate events act as an ingestion staging buffer, preventing civic table pollution.
2. **Historical Audit Trail**: Candidate records preserve the raw bounding box, edge confidence, model name, and vehicle timestamp. While records may be updated to link evidence or promotion status, they maintain historical traceability.
3. **Multi-Observation Fusion Target**: Multiple candidate events from different buses point to the same authoritative pothole ID (`promotedToPotholeId: 'POT-000012'`), enabling complete provenance tracing.

### `CandidateEvent` Schema Summary (`models/CandidateEvent.js`)

The `candidate_events` collection stores every received event with:
- `candidateId` (String, Unique, Indexed): Sequential ID (`CAN-000042`)
- `edgeEventId` (String, Unique, Indexed): Canonical UUID from RAAHI-Edge
- `eventType` (String): `'pothole'` or `'congestion'`
- `busId` (String, Indexed): Vehicle identifier (`RAAHI-01`)
- `timestamp` (Date, Indexed): UTC observation instant ($t_0$)
- `location`: `{ latitude, longitude, accuracy }` (WGS 84, indexed)
- `edgeModel` (String): Deep learning model (`'YOLO11n'`)
- `confidence` (Number): Edge confidence ($0.0$ to $1.0$)
- `class` (String): Detection label (`'pothole'`, `'road_damage'`)
- `boundingBox`: `{ x1, y1, x2, y2 }`
- `evidenceReference` & `videoUrl`: MP4 clip reference and Google Drive link
- `status` (Enum: `['pending', 'promoted']`) & `promotedToPotholeId` (String, Indexed)

### Candidate Promotion Service (`centralEventPromotionService.js`)

- **Class Eligibility**: Only candidates matching supported authoritative classes (`'pothole'`, `'road_damage'`) are eligible for promotion. Non-supported classes remain recorded in `candidate_events` for audit.
- **Telemetry Preservation**: Edge coordinates and confidence scores are preserved verbatim; Central never averages or recalculates them.
- **Idempotency**: Multiple promotions of the same candidate return the existing record without duplicate creation.
- **Lifecycle Transition**: Central updates `candidate.status = 'promoted'` and assigns `candidate.promotedToPotholeId = targetPotholeId`.


---

# 9. Pothole Deduplication

Municipal bus fleets travel along fixed routes. If a pothole exists on a route, multiple buses passing over that segment will detect it. RAAHI Central implements **Deterministic 10-Meter Spatial Deduplication** in `services/potholeDeduplicationService.js`.

### The Spherical Haversine Formula

$$\Delta\phi = (\text{lat}_2 - \text{lat}_1) \cdot \frac{\pi}{180}, \quad \Delta\lambda = (\text{lon}_2 - \text{lon}_1) \cdot \frac{\pi}{180}$$

$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\left(\text{lat}_1 \cdot \frac{\pi}{180}\right) \cdot \cos\left(\text{lat}_2 \cdot \frac{\pi}{180}\right) \cdot \sin^2\left(\frac{\Delta\lambda}{2}\right)$$

$$c = 2 \cdot \text{atan2}\left(\sqrt{a}, \sqrt{1-a}\right), \quad d = R \cdot c \quad (R = 6,371,000\text{ m})$$

```javascript
// raahi-pothole-detection/dashboard/server/services/potholeDeduplicationService.js
const EARTH_RADIUS_METERS = 6371000;

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const deltaPhi = (lat2 - lat1) * toRad;
  const deltaLambda = (lon2 - lon1) * toRad;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 100) / 100;
}
```

### The 10-Meter Threshold & Deduplication Logic

The radius is governed by `POTHOLE_DEDUP_RADIUS_METERS` (defaults to **10.0 meters**), which accommodates standard GPS horizontal accuracy while staying narrower than city block intersections.

When candidate coordinates are submitted to `createOrUpdatePothole(candidate)`:
1. Central queries existing active potholes (`status !== 'ignored'`).
2. Calculates Haversine distance to each candidate.
3. **If Distance $\le 10.0\text{ m}$**: Selects closest pothole, increments `detectionCount`, updates `lastDetectedAt`, appends `busId` to `busesDetectedBy`, updates latest confidence and video URL. Duplicate creation is **suppressed**.
4. **If Distance $> 10.0\text{ m}$**: Creates a new canonical record (`POT-XXXXXX`) with `detectionCount: 1`.

### Worked Numerical Example

- **Bus A (RAAHI-01)**: Latitude $28.64874^{\circ}$, Longitude $77.50414^{\circ}$. Creates `POT-000001` (`detectionCount: 1`).
- **Bus B (RAAHI-04)**: Latitude $28.64877^{\circ}$, Longitude $77.50417^{\circ}$ (observed later).
- **Haversine Distance**:
  $$d \approx 4.21\text{ meters} \le 10.00\text{ meters}$$
- **Result**: Fused into `POT-000001` (`detectionCount: 2`, `busesDetectedBy: ["RAAHI-01", "RAAHI-04"]`).

> [!NOTE]
> Deduplication is **100% deterministic geographic mathematics**. Zero AI, machine learning, or neural networks are involved.


---

# 10. Multi-Bus Traffic Correlation

Unlike static potholes, traffic congestion is transient. A single slowing bus may merely indicate passenger boarding. When multiple independent transit buses traversing the same road segment report severe congestion concurrently, it confirms a municipal traffic incident.

Central implements **Deterministic Multi-Bus Traffic Correlation** in `models/TrafficIncident.js` and `services/trafficIncidentService.js`.

### Correlation Thresholds

Traffic correlation is governed by two deterministic boundary windows:
1. **Spatial Radius Threshold**: $50.0\text{ meters}$ (`DEFAULT_TRAFFIC_SPATIAL_RADIUS_METERS`). Accounts for the physical length of multi-vehicle queues.
2. **Temporal Window**: $10\text{ minutes}$ ($600,000\text{ ms}$) (`DEFAULT_TRAFFIC_TEMPORAL_WINDOW_MS`). Restricts correlation to active, concurrent congestion conditions.

### Correlation Algorithm Flow

When an edge candidate package arrives with `eventType === 'congestion'` or `class === 'traffic_congestion'`, Central passes the candidate to `createOrUpdateTrafficIncident(candidate)`:

```javascript
// raahi-pothole-detection/dashboard/server/services/trafficIncidentService.js
export async function createOrUpdateTrafficIncident(candidate) {
  const lat = candidate.location?.latitude;
  const lng = candidate.location?.longitude;
  const ts = candidate.timestamp ? new Date(candidate.timestamp) : new Date();
  const busId = (candidate.busId || 'RAAHI-01').trim();
  const edgeEventId = candidate.edgeEventId || candidate.candidateId;

  const telemetry = candidate.trafficTelemetry || {};
  const { activeVehicles, vehiclesInRoi, occupancyRatio, flowVpm, trafficState } = telemetry;

  // 1. Search for existing active traffic incident within 50m and last 10 minutes
  const match = await findNearbyTrafficIncident(lat, lng, ts);

  if (match) {
    // 2. Correlate with existing incident
    const incident = match.incident;
    incident.detectionCount = (incident.detectionCount || 1) + 1;
    incident.lastDetectedAt = ts;

    if (!incident.busesReportedBy.includes(busId)) {
      incident.busesReportedBy.push(busId);
    }
    if (!incident.edgeEventIds.includes(edgeEventId)) {
      incident.edgeEventIds.push(edgeEventId);
    }

    // Update traffic density metrics to latest
    incident.metrics = { activeVehicles, vehiclesInRoi, occupancyRatio, flowVpm };
    incident.trafficState = trafficState || 'CONGESTED';

    // Multi-bus correlation elevates severity
    if (incident.busesReportedBy.length >= 2) {
      incident.severity = 'critical'; // Elevated due to multi-bus verification!
    } else if (occupancyRatio > 0.6) {
      incident.severity = 'high';
    } else {
      incident.severity = 'medium';
    }

    const saved = await incident.save();
    return { success: true, action: 'correlated', incident: saved };
  }

  // 3. Create new traffic incident
  const nextId = await getNextTrafficIncidentId(); // TRF-INC-XXXXXX
  const severity = occupancyRatio > 0.6 ? 'high' : 'medium';

  const newIncident = new TrafficIncident({
    incidentId: nextId,
    edgeEventId,
    eventType: 'congestion',
    trafficState: trafficState || 'CONGESTED',
    severity,
    location: { latitude: lat, longitude: lng },
    firstDetectedAt: ts,
    lastDetectedAt: ts,
    detectionCount: 1,
    busesReportedBy: [busId],
    metrics: { activeVehicles, vehiclesInRoi, occupancyRatio, flowVpm },
    status: 'active',
    edgeEventIds: [edgeEventId]
  });

  const saved = await newIncident.save();
  return { success: true, action: 'created', incident: saved };
}
```

### Dynamic Multi-Bus Severity Escalation

- **1 Bus Reporting**: Severity is classified as `medium` (or `high` if ROI occupancy $> 0.60$). Represents localized slowdown.
- **2 or More Independent Buses Reporting**: Severity is automatically escalated to **`critical`**. When multiple distinct buses confirm gridlock on the same 50m corridor within 10 minutes, Central flags the road segment as a high-priority congestion bottleneck on the GIS console.


---

# 11. Data Validation and Cleaning

Central enforces strict schema validation and defensive sanitization in `services/centralEventService.js` through `validateEventPackage(payload)`. Every field is audited against mathematical boundaries and structural constraints. Non-compliant requests are immediately rejected with HTTP `400 Bad Request`.

### Validation Rules and Rejection Criteria

| Field | Validation Constraint | Error Message on Rejection |
| :--- | :--- | :--- |
| `payload` | Must be a non-null JSON object | `"Payload must be a non-null JSON object."` |
| `eventId` / `edgeEventId` | Must be a non-empty string | `"Missing or invalid 'eventId'. Must be a non-empty string."` |
| `eventType` | Must be a non-empty string | `"Missing or invalid 'eventType'. Must be a non-empty string."` |
| `busId` | Must be a non-empty string | `"Missing or invalid 'busId'. Must be a non-empty string."` |
| `timestamp` | Must parse into a valid Date | `"Invalid 'timestamp' value. Must be a valid ISO 8601 string."` |
| `latitude` | Finite number, $-90.0 \le \text{lat} \le 90.0$ | `"Invalid GPS latitude. Must be a finite number between -90 and 90."` |
| `longitude` | Finite number, $-180.0 \le \text{lng} \le 180.0$ | `"Invalid GPS longitude. Must be a finite number between -180 and 180."` |
| `accuracy` | If provided, finite number $\ge 0.0$ | `"Invalid GPS accuracy. Must be a non-negative finite number."` |
| `edgeModel` | Non-empty string (e.g. `'YOLO11n'`) | `"Missing or invalid 'edge model'. Must specify edge detector."` |
| `confidence` | Finite number, $0.0 \le \text{conf} \le 1.0$ | `"Invalid 'confidence' score. Must be between 0.0 and 1.0."` |
| `class` | Non-empty string (e.g. `'pothole'`) | `"Missing or invalid detection 'class'. Must be a non-empty string."` |
| `boundingBox` | Object: `{x1, y1, x2, y2}` or `{x, y, w, h}` | `"Invalid 'boundingBox' format."` |
| `evidenceReference` | If provided, must be a string | `"Invalid 'evidence reference'. When provided, must be a string."` |

### Coordinate & Bounding Box Normalization

Central normalizes coordinate formats across different edge revisions:
- Extracts coordinates whether transmitted flatly (`latitude`) or nested (`location.latitude`, `gps.latitude`).
- Parses stringified numbers safely using `parseFloat()` and verifies `Number.isFinite()`.
- Extracts and unifies bounding box formats via `extractBoundingBox()`, converting `{ x, y, width, height }` or arrays `[x1, y1, x2, y2]` into standard `{ x1, y1, x2, y2 }`.


---

# 12. GPS and Timestamp Correlation

Spatial-temporal accuracy is fundamental to RAAHI. Central's deduplication and multi-bus correlation algorithms rely on geographic coordinates and temporal synchronization.

### Why Edge Associates GPS at Detection Instant ($t_0$)

Vehicular edge sensing experiences variable network latency; an event package may wait in the SQLite queue for tens of seconds before cellular transmission succeeds.

If Central attempted to timestamp the event upon HTTP receipt ($t_{\text{arrival}}$), the event would be attributed to the wrong road segment—a bus traveling at $40\text{ km/h}$ covers over $440\text{ meters}$ in 40 seconds.

Therefore, **RAAHI-Edge anchors GPS coordinates and timestamps locally at instant $t_0$**. When the package arrives at Central:
- `timestamp` represents the UTC instant the physical road defect was observed by the camera.
- `createdAt` represents the Central server ingestion timestamp.
- Central executes all spatial-temporal correlation against the Edge `timestamp`.

### GPS Telemetry & Precision Disclosures

Edge GPS telemetry is captured on the vehicle using Android's `FusedLocationProviderClient`, delivering updates at approximately 1 Hz comprising `latitude`, `longitude`, `accuracy`, and `timestamp`. In physical roadway testing, observed horizontal accuracy was approximately 14–21 meters.

Central validates coordinate boundary limits ($-90.0 \le \text{latitude} \le 90.0$, $-180.0 \le \text{longitude} \le 180.0$) and stores timestamps formatted with millisecond resolution. However, Central does not alter or artificially increase physical GNSS accuracy.

### Temporal Window Matching

For traffic correlation, Central evaluates timestamps against rolling time windows:
```javascript
const targetTime = timestamp ? new Date(timestamp).getTime() : Date.now();
const windowStart = new Date(targetTime - DEFAULT_TRAFFIC_TEMPORAL_WINDOW_MS);

const activeIncidents = await TrafficIncident.find({
  status: 'active',
  lastDetectedAt: { $gte: windowStart },
  'location.latitude': { $exists: true, $ne: null },
  'location.longitude': { $exists: true, $ne: null }
});
```
This guarantees that morning slowdowns are never mistakenly correlated with evening congestion incidents on the same street segment.


---

# 13. Fleet Registry

Central provides a live transit vehicle tracking registry through the canonical endpoint:

```http
GET /api/fleet/buses
```

### In-Memory Fleet State Architecture

Connected edge buses stream GPS breadcrumbs and event packages to Central. To provide low-latency queries for the GIS dashboard without placing continuous write pressure on MongoDB, Central maintains an in-memory registry:

```javascript
// raahi-pothole-detection/dashboard/server/index.js
const activeFleet = new Map();
```

Whenever an event package arrives at `POST /api/central/events` or a telemetry ping arrives at `POST /api/gps`, Central updates the vehicle's entry in `activeFleet`:
- `id`: Vehicle registration identifier (e.g., `RAAHI-01`)
- `route`: Assigned transit route
- `lat` / `lng`: Latest geographic coordinates
- `accuracy`: Horizontal GPS accuracy in meters
- `speed`: Current vehicle velocity in km/h
- `status`: Dynamic liveness status (`'online'` or `'offline'`)
- `camera`: Camera pipeline status (`true`)
- `lastSeen`: Human-readable indicator (`'Now'`)
- `updatedAt`: Epoch timestamp of last communication

### Liveness Timeout & Offline Transition

When `GET /api/fleet/buses` is called, Central evaluates liveness:
```javascript
const now = Date.now();
for (const [bId, busInfo] of activeFleet.entries()) {
  const isOnline = (now - busInfo.updatedAt) < 60000; // 60-second liveness threshold
  buses.push({
    ...busInfo,
    status: isOnline ? 'online' : 'offline'
  });
}
```
If a bus loses connectivity or finishes its shift, Central automatically transitions its status to `offline` after 60 seconds of silence. Because this registry is held in server RAM, it resets if the server process restarts.

### Response Schema

```json
{
  "success": true,
  "count": 2,
  "buses": [
    {
      "id": "RAAHI-01",
      "route": "Active Route 7A",
      "lat": 28.613905,
      "lng": 77.209008,
      "accuracy": 3.2,
      "speed": 28.4,
      "status": "online",
      "camera": true,
      "lastSeen": "Now",
      "updatedAt": 1789785252000
    },
    {
      "id": "RAAHI-04",
      "route": "Active Route 12",
      "lat": 28.621512,
      "lng": 77.216745,
      "accuracy": 4.1,
      "speed": 0.0,
      "status": "online",
      "camera": true,
      "lastSeen": "Now",
      "updatedAt": 1789785248000
    }
  ]
}
```


---

# 14. Traffic Incident API

Central exposes active traffic incidents to municipal traffic management operations through:

```http
GET /api/traffic/incidents
```

### Query & Filtering Architecture

This endpoint queries the MongoDB `trafficincidents` collection, returning up to 100 active incidents sorted by most recent observation:

```javascript
app.get('/api/traffic/incidents', async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.json({ success: true, count: 0, incidents: [] });
    }
    const incidents = await TrafficIncident.find().sort('-lastDetectedAt').limit(100).lean();
    res.json({ success: true, count: incidents.length, incidents });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

### Incident Response Schema

```json
{
  "success": true,
  "count": 1,
  "incidents": [
    {
      "_id": "66e92f1b8a1c890123456789",
      "incidentId": "TRF-INC-000004",
      "edgeEventId": "EVT-20260919-RAAHI01-00108",
      "eventType": "congestion",
      "trafficState": "CONGESTED",
      "severity": "critical",
      "location": { "latitude": 28.6215, "longitude": 77.2167, "accuracy": 3.8 },
      "firstDetectedAt": "2026-09-19T08:15:30.000Z",
      "lastDetectedAt": "2026-09-19T08:22:10.000Z",
      "detectionCount": 3,
      "busesReportedBy": ["RAAHI-01", "RAAHI-02"],
      "metrics": { "activeVehicles": 18, "vehiclesInRoi": 12, "occupancyRatio": 0.78, "flowVpm": 6.5 },
      "status": "active",
      "edgeEventIds": ["EVT-20260919-RAAHI01-00108", "EVT-20260919-RAAHI02-00049"],
      "evidenceReference": "TRF-INC-000004_evidence.mp4",
      "videoUrl": "https://drive.google.com/file/d/1BxyZ.../view"
    }
  ]
}
```

The Central React dashboard polls this endpoint every 6 seconds, rendering pulsing beacons on the map (`critical` = crimson, `high` = dark orange, `medium` = amber).


---

# 15. Evidence Upload Pipeline

When an edge device detects a high-confidence road hazard or severe traffic condition, it generates a 15-second MP4 evidence clip consisting of **5 seconds before the event and 10 seconds after the event** ($t_0 - 5.0\text{s}$ to $t_0 + 10.0\text{s}$; 150 pre-frames + 300 post-frames at 30 FPS = 450 frames total). This clip is transmitted via:

```http
POST /api/central/evidence/upload
Content-Type: video/mp4 (or application/octet-stream)
X-Event-ID: EVT-20260919-RAAHI01-00042
X-File-Name: EVT-20260919-RAAHI01-00042_evidence.mp4
```

### Pipeline Flow

```
RAAHI-Edge (Vehicle) -> 15s MP4 Clip -> [POST /api/central/evidence/upload]
    -> Validate binary stream (up to 100MB) -> Stage to videos/evidence/<fileName>
    -> Google Drive Authenticated?
          ├─► (Yes) -> Synchronously upload to 'RAAHI-Pothole-Evidence' -> Retrieve driveUrl
          └─► (No)  -> Retain in videos/evidence/ -> Local URL /evidence/<fileName>
    -> Update CandidateEvent, Pothole, and TrafficIncident records matching eventId
    -> Return HTTP 200 OK (localUrl, driveUrl, driveFileId, sizeBytes)
```

```javascript
// Implementation excerpt from server/index.js
app.post('/api/central/evidence/upload', express.raw({ limit: '100mb', type: ['video/mp4', 'application/octet-stream'] }), async (req, res) => {
  try {
    const eventId = req.headers['x-event-id'] || req.query.eventId;
    const rawFileName = req.headers['x-file-name'] || req.query.fileName;
    const fileName = (rawFileName ? path.basename(rawFileName) : `${eventId || Date.now()}_evidence.mp4`);

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing file body' });
    }

    const evidenceDir = path.join(PROJECT_ROOT, 'videos/evidence');
    if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

    const targetPath = path.join(evidenceDir, fileName);
    fs.writeFileSync(targetPath, req.body);

    let driveUrl = null, driveFileId = null;
    if (googleDriveService.isAuthenticated()) {
      try {
        const driveResult = await googleDriveService.uploadEvidenceClip({
          filePath: targetPath,
          fileName,
          mimeType: 'video/mp4',
          makePublic: true
        });
        driveUrl = driveResult.url;
        driveFileId = driveResult.fileId;
      } catch (driveErr) {
        console.warn(`Drive upload failed (staged locally): ${driveErr.message}`);
      }
    }

    const localServeUrl = `/evidence/${fileName}`;
    const authoritativeUrl = driveUrl || localServeUrl;

    if (eventId && isDbConnected()) {
      await CandidateEvent.updateMany({ edgeEventId: eventId }, { $set: { evidenceReference: fileName, videoUrl: authoritativeUrl, driveFileId } });
      await Pothole.updateMany({ edgeEventId: eventId }, { $set: { evidenceReference: fileName, videoUrl: authoritativeUrl, driveFileId } });
      await TrafficIncident.updateMany({ edgeEventIds: eventId }, { $set: { evidenceReference: fileName, videoUrl: authoritativeUrl, driveFileId } });
    }

    return res.status(200).json({ success: true, eventId, fileName, localUrl: localServeUrl, driveUrl, driveFileId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
```

The Google Drive upload is executed synchronously with `await` within the HTTP request handler. If Drive authentication is unavailable or the upload fails, the clip remains safely staged locally in `videos/evidence/` and served via `/evidence/:fileName`.


---

# 16. Google Drive Integration

Digital video evidence is synchronized to Google Drive via Google Drive API v3 (OAuth 2.0) in `services/googleDriveService.js`.

### Why Google Drive is Used

- **Cost-Free Storage**: 15 GB free storage with affordable scaling, ideal for prototypes and trials.
- **Adaptive Bitrate Streaming**: Built-in video preview player (`webViewLink`) allows users to view 15s clips in browser without dedicated transcoding clusters.
- **Access Control**: Supports public link sharing (for demo evaluation) and private authenticated downloads (for production).

### OAuth 2.0 Architecture

Central uses the Google APIs client (`googleapis` v180.0.0):
1. Loads `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET` from `.env`.
2. Refreshes tokens automatically from `GOOGLE_DRIVE_REFRESH_TOKEN` or `config/drive_token.json`.
3. Auto-provisions root folder `RAAHI-Pothole-Evidence` if not found.
4. Executes request-driven upload inside the route handler when evidence is received.

```javascript
const sharePublic = (process.env.GOOGLE_DRIVE_SHARE_PUBLIC === 'true') || makePublic;
if (sharePublic) {
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' }
  });
}
```

> [!WARNING]
> **Production Privacy Note**: In the prototype, `makePublic` is set to `true` to allow judges and reviewers to view evidence clips without Google login. For **production municipal deployments**, public sharing should be disabled (`GOOGLE_DRIVE_SHARE_PUBLIC=false`), with evidence served securely through authenticated backend proxy streams (`downloadFileBuffer()`).


---

# 17. MongoDB Data Model

RAAHI Central connects remotely over TLS to a managed MongoDB Atlas cluster (database: `raahi`) using Mongoose 9.10.0 with three dedicated collections: `candidate_events`, `potholes`, and `trafficincidents`. Connection strings and credentials are securely injected via environment variables and are never committed to version control.

### Collection 1: `candidate_events` (`models/CandidateEvent.js`)
Stages incoming edge event packages as a historical audit trail.

| Field Name | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Primary Key | MongoDB primary key |
| `candidateId` | `String` | Required, Unique, Indexed | Sequential ID (`CAN-XXXXXX`) |
| `edgeEventId` | `String` | Required, Unique, Indexed | Canonical UUID from Edge |
| `eventType` | `String` | Required, Default `'pothole'` | Classification (`pothole`, `congestion`) |
| `busId` | `String` | Required, Indexed | Vehicle ID (`RAAHI-01`) |
| `timestamp` | `Date` | Required, Indexed | Observation UTC timestamp ($t_0$) |
| `location.latitude` | `Number` | Required, Range `[-90, 90]` | Decimal latitude in WGS 84 |
| `location.longitude` | `Number` | Required, Range `[-180, 180]`| Decimal longitude in WGS 84 |
| `location.accuracy` | `Number` | Default `null` | Horizontal accuracy in meters |
| `edgeModel` | `String` | Required, Default `'YOLO11n'` | Edge detector model |
| `confidence` | `Number` | Required, Range `[0.0, 1.0]` | Detection confidence score |
| `class` | `String` | Required, Default `'pothole'` | Class label |
| `boundingBox` | `Object` | `{ x1, y1, x2, y2 }` | Bounding box coordinates |
| `trafficTelemetry` | `Mixed` | Default `null` | Telemetry payload (activeVehicles, occupancy) |
| `evidenceReference` | `String` | Default `''` | MP4 evidence file name |
| `videoUrl` | `String` | Default `''` | Google Drive or local video URL |
| `driveFileId` | `String` | Default `null` | Google Drive file ID |
| `status` | `String` | Enum `['pending', 'promoted']`| Promotion state |
| `promotedToPotholeId` | `String` | Default `null`, Indexed | Target `POT-XXXXXX` if promoted |

**Indexes**: `{ candidateId: 1 }` (Unique), `{ edgeEventId: 1 }` (Unique), `{ status: 1, createdAt: -1 }`, `{ busId: 1, createdAt: -1 }`, `{ 'location.latitude': 1, 'location.longitude': 1 }`.

---

### Collection 2: `potholes` (`models/Pothole.js`)
Maintains the authoritative civic registry of physical road surface hazards.

| Field Name | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Primary Key | MongoDB primary key |
| `potholeId` | `String` | Required, Unique, Indexed | Canonical incident ID (`POT-XXXXXX`) |
| `location.latitude` | `Number` | Required, Range `[-90, 90]` | Centroid decimal latitude in WGS 84 |
| `location.longitude` | `Number` | Required, Range `[-180, 180]`| Centroid decimal longitude in WGS 84 |
| `location.accuracy` | `Number` | Default `null` | Horizontal accuracy in meters |
| `address` | `String` | Default `''` | Reverse geocoded street address |
| `firstDetectedAt` | `Date` | Default `Date.now` | First observation timestamp |
| `lastDetectedAt` | `Date` | Default `Date.now` | Most recent observation timestamp |
| `detectionCount` | `Number` | Default `1`, Min `1` | Total fused observations across passes |
| `busesDetectedBy` | `[String]` | Default `[]` | Array of distinct bus IDs observing defect |
| `confidence` | `Number` | Range `[0.0, 1.0]` | Latest detection confidence score |
| `videoUrl` | `String` | Default `''` | Google Drive video link |
| `driveFileId` | `String` | Default `null` | Google Drive unique file ID |
| `status` | `String` | Enum `['open', 'investigating', 'repaired', 'ignored']` | Maintenance workflow status |
| `edgeEventId` | `String` | Unique (Partial Index) | First triggering edge event UUID |
| `sourceCandidateId` | `String` | Default `null`, Indexed | First triggering candidate ID |
| `boundingBox` | `Object` | `{ x1, y1, x2, y2 }` | Bounding box coordinates |
| `evidenceReference` | `String` | Default `''` | MP4 evidence file name |

**Indexes**: `{ potholeId: 1 }` (Unique), `{ status: 1 }`, `{ 'location.latitude': 1, 'location.longitude': 1 }`, `{ edgeEventId: 1 }` (Unique partial).

---

### Collection 3: `trafficincidents` (`models/TrafficIncident.js`)
Stores multi-bus correlated traffic congestion incidents.

| Field Name | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Primary Key | MongoDB primary key |
| `incidentId` | `String` | Required, Unique, Indexed | Sequential incident ID (`TRF-INC-XXXXXX`) |
| `edgeEventId` | `String` | Optional | First triggering edge event UUID |
| `trafficState` | `String` | Default `'CONGESTED'` | State label (`CONGESTED`, `SLOW_FLOW`) |
| `severity` | `String` | Enum `['low', 'medium', 'high', 'critical']` | Severity level (critical = 2+ buses) |
| `location.latitude` | `Number` | Required, Range `[-90, 90]` | Centroid decimal latitude |
| `location.longitude` | `Number` | Required, Range `[-180, 180]`| Centroid decimal longitude |
| `firstDetectedAt` | `Date` | Default `Date.now` | Incident onset timestamp |
| `lastDetectedAt` | `Date` | Default `Date.now` | Most recent observation timestamp |
| `detectionCount` | `Number` | Default `1`, Min `1` | Total correlated observations |
| `busesReportedBy` | `[String]` | Default `[]` | Distinct buses reporting this incident |
| `metrics.activeVehicles`| `Number`| Default `0` | Active vehicles in view |
| `metrics.occupancyRatio`| `Number`| Default `0.0` | Spatial occupancy ratio ($0.0$ to $1.0$) |
| `metrics.flowVpm` | `Number` | Default `0.0` | Flow rate (Vehicles/Minute) |
| `status` | `String` | Enum `['active', 'cleared', 'investigating']` | Operational status |
| `edgeEventIds` | `[String]` | Default `[]` | Correlated edge event UUIDs |
| `videoUrl` | `String` | Default `''` | Video evidence URL |

**Indexes**: `{ incidentId: 1 }` (Unique), `{ status: 1 }`, `{ 'location.latitude': 1, 'location.longitude': 1 }`.


---

# 18. Central Dashboard

The RAAHI Central Dashboard is a Single Page Application (SPA) built with **React 18.3.1**, **Vite 6.0.3**, and **Leaflet 1.9.4**. Designed for municipal command centers, it provides near-real-time geospatial visualization, incident triage, candidate inspection, and fleet telemetry monitoring.

### Component Structure & Architecture

```
App.jsx (Master Container, Periodic Polling Loop & State Management)
├── Topbar.jsx (System Health, Online Status, GPS Indicator)
├── Sidebar.jsx (Primary Navigation: Overview, Candidates, Incidents, Fleet, Analytics)
│
├── [Page: overview]
│   ├── StatCard.jsx (Total Potholes, Open Issues, Multi-Bus Correlated, Active Fleet)
│   ├── MapView.jsx (Leaflet GIS: Hazards, Traffic Beacons, Bus Positions)
│   └── IncidentDrawer.jsx (Slide-out triage panel for selected hazard)
│
├── [Page: candidates]
│   ├── CandidatePipeline.jsx (Candidate Event Stream, Verification, Auto-Promote Status)
│   └── CandidateDrawer.jsx (Raw JSON payload inspector & manual promote button)
│
├── [Page: incidents]
│   └── IncidentList.jsx (MongoDB Pothole Records Table, Status Filters, CSV Export)
│
├── [Page: buses]
│   └── FleetPage (Connected Edge Devices, Routes, Speeds, Last-Seen Timestamps)
│
├── [Page: analytics]
│   └── CentralAnalytics.jsx (Incident Frequency, Bus Contribution Charts, Cluster Stats)
│
└── [Page: health]
    └── SystemHealth.jsx (Node Server, MongoDB Readiness, Google Drive OAuth Status)
```

### State Management & Periodic Polling Loop

The dashboard implements an active polling loop in `App.jsx`. Every 6 seconds (when `live` mode is active), Central fetches fresh intelligence across all domains in parallel:

```javascript
// raahi-pothole-detection/dashboard/src/App.jsx
useEffect(() => {
  if (!live) return;
  const timer = setInterval(() => {
    fetchPotholes(statusFilter);
    fetchPotholeStats();
    fetchCandidatesData();
    fetchBusesData();
    fetchTrafficData();
  }, 6000);
  return () => clearInterval(timer);
}, [live, statusFilter]);
```

### Real Data vs. Mock Fallback Disclosures

- **Pothole Incidents**: Sourced live from MongoDB via `GET /api/potholes`.
- **Candidate Events**: Sourced live from MongoDB via `GET /api/central/candidates`.
- **Traffic Incidents**: Sourced live from MongoDB via `GET /api/traffic/incidents`.
- **Connected Buses**: Sourced live from Central in-memory registry via `GET /api/fleet/buses`.
- **Mock Fallback (`data/mockData.js`)**: Static demo bus markers (`initialBuses`) exist purely as a fallback when zero live buses are connected, ensuring dashboard evaluation is possible offline. As soon as live buses connect, Central overrides demo markers with true live vehicle positions.


---

# 19. GIS / Map Intelligence

RAAHI Central geospatial visualization is built on React-Leaflet, wrapping Leaflet 1.9 with an OpenStreetMap tile layer. It translates MongoDB coordinates and fleet telemetry into an interactive municipal dashboard.

```
+-------------------------------------------------------------------------+
|                      LEAFLET GIS CARTOGRAPHY ENGINE                     |
|                                                                         |
|  [Layer: OpenStreetMap CartoDB Tiles]                                   |
|    |                                                                    |
|    +--> Pothole Markers (Custom HTML DivIcons)                          |
|    |      * Critical/High Severity: Red Pulse Marker                    |
|    |      * Medium Severity: Yellow Marker                              |
|    |      * Low Severity: Light Amber Marker                            |
|    |      * In-Progress / Verified: Blue Marker                         |
|    |      * Resolved: Green Check Marker                                |
|    |                                                                    |
|    +--> Fleet Vehicle Markers                                           |
|    |      * Active Bus: Blue Icon with Bus ID label                     |
|    |      * Tooltip: Telemetry (speed, heading, route, last ping)       |
|    |                                                                    |
|    +--> Traffic Congestion Overlays                                     |
|           * Spatial clusters (50m radius circles)                       |
|           * Correlated multi-bus incident highlights                    |
+-------------------------------------------------------------------------+
```

### Custom Marker Rendering & Styling

Central renders custom HTML `DivIcon` elements that display contextual status directly on the map:

1. **Severity-Driven Visual Hierarchy**:
   - **Critical / High Severity**: Rendered in crimson red (`#ef4444`) with a CSS pulse animation for immediate operator attention.
   - **Medium Severity**: Rendered in amber yellow (`#f59e0b`) indicating moderate pavement disruption.
   - **Low Severity**: Rendered in muted yellow (`#fbbf24`) for early surface degradation.
   - **Resolved Defect**: Rendered in emerald green (`#10b981`) confirming municipal remediation.

2. **Fleet Vehicle Visualizer**:
   - Bus markers represent active transit vehicles reporting telemetry to `POST /api/gps`.
   - Tooltips display vehicle telemetry attributes: Bus ID (e.g., `RAAHI-01`), assigned route, instantaneous speed in km/h, and status.

3. **Defect Detail Popup**:
   Clicking any defect marker opens an interactive Leaflet popup containing:
   - Unique Pothole ID (e.g., `POT-000001`).
   - Latitude and Longitude formatted to 6 decimal places.
   - Reverse-geocoded landmark or road name (if available).
   - Detection confidence percentage and estimated depth/dimensions.
   - Direct link to the 15-second MP4 evidence clip hosted on Google Drive or Central local storage.
   - Quick-action buttons to change status (e.g., "Assign Repair", "Mark Resolved").

### Periodic Polling Architecture for Near-Real-Time Updates

To maintain synchronization with the backend without requiring complex WebSocket infrastructure in the current prototype, the GIS interface utilizes client-side periodic polling:
- **Pothole and Incident Telemetry**: Polled every 6 seconds via `GET /api/potholes` and `GET /api/traffic/incidents`.
- **Bus Fleet Telemetry**: Polled every 2 to 3 seconds via `GET /api/fleet/buses` and `GET /api/gps`.

When new events are detected or deduplicated on Central, the map state updates incrementally during the next polling tick, repositioning bus icons and rendering new defect markers dynamically.

---

# 20. Central API Reference

RAAHI Central exposes a RESTful JSON API implemented in Express 4.21 on port `5001`, partitioned into event ingestion, evidence handling, candidate review, fleet tracking, and municipal queries.

All endpoints accept and return `application/json` unless otherwise specified.

- **Primary Canonical Production Base URL**: `https://raahi.feminismindia.com`
- **Secondary Deployment Alias Base URL**: `https://raahi.ujjwalraj.online`
- **Internal Loopback Base URL**: `http://localhost:5001`

---

### Core Edge Ingestion Endpoints

#### 1. Ingest Candidate Event
`POST /api/central/events`

Ingests a structured road hazard or traffic congestion event from an edge unit.

- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "edgeEventId": "evt_edge_1740001122_001",
  "busId": "RAAHI-01",
  "timestamp": "2026-09-19T06:30:15.120Z",
  "eventType": "POTHOLE",
  "location": {
    "latitude": 28.648740,
    "longitude": 77.504140,
    "accuracy": 3.2
  },
  "metadata": {
    "confidence": 0.88,
    "severity": "HIGH",
    "speed": 34.5,
    "weather": "CLEAR"
  }
}
```
- **Responses**:
  - `201 Created`: Event accepted and staged in `candidate_events`. If deduplication succeeds, returns `candidateId` and deduplication disposition (`NEW_INCIDENT` or `DEDUPLICATED_EXISTING`).
  - `400 Bad Request`: Validation failure (missing required fields, coordinates out of range, invalid event type).
  - `409 Conflict`: Duplicate `edgeEventId` already exists (idempotency enforcement).

---

#### 2. Upload Digital Video Evidence Clip
`POST /api/central/evidence/upload`

Receives the 15-second MP4 video clip corresponding to a staged candidate event.

- **Headers**:
  - `Content-Type: video/mp4` or `application/octet-stream`
  - `x-event-id`: `evt_edge_1740001122_001` (staged event ID)
  - `x-file-name`: `evt_edge_1740001122_001_evidence.mp4`
- **Request Body**: Raw binary MP4 stream (up to 100 MB).
- **Processing**:
  - Writes binary file to `videos/evidence/{fileName}`.
  - If Google Drive is authenticated, calls `googleDriveService.uploadEvidenceClip()` synchronously.
  - Updates `CandidateEvent` and `Pothole` records in MongoDB with `evidenceReference`, `videoUrl`, and `driveWebViewLink`.
- **Responses**:
  - `200 OK`: Evidence successfully staged locally and synchronized to Google Drive.
  - `400 Bad Request`: Missing video payload in request body.
  - `500 Internal Server Error`: Disk write error or unhandled storage exception.

---

### Candidate Event & Promotion Endpoints

#### 3. List Candidate Events
`GET /api/central/candidates`

Queries staged candidate events for municipal review.

- **Query Parameters**:
  - `status`: Filter by candidate status (`PENDING`, `PROMOTED`, `REJECTED`).
  - `type`: Filter by event type (`POTHOLE`, `TRAFFIC_CONGESTION`).
  - `limit`: Number of records to return (default: 50).
- **Responses**:
  - `200 OK`: JSON array of candidate event objects.

#### 4. Promote Candidate Event
`POST /api/central/candidates/:candidateId/promote`

Promotes a staged candidate event to the authoritative `potholes` or `trafficincidents` collection.

- **Path Parameter**: `candidateId` (MongoDB ObjectId or custom candidate ID).
- **Responses**:
  - `200 OK`: Candidate promoted successfully; returns updated authoritative entity ID.
  - `404 Not Found`: Candidate ID does not exist.

---

### Telemetry and Incident Endpoints

#### 5. System Health & Connectivity
`GET /api/status`

Returns runtime status of the Central server, database, and third-party integrations.

- **Response `200 OK`**:
```json
{
  "status": "ONLINE",
  "uptimeSeconds": 14205,
  "database": {
    "connected": true,
    "host": "127.0.0.1",
    "database": "raahi_central"
  },
  "googleDrive": {
    "authenticated": true,
    "folder": "RAAHI-Evidence-Storage"
  },
  "fleet": {
    "activeBuses": 3,
    "lastTelemetryPing": "2026-09-19T06:35:00.000Z"
  }
}
```

#### 6. Fleet Telemetry Ingestion & Query
- `POST /api/gps`: Ingests vehicle GPS telemetry ping (`busId`, `latitude`, `longitude`, `speed`, `heading`, `timestamp`).
- `GET /api/fleet/buses`: Returns active fleet list with latest known GPS coordinates, speed, and status.

#### 7. Authoritative Potholes & Traffic Incidents
- `GET /api/potholes`: Returns list of authoritative potholes with filtering by status and bounding box.
- `GET /api/potholes/stats`: Returns aggregated counts (total, pending, in-progress, resolved, severity distribution).
- `GET /api/traffic/incidents`: Returns active multi-bus correlated traffic congestion incidents.

---

### Google Drive OAuth Endpoints

- `GET /api/dev/auth/google/status`: Returns current OAuth token status.
- `GET /api/dev/auth/google/login`: Generates and redirects to Google OAuth 2.0 consent URL.
- `GET /api/dev/auth/google/callback`: Receives authorization code from Google, exchanges for tokens, and persists to `config/drive_token.json`.

---

# 21. End-to-End Data Flows

The collaboration between RAAHI-Edge and RAAHI-Central is organized into deterministic, auditable data flows.

---

### Flow 1: Pothole Detection to Authoritative Municipal Record

```
[ Transit Bus (Edge) ]                           [ Central Ingestion Gateway ]                    [ Municipal Database / Drive ]
         |                                                    |                                                |
         | 1. YOLO Detects Pothole at t0                      |                                                |
         |    (Confidence: 0.88, Severity: HIGH)              |                                                |
         |                                                    |                                                |
         | 2. Ring Buffer Slices 15s MP4                      |                                                |
         |    (t0 - 5.0s to t0 + 10.0s = 450 frames @ 30 FPS) |                                                |
         |                                                    |                                                |
         | 3. POST /api/central/events (JSON Metadata)        |                                                |
         |--------------------------------------------------->|                                                |
         |                                                    | 4. Validate schema & GPS bounds                |
         |                                                    | 5. Query 10m Haversine Radius                  |
         |                                                    |    -> No existing record within 10m            |
         |                                                    | 6. Insert into 'candidate_events'              |
         |                                                    |----------------------------------------------->|
         |                                                    | 7. Create authoritative 'potholes' record      |
         |                                                    |----------------------------------------------->|
         | 8. 201 Created (candidateId: 'CAND-001')           |                                                |
         |<---------------------------------------------------|                                                |
         |                                                    |                                                |
         | 9. POST /api/central/evidence/upload (Binary MP4)  |                                                |
         |--------------------------------------------------->|                                                |
         |                                                    | 10. Write MP4 to disk ('videos/evidence/')     |
         |                                                    | 11. Synchronous Google Drive API Upload        |
         |                                                    |----------------------------------------------->|
         |                                                    | 12. Update CandidateEvent & Pothole records    |
         |                                                    |     with driveWebViewLink and videoUrl         |
         |                                                    |----------------------------------------------->|
         | 13. 200 OK (Evidence Linked)                       |                                                |
         |<---------------------------------------------------|                                                |
         |                                                    |                                                |
         |                                                    | 14. Dashboard Polls GET /api/potholes (6s)     |
         |                                                    |     -> New red pulse marker rendered on map    |
```

---

### Flow 2: Multi-Bus Traffic Congestion Correlation

1. **First Transit Vehicle (Bus `RAAHI-01`)**: Traverses an arterial corridor at 08:30:00 AM, detects low speed (6 km/h) and vehicle clustering, and transmits a candidate event at $(28.6140^{\circ}, 77.2100^{\circ})$. Central stages it as an initial incident.
2. **Second Transit Vehicle (Bus `RAAHI-03`)**: Traverses the corridor 4 minutes later at $(28.6142^{\circ}, 77.2103^{\circ})$—35 meters away—confirming congestion.
3. **Central Deterministic Correlation**: Central calculates Haversine distance ($35.4\text{ m} \le 50.0\text{ m}$) and temporal delta ($255\text{ s} \le 600\text{ s}$). Match verified: Central adds `RAAHI-03`, increments confirmation count to 2, escalates status to `MULTI_BUS_VERIFIED`, and renders the incident on the dashboard.

---

# 22. Central Reliability & Process Supervision

Central provides high operational availability through systemd process supervision, automated crash recovery, resilient database connection handling, and dual-tier evidence storage.

### 1. Systemd Production Process Supervision (`raahi-central.service`)

In production on the Azure VM, RAAHI Central runs as a dedicated systemd service managed under the `raahiadmin` user. The service configuration enforces:
- **Auto-Boot Activation**: `WantedBy=multi-user.target` ensures Central starts immediately upon VM boot without requiring an interactive SSH session or manual command invocation.
- **Unattended Crash Recovery**: Configured with `Restart=always` and `RestartSec=5s`. If the Node.js process ever exits abnormally or is killed, systemd automatically detects the termination and launches a clean replacement instance within 5 seconds.
- **Cgroup Process Management**: `KillMode=control-group` guarantees that child processes spawned by npm/Node are cleanly reaped upon restart.
- **Persistent Cloudflare Tunnel Supervision**: `cloudflared.service` runs concurrently under systemd, ensuring edge ingress remains persistently connected across restarts.

#### Verified Crash Recovery Test
The automatic recovery mechanism was physically validated on the production Azure VM:
1. The active running Node.js process (`PID 12707`) was deliberately terminated using `SIGKILL` (`kill -9`).
2. Systemd journal immediately logged: `Process 12694 ExecStart=/usr/bin/npm start (code=killed, signal=KILL)`, entering `activating (auto-restart)` state.
3. Within exactly 5 seconds, systemd initiated a fresh instance (`Main PID: 12885`), executed `node server/index.js`, and reconnected to MongoDB Atlas (`[MongoDB] Connected successfully!`).
4. Operational probes (`curl http://localhost:5001/api/status`) and external Cloudflare endpoints returned HTTP 200 with full health restored without administrative intervention.

### 2. Database Connection Resilience

Central maintains a persistent connection to MongoDB Atlas using Mongoose with automated retry logic:
- Endpoints verify connectivity via `isDbConnected()` before attempting query execution.
- If Atlas connectivity is temporarily interrupted during a network partition, Central returns structured JSON errors (`503 Service Unavailable`) rather than throwing unhandled promise rejections that would crash the server.
- The `GET /api/status` endpoint remains operational even during database disruptions to report diagnostics to municipal monitoring tools.

### 3. Dual-Tier Evidence Storage

Video evidence is protected by a two-tier storage model:
1. **Primary Local Staging**: Inbound video binaries are immediately saved to the local filesystem under `videos/evidence/{fileName}` using standard POSIX file operations.
2. **Secondary Cloud Upload**: The server then attempts to synchronize the file to Google Drive. If Google Drive authentication is missing, expired, or network-throttled, Central logs a warning and marks the record with the local route (`/evidence/{fileName}`).
3. **Graceful Fallback**: The municipal dashboard can stream the clip directly from Central's local static server, ensuring evidence remains accessible even without external internet access.

---

# 23. Security & Network Isolation

The security posture of RAAHI Central explicitly distinguishes between **implemented prototype controls** and **recommended production enterprise controls**.

```
+-------------------------------------------------------------------------+
|                  SECURITY POSTURE SPECIFICATION                         |
|                                                                         |
|  [CURRENTLY IMPLEMENTED IN PROTOTYPE]                                   |
|    * File Upload Path Sanitization (path.basename directory traversal)  |
|    * MIME-Type & Payload Size Limits (100MB max via express.raw)        |
|    * Local OAuth Token Protection (gitignored drive_token.json)         |
|    * Architectural Privacy: No continuous video streaming to cloud      |
|                                                                         |
|  [RECOMMENDED FOR ENTERPRISE PRODUCTION]                               |
|    * HMAC-SHA256 Edge Device Authentication (x-raahi-edge-key)         |
|    * Mutual TLS (mTLS) for Edge-to-Central Transit Encryption           |
|    * Cloud KMS for OAuth Tokens and DB Credentials                      |
|    * Role-Based Access Control (RBAC) for Municipal Operators           |
|    * Automated Edge-Side Face and License Plate Redaction               |
+-------------------------------------------------------------------------+
```

### Currently Implemented Production Security Controls

1. **Azure Network Security Group (NSG) Ingress Isolation**: The Azure VM's Network Security Group explicitly permits only SSH (port 22) for administrator access. Port 5001 is **NOT publicly exposed through the Azure NSG**; Central binds only to the internal loopback interface, preventing direct port scanning or perimeter attacks.
2. **Cloudflare Tunnel Ingress**: Port 5001 is not exposed through the Azure NSG. Public application traffic is routed through the Cloudflare Tunnel to the loopback service. The `cloudflared.service` connector establishes an outbound-only encrypted connection to Cloudflare's edge network.
3. **Strict Path Traversal Protection**: Upload filenames supplied in HTTP headers are sanitized via `path.basename()` to block directory traversal attacks.
4. **Binary Payload Size Restrictions**: Evidence uploads are strictly capped at 100 MB via `express.raw({ limit: '100mb' })` to prevent buffer overflow or memory exhaustion.
5. **Secret Isolation**: Database connection strings, OAuth client secrets, and environment tokens are stored in `/home/raahiadmin/RAAHI-Central/raahi-pothole-detection/dashboard/.env` with strict filesystem permissions (`chmod 600`), isolated from Git tracking via `.gitignore`.
6. **Architectural Privacy Preservation**: Continuous raw optical video is never transmitted to Central. Central receives only targeted 15-second evidence clips triggered by confirmed road anomalies.

### Recommended Production Controls (Enterprise Roadmap)

For production deployment across a metropolitan municipal network, the following hardening measures are recommended:
- **Edge API Authentication**: Enforce pre-shared HMAC tokens or JWTs on `POST /api/central/*` endpoints to verify that incoming telemetry originates from registered municipal hardware.
- **Mutual TLS (mTLS)**: Enforce bidirectional TLS certificate verification between bus gateway modems and Central load balancers.
- **Role-Based Access Control (RBAC)**: Protect municipal dashboard endpoints with OAuth2 / OpenID Connect authentication, providing distinct roles for Field Technicians, Municipal Engineers, and System Administrators.
- **Automated PII Redaction**: Implement automated edge-side Gaussian blurring for vehicle license plates and pedestrian faces prior to generating the 15-second evidence clips.

---

# 24. Performance / Scalability

Central's performance derives directly from offloading neural network perception to edge devices.

```
+-------------------------------------------------------------------------+
|                    CENTRAL PERFORMANCE CHARACTERISTICS                  |
|                                                                         |
|  Compute Model: CPU-bound, deterministic arithmetic                     |
|  Cloud GPU Requirement: STRICTLY ZERO                                   |
|  Network Ingestion Model: Sparse event-driven JSON + 15s MP4 clips      |
|  Spatial Indexing: MongoDB 2dsphere geospatial index                    |
|  Scaling Potential: Scales horizontally via standard stateless Node.js  |
+-------------------------------------------------------------------------+
```

### 1. Zero Cloud GPU Requirement

Because all object detection, tracking, and traffic perception are executed on vehicle-mounted hardware (Samsung Galaxy S23 FE with hardware NPU/GPU acceleration), Central has zero requirement for cloud GPUs. Central runs comfortably on standard, low-cost commodity CPU instances.

### 2. Efficient Deterministic Arithmetic

Central's intelligence operations are lightweight trigonometric calculations:
- **Haversine Distance**: Computing the spherical distance between two sets of coordinates requires only basic floating-point arithmetic (sin, cos, atan2). Central evaluates spatial proximity without heavy geospatial GIS overhead.
- **Temporal Window Comparison**: Time checks involve simple integer subtraction of Unix timestamps.

### 3. Database Geospatial Indexing

MongoDB collections are optimized for spatial and temporal queries:
- The `location.coordinates` field in the `potholes` collection is indexed with a `2dsphere` index, allowing spherical proximity queries to execute via B-tree index lookups rather than full-collection scans.
- Compound indexes on `[status, createdAt]` allow fast filtering for municipal dashboard views.

### 4. Fleet Scaling as an Architectural Capability

Support for multi-vehicle transit fleets is an architectural capability of RAAHI's decoupled design. Unlike traditional surveillance architectures where vehicles continuously stream high-definition video across cellular channels, RAAHI Edge units transmit only sparse metadata upon defect detection. Physical validation was performed using the physical Samsung Galaxy S23 FE testbed setup; architecturally, this event-driven model allows a single Central server to coordinate multiple transit corridors without network congestion.

---

# 25. Cost Architecture

> [!NOTE]
> **Illustrative Architectural Cost Comparison (Conceptual Estimate)**  
> The figures below represent an illustrative architectural comparison between a traditional cloud-streaming perception architecture and RAAHI's edge-native approach. They are conceptual estimates provided to demonstrate the economic rationale of the architecture, not vendor-audited benchmarks.

```
+-------------------------------------------------------------------------+
|                  ARCHITECTURAL COST MODEL COMPARISON                    |
|                                                                         |
|  TRADITIONAL CLOUD-STREAMING APPROACH:                                  |
|    * Continuous RTSP stream from each bus (1080p @ 30 FPS, ~3 Mbps)    |
|    * Continuous 4G/5G cellular data bandwidth (~1.35 GB / bus / hour)   |
|    * Cloud GPU instances required 24/7 for video decoding & inference   |
|    * Massive cloud ingress and storage egress fees                      |
|                                                                         |
|  RAAHI EDGE-NATIVE ARCHITECTURE:                                        |
|    * Zero continuous video streaming to cloud                          |
|    * Perception executed locally on existing vehicle hardware           |
|    * Only sparse JSON metadata + 15s MP4 clips transmitted              |
|    * Central runs on standard, low-cost commodity CPU VPS              |
|    * Storage uses existing municipal Google Drive / cloud bucket        |
+-------------------------------------------------------------------------+
```

### Architectural Rationale for Edge-Native Processing

1. **Elimination of Cloud GPU Compute**:
   In a traditional computer vision architecture, video from transit cameras is continuously streamed over cellular networks to cloud GPU clusters running YOLO or VLM models. Continuous cloud GPU compute represents a major recurring operational expenditure for municipal transport agencies. By running YOLO11n locally on edge hardware, RAAHI Central eliminates cloud GPU requirements entirely.

2. **Substantial Bandwidth Reduction**:
   Transmitting continuous high-definition video across cellular networks incurs significant SIM data costs and is prone to signal degradation in urban dead zones. RAAHI Edge processes video on-device and transmits only lightweight JSON payloads (approx. 500 bytes per event) and targeted 15-second evidence MP4 clips upon verified defect detections.

3. **Commodity Server Infrastructure**:
   Because RAAHI Central performs only deterministic validation, spatial deduplication, and database persistence, the entire Central backend and dashboard can be hosted on a standard low-cost CPU virtual private server (VPS), keeping municipal infrastructure overhead minimal.

---

# 26. Testing

The Central backend includes 9 specialized verification scripts in `raahi-pothole-detection/dashboard/server/`, validating deterministic deduplication, multi-bus correlation, GPS association, candidate promotion, and evidence storage.

```
+-------------------------------------------------------------------------+
|                       CENTRAL VERIFICATION SUITE                        |
|                                                                         |
|  Location: raahi-pothole-detection/dashboard/server/                    |
|                                                                         |
|  1. test_central_event_ingestion.js   - Schema validation & deduplication|
|  2. test_central_event_promotion.js   - Candidate event promotion flow  |
|  3. test_geographical_deduplication.js - 10m Haversine threshold bounds |
|  4. test_multi_bus_simulation.js      - 3-bus concurrent corridor test  |
|  5. test_phase17_incident_management.js- Traffic incident lifecycle    |
|  6. test_gps_association.js           - Temporal GPS coordinate matching|
|  7. test_history_association.js       - Historical path interpolation   |
|  8. test_geocoding.js                 - Landmark reverse geocoding      |
|  9. test_video_evidence.js            - Drive evidence linking & staging|
+-------------------------------------------------------------------------+
```

### Test Suite Descriptions

1. **`test_central_event_ingestion.js`**: Validates schema checks (400 on missing fields), candidate staging in `candidate_events`, and idempotency (409 on duplicate `edgeEventId`).
2. **`test_geographical_deduplication.js`**: Submits synthetic coordinates at 3m, 7m, 9.5m, and 14m offsets to verify the 10m Haversine boundary.
3. **`test_multi_bus_simulation.js`**: Simulates 3 buses along a shared corridor to verify 50m / 10-minute traffic incident correlation.
4. **`test_central_event_promotion.js`**: Tests manual candidate promotion to `potholes`.
5. **`test_phase17_incident_management.js`**: Tests traffic incident lifecycle and status transitions.
6. **`test_gps_association.js` & `test_history_association.js`**: Validates timestamp-based interpolation of vehicle coordinates.
7. **`test_video_evidence.js`**: Validates binary MP4 uploads, local disk staging, Google Drive linking, and database record updates.

### Running Central Backend Tests

To execute the test suite, ensure MongoDB and the Central server are running:
```bash
cd /Users/ujjwalraj/Desktop/RAAHI22/raahi-pothole-detection/dashboard/server
node test_central_event_ingestion.js
node test_geographical_deduplication.js
node test_multi_bus_simulation.js
node test_central_event_promotion.js
```

---

# 27. Physical End-to-End Validation

RAAHI Central has been physically validated using the real on-vehicle edge testbed connecting a Samsung Galaxy S23 FE (`SM-S711B`, Android 16) to RAAHI Central.

```
+-------------------------------------------------------------------------+
|                  PHYSICAL VALIDATION TESTBED TOPOLOGY                   |
|                                                                         |
|  [ Physical Testbed: Samsung Galaxy S23 FE (SM-S711B) ]                 |
|    * Camera: 1080p @ 30 FPS optical stream                              |
|    * Hardware H.264 Encoder: c2.exynos.h264.encoder (6.0 Mbps)          |
|    * MediaMTX RTSP Server (:8555)                                       |
|    * Physical GNSS Fixes: ~1 Hz satellite telemetry physically verified |
|    * Edge Pipeline: Dual YOLO11n Models (Pothole + Vehicle Perception)  |
|    * Circular Ring Buffer: 15.0s clip (5.0s pre-event + 10.0s post)    |
|                                                                         |
|                                │ (HTTP REST / JSON + MP4)               |
|                                ▼                                        |
|  [ RAAHI Central Server (Port 5001) ]                                   |
|    * Express 4.21 Ingestion Gateway (raahi-central.service)             |
|    * MongoDB Atlas ('candidate_events', 'potholes')                     |
|    * 10m Haversine Deduplication Engine (merged into POT-000002)        |
|    * Synchronous Google Drive API Evidence Upload                       |
|                                                                         |
|                                │ (Web Browser Access via Cloudflare)    |
|                                ▼                                        |
|  [ Leaflet GIS Municipal Dashboard (Port 5001 / Cloudflare) ]           |
|    * Production build served via Express static middleware              |
|    * Rendered verified pothole marker with pulse animation              |
|    * Playable 15-second MP4 evidence clip in modal                      |
|    * Real-time GPS location lock pill                                   |
+-------------------------------------------------------------------------+
```

### Physical Testbed Execution Sequence

1. **Optical Capture & Hardware Encoding**:
   The Samsung Galaxy S23 FE physical camera captured live roadway video, encoded it via the Exynos hardware encoder (`c2.exynos.h264.encoder`) at 1080p @ 30 FPS (6.0 Mbps), and published it over RTSP.
2. **On-Device Edge Perception**:
   The edge pipeline ingested the RTSP stream into OpenCV, executed dual YOLO11n inference, tracked vehicles with ByteTrack, and maintained a continuous 180-frame ring buffer.
3. **GNSS / GPS Functionality Verification**:
   GNSS/GPS functionality was physically verified during testing: the physical S23 FE GNSS chip delivered live satellite coordinates at ~1 Hz cadence, associating coordinates with detection frames at time $t_0$. Telemetry was transmitted to Central's `POST /api/gps` and persisted in edge SQLite.
4. **Deterministic Deduplication & Evidence Archival**:
   - Central ingested candidate packages via `POST /api/central/events`.
   - Haversine deduplication verified candidate distance against existing records, merging multiple observations within 10 meters into authoritative pothole `POT-000002`.
   - Canonical 15.0-second MP4 evidence clips (450 frames @ 30 FPS, 5s pre-event + 10s post-event) were staged on disk and uploaded to Google Drive.
5. **Dashboard Verification**:
   The production React 18 dashboard rendered verified defect markers and live vehicle breadcrumbs with zero runtime errors.

---

# 28. Current Limitations

While RAAHI Central provides a deterministic aggregation and GIS platform, several constraints apply to the current prototype:

1. **Single-Node Cloud Deployment**:
   Central is currently deployed as a single-instance systemd service on an Azure Standard_B2ats_v2 VM (2 vCPU, 1 GiB RAM). While systemd provides automated local process crash recovery and MongoDB Atlas handles database failover, the application tier operates without horizontal multi-node autoscaling.

2. **Synchronous Google Drive Upload**:
   Evidence clip uploads in `POST /api/central/evidence/upload` invoke `googleDriveService.uploadEvidenceClip()` synchronously within the HTTP route handler. Under poor network conditions or Google API throttling, the HTTP response time can extend until the cloud upload completes or times out.

3. **Edge GPS Physical Precision**:
   Vehicle GPS telemetry on edge transit units relies on Android's `FusedLocationProviderClient` updating at approximately 1 Hz (one sample per second). In physical roadway testing, observed horizontal positioning accuracy was approximately 14–21 meters. Central validates coordinates and stores timestamps with millisecond formatting, but does not increase physical GNSS accuracy.

4. **Dashboard Polling Update Loop**:
   The Leaflet municipal dashboard relies on periodic client-side polling (2-second intervals for fleet telemetry, 6-second intervals for defect updates) rather than push-based WebSockets or Server-Sent Events (SSE).

5. **Demo Fallback Telemetry**:
   The dashboard includes fallback mock fleet data in `dashboard/src/data/mockData.js`. When zero physical transit buses are actively transmitting telemetry to Central, the dashboard visualizes this initial demo dataset to maintain interface layout integrity for demonstration purposes.

---

# 29. Future Improvements

The following architectural enhancements are planned for transition from the current prototype to full municipal scale:

1. **Decoupled Asynchronous Evidence Queue**:
   Migrate cloud storage uploads from synchronous route handlers to an asynchronous task queue (e.g., BullMQ backed by Redis). Inbound 15-second MP4 evidence clips will be acknowledged immediately upon local disk staging, with background workers managing cloud upload, retry backoff, and Google Drive rate limits.

2. **Push-Based WebSocket / SSE Telemetry**:
   Replace client-side HTTP polling with a persistent WebSocket or Server-Sent Events (SSE) feed. As soon as Central correlates a multi-bus congestion event or deduplicates a pothole, the updated state will be pushed directly to municipal operators.

3. **Automated Edge Privacy Blurring**:
   Integrate an automated face and license plate redaction filter directly into the RAAHI-Edge ring buffer prior to MP4 encoding, ensuring no personally identifiable information (PII) is captured in exported evidence clips.

4. **Containerized Multi-Node Deployment**:
   Package the Central server, MongoDB replica set, and React dashboard as containerized microservices managed via Docker Compose and Kubernetes for enterprise production resilience.

5. **Municipal Work-Order Integration**:
   Build automated webhooks connecting Central's `potholes` collection to municipal public works ticketing systems (e.g., Cityworks, SAP), enabling automatic repair dispatch when defect confirmation thresholds are satisfied.

---

# 30. Production Deployment Architecture

RAAHI Central is deployed in production on Microsoft Azure, isolated from direct public internet exposure by an Azure Network Security Group (NSG) and published securely via a Cloudflare Zero-Trust Tunnel.

```
+-------------------------------------------------------------------------+
|                  AZURE & CLOUDFLARE PRODUCTION DEPLOYMENT               |
|                                                                         |
|  [ Public Client / Edge Nodes ]                                         |
|    * https://raahi.feminismindia.com  (Primary Canonical Production)    |
|    * https://raahi.ujjwalraj.online   (Secondary Deployment Alias)      |
|                                │                                        |
|                                ▼ HTTPS (Port 443)                       |
|  [ Cloudflare Edge Network ]                                            |
|    * Anycast DNS, SSL Termination, DDoS Mitigation                      |
|    * Tunnel Name: 'RAAHI-Central'                                       |
|                                │                                        |
|                                ▼ Encrypted QUIC/HTTP2 Tunnel            |
|  [ Azure Cloud: Central India ]                                         |
|    * Resource Group: RAAHI-Central-RG                                   |
|    * VM Name: raahi-central (Standard_B2ats_v2: 2 vCPU, 1 GiB RAM)      |
|    * Public IP: 20.235.104.3 | Private IP: 172.16.0.4                   |
|    * Azure NSG: Port 22 (SSH) Only | Port 5001 CLOSED to Public         |
|    * Systemd Connector: cloudflared.service (v2026.9.1)                 |
|                                │                                        |
|                                ▼ Loopback: http://localhost:5001        |
|  [ RAAHI Central Node.js Server ]                                       |
|    * Systemd Unit: raahi-central.service (User: raahiadmin)             |
|    * Working Directory: ~/RAAHI-Central/raahi-pothole-detection/dashboard|
|    * Runtime: Node.js v22.23.2 | npm v10.9.8                            |
|                                │                                        |
|                                ▼ TLS Over TCP                           |
|  [ Managed Database: MongoDB Atlas ]                                    |
|    * Cluster: Multi-tenant Atlas Cluster                                |
|    * Database Name: 'raahi'                                             |
+-------------------------------------------------------------------------+
```

### Production Specification Matrix

| Deployment Dimension | Production Specification |
| :--- | :--- |
| **Cloud Provider** | Microsoft Azure (Azure for Students Subscription) |
| **Resource Group** | `RAAHI-Central-RG` |
| **Virtual Machine Name** | `raahi-central` |
| **Azure Region** | Central India |
| **Operating System** | Ubuntu Server 24.04 LTS x64 Gen2 (Kernel: `6.17.0-1022-azure`) |
| **VM Instance Size** | `Standard_B2ats_v2` (2 vCPU, 1.0 GiB RAM) |
| **Azure Public IP** | `20.235.104.3` |
| **Azure Private IP** | `172.16.0.4` |
| **SSH Management User** | `raahiadmin` |
| **Azure Network Security Group** | Port 22 (SSH) open; **Port 5001 is private and closed to the public** |
| **Application Runtime** | Node.js `v22.23.2`, npm `v10.9.8` |
| **Application Repository** | `~/RAAHI-Central/raahi-pothole-detection/dashboard` |
| **Database Tier** | MongoDB Atlas remote managed cluster (Database: `raahi`) |
| **Edge Ingress Proxy** | Cloudflare Tunnel (`RAAHI-Central`, `cloudflared` v2026.9.1) |
| **Service Supervisor** | Linux systemd (`raahi-central.service` + `cloudflared.service`) |
| **Canonical Public Hostname** | **`https://raahi.feminismindia.com`** |
| **Secondary Public Alias** | **`https://raahi.ujjwalraj.online`** *(alias; may expire upon domain renewal)* |

### Production Deployment Verification Summary

All components of the production architecture have been verified operational:
- **Local Loopback (`http://localhost:5001`)**: Responds with HTTP 200 serving compiled React 18 production bundle.
- **Health Diagnostic (`/api/status`)**: Reports `detectionSystem: "Online"` with active device state.
- **MongoDB Atlas Connectivity**: Reports `connected: true`, `readyState: 1`, `databaseName: "raahi"`.
- **Authoritative Data Routes (`/api/potholes`)**: Returns verified incident records.
- **Public Domain Routing**: Both `https://raahi.feminismindia.com` and `https://raahi.ujjwalraj.online` return HTTP 200.
- **Tunnel Resilience**: `cloudflared.service` verified active with healthy tunnel connector replica.
- **Process Supervision**: `raahi-central.service` verified active, enabled at boot, with automated crash recovery.

---

# 31. Local Installation & Development Setup

Follow these steps to set up RAAHI Central locally for development or testing.

### Prerequisites
- **Node.js**: v18.0.0 or higher (v22.x recommended)
- **npm**: v9.0.0 or higher
- **MongoDB**: Community Edition v7.0+ or a free MongoDB Atlas cluster
- **Git** & **Git LFS**: Installed and initialized

### Step 1: Clone the Repository
```bash
git clone https://github.com/iUjjwalRaj/RAAHI-Central.git
cd RAAHI-Central
git lfs install
git lfs pull
```

### Step 2: Install Dashboard & Server Dependencies
```bash
cd raahi-pothole-detection/dashboard
npm install
```

### Step 3: Build the Frontend Production Bundle
```bash
npm run build
```
*Compiles the React 18 client application into `dashboard/dist`, ready for Express static serving.*

---

# 32. Environment Configuration

RAAHI Central reads its configuration from `dashboard/.env` in development, or the systemd environment file in production.

Create or update `raahi-pothole-detection/dashboard/.env`:

```bash
# =================================================================
# RAAHI Central Server Configuration
# =================================================================

# Server Port (Default: 5001)
PORT=5001

# MongoDB Connection String (Atlas or Local)
# In production, uses remote MongoDB Atlas connection string with database 'raahi'
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/raahi?retryWrites=true&w=majority

# Spatial Deduplication Proximity Threshold (Meters)
POTHOLE_DEDUP_RADIUS_METERS=10

# Reverse Geocoding Configuration
GEOCODING_PROVIDER=nominatim
GEOCODING_USER_AGENT=RAAHI-Central/1.0
GEOCODING_TIMEOUT_MS=3000

# =================================================================
# Google Drive API Configuration (OAuth 2.0)
# =================================================================
GOOGLE_DRIVE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_DRIVE_CLIENT_SECRET=your_client_secret
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5001/api/dev/auth/google/callback
GOOGLE_DRIVE_REFRESH_TOKEN=your_refresh_token
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_DRIVE_SHARE_PUBLIC=true
```

> [!IMPORTANT]
> **Secret Protection**: The production `.env` file on the Azure VM is owned by `raahiadmin` with `chmod 600` permissions. Connection strings, passwords, and OAuth secrets are strictly excluded from version control via `.gitignore`.

---

# 33. Production Persistence & Service Management

In production on the Azure VM, RAAHI Central is **never run manually in a temporary terminal**. Instead, it is managed as a persistent system-level daemon using `systemd`.

### Systemd Service Configuration (`/etc/systemd/system/raahi-central.service`)

```ini
[Unit]
Description=RAAHI Central Municipal Backend and Dashboard
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=raahiadmin
Group=raahiadmin
WorkingDirectory=/home/raahiadmin/RAAHI-Central/raahi-pothole-detection/dashboard
EnvironmentFile=/home/raahiadmin/RAAHI-Central/raahi-pothole-detection/dashboard/.env
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin:/bin
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5s
KillMode=control-group
StandardOutput=journal
StandardError=journal
SyslogIdentifier=raahi-central

[Install]
WantedBy=multi-user.target
```

### Verified Operational Properties Provided by Systemd

1. **Automatic Boot Launch**: Central starts automatically when the Azure VM boots without human intervention.
2. **No Interactive Session Dependency**: The server runs independently in the background; closing SSH terminal windows does not interrupt execution.
3. **Automated Crash Recovery**: If the Node process encounters an uncaught fatal exception or is terminated, systemd restarts it within 5 seconds.
4. **Coordinated Ingress**: `cloudflared.service` runs alongside Central under systemd, ensuring public accessibility is preserved across system reboots.
5. **Centralized Logging**: All stdout/stderr logs are routed to `systemd-journald` with structured timestamps.

---

# 34. Running in Production & Operational Runbook

Operators and developers **do NOT need to SSH into the VM or run `npm start` manually** during normal operation. The platform runs autonomously.

For system administration, use standard systemd management commands:

### Service Inspection & Status
```bash
# Check Central service status, memory usage, and recent logs
sudo systemctl status raahi-central

# Check Cloudflare tunnel status and connector health
sudo systemctl status cloudflared

# Verify service is enabled at system boot
sudo systemctl is-enabled raahi-central
```

### Live Log Streaming
```bash
# Stream real-time Central backend logs
sudo journalctl -u raahi-central -f

# Stream real-time Cloudflare Tunnel logs
sudo journalctl -u cloudflared -f

# View logs from a specific timeframe
sudo journalctl -u raahi-central --since "1 hour ago"
```

### Service Lifecycle Controls
```bash
# Restart Central backend (e.g., after pulling Git updates or changing .env)
sudo systemctl restart raahi-central

# Stop service cleanly
sudo systemctl stop raahi-central

# Start service
sudo systemctl start raahi-central
```

---

# 35. Troubleshooting

### Production Diagnostics

1. **Service Not Running (`systemctl status raahi-central` shows failed)**:
   - Check journal logs: `sudo journalctl -u raahi-central -n 50 --no-pager`.
   - Verify `.env` syntax and MongoDB Atlas credentials.
   - Verify port 5001 is not occupied by a zombie process: `sudo lsof -i :5001`.

2. **Cloudflare Tunnel Returns 502 Bad Gateway**:
   - Cause: Central backend is stopped or not listening on `localhost:5001`.
   - Fix: Inspect Central status: `sudo systemctl status raahi-central`. Restart if needed: `sudo systemctl restart raahi-central`.

3. **MongoDB Atlas Connection Timeout / Refusal**:
   - Cause: Azure VM outbound IP (`20.235.104.3`) is not allowlisted in MongoDB Atlas Network Access rules.
   - Fix: Ensure `20.235.104.3/32` (or authorized VPC/IP block) is allowlisted in the Atlas console under Network Security.

4. **Frontend Dashboard Blank or ReferenceError**:
   - Cause: Outdated bundle in `dist/`.
   - Fix: Rebuild client application via `cd ~/RAAHI-Central/raahi-pothole-detection/dashboard && npm run build`, then restart: `sudo systemctl restart raahi-central`.

### Local Development Diagnostics

1. **Port Conflict on Port 5001**:
   ```bash
   lsof -i :5001
   kill -9 <PID>
   ```

2. **Google Drive Upload Warnings (`Google Drive not authenticated`)**:
   - Central continues functioning in local fallback mode by saving evidence clips locally to `videos/evidence/`. Complete the OAuth flow at `http://localhost:5001/api/dev/auth/google/login` if Drive synchronization is desired.

---

# 36. Repository / GitHub

RAAHI Central is version-controlled on GitHub as part of Project RAAHI.

- **GitHub Repository**: `https://github.com/iUjjwalRaj/RAAHI-Central.git`
- **Primary Branch**: `main`
- **Edge Companion Repository**: `https://github.com/iUjjwalRaj/RAAHI-Edge.git`
- **Primary Production URL**: `https://raahi.feminismindia.com`

### Binary Asset Handling (Git LFS)
Large model weights and pre-trained perception assets from earlier development are tracked using Git Large File Storage (Git LFS) in `.gitattributes`. To ensure all binary assets are present after cloning:
```bash
git lfs install
git lfs pull
```

---

# 37. Technical Glossary

- **Candidate Event**: A staged edge observation stored in `candidate_events` as an audit record prior to deduplication.
- **Haversine Formula**: Spherical trigonometric equation calculating great-circle distances between GPS coordinates.
- **Spatial Deduplication**: Deterministic algorithm matching defect coordinates within 10 meters to prevent duplicate records.
- **Multi-Bus Correlation**: Correlation engine verifying traffic reports across buses within a 50m / 10-minute window.
- **Evidence Clip**: 15.0-second MP4 file (5 seconds before the event and 10 seconds after the event, $t_0 - 5.0\text{s}$ to $t_0 + 10.0\text{s} = 450$ frames @ 30 FPS) providing visual proof.
- **GNSS / GPS**: Vehicle satellite receiver delivering telemetry at ~1 Hz cadence.
- **Zero Central AI**: Invariant that Central performs strictly zero neural network or VLM inference, remaining deterministic.
- **Cloudflare Tunnel**: Zero-Trust outbound encrypted tunnel establishing secure public ingress without opening public inbound firewall ports.
- **Azure NSG**: Network Security Group enforcing cloud perimeter isolation.
- **Systemd Production Persistence**: OS-level daemon supervisor providing boot-up launch and automated 5-second crash recovery.

---

# 38. Final Architecture Summary

Project RAAHI establishes a strict, clean division of responsibility between on-vehicle edge intelligence and centralized municipal fleet aggregation:

```
+-------------------------------------------------------------------------+
|                    RAAHI TWO-TIER ARCHITECTURE SUMMARY                  |
|                                                                         |
|  1. RAAHI-EDGE (Vehicle Tier):                                          |
|     * Local camera stream acquisition (Samsung Galaxy S23 FE via RTSP)  |
|     * Hardware-accelerated dual YOLO11n object detection (MPS/NPU)      |
|     * On-device ByteTrack multi-object tracking                         |
|     * Edge traffic density & speed estimation                           |
|     * Circular ring buffer evidence slicing (15s: 5s pre + 10s post)    |
|     * GPS association (~1 Hz telemetry associated at t0)                |
|     * Local SQLite buffering for offline resilience                     |
|                                                                         |
|  2. RAAHI-CENTRAL (Cloud Tier - Azure & Cloudflare):                    |
|     * Azure Ubuntu 24.04 VM running persistent systemd service          |
|     * Cloudflare Zero-Trust Tunnel (raahi.feminismindia.com)            |
|     * Strictly ZERO AI, VLM, LLM, or YOLO inference                     |
|     * Defensive schema validation & idempotency checks                  |
|     * Candidate event staging & audit trail ('candidate_events')        |
|     * Deterministic 10-meter Haversine spatial deduplication            |
|     * Deterministic 50m / 10-minute multi-bus traffic correlation       |
|     * Authoritative civic state persistence in MongoDB Atlas ('raahi')  |
|     * Request-driven video evidence storage via Google Drive & local disk|
|     * Compiled React 18 + Leaflet GIS municipal command center         |
+-------------------------------------------------------------------------+
```

By executing all deep learning on edge hardware and keeping Central 100% deterministic, RAAHI provides municipal transit authorities with an auditable, scalable, and economically sustainable road safety and traffic monitoring platform.