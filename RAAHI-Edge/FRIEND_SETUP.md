# RAAHI Edge — Friend Setup Guide

This guide is for a teammate setting up the **RAAHI-Edge** perception appliance for the first time. Follow these steps to clone the repository, install dependencies, pair an Android phone running RAAHI-Eye, and run the complete local perception pipeline.

---

## 1. What You Are Setting Up

RAAHI (Road Asset & Hazard Assessment Interface) operates as a distributed edge-cloud system:

```text
[Android Phone] ──(RTSP / H.264)──► [MediaMTX :8555] ──► [RAAHI-Edge :5050] ──► [Production Central]
   RAAHI-Eye                            RTSP Proxy          Dual YOLO11n +          MongoDB Atlas
   (Camera + GPS)                                           ByteTrack + Evidence    Google Drive
                                                            Dashboard :5174         GIS Web Console
```

### System Boundaries

| Component | Where It Runs | Responsibilities |
| :--- | :--- | :--- |
| **RAAHI-Eye** | Android Phone | Captures 1080p @ 30 FPS video, encodes H.264, reads 1 Hz GPS, streams RTSP over TCP. |
| **MediaMTX** | Local Machine | High-performance RTSP proxy server running on port `8555`. |
| **RAAHI-Edge API** | Local Machine | Python pipeline coordinator running on port `5050`. Runs YOLO11n pothole and vehicle detection, ByteTrack tracking, 15-second evidence recording, and SQLite queue. |
| **Operator Dashboard** | Local Machine | React 18 / Vite in-cabin operator HUD running on port `5174`. |
| **RAAHI Central** | Cloud (Production) | Authoritative fleet platform at `https://raahi.feminismindia.com`. Performs spatial deduplication, MongoDB storage, and Google Drive evidence archiving. |

> [!NOTE]
> **No Secrets Needed**: You do **not** need MongoDB credentials, Google Drive tokens, Azure keys, or Central server access to run RAAHI-Edge. The Edge appliance communicates with Central purely over standard HTTPS API endpoints.

---

## 2. Prerequisites

### Supported Operating Systems
- **macOS Apple Silicon (M1/M2/M3/M4)**: *Primary verified environment.* PyTorch hardware acceleration runs natively via Apple Metal Performance Shaders (MPS).
- **Linux (Ubuntu 22.04+)**: Supported with CUDA GPU or CPU fallback.

### System Dependencies (Install Manually First)
Make sure the following tools are installed on your machine before running setup:

#### On macOS (using Homebrew):
```bash
# Core tools
brew install git python@3.12 node ffmpeg mediamtx
```

#### On Linux (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip ffmpeg nodejs npm
# Download and place mediamtx in /usr/local/bin from:
# https://github.com/bluenviron/mediamtx/releases
```

### Dependency Breakdown

| Dependency | Required Version | How It Is Installed |
| :--- | :--- | :--- |
| **Git** | Any modern version | Manual (`brew install git` / `apt install git`) |
| **Python** | `>= 3.11` (3.11 or 3.12) | Manual (`brew install python@3.12`) |
| **Node.js & npm** | `Node >= 18` | Manual (`brew install node`) |
| **FFmpeg** | Any with H.264 support | Manual (`brew install ffmpeg`) |
| **MediaMTX** | `>= v1.0.0` | Manual (`brew install mediamtx`) |
| **Python Packages** | From `requirements.txt` | **Automated** by `./setup.sh` into `venv/` |
| **Dashboard Packages**| From `dashboard/package.json` | **Automated** by `./setup.sh` |
| **Dashboard Build** | Production bundle in `dist/` | **Automated** by `./setup.sh` |
| **Runtime Folders** | `data/`, `captures/`, etc. | **Automated** by `./setup.sh` |
| **Configuration** | Production `.env` | **Automated** by `./setup.sh` |

---

## 3. Clone the Repository

Clone the repository to your local machine:

```bash
git clone https://github.com/iUjjwalRaj/RAAHI-Edge.git
cd RAAHI-Edge
```

---

## 4. First-Time Setup

Run the automated setup script:

```bash
./setup.sh
```

### What `setup.sh` Does Automatically:
1. **Validates Environment**: Detects OS and CPU architecture (confirms Apple Silicon MPS support on macOS).
2. **Checks System Tools**: Verifies Git, Python 3.11+, FFmpeg, MediaMTX, and Node.js/npm.
3. **Prepares Virtual Environment**: Creates (or reuses) `venv/` without touching your global Python.
4. **Installs Python Libraries**: Installs all required packages from `requirements.txt` (`torch`, `torchvision`, `ultralytics`, `opencv-python`, `fastapi`, `uvicorn`, `websockets`, etc.).
5. **Sets Up Dashboard**: Installs npm dependencies inside `dashboard/` and builds the production bundle via Vite (`dashboard/dist/`).
6. **Initializes Runtime Directories**: Creates `data/`, `data/evidence/`, `captures/`, and verifies model weights in `models/`.
7. **Configures Central Uplink**: Creates a `.env` file pointing to production Central (`https://raahi.feminismindia.com`). If you already have a `.env`, it preserves it untouched.
8. **Detects Machine LAN IP**: Identifies your local network IP and prints the exact RTSP target for your phone.
9. **Hardware Sanity Check**: Tests Python imports and confirms hardware acceleration (Apple Metal MPS or CUDA).

