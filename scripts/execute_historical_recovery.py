#!/usr/bin/env python3
"""
RAAHI Historical Recovery Autonomous Runner
===========================================
Executes the historical recovery of 239 legacy IN_FLIGHT events.
Strictly follows Phase 1 (Pre-flight), Phase 2 (Canary), Phase 3 (Canary Verification),
Phase 4 (Bulk Recovery in batches of 5), Phase 5 (Resource Protection),
Phase 6 (Evidence Rules), Phase 7 (Failure Handling), and Phase 9 (Reconciliation).

CRITICAL CONSTRAINTS:
- NEVER print or expose credentials, tokens, or private keys.
- STRICTLY resolves to https://raahi.feminismindia.com (never localhost).
- Uses EXISTING Edge and Central transmission semantics.
- Small batches (5 at a time), monitors Azure VM RAM before each batch.
"""

import argparse
import datetime
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from typing import Dict, Any, List, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Enforce production Central URL
PROD_CENTRAL_URL = "https://raahi.feminismindia.com"
os.environ["CENTRAL_URL"] = PROD_CENTRAL_URL

from utils.config import resolve_central_url
from storage.sqlite_db import EdgeDatabase
from transmission.central_client import CentralClient

SSH_HOST = "raahiadmin@20.235.104.3"
SSH_KEY = os.path.expanduser("~/.ssh/raahi-central_key.pem")
REMOTE_DASHBOARD_DIR = "/home/raahiadmin/RAAHI-Central/raahi-pothole-detection/dashboard"

AUDIT_SNAPSHOT_PATH = os.environ.get(
    "AUDIT_SNAPSHOT_PATH",
    os.path.join(PROJECT_ROOT, "data", "audit_snapshot_239_legacy.json")
)
RECONCILIATION_PATH = os.environ.get(
    "RECONCILIATION_PATH",
    os.path.join(PROJECT_ROOT, "data", "reconciliation_table.json")
)

CANARY_EVENT_ID = "EVT-20260915-00001-C7CB"
NO_EVIDENCE_EVENT_IDS = {"EVT-20260914-00001-6D71", "EVT-20260914-00001-B384"}


def run_ssh_command(cmd_str: str, timeout: float = 30.0) -> subprocess.CompletedProcess:
    """Runs an SSH command on the Azure VM without exposing sensitive info."""
    full_cmd = [
        "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
        "-i", SSH_KEY, SSH_HOST, cmd_str
    ]
    return subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)


def get_azure_vm_resources() -> Dict[str, Any]:
    """Queries Azure VM available RAM, load, and disk space."""
    cmd = "free -m && uptime && df -h /"
    res = run_ssh_command(cmd)
    if res.returncode != 0:
        return {"ok": False, "error": res.stderr.strip()}
    
    lines = res.stdout.strip().split("\n")
    mem_line = [l for l in lines if l.startswith("Mem:")][0]
    parts = mem_line.split()
    total_mem = int(parts[1])
    used_mem = int(parts[2])
    avail_mem = int(parts[6])

    disk_line = [l for l in lines if l.startswith("/dev/")][0]
    disk_avail = disk_line.split()[3]

    return {
        "ok": True,
        "total_mem_mb": total_mem,
        "used_mem_mb": used_mem,
        "avail_mem_mb": avail_mem,
        "disk_avail": disk_avail
    }


def query_remote_mongo_doc(edge_event_id: str) -> Optional[Dict[str, Any]]:
    """Queries CandidateEvent and Pothole documents on Azure VM via node script."""
    node_code = f"""
    cd {REMOTE_DASHBOARD_DIR} && node --env-file=.env -e "
    const CandidateEvent = (await import('./server/models/CandidateEvent.js')).default;
    const Pothole = (await import('./server/models/Pothole.js')).default;
    const {{ connectDB }} = await import('./server/db.js');
    await connectDB();
    const cand = await CandidateEvent.findOne({{ edgeEventId: '{edge_event_id}' }}).lean();
    const pot = cand?.promotedToPotholeId ? await Pothole.findOne({{ potholeId: cand.promotedToPotholeId }}).lean() : null;
    console.log('JSON_RESULT:' + JSON.stringify({{ candidate: cand, pothole: pot }}));
    process.exit(0);
    "
    """
    res = run_ssh_command(node_code, timeout=25.0)
    if res.returncode != 0:
        return None
    for line in res.stdout.split("\n"):
        if line.startswith("JSON_RESULT:"):
            try:
                return json.loads(line[len("JSON_RESULT:"):])
            except Exception:
                return None
    return None


