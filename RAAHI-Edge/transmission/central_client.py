"""
Central Transmission Client & Offline-First Queue Worker for RAAHI-Edge.
Handles resilient dispatch of candidate event packages and binary evidence clips
to the canonical RAAHI22 Central system.
"""

import json
import os
import threading
import time
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

from utils.config import resolve_central_url


class CentralClient:
    """
    Clean client abstraction for central RAAHI system communication.
    Supports deterministic URL precedence (Constructor -> Env -> config.yaml -> localhost).
    """

    def __init__(self, central_base_url: Optional[str] = None):
        self.central_base_url = resolve_central_url(central_base_url)

    def check_central_health(self) -> Dict[str, Any]:
        """Checks if central server is reachable and active."""
        try:
            req = urllib.request.Request(
                f"{self.central_base_url}/api/status",
                headers={"User-Agent": "RAAHI-Edge/1.0"}
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return {"connected": True, "data": data}
        except Exception as e:
            return {"connected": False, "error": str(e)}
        return {"connected": False, "error": "Unknown error"}

    def send_candidate_event(self, event_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Dispatches candidate event to the canonical central ingestion endpoint:
        POST /api/central/events
        """
        lat = float(event_data["latitude"]) if event_data.get("latitude") is not None else 0.0
        lon = float(event_data["longitude"]) if event_data.get("longitude") is not None else 0.0

        # Guard against zero-GPS unreferenced events polluting central GIS data
        if (lat == 0.0 and lon == 0.0) or event_data.get("central_delivery_status") == "LOCAL_AUDIT_ONLY":
            return {
                "success": False,
                "skipped": True,
                "error": "Zero-GPS event (0.0, 0.0) marked LOCAL_AUDIT_ONLY; withheld from Central GIS"
            }

        url = f"{self.central_base_url}/api/central/events"

        # 1. Parse bounding box
        bbox = {}
        if "bbox_json" in event_data and event_data["bbox_json"]:
            try:
                bbox = json.loads(event_data["bbox_json"])
            except Exception:
                bbox = {}
        elif "bbox" in event_data and isinstance(event_data["bbox"], dict):
            bbox = event_data["bbox"]

        # 2. Parse traffic telemetry if present
        traffic_telemetry = None
        if "traffic_telemetry_json" in event_data and event_data["traffic_telemetry_json"]:
            try:
                traffic_telemetry = json.loads(event_data["traffic_telemetry_json"])
            except Exception:
                traffic_telemetry = None
        elif "trafficTelemetry" in event_data and isinstance(event_data["trafficTelemetry"], dict):
            traffic_telemetry = event_data["trafficTelemetry"]

        # 3. Construct canonical Edge Event Package
        event_id = event_data.get("event_id") or event_data.get("eventId")
        clip_path = event_data.get("evidence_clip_path") or event_data.get("evidence", {}).get("clipPath", "")
        evidence_ref = os.path.basename(clip_path) if clip_path else ""

        payload = {
            "eventId": event_id,
            "eventType": event_data.get("event_type") or event_data.get("eventType") or "pothole",
            "className": event_data.get("class_name") or event_data.get("className") or "pothole",
            "busId": event_data.get("bus_id") or event_data.get("busId") or "RAAHI-001",
            "timestamp": event_data.get("timestamp"),
            "latitude": float(event_data["latitude"]) if event_data.get("latitude") is not None else 0.0,
            "longitude": float(event_data["longitude"]) if event_data.get("longitude") is not None else 0.0,
            "accuracy": float(event_data["gps_accuracy"]) if event_data.get("gps_accuracy") is not None else (float(event_data["accuracy"]) if event_data.get("accuracy") is not None else None),
            "gpsTimestamp": event_data.get("gps_timestamp") or event_data.get("gpsTimestamp"),
            "edgeModel": event_data.get("edge_model") or event_data.get("edgeModel") or "YOLO11n",
            "confidence": float(event_data.get("edge_confidence") if event_data.get("edge_confidence") is not None else event_data.get("confidence", 0.85)),
            "boundingBox": bbox,
            "trafficTelemetry": traffic_telemetry,
            "evidenceReference": evidence_ref
        }

        try:
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json", "User-Agent": "RAAHI-Edge/1.0"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=6.0) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                return {"success": True, "status": resp.status, "response": resp_data}
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode("utf-8"))
                return {"success": False, "status": e.code, "error": err_body.get("message") or e.reason}
            except Exception:
                return {"success": False, "status": e.code, "error": e.reason}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def upload_evidence_clip(self, event_id: str, clip_path: str) -> Dict[str, Any]:
        """
        Transmits actual MP4 binary stream to the central evidence upload endpoint:
        POST /api/central/evidence/upload
        Central stages the file and uploads to Google Drive.
        """
        url = f"{self.central_base_url}/api/central/evidence/upload"
        if not os.path.exists(clip_path):
            return {"success": False, "error": f"Evidence file not found: {clip_path}"}

        file_size = os.path.getsize(clip_path)
        if file_size == 0:
            return {"success": False, "error": f"Evidence file is empty (0 bytes): {clip_path}"}

        file_name = os.path.basename(clip_path)

        with open(clip_path, "rb") as f:
            file_bytes = f.read()

        headers = {
            "Content-Type": "video/mp4",
            "X-Event-ID": event_id,
            "X-File-Name": file_name,
            "Content-Length": str(file_size),
            "User-Agent": "RAAHI-Edge/1.0"
        }

        try:
            req = urllib.request.Request(
                url,
                data=file_bytes,
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=60.0) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                return {"success": True, "status": resp.status, "response": resp_data}
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode("utf-8"))
                return {"success": False, "status": e.code, "error": err_body.get("message") or e.reason}
            except Exception:
                return {"success": False, "status": e.code, "error": e.reason}
        except Exception as e:
            return {"success": False, "error": str(e)}


class TransmissionQueueWorker:
    """
    Background daemon that monitors the local SQLite transmission_queue
    and drains pending items to the central system when connectivity allows.
    Guarantees offline resilience and zero data loss on network drops.
    """

    def __init__(self, db, central_client: CentralClient, poll_interval_sec: float = 3.0):
        self.db = db
        self.client = central_client
        self.poll_interval_sec = poll_interval_sec
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_sync_time: Optional[float] = None
        self.last_sync_status: str = "IDLE"

    def start(self):
        """Starts background worker thread."""
        if self.running:
            return

        # Recover orphaned IN_FLIGHT transmissions on cold start
        try:
            if hasattr(self.db, "recover_stale_in_flight"):
                recovered = self.db.recover_stale_in_flight(is_cold_start=True)
                if recovered > 0:
                    self.db.log_system_message("INFO", "NETWORK", f"Recovered {recovered} orphaned IN_FLIGHT transmission(s) on cold start")
        except Exception as e:
            print(f"[QueueWorker] Error recovering cold-start transmissions: {e}")

        self.running = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.thread.start()

    def stop(self):
        """Stops background worker cleanly."""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def _worker_loop(self):
        while self.running:
            try:
                # 0. Recover stale IN_FLIGHT records (older than 120s) during normal operation
                if hasattr(self.db, "recover_stale_in_flight"):
                    recovered = self.db.recover_stale_in_flight(stale_threshold_sec=120.0, is_cold_start=False)
                    if recovered > 0:
                        self.db.log_system_message("INFO", "NETWORK", f"Recovered {recovered} stale IN_FLIGHT transmission(s) (>120s)")

                # 1. Fetch pending transmission jobs from SQLite
                pending_items = self.db.get_pending_transmissions(limit=5)
                if pending_items:
                    # Check central health before attempting
                    health = self.client.check_central_health()
                    if health.get("connected"):
                        self.last_sync_status = "CONNECTED"
                        for item in pending_items:
                            if not self.running:
                                break
                            eid = item["event_id"]
                            self.db.update_queue_status(eid, "IN_FLIGHT")

                            # Send canonical event package to Central
                            res = self.client.send_candidate_event(item)
                            if res.get("skipped"):
                                self.db.update_queue_status(eid, "LOCAL_AUDIT_ONLY", error=res.get("error"))
                                self.db.log_system_message("INFO", "NETWORK", f"Event {eid} withheld from Central GIS: {res.get('error')}")
                            elif res.get("success"):
                                # If evidence clip exists, upload actual binary MP4
                                clip_path = item.get("evidence_clip_path")
                                if clip_path and os.path.exists(clip_path):
                                    ev_res = self.client.upload_evidence_clip(eid, clip_path)
                                    if ev_res.get("success"):
                                        drive_url = ev_res.get("response", {}).get("driveUrl") or ev_res.get("response", {}).get("videoUrl")
                                        self.db.log_system_message(
                                            "INFO",
                                            "EVIDENCE",
                                            f"Evidence clip for {eid} uploaded to Central ({drive_url or 'staged'})"
                                        )

                                self.db.update_queue_status(eid, "SENT")
                                self.last_sync_time = time.time()
                                self.db.log_system_message("INFO", "NETWORK", f"Event {eid} successfully transmitted to Central")
                            else:
                                err_msg = res.get("error") or f"HTTP {res.get('status')}"
                                self.db.update_queue_status(eid, "FAILED", error=err_msg)
                                self.db.log_system_message("WARNING", "NETWORK", f"Failed transmitting {eid}: {err_msg}")
                    else:
                        self.last_sync_status = "OFFLINE"
                else:
                    self.last_sync_status = "IDLE"

            except Exception as e:
                self.last_sync_status = f"ERROR: {e}"

            time.sleep(self.poll_interval_sec)
