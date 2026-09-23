"""
Manual Development Storage Cleanup Manager for RAAHI-Edge.
STRICTLY FOR LOCAL MACBOOK DEVELOPMENT AND TESTING ONLY.
Requires explicit operator invocation and confirmation token.
Never runs automatically.
"""

import os
import sqlite3
import time
from typing import Dict, Any, List, Optional

from storage.sqlite_db import EdgeDatabase


REQUIRED_CONFIRMATION_TOKEN = "CONFIRM_DELETE_LOCAL_DEV_DATA"


class ManualDevCleanupManager:
    """
    Handles safe, operator-confirmed manual cleanup of local development/test evidence
    and associated SQLite metadata on macOS development machines.
    """

    def __init__(self, db: EdgeDatabase, evidence_dir: str = "data/evidence"):
        self.db = db
        self.evidence_dir = evidence_dir

    def inspect_cleanup_scope(self) -> Dict[str, Any]:
        """
        Non-destructive inspection / dry-run.
        Audits current filesystem and SQLite state without modifying any data.
        """
        # 1. Database records audit
        with self.db.lock:
            conn = self.db._get_connection()
            cur = conn.cursor()

            cur.execute("SELECT COUNT(*) FROM events")
            total_events = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM evidence")
            total_evidence_rows = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM transmission_queue")
            total_queue_rows = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*)
                FROM events e
                JOIN transmission_queue q ON e.event_id = q.event_id
                WHERE q.status = 'SENT' AND e.central_delivery_status = 'SENT'
            """)
            sent_events = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*)
                FROM transmission_queue
                WHERE status IN ('PENDING', 'RECORDING', 'IN_FLIGHT', 'FAILED')
            """)
            pending_events = cur.fetchone()[0]

            # Collect all registered file basenames in DB
            cur.execute("SELECT clip_path, keyframe_path FROM evidence")
            ev_paths = cur.fetchall()
            db_clips = {os.path.basename(r[0]) for r in ev_paths if r[0]}
            db_keyframes = {os.path.basename(r[1]) for r in ev_paths if r[1]}

            conn.close()

        # 2. Filesystem audit
        mp4_files = []
        keyframe_files = []
        other_files = []
        unreferenced_files = []

        total_mp4_bytes = 0
        total_keyframe_bytes = 0
        total_other_bytes = 0

        if os.path.exists(self.evidence_dir):
            for f in os.listdir(self.evidence_dir):
                fp = os.path.join(self.evidence_dir, f)
                if os.path.isfile(fp):
                    sz = os.path.getsize(fp)
                    if f.endswith(".mp4"):
                        mp4_files.append((f, sz))
                        total_mp4_bytes += sz
                    elif f.endswith(".jpg") or f.endswith(".jpeg"):
                        keyframe_files.append((f, sz))
                        total_keyframe_bytes += sz
                    else:
                        other_files.append((f, sz))
                        total_other_bytes += sz

                    if f not in db_clips and f not in db_keyframes:
                        unreferenced_files.append((f, sz))

        total_evidence_bytes = total_mp4_bytes + total_keyframe_bytes + total_other_bytes

        # 3. Database file size audit
        db_path = self.db.db_path
        main_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0
        wal_bytes = os.path.getsize(db_path + "-wal") if os.path.exists(db_path + "-wal") else 0
        shm_bytes = os.path.getsize(db_path + "-shm") if os.path.exists(db_path + "-shm") else 0
        total_db_bytes = main_bytes + wal_bytes + shm_bytes

        return {
            "scope": "LOCAL_MACBOOK_DEVELOPMENT_ONLY",
            "evidenceDir": os.path.abspath(self.evidence_dir),
            "databasePath": os.path.abspath(db_path),
            "totalEvents": total_events,
            "sentEvents": sent_events,
            "pendingEvents": pending_events,
            "evidenceDbRows": total_evidence_rows,
            "queueDbRows": total_queue_rows,
            "totalMp4Files": len(mp4_files),
            "mp4Bytes": total_mp4_bytes,
            "mp4MB": round(total_mp4_bytes / (1024 * 1024), 2),
            "totalKeyframes": len(keyframe_files),
            "keyframeBytes": total_keyframe_bytes,
            "keyframeMB": round(total_keyframe_bytes / (1024 * 1024), 2),
            "otherFiles": len(other_files),
            "totalEvidenceFiles": len(mp4_files) + len(keyframe_files) + len(other_files),
            "totalEvidenceBytes": total_evidence_bytes,
            "totalEvidenceMB": round(total_evidence_bytes / (1024 * 1024), 2),
            "unreferencedFilesCount": len(unreferenced_files),
            "databaseSizeBytes": total_db_bytes,
            "databaseSizeMB": round(total_db_bytes / (1024 * 1024), 2),
            "estimatedSpaceRecoveredMB": round(total_evidence_bytes / (1024 * 1024), 2),
            "warning": (
                "MANUAL DEVELOPMENT CLEANUP WILL PERMANENTLY REMOVE LOCAL EVIDENCE AND SQLITE RECORDS. "
                "Any pending local events will no longer be available for later Central transmission. "
                "Requires explicit confirmation token to execute."
            )
        }

    def execute_cleanup(self, confirm_token: str) -> Dict[str, Any]:
        """
        Executes manual development cleanup ONLY with valid confirmation token.
        Deletes physical evidence files from local disk, cleans associated SQLite records,
        and runs VACUUM to reclaim space.
        """
        if confirm_token != REQUIRED_CONFIRMATION_TOKEN:
            return {
                "success": False,
                "error": f"Invalid confirmation token. Expected '{REQUIRED_CONFIRMATION_TOKEN}', got '{confirm_token}'."
            }

        audit_before = self.inspect_cleanup_scope()

        # 1. Delete physical evidence files from disk
        deleted_files = 0
        freed_bytes = 0
        failed_files = []

        if os.path.exists(self.evidence_dir):
            for f in os.listdir(self.evidence_dir):
                if f.endswith(".mp4") or f.endswith(".jpg") or f.endswith(".jpeg"):
                    fp = os.path.join(self.evidence_dir, f)
                    if os.path.isfile(fp):
                        try:
                            sz = os.path.getsize(fp)
                            os.remove(fp)
                            deleted_files += 1
                            freed_bytes += sz
                        except Exception as e:
                            failed_files.append((f, str(e)))

        # 2. Clean SQLite records
        db_cleanup_res = self.db.clean_all_development_records()

        # 3. VACUUM database to reclaim pages
        self.db.vacuum_database()

        audit_after = self.inspect_cleanup_scope()

        msg = (
            f"[ManualDevCleanup] Operator executed local dev cleanup: "
            f"deleted {deleted_files} files ({freed_bytes / (1024*1024):.2f} MB freed), "
            f"pruned {db_cleanup_res.get('eventsDeleted', 0)} events. "
            f"New DB size: {audit_after['databaseSizeMB']} MB."
        )
        self.db.log_system_message("WARNING", "STORAGE", msg)
        print(msg)

        return {
            "success": True,
            "deletedFiles": deleted_files,
            "freedEvidenceBytes": freed_bytes,
            "freedEvidenceMB": round(freed_bytes / (1024 * 1024), 2),
            "dbRecordsPruned": db_cleanup_res,
            "failedFiles": failed_files,
            "postCleanupAudit": audit_after,
            "message": msg
        }
