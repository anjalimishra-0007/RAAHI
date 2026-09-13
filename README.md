# RAAHI Edge AI

MacBook-side Edge AI processing pipeline for Project RAAHI (Smart India Hackathon road monitoring and road safety system).

---

## Phase 1 Architecture

The primary objective of Phase 1 is verifying reliable real-time video capture from the physical Samsung Galaxy S23 FE:

```
┌─────────────────────────┐
│ Samsung Galaxy S23 FE   │
│ - Rear Camera           │
│ - RootEncoder 2.8.1     │
│ - Hardware H.264 Encoder│
└───────────┬─────────────┘
            │ RTSP / H.264
            ▼
┌─────────────────────────┐
│ MacBook Air/Pro         │
│ MediaMTX RTSP Server    │ (Port 8555)
└───────────┬─────────────┘
            │ RTSP / TCP
            ▼
┌─────────────────────────┐
│ OpenCV RTSP Receiver    │
│ - Low-latency queue     │
│ - Real-time telemetry   │
│ - Live GUI display      │
└─────────────────────────┘
```

---

## Project Structure

```
raahi-edge/
├── config.yaml              # RTSP endpoints, camera specs, and display configuration
├── requirements.txt         # Python dependencies (OpenCV, PyYAML, NumPy)
├── .gitignore               # Git exclusions
├── README.md                # Documentation and operational runbook
├── main.py                  # Primary entry point with live GUI & telemetry
├── mediamtx.yml             # Dedicated MediaMTX server configuration
│
├── capture/
│   ├── __init__.py
│   └── rtsp_receiver.py     # Threaded OpenCV capture worker & statistics tracker
│
├── utils/
│   ├── __init__.py
│   └── logger.py            # Color-coded thread-safe console logger
│
└── tests/
    ├── __init__.py
    └── test_stream.py       # Headless smoke test script
```

---

## Getting Started

### 1. Prerequisites
- **macOS** (Apple Silicon `arm64`)
- **Python 3.11+**
- **FFmpeg**: Installed via `brew install ffmpeg`
- **MediaMTX**: Installed via `brew install mediamtx`

### 2. Environment Setup

```bash
# Create dedicated virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. MediaMTX Configuration

Launch MediaMTX using the bundled config:

```bash
mediamtx mediamtx.yml
```

MediaMTX will listen on port `8555` for RTSP publishing and reading.

### 4. Android App Configuration

On the Samsung Galaxy S23 FE (`RAAHI Eye` Android app):
1. Connect the phone to the same Wi-Fi/Hotspot network as the MacBook.
2. In the app's settings or RTSP URL input field, enter:
   ```
   rtsp://<MACBOOK_IP>:8555/live
   ```
   *(Find your MacBook IP via `ipconfig getifaddr en0` or `ifconfig en0`)*
3. Tap **START STREAM**.
4. Confirm the pulsing `LIVE` indicator appears.

### 5. Independent Verification with FFmpeg

Before launching the Python application, verify that the stream is reachable and healthy:

```bash
ffmpeg -rtsp_transport tcp -i rtsp://127.0.0.1:8555/live -vframes 5 -f null -
```

### 6. Run Python Edge Receiver

```bash
# Activate virtual environment
source .venv/bin/activate

# Launch live viewer with HUD telemetry overlay
python main.py

# Or run headless test
python tests/test_stream.py --frames 60
```

---

## Keyboard Controls

| Key | Action |
|---|---|
| `q` or `ESC` | Cleanly disconnect and exit application |
| `d` | Toggle telemetry HUD overlay on / off |
| `s` | Save high-resolution snapshot to `captures/` |

---

## Diagnostics & Telemetry

The application continuously tracks and reports:
- **Connection State**: `CONNECTING`, `STREAMING`, `STALLED`, `DISCONNECTED`
- **Resolution**: Dynamically detected dimensions (e.g. `1920x1080`)
- **Live FPS**: Real-time rolling window calculation over the last 30 frames
- **Average FPS**: Cumulative frames received / elapsed time
- **Drop / Failure Statistics**: Stale frame drops and read timeout occurrences
- **Reconnection Count**: Automatic recovery tracking without application crashes