> [!TIP]
> `./setup.sh` is completely **idempotent**. You can run it anytime to verify your environment; it will reuse existing installations without deleting your data.

---

## 5. Start RAAHI Edge

Start the local Edge appliance using the supervisor script:

```bash
./start.sh
```

### Active Services and Ports:

| Service | Port | Endpoint / URL | Purpose |
| :--- | :---: | :--- | :--- |
| **MediaMTX** | `8555` | `rtsp://127.0.0.1:8555/live` | Receives H.264 stream from the phone; exposes it to OpenCV. |
| **Edge API & Pipeline** | `5050` | `http://127.0.0.1:5050` | Runs AI models, processes frames, manages SQLite queue, broadcasts WebSocket telemetry. |
| **Operator Dashboard** | `5174` | `http://localhost:5174` | In-cabin React dashboard with live preview HUD and metrics. |

### Useful `start.sh` Flags:
* **Pre-flight Check Only**:
  ```bash
  ./start.sh --check
  ```
  Validates prerequisites, configuration, and ports without launching daemons.
* **Headless Mode** (No UI):
  ```bash
  ./start.sh --no-dashboard
  ```
  Runs only MediaMTX and the Edge API backend.
* **Don't Open Browser**:
  ```bash
  ./start.sh --no-open
  ```
  Starts all services without automatically opening your browser.
* **macOS Terminal Tabs**:
  ```bash
  ./start.sh --tabs
  ```
  Opens each service in a separate native Terminal tab for isolated logs.
* **Kill Stale Processes**:
  ```bash
  ./start.sh --kill-existing
  ```
  Automatically frees ports 8555, 5050, or 5174 if previous runs were not stopped cleanly.

---

## 6. Find the Laptop's LAN IP

Your Android phone needs to reach your laptop over the local network to push the RTSP video stream.

When you run `./setup.sh` or `./start.sh`, it prints your machine's LAN IP:

```text
[INFO] Local Machine LAN IP      : 192.168.x.x
[INFO] Android RAAHI-Eye Target  : rtsp://192.168.x.x:8555/live
```

### Finding It Manually (if needed):
* **macOS**:
  ```bash
  ipconfig getifaddr en0
  # If connected via Wi-Fi hotspot or secondary interface:
  ipconfig getifaddr en1
  ```
* **Linux**:
  ```bash
  hostname -I | awk '{print $1}'
  ```

Your RTSP publishing destination is always:
```text
rtsp://<YOUR_LAN_IP>:8555/live
```
*(Example: `rtsp://192.168.1.45:8555/live` — replace with your actual LAN IP).*

---

## 7. Set Up RAAHI-Eye (Android Phone)

The phone runs the **RAAHI-Eye** native Android application (`com.example.raahieye`).

### Step-by-Step Device Setup:
1. **Network Pairing**: Connect your Android phone and your laptop to the **same Wi-Fi network** or enable a **mobile hotspot** on the phone and connect your laptop to it.
   > [!IMPORTANT]
   > Connecting your laptop to your phone's personal mobile hotspot is the recommended field setup, as it guarantees direct IP routing and avoids university/corporate Wi-Fi client isolation.
2. **Install / Open RAAHI-Eye**: Launch the RAAHI-Eye app on your Android device.
3. **Configure RTSP Target**:
   * Set the streaming URL to:
     ```text
     rtsp://<YOUR_LAN_IP>:8555/live
     ```
   * Replace `<YOUR_LAN_IP>` with the exact IP detected in Step 6.
   * *(If testing a build where the endpoint is set in Android Studio, update the target string in `MainActivity.kt` and deploy via USB-C).*
4. **Grant Permissions**: Ensure Camera and High-Accuracy Location (GPS) permissions are granted.
5. **Start Streaming**: Tap **Start Streaming**. The app status should change to `Streaming (1080p @ 30 FPS)`.

