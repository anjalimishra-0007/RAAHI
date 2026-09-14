"""
FastAPI Server & Process Orchestrator for RAAHI-Edge.
Exposes REST and WebSocket endpoints for the React Bus Control Dashboard.
"""

import asyncio
import os
import sys
import subprocess
import time
from typing import Dict, List, Optional, Any

# Ensure project root is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from pydantic import BaseModel

from pipeline_coordinator import PipelineCoordinator

app = FastAPI(title="RAAHI-Edge Bus Control API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Pipeline Coordinator instance
coordinator = PipelineCoordinator(
    bus_id="RAAHI-001",
    rtsp_url="rtsp://127.0.0.1:8555/live",
    model_path="models/pothole_yolo11n.pt",
    db_path="data/raahi_edge.db",
    evidence_dir="data/evidence",
    central_url="http://localhost:5001"
)

# ------------------ SCHEMAS ------------------

class GpsPayload(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    speed: Optional[float] = None
    timestamp: Optional[str] = None
    busId: Optional[str] = None

class SettingsPayload(BaseModel):
    busId: Optional[str] = None
    rtspUrl: Optional[str] = None
    centralUrl: Optional[str] = None
    confThreshold: Optional[float] = None
    preBufferSec: Optional[float] = None
    postBufferSec: Optional[float] = None

# ------------------ LIFECYCLE ------------------

@app.on_event("startup")
async def startup_event():
    print("[API Server] RAAHI-Edge API server started on port 5050")
    # Auto-start pipeline on boot
    coordinator.start()

@app.on_event("shutdown")
async def shutdown_event():
    print("[API Server] Shutting down RAAHI-Edge...")
    coordinator.stop()

# ------------------ PIPELINE CONTROLS ------------------

@app.post("/api/pipeline/start")
def start_pipeline():
    success = coordinator.start()
    return {"success": success, "message": "Pipeline started"}

@app.post("/api/pipeline/stop")
def stop_pipeline():
    success = coordinator.stop()
    return {"success": success, "message": "Pipeline stopped"}

@app.post("/api/pipeline/restart")
def restart_pipeline():
    success = coordinator.restart()
    return {"success": success, "message": "Pipeline restarted"}

@app.get("/api/pipeline/status")
def get_pipeline_status():
    return coordinator.get_health_status()

# ------------------ LIVE PREVIEW MJPEG ------------------

def mjpeg_generator():
    """Streams preview frames at ~15 FPS to avoid unnecessary CPU/bandwidth overhead."""
    while True:
        frame_bytes = coordinator.latest_preview_jpeg
        if frame_bytes:
            yield (b"--frame\r\n"
                   b"Content-Type: image/jpeg\r\n"
                   b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n\r\n" +
                   frame_bytes + b"\r\n")
        time.sleep(0.066)

@app.get("/api/video/preview")
def get_video_preview():
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

# ------------------ GPS TELEMETRY ------------------

@app.post("/api/gps")
def ingest_gps(payload: GpsPayload):
    sample = coordinator.gps_manager.ingest_sample(
        latitude=payload.latitude,
        longitude=payload.longitude,
        accuracy=payload.accuracy,
        speed=payload.speed,
        timestamp=payload.timestamp,
        bus_id=payload.busId or coordinator.bus_id
    )
    # Persist to database
    coordinator.db.insert_gps_telemetry(
        bus_id=sample["busId"],
        lat=sample["latitude"],
        lon=sample["longitude"],
        accuracy=sample["accuracy"],
        speed=sample["speed"],
        ts=sample["timestamp"]
    )
    return {"success": True, "sample": sample}

@app.get("/api/gps")
def get_latest_gps(bus_id: Optional[str] = None):
    fix = coordinator.gps_manager.get_latest_fix(bus_id or coordinator.bus_id)
    return {"connected": fix is not None, "latestGps": fix}

# ------------------ DATA INSPECTOR ------------------

@app.get("/api/events")
def get_events(limit: int = 50, offset: int = 0, event_type: Optional[str] = None):
    events = coordinator.db.get_events(limit=limit, offset=offset, event_type=event_type)
    return {"count": len(events), "events": events}

@app.get("/api/events/{event_id}")
def get_event_detail(event_id: str):
    event = coordinator.db.get_event_by_id(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

@app.get("/api/evidence/{filename}")
def get_evidence_file(filename: str):
    # Prevent path traversal
    safe_name = os.path.basename(filename)
    path = os.path.join(coordinator.evidence_dir, safe_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Evidence file not found")
    media_type = "video/mp4" if safe_name.endswith(".mp4") else "image/jpeg"
    return FileResponse(path, media_type=media_type)

# ------------------ STORAGE & TRANSMISSION ------------------

@app.get("/api/storage/stats")
def get_storage_stats():
    return coordinator.db.get_storage_stats()

@app.get("/api/transmission/stats")
def get_transmission_stats():
    stats = coordinator.db.get_storage_stats()
    return {
        "connected": coordinator.central_client.check_central_health().get("connected", False),
        "syncStatus": coordinator.transmission_worker.last_sync_status,
        "lastSyncTime": coordinator.transmission_worker.last_sync_time,
        "sentCount": stats["sentQueue"],
        "pendingCount": stats["pendingQueue"],
        "failedCount": stats["failedQueue"],
        "totalEvents": stats["totalEvents"]
    }

# ------------------ LOGS ------------------

@app.get("/api/logs")
def get_logs(limit: int = 100, category: Optional[str] = None, level: Optional[str] = None):
    logs = coordinator.db.get_system_logs(limit=limit, category=category, level=level)
    return {"count": len(logs), "logs": logs}

# ------------------ PHONE & ADB DIAGNOSTICS ------------------

@app.get("/api/phone/diagnostics")
def get_phone_diagnostics():
    # 1. Probe ADB
    adb_connected = False
    device_model = "None"
    android_version = "Unknown"

    try:
        res = subprocess.run(["adb", "devices", "-l"], capture_output=True, text=True, timeout=2.0)
        lines = [l for l in res.stdout.strip().split("\n") if "\tdevice" in l]
        if lines:
            adb_connected = True
            device_model = lines[0].split()[0]
            # Try to get model
            v_res = subprocess.run(["adb", "-s", device_model, "shell", "getprop", "ro.build.version.release"], capture_output=True, text=True, timeout=2.0)
            if v_res.returncode == 0:
                android_version = v_res.stdout.strip()
    except Exception:
        adb_connected = False

    # 2. Ping hotspot IP
    hotspot_ip = "10.159.195.5"
    hotspot_reachable = False
    ping_ms = None
    try:
        p_res = subprocess.run(["ping", "-c", "1", "-t", "1", hotspot_ip], capture_output=True, text=True, timeout=1.5)
        if p_res.returncode == 0:
            hotspot_reachable = True
            for part in p_res.stdout.split():
                if "time=" in part:
                    ping_ms = float(part.split("time=")[1])
    except Exception:
        pass

    # 3. MediaMTX active streams
    return {
        "adbConnected": adb_connected,
        "adbDevice": device_model,
        "androidVersion": android_version,
        "hotspotIp": hotspot_ip,
        "hotspotReachable": hotspot_reachable,
        "hotspotPingMs": ping_ms,
        "mediaMtxListening": True,
        "timestamp": time.time()
    }

# ------------------ SETTINGS ------------------

@app.get("/api/settings")
def get_settings():
    return {
        "busId": coordinator.bus_id,
        "rtspUrl": coordinator.rtsp_url,
        "centralUrl": coordinator.central_url,
        "confThreshold": coordinator.conf_threshold,
        "preBufferSec": coordinator.pre_buffer_sec,
        "postBufferSec": coordinator.post_buffer_sec
    }

@app.post("/api/settings")
def update_settings(payload: SettingsPayload):
    if payload.busId:
        coordinator.bus_id = payload.busId
        coordinator.gps_manager.default_bus_id = payload.busId
        coordinator.event_engine.default_bus_id = payload.busId
    if payload.rtspUrl:
        coordinator.rtsp_url = payload.rtspUrl
    if payload.centralUrl:
        coordinator.central_url = payload.centralUrl
        coordinator.central_client.central_base_url = payload.centralUrl.rstrip("/")
    if payload.confThreshold is not None:
        coordinator.conf_threshold = payload.confThreshold
        if coordinator.detector:
            coordinator.detector.conf_threshold = payload.confThreshold
    if payload.preBufferSec is not None:
        coordinator.pre_buffer_sec = payload.preBufferSec
    if payload.postBufferSec is not None:
        coordinator.post_buffer_sec = payload.postBufferSec

    return {"success": True, "message": "Settings updated"}

# ------------------ WEBSOCKET TELEMETRY ------------------

@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            status = coordinator.get_health_status()
            stats = coordinator.db.get_storage_stats()
            diag = get_phone_diagnostics()
            payload = {
                "health": status,
                "storage": stats,
                "phone": diag,
                "timestamp": time.time()
            }
            await websocket.send_json(payload)
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

# ------------------ FRONTEND STATIC HOSTING ------------------

dist_dir = os.path.join(os.path.dirname(__file__), "../dashboard/dist")
if os.path.exists(dist_dir):
    from fastapi.staticfiles import StaticFiles
    assets_path = os.path.join(dist_dir, "assets")
    if os.path.exists(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/")
    def serve_frontend_root():
        return FileResponse(os.path.join(dist_dir, "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5050, log_level="info")
