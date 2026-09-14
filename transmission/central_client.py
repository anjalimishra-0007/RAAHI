"""
Central Transmission Client & Offline-First Queue Worker for RAAHI-Edge.
Handles resilient dispatch of candidate event packages and evidence to the central system.
"""

import json
import os
import threading
import time
import urllib.request
import urllib.error
from typing import Dict, Any, Optional


class CentralClient:
    """
    Clean client abstraction for central RAAHI system communication.
    """

    def __init__(self, central_base_url: str = "http://localhost:5001"):
        self.central_base_url = central_base_url.rstrip("/")

    def check_central_health(self) -> Dict[str, Any]:
        """Checks if central server is reachable."""
        try:
            req = urllib.request.Request(f"{self.central_base_url}/api/status", headers={"User-Agent": "RAAHI-Edge/1.0"})
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return {"connected": True, "data": data}
        except Exception as e:
            return {"connected": False, "error": str(e)}
        return {"connected": False, "error": "Unknown error"}

    def send_candidate_event(self, event_package: Dict[str, Any]) -> Dict[str, Any]:
        """
        Dispatches candidate event to central ingestion endpoint.
        Adapts edge payload to central /api/live/detection expectations.
        """
        url = f"{self.central_base_url}/api/live/detection"
        payload = {
            "eventId": event_package["eventId"],
            "eventType": event_package["eventType"],
            "className": event_package.get("className", "pothole"),
            "confidence": event_package.get("edgeConfidence", 0.0),
            "frame": event_package.get("frameNumber", 0),
            "timestamp": event_package.get("timestamp"),
            "bbox": event_package.get("bbox", {}),
            "bus": event_package.get("busId", "RAAHI-001"),
            "busId": event_package.get("busId", "RAAHI-001")
        }

        try:
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json", "User-Agent": "RAAHI-Edge/1.0"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                return {"success": True, "response": resp_data}
        except urllib.error.HTTPError as e:
            return {"success": False, "status": e.code, "error": e.reason}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def upload_evidence_clip(self, event_id: str, clip_path: str) -> Dict[str, Any]:
        """
        Notifies central system of evidence clip for Google Drive sync.
        """
        url = f"{self.central_base_url}/api/live/evidence/upload"
        if not os.path.exists(clip_path):
            return {"success": False, "error": f"Evidence file not found: {clip_path}"}

        payload = {
            "potholeId": event_id,
            "filePath": os.path.abspath(clip_path),
            "fileName": os.path.basename(clip_path)
        }

        try:
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json", "User-Agent": "RAAHI-Edge/1.0"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                return {"success": True, "response": resp_data}
        except Exception as e:
            return {"success": False, "error": str(e)}


class TransmissionQueueWorker:
    """
    Background daemon that monitors the local SQLite transmission_queue
    and drains pending items to the central system when connectivity allows.
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
        self.running = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.thread.start()

    def stop(self):
        """Stops background worker."""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def _worker_loop(self):
        while self.running:
            try:
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

                            # Send event package
                            res = self.client.send_candidate_event(item)
                            if res.get("success"):
                                # If evidence clip exists, upload clip
                                clip_path = item.get("evidence_clip_path")
                                if clip_path and os.path.exists(clip_path):
                                    self.client.upload_evidence_clip(eid, clip_path)

                                self.db.update_queue_status(eid, "SENT")
                                self.last_sync_time = time.time()
                                self.db.log_system_message("INFO", "NETWORK", f"Event {eid} successfully transmitted to central")
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