---

## 8. Verify the Stream

Once the phone is streaming, verify each layer of the pipeline:

### 1. Verify MediaMTX Ingestion
In your terminal running `./start.sh` or by checking logs:
```bash
tail -n 20 data/mediamtx_runtime.log
```
You should see:
`[RTSP] [conn ...] is publishing to path 'live'`

### 2. Verify Edge Pipeline Status
Query the Edge API health endpoint:
```bash
curl -s http://localhost:5050/api/pipeline/status | jq .components
```
Expected output:
```json
{
  "camera": "LIVE",
  "rtsp": "LIVE",
  "mediamtx": "LIVE",
  "opencv": "CONNECTED",
  "yolo11n": "LIVE",
  "trafficTracker": "LIVE",
  "centralConnection": "LIVE"
}
```

### 3. Verify in Operator Dashboard
Open **`http://localhost:5174`** in your browser. You should see:
* The live 1080p video feed from the phone.
* Bounding boxes around potholes and detected vehicles (cars, buses, trucks, motorcycles).
* Live telemetry: FPS (typically 25–30 FPS on Apple Silicon), vehicle count, traffic flow (VPM), and congestion state.

---

## 9. Verify an Event Reaches Central

When an anomaly (such as a pothole or severe traffic congestion) is detected:

```text
Detection (YOLO)
    ↓
Event Packaging (15s MP4 clip + GPS fix)
    ↓
Local SQLite Queue (raahi_edge.db: IN_FLIGHT)
    ↓
HTTPS POST https://raahi.feminismindia.com/api/central/events
    ↓
Central Response (HTTP 200/201: Candidate created)
    ↓
Local Queue Transition (SENT / ARCHIVED)
```

### Verification Checks:
1. **Check Local Transmission Queue**:
   ```bash
   curl -s http://localhost:5050/api/transmission/stats | jq .
   ```
   Look for `sent_count > 0` and `pending_count: 0`.
2. **View Log Output**:
   ```bash
   tail -f data/api_runtime.log
   ```
   Look for `[CentralSync] Event EVT-... successfully transmitted to Central`.
3. **Verify on Production Central**:
   Open the public Central dashboard at:
   `https://raahi.feminismindia.com`
   The new incident should appear on the map and event table with GPS coordinates.

---

## 10. Evidence & Google Drive Architecture

* **Local Machine**: When an event triggers, RAAHI-Edge cuts a **15-second evidence MP4** (5s pre-event buffer + 10s post-event) and stores it in `data/evidence/`.
* **Central Cloud**: When Edge transmits the event payload and clip, Central uploads the MP4 to **Google Drive** for long-term durable archival and updates the record in MongoDB Atlas.
* **Zero Local Secrets**: Google Drive authentication is handled entirely on the production Central server. Your local machine never needs Google Drive credentials or OAuth tokens.

---

## 11. Troubleshooting

### Problem 1: `./setup.sh` fails with missing prerequisite
* **Symptom**: Script exits with `✗ FFmpeg not found` or `✗ MediaMTX not found`.
* **Fix**: Install the missing binary using Homebrew on macOS:
  ```bash
  brew install ffmpeg mediamtx
  ```
  Then re-run `./setup.sh`.

### Problem 2: Port 8555, 5050, or 5174 already in use
* **Symptom**: `./start.sh` reports `Port 8555 is already in use by process PID: ...`.
* **Fix**: Run `start.sh` with the auto-kill flag:
  ```bash
  ./start.sh --kill-existing
  ```
  Or manually kill the offending process:
  ```bash
  lsof -ti:8555 -ti:5050 -ti:5174 | xargs kill -9
  ```

### Problem 3: Phone cannot connect / MediaMTX receives no stream
* **Symptom**: Phone app shows connection error; MediaMTX log shows no publishers.
* **Fixes**:
  1. **Check Network**: Ensure laptop and phone are on the exact same network. If using university/office Wi-Fi, switch to your **phone's mobile hotspot** to bypass router client isolation.
  2. **Check IP**: Confirm your laptop's current IP hasn't changed (re-run `./start.sh --check`).
  3. **Check Port & Path**: URL must be `rtsp://<IP>:8555/live` (port must be `8555`, path must be `/live`).
  4. **Check Firewall**: Ensure macOS Application Firewall allows incoming connections on port `8555`.

### Problem 4: Dashboard shows "OFFLINE"
* **Symptom**: Dashboard opens at `http://localhost:5174`, but connection status says offline.
* **Fix**: The dashboard communicates with the backend via `http://127.0.0.1:5050`. Check if the API server is alive:
  ```bash
  curl -s http://127.0.0.1:5050/api/pipeline/status
  ```
  If it fails, inspect `data/api_runtime.log` for Python exceptions.