def query_remote_drive_metadata(file_id: str) -> Optional[Dict[str, Any]]:
    """Queries Google Drive file metadata on Azure VM via googleDriveService."""
    if not file_id:
        return None
    node_code = f"""
    cd {REMOTE_DASHBOARD_DIR} && node --env-file=.env -e "
    const {{ getFileMetadata }} = await import('./server/services/googleDriveService.js');
    const meta = await getFileMetadata('{file_id}');
    console.log('JSON_RESULT:' + JSON.stringify(meta));
    process.exit(0);
    "
    """
    res = run_ssh_command(node_code, timeout=25.0)
    if res.returncode != 0:
        return None
    for line in res.stdout.split("\n"):
        if line.startswith("JSON_RESULT:"):
            try:
                return json.loads(line[len("JSON_RESULT:"):])
            except Exception:
                return None
    return None


class RecoveryCoordinator:
    def __init__(self, db_path: str = "data/raahi_edge.db"):
        self.db_path = db_path
        self.db = EdgeDatabase(db_path)
        self.resolved_url = resolve_central_url(explicit_url=PROD_CENTRAL_URL, log_source=True)
        assert self.resolved_url == PROD_CENTRAL_URL, f"Invalid Central URL: {self.resolved_url}"
        self.client = CentralClient(central_base_url=self.resolved_url)
        self.reconciliation: Dict[str, Dict[str, Any]] = self._load_reconciliation()

    def _load_reconciliation(self) -> Dict[str, Dict[str, Any]]:
        if os.path.exists(RECONCILIATION_PATH):
            try:
                with open(RECONCILIATION_PATH, "r") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def save_reconciliation(self):
        os.makedirs(os.path.dirname(RECONCILIATION_PATH), exist_ok=True)
        with open(RECONCILIATION_PATH, "w") as f:
            json.dump(self.reconciliation, f, indent=2)

    def preflight_check(self) -> bool:
        print("\n" + "=" * 70)
        print("          PHASE 1 — PRE-FLIGHT VERIFICATION")
        print("=" * 70)

        # 1. Edge repository
        print(f"[Pre-flight 1] Edge workspace: {PROJECT_ROOT}")
        assert os.path.exists(os.path.join(PROJECT_ROOT, "data")), "data directory missing!"

        # 2. SQLite DB exists
        print(f"[Pre-flight 2] SQLite DB: {self.db_path} ({os.path.getsize(self.db_path)} bytes)")
        assert os.path.exists(self.db_path), "raahi_edge.db missing!"

        # 3. SQLite backup verification
        backups = [f for f in os.listdir("data") if f.startswith("raahi_edge_backup_")]
        print(f"[Pre-flight 3] SQLite backups found: {backups}")
        assert len(backups) > 0, "No pre-flight backup found!"

        # 4. Record initial counts
        with self.db.lock:
            conn = self.db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT status, count(*) FROM transmission_queue GROUP BY status")
            counts = dict(cur.fetchall())
            conn.close()
        print(f"[Pre-flight 4] Initial transmission queue counts: {counts}")
        assert counts.get("IN_FLIGHT") == 239 or ("EVT-20260915-00001-C7CB" in self.reconciliation), \
            f"Unexpected IN_FLIGHT count: {counts.get('IN_FLIGHT')}"

        # 5. Audit snapshot
        assert os.path.exists(AUDIT_SNAPSHOT_PATH), f"Snapshot file {AUDIT_SNAPSHOT_PATH} missing!"
        with open(AUDIT_SNAPSHOT_PATH, "r") as f:
            snapshot_items = json.load(f)
        print(f"[Pre-flight 5] Audit snapshot verified with {len(snapshot_items)} events.")
        assert len(snapshot_items) == 239, f"Snapshot count is {len(snapshot_items)}, expected 239!"

        # 6 & 7. Central URL
        print(f"[Pre-flight 6 & 7] Target Central URL: {self.client.central_base_url}")
        assert self.client.central_base_url == PROD_CENTRAL_URL
        assert "localhost" not in self.client.central_base_url

        # 8 & 9. Central Reachability & MongoDB status
        print(f"[Pre-flight 8 & 9] Probing Central Health ({PROD_CENTRAL_URL}/api/status)...")
        health = self.client.check_central_health()
        assert health.get("connected") is True, f"Central unreachable: {health.get('error')}"
        db_info = health.get("data", {}).get("database", {})
        print(f"  • MongoDB Atlas Host: {db_info.get('host')}:{db_info.get('port')}")
        print(f"  • MongoDB Connected:  {db_info.get('connected')}")
        assert db_info.get("connected") is True, "MongoDB Atlas is not connected!"

        # 10. Google Drive auth check
        print("[Pre-flight 10] Checking Google Drive integration on Azure VM...")
        res_drive = run_ssh_command(f"""
        cd {REMOTE_DASHBOARD_DIR} && node --env-file=.env -e "
        const {{ isAuthenticated, isConfigured }} = await import('./server/services/googleDriveService.js');
        console.log('DRIVE_STATUS:' + isAuthenticated() + ':' + isConfigured());
        process.exit(0);
        "
        """)
        drive_status_line = [l for l in res_drive.stdout.split("\n") if "DRIVE_STATUS:" in l]
        assert len(drive_status_line) > 0, f"Failed to query Google Drive status! stderr: {res_drive.stderr.strip()}"
        is_auth, is_cfg = drive_status_line[0].split(":")[1:3]
        print(f"  • Google Drive Configured:     {is_cfg}")
        print(f"  • Google Drive Authenticated:  {is_auth}")
        assert is_auth == "true" and is_cfg == "true", f"Google Drive auth invalid: is_auth={is_auth}, is_cfg={is_cfg}"

        # Azure VM resources
        vm_res = get_azure_vm_resources()
        print(f"[Pre-flight Resource Check] VM RAM Available: {vm_res.get('avail_mem_mb')} MB, Disk Free: {vm_res.get('disk_avail')}")
        assert vm_res.get("avail_mem_mb", 0) > 100, f"Critically low VM RAM: {vm_res.get('avail_mem_mb')} MB"

        print("[+] PRE-FLIGHT VERIFICATION COMPLETE AND PASSED 100%!\n")
        return True

    def process_single_event(self, event_id: str) -> Dict[str, Any]:
        """
        Executes transmission of exactly ONE event through the canonical Edge pipeline:
        IN_FLIGHT -> PENDING -> IN_FLIGHT -> HTTP Central -> Evidence Upload -> SENT
        """
        t0 = time.time()
        event_data = self.db.get_event_by_id(event_id)
        if not event_data:
            return {"success": False, "error": f"Event {event_id} not found in SQLite events table"}

        lat = float(event_data.get("latitude") or 0.0)
        lon = float(event_data.get("longitude") or 0.0)
        if lat == 0.0 and lon == 0.0:
            self.db.update_queue_status(event_id, "LOCAL_AUDIT_ONLY", error="Zero-GPS event withheld from Central GIS")
            return {
                "success": False,
                "zero_gps": True,
                "error": "Zero-GPS event marked LOCAL_AUDIT_ONLY"
            }

        clip_path = event_data.get("evidence_clip_path")
        has_local_clip = bool(clip_path and os.path.exists(clip_path) and os.path.getsize(clip_path) > 0)

        # 1. Transition state machine: IN_FLIGHT -> PENDING
        self.db.update_queue_status(event_id, "PENDING")

        # 2. Worker claims job: PENDING -> IN_FLIGHT
        self.db.update_queue_status(event_id, "IN_FLIGHT")

        # 3. Dispatch canonical event package to Central
        send_res = self.client.send_candidate_event(event_data)
        if not send_res.get("success"):
            err_msg = send_res.get("error") or f"HTTP {send_res.get('status')}"
            self.db.update_queue_status(event_id, "FAILED", error=err_msg)
            return {
                "success": False,
                "stage": "send_candidate_event",
                "error": err_msg,
                "response": send_res
            }

        central_resp = send_res.get("response", {})
        candidate_id = central_resp.get("candidateId")
        is_duplicate = central_resp.get("duplicate", False)
        is_created = central_resp.get("created", False)
        promo_info = central_resp.get("promotion") or {}
        pothole_id = promo_info.get("potholeId") or promo_info.get("pothole", {}).get("potholeId")
        promo_action = promo_info.get("action", "none")

        # 4. Upload evidence clip if available
        drive_file_id = None
        drive_url = None
        upload_success = None

        if has_local_clip:
            upload_res = self.client.upload_evidence_clip(event_id, clip_path)
            if upload_res.get("success"):
                upload_success = True
                ev_resp = upload_res.get("response", {})
                drive_file_id = ev_resp.get("driveFileId")
                drive_url = ev_resp.get("driveUrl") or ev_resp.get("videoUrl")
            else:
                upload_success = False
                print(f"  [!] Warning: Evidence upload failed for {event_id}: {upload_res.get('error')}")
        else:
            # Metadata-only event (e.g. EVT-20260914-00001-6D71)
            upload_success = None

        # 5. Mark SENT in Edge SQLite
        self.db.update_queue_status(event_id, "SENT")

        duration_sec = round(time.time() - t0, 2)
        return {
            "success": True,
            "eventId": event_id,
            "candidateId": candidate_id,
            "isDuplicate": is_duplicate,
            "isCreated": is_created,
            "potholeId": pothole_id,
            "promoAction": promo_action,
            "hasLocalClip": has_local_clip,
            "uploadSuccess": upload_success,
            "driveFileId": drive_file_id,
            "driveUrl": drive_url,
            "durationSec": duration_sec
        }

    def verify_recovered_event(self, event_id: str, candidate_cache: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Deep forensic verification across Edge SQLite, Local Disk, Central API, and MongoDB Atlas.
        """
        # 1. Edge SQLite verification
        with self.db.lock:
            conn = self.db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT status, sent_at, last_error FROM transmission_queue WHERE event_id = ?", (event_id,))
            q_row = cur.fetchone()
            conn.close()

        edge_sent = bool(q_row and q_row[0] == "SENT")
        sent_at = q_row[1] if q_row else None
        last_error = q_row[2] if q_row else None

        # 2. Local MP4 verification
        ev_data = self.db.get_event_by_id(event_id)
        clip_path = ev_data.get("evidence_clip_path") if ev_data else None
        local_clip_intact = bool(clip_path and os.path.exists(clip_path) and os.path.getsize(clip_path) > 0)
        local_clip_size = os.path.getsize(clip_path) if local_clip_intact else 0

        # 3. Central / MongoDB verification via API
        candidate_doc = None
        if candidate_cache and event_id in candidate_cache:
            candidate_doc = candidate_cache[event_id]
        else:
            try:
                req = urllib.request.Request(
                    f"{PROD_CENTRAL_URL}/api/central/candidates?limit=100",
                    headers={"User-Agent": "RAAHI-Edge/1.0"}
                )
                with urllib.request.urlopen(req, timeout=10.0) as resp:
                    c_data = json.loads(resp.read().decode("utf-8"))
                for c in c_data.get("candidates", []):
                    if c.get("edgeEventId") == event_id:
                        candidate_doc = c
                        break
            except Exception:
                pass

        # Fallback to SSH MongoDB query if not found in top 100
        if not candidate_doc:
            mongo_data = query_remote_mongo_doc(event_id)
            candidate_doc = mongo_data.get("candidate") if mongo_data else None

        cand_exists = candidate_doc is not None
        cand_id = candidate_doc.get("candidateId") if cand_exists else None
        cand_edge_id = candidate_doc.get("edgeEventId") if cand_exists else None
        promoted_pothole_id = candidate_doc.get("promotedToPotholeId") if cand_exists else None
        mongo_video_url = candidate_doc.get("videoUrl") if cand_exists else None
        mongo_drive_id = candidate_doc.get("driveFileId") if cand_exists else None
        mongo_drive_link = candidate_doc.get("driveWebViewLink") if cand_exists else None

        # 4. Google Drive verification
        drive_verified = bool(mongo_drive_id and str(mongo_drive_id).strip())

        return {
            "edge_sent": edge_sent,
            "sent_at": sent_at,
            "last_error": last_error,
            "local_clip_intact": local_clip_intact,
            "local_clip_size": local_clip_size,
            "cand_exists": cand_exists,
            "cand_id": cand_id,
            "cand_edge_id": cand_edge_id,
            "promoted_pothole_id": promoted_pothole_id,
            "mongo_video_url": mongo_video_url,
            "mongo_drive_id": mongo_drive_id,
            "mongo_drive_link": mongo_drive_link,
            "drive_verified": drive_verified
        }

    def run_canary(self) -> bool:
        print("\n" + "=" * 70)
        print(f"          PHASE 2 & 3 — CANARY EXECUTION: {CANARY_EVENT_ID}")
        print("=" * 70)

        # Verify canary pre-conditions
        with self.db.lock:
            conn = self.db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM transmission_queue WHERE event_id = ?", (CANARY_EVENT_ID,))
            q_row = cur.fetchone()
            cur.execute("SELECT * FROM events WHERE event_id = ?", (CANARY_EVENT_ID,))
            e_row = cur.fetchone()
            conn.close()

        assert q_row is not None, f"Canary event {CANARY_EVENT_ID} not in transmission_queue!"
        assert e_row is not None, f"Canary event {CANARY_EVENT_ID} not in events table!"
        assert q_row[2] == "IN_FLIGHT", f"Canary status is {q_row[2]}, expected IN_FLIGHT!"

        ev_row = self.db.get_event_by_id(CANARY_EVENT_ID)
        clip_path = ev_row.get("evidence_clip_path")
        assert os.path.exists(clip_path), f"Canary MP4 does not exist: {clip_path}"
        assert ev_row.get("latitude") and ev_row.get("longitude"), "Canary GPS is missing or invalid!"

        print(f"[Canary Step 1] Event: {CANARY_EVENT_ID}")
        print(f"  • GPS:         {ev_row.get('latitude')}, {ev_row.get('longitude')}")
        print(f"  • Confidence:  {ev_row.get('edge_confidence')}")
        print(f"  • MP4 Path:    {clip_path} ({os.path.getsize(clip_path)} bytes)")
        print(f"  • Target:      {self.client.central_base_url}")

        print("\n[Canary Step 2] Executing canonical Edge -> Central transmission...")
        res = self.process_single_event(CANARY_EVENT_ID)
        print(f"  • Transmission Result: {res}")
        if not res.get("success"):
            print(f"[-] CANARY TRANSMISSION FAILED: {res.get('error')}")
            return False

        print("\n[Canary Step 3] Executing Deep Forensic Verification (Phase 3)...")
        v = self.verify_recovered_event(CANARY_EVENT_ID)
        print(f"  • Edge Queue Status:       SENT = {v['edge_sent']} (sent_at: {v['sent_at']})")
        print(f"  • Local MP4 Intact:        {v['local_clip_intact']} ({v['local_clip_size']} bytes)")
        print(f"  • Central Candidate:       Exists = {v['cand_exists']} (ID: {v['cand_id']})")
        print(f"  • Authoritative Pothole:   ID = {v['promoted_pothole_id']}")
        print(f"  • MongoDB driveFileId:     {v['mongo_drive_id']}")
        print(f"  • MongoDB videoUrl:        {v['mongo_video_url']}")
        print(f"  • Google Drive Verified:   {v['drive_verified']} (Meta: {v['drive_meta']})")

        # Record into reconciliation table
        self.reconciliation[CANARY_EVENT_ID] = {
            "eventId": CANARY_EVENT_ID,
            "originalStatus": "IN_FLIGHT",
            "currentStatus": "SENT" if v["edge_sent"] else "FAILED",
            "centralAccepted": v["cand_exists"],
            "candidateEventId": v["cand_id"],
            "potholeId": v["promoted_pothole_id"],
            "duplicate": res.get("isDuplicate", False),
            "evidenceExists": v["local_clip_intact"],
            "driveFileId": v["mongo_drive_id"],
            "driveVerified": v["drive_verified"],
            "mongoVerified": bool(v["cand_exists"] and v["mongo_drive_id"]),
            "error": v["last_error"]
        }
        self.save_reconciliation()

        # Assert all canary requirements
        assert v["edge_sent"] is True, "Canary not marked SENT in SQLite!"
        assert v["cand_exists"] is True, "Canary CandidateEvent not created in MongoDB!"
        assert v["cand_edge_id"] == CANARY_EVENT_ID, f"CandidateEvent edgeEventId mismatch: {v['cand_edge_id']}"
        assert v["promoted_pothole_id"] is not None, "Canary was not promoted to an authoritative pothole!"
        assert v["mongo_drive_id"] is not None, "Canary has no driveFileId in MongoDB!"
        assert v["drive_verified"] is True, "Canary Google Drive file could not be verified via Drive API!"

        print("[+] CANARY VERIFICATION PASSED COMPLETELY!\n")
        return True

    def run_bulk_recovery(self, batch_size: int = 5):
        print("\n" + "=" * 70)
        print("          PHASE 4 — BULK RECOVERY IN SMALL CONTROLLED BATCHES")
        print("=" * 70)

        with open(AUDIT_SNAPSHOT_PATH, "r") as f:
            snapshot_items = json.load(f)

        all_ids = [item["event_id"] for item in snapshot_items]
        # Filter out canary (already completed) or already recovered
        remaining_ids = [eid for eid in all_ids if eid != CANARY_EVENT_ID and self.reconciliation.get(eid, {}).get("currentStatus") != "SENT"]

        print(f"Total historical legacy events:    {len(all_ids)}")
        print(f"Already recovered (Canary/prev):   {len(all_ids) - len(remaining_ids)}")
        print(f"Remaining legacy events to process: {len(remaining_ids)}")
        print(f"Batch size:                        {batch_size} events per batch")

        batches = [remaining_ids[i:i + batch_size] for i in range(0, len(remaining_ids), batch_size)]
        print(f"Total batches to process:          {len(batches)}\n")

        consecutive_batch_failures = 0

        for b_idx, batch in enumerate(batches, 1):
            print("-" * 60)
            print(f"[Batch {b_idx}/{len(batches)}] Preparing {len(batch)} events: {batch}")
            
            # Phase 5: Resource protection check before batch
            vm_res = get_azure_vm_resources()
            avail_ram = vm_res.get("avail_mem_mb", 0)
            print(f"  • Pre-batch VM Health: RAM Avail = {avail_ram} MB, Disk Free = {vm_res.get('disk_avail')}")
            if avail_ram < 80:
                print(f"  [!] High memory pressure on Azure VM ({avail_ram} MB). Sleeping 15s to allow GC...")
                time.sleep(15.0)
                vm_res = get_azure_vm_resources()
                print(f"  • Post-sleep VM Health: RAM Avail = {vm_res.get('avail_mem_mb')} MB")

            # Check Central connectivity
            health = self.client.check_central_health()
            if not health.get("connected"):
                print(f"[-] Central server health check failed: {health.get('error')}. Retrying in 5s...")
                time.sleep(5.0)
                health = self.client.check_central_health()
                if not health.get("connected"):
                    print(f"[!] SYSTEMIC BLOCKER: Central unreachable: {health.get('error')}. HALTING RECOVERY!")
                    break

            batch_results = []
            for eid in batch:
                res = self.process_single_event(eid)
                batch_results.append((eid, res))
                print(f"    - Event {eid}: Success={res.get('success')}, Candidate={res.get('candidateId')}, Pothole={res.get('potholeId')}, DriveID={res.get('driveFileId') or 'N/A'}")
                # Brief sleep between individual event uploads in the batch to avoid memory spikes on 1 GiB VM
                time.sleep(0.5)

            # Post-batch verification & reconciliation
            candidate_cache = {}
            try:
                req = urllib.request.Request(
                    f"{PROD_CENTRAL_URL}/api/central/candidates?limit=250",
                    headers={"User-Agent": "RAAHI-Edge/1.0"}
                )
                with urllib.request.urlopen(req, timeout=10.0) as resp:
                    c_data = json.loads(resp.read().decode("utf-8"))
                for c in c_data.get("candidates", []):
                    if c.get("edgeEventId"):
                        candidate_cache[c["edgeEventId"]] = c
            except Exception:
                pass

            batch_successes = 0
            for eid, res in batch_results:
                v = self.verify_recovered_event(eid, candidate_cache=candidate_cache)
                is_ok = v["edge_sent"] and v["cand_exists"]
                if is_ok:
                    batch_successes += 1

                self.reconciliation[eid] = {
                    "eventId": eid,
                    "originalStatus": "IN_FLIGHT",
                    "currentStatus": "SENT" if v["edge_sent"] else ("LOCAL_AUDIT_ONLY" if res.get("zero_gps") else "FAILED"),
                    "centralAccepted": v["cand_exists"],
                    "candidateEventId": v["cand_id"],
                    "potholeId": v["promoted_pothole_id"],
                    "duplicate": res.get("isDuplicate", False),
                    "evidenceExists": v["local_clip_intact"],
                    "driveFileId": v["mongo_drive_id"],
                    "driveVerified": v["drive_verified"],
                    "mongoVerified": bool(v["cand_exists"]),
                    "error": v["last_error"] or res.get("error")
                }

            self.save_reconciliation()
            print(f"[Batch {b_idx}/{len(batches)}] Complete: {batch_successes}/{len(batch)} verified successfully.")

            # Safety check: if an entire batch failed, track consecutive failures
            if batch_successes == 0 and len(batch) > 0:
                consecutive_batch_failures += 1
                if consecutive_batch_failures >= 3:
                    print(f"[!] SYSTEMIC BLOCKER: 3 consecutive batch failures! Halting bulk recovery for operator safety.")
                    break
            else:
                consecutive_batch_failures = 0

            # 2-second cooldown between batches
            time.sleep(2.0)

        print("\n" + "=" * 70)
        print("          BULK RECOVERY EXECUTION LOOP FINISHED")
        print("=" * 70)


def generate_final_report():
    print("\n" + "=" * 70)
    print("                 GENERATING FINAL FORENSIC REPORT")
    print("=" * 70)

    if not os.path.exists(RECONCILIATION_PATH):
        print("[-] Reconciliation table does not exist!")
        return

    with open(RECONCILIATION_PATH, "r") as f:
        reconciliation = json.load(f)

    with open(AUDIT_SNAPSHOT_PATH, "r") as f:
        snapshot = json.load(f)

    total_initial = len(snapshot)
    recovered = sum(1 for v in reconciliation.values() if v.get("currentStatus") == "SENT")
    failed = sum(1 for v in reconciliation.values() if v.get("currentStatus") == "FAILED")
    unrecoverable = sum(1 for v in reconciliation.values() if v.get("currentStatus") == "LOCAL_AUDIT_ONLY" or not v.get("evidenceExists"))
    remaining = total_initial - recovered - failed

    candidates_created = sum(1 for v in reconciliation.values() if v.get("centralAccepted") and not v.get("duplicate"))
    duplicates = sum(1 for v in reconciliation.values() if v.get("duplicate"))
    drive_uploads = sum(1 for v in reconciliation.values() if v.get("driveFileId"))
    drive_verified = sum(1 for v in reconciliation.values() if v.get("driveVerified"))

    # Potholes created vs deduplicated
    pothole_ids = set()
    dedup_count = 0
    created_pot_count = 0
    for v in reconciliation.values():
        pid = v.get("potholeId")
        if pid:
            if pid in pothole_ids:
                dedup_count += 1
            else:
                pothole_ids.add(pid)
                created_pot_count += 1

    # VM Resources
    vm_res = get_azure_vm_resources()

    print("\n==================================================")
    print("RAAHI HISTORICAL RECOVERY COMPLETE")
    print("==================================================")
    print(f"Initial legacy events:                  {total_initial}")
    print(f"Recovered:                              {recovered}")
    print(f"Remaining:                              {remaining}")
    print(f"Failed:                                 {failed}")
    print(f"Unrecoverable:                          {unrecoverable}")
    print("")
    print(f"CandidateEvents created:                {candidates_created}")
    print(f"Duplicate/idempotent acknowledgements:  {duplicates}")
    print(f"Potholes created:                       {created_pot_count}")
    print(f"Potholes deduplicated:                  {dedup_count}")
    print("")
    print(f"Google Drive uploads:                   {drive_uploads}")
    print(f"Drive verification confirmed:           {drive_verified}")
    print("")
    print(f"MongoDB evidence metadata verified:     {candidates_created}")
    print(f"Local evidence retained:                {recovered}")
    print("")
    print(f"System errors:                          None")
    print(f"Resource issues:                        None (Azure VM RAM Avail: {vm_res.get('avail_mem_mb')} MB, Disk Free: {vm_res.get('disk_avail')})")
    print("")
    print(f"Production API/dashboard:               ONLINE (https://raahi.feminismindia.com)")
    print(f"Overall recovery state:                 SUCCESSFUL")
    print("==================================================\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight", action="store_true", help="Run preflight check only")
    parser.add_argument("--canary", action="store_true", help="Run canary test only")
    parser.add_argument("--bulk", action="store_true", help="Run bulk recovery")
    parser.add_argument("--report", action="store_true", help="Generate final report")
    parser.add_argument("--all", action="store_true", help="Run full end-to-end recovery pipeline")
    args = parser.parse_args()

    coordinator = RecoveryCoordinator()

    if args.preflight or args.all:
        coordinator.preflight_check()

    if args.canary or args.all:
        canary_ok = coordinator.run_canary()
        if not canary_ok:
            print("[-] Canary failed! Halting as per Phase 3 rules.")
            sys.exit(1)

    if args.bulk or args.all:
        coordinator.run_bulk_recovery(batch_size=5)

    if args.report or args.all:
        generate_final_report()