### Problem 5: Events stuck in transmission queue
* **Symptom**: `transmission/stats` reports events as `PENDING` or `FAILED`.
* **Fix**: Check your laptop's outbound internet connection to Central:
  ```bash
  curl -I https://raahi.feminismindia.com/api/health
  ```
  Ensure `.env` contains `CENTRAL_URL=https://raahi.feminismindia.com`.

---

## 12. Normal Daily Workflow

Once the first-time setup is complete, your daily workflow takes 10 seconds:

```bash
cd RAAHI-Edge
./start.sh
```

1. Connect phone and laptop to the same network (e.g. phone hotspot).
2. Open **RAAHI-Eye** on the phone and tap **Start Streaming**.
3. Open `http://localhost:5174` in your browser.
4. Verify detections and telemetry on the live HUD.

---

## 13. Stopping RAAHI

To cleanly stop the entire stack:

Press **`[Ctrl+C]`** in the terminal where `./start.sh` is running.

The script intercepts the termination signal (`SIGINT`/`SIGTERM`/`EXIT`), shuts down MediaMTX, the Edge API, and the dashboard Vite server, and ensures all network ports are cleanly released.

---

## 14. Important Safety & Security Rules

* **Never commit `.env`**: `.env` contains local configuration. It is ignored by Git.
* **Never commit secrets**: Do not commit API keys, tokens, MongoDB credentials, or certificates.
* **Never commit runtime data**: Never stage `data/`, `*.db`, `*.mp4`, or `captures/`.
* **Do not hardcode personal IPs**: LAN IPs are dynamic. Never hardcode your machine's IP address into code or config files.
* **Do not modify Central infrastructure**: The local Edge stack is designed to send events to Central without modifying production cloud services.

---

## 15. Architecture Quick Reference

```text
┌─────────────────────────────────────────────────────────────┐
│                 MOBILE NODE (ANDROID PHONE)                 │
│                                                             │
│   [ Camera2 API ] ──► [ Hardware H.264 ] ──► [ RootEncoder] │
│   [ High-Accuracy GNSS / FusedLocation ]                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ RTSP over TCP (:8555)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 LOCAL LAPTOP (RAAHI-EDGE)                   │
│                                                             │
│   [ MediaMTX :8555 ] ──(RTSP/TCP)──► [ OpenCV Receiver ]    │
│                                              │              │
│       ┌──────────────────────────────────────┴──────────┐   │
│       ▼                                                 ▼   │
│   [ YOLO11n Pothole ]                          [ YOLO11n Cars ]
│       │                                                 │   │
│   [ Event Packaging ]                          [ ByteTrack ]│
│   [ 15s Evidence Clip ]                        [ Flow / VPM]│
│       │                                                 │   │
│       └──────────────────┬──────────────────────────────┘   │
│                          ▼                                  │
│       [ SQLite Transmission Queue (raahi_edge.db) ]         │
│       [ Operator Dashboard UI (Vite / React :5174) ]        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS POST /api/central/events
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               RAAHI CENTRAL CLOUD (PRODUCTION)              │
│                                                             │
│   [ Ingestion Endpoint (https://raahi.feminismindia.com) ]   │
│   [ 10m Spatial Deduplication Engine ]                      │
│   [ MongoDB Atlas Cloud Database ]                          │
│   [ Google Drive Evidence Storage Sync ]                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 16. What Success Looks Like Checklist

Use this checklist to confirm your environment is 100% operational:

- [ ] Repository cloned (`git clone https://github.com/iUjjwalRaj/RAAHI-Edge.git`)
- [ ] Prerequisites installed (`git`, `python@3.12`, `ffmpeg`, `mediamtx`, `node`)
- [ ] `./setup.sh` finished with `RAAHI-EDGE SETUP COMPLETED SUCCESSFULLY!`
- [ ] `./start.sh` starts all 3 services without errors
- [ ] MediaMTX is listening on port `8555`
- [ ] Edge API responds at `http://127.0.0.1:5050/api/pipeline/status`
- [ ] Operator Dashboard loads at `http://localhost:5174`
- [ ] Phone and laptop connected to the same network / hotspot
- [ ] RAAHI-Eye streaming to `rtsp://<YOUR_LAN_IP>:8555/live`
- [ ] Dashboard displays live camera feed and YOLO detection boxes
- [ ] Pothole or vehicle event is packaged and saved in `data/raahi_edge.db`
- [ ] Event transmits successfully to Central (`https://raahi.feminismindia.com`)
