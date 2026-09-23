"""
Local MacBook Storage Retention Manager for RAAHI-Edge.
Monitors local evidence storage (max 800 MB) and SQLite database size (max 200 MB).
Safely prunes oldest completed/ACKed historical data while strictly protecting pending,
in-flight, or currently recording evidence files and database records.
"""

import os
import threading
import time
from typing import Dict, List, Optional, Set, Callable, Any

from storage.sqlite_db import EdgeDatabase


class RetentionConfig:
    """Configurable local storage limits and retention rules."""

    def __init__(
        self,
        max_evidence_mb: float = 800.0,
        max_database_mb: float = 200.0,
        target_headroom_ratio: float = 0.90,
        check_interval_sec: float = 60.0,
        enabled: bool = True
    ):
        self.max_evidence_mb = max_evidence_mb
        self.max_database_mb = max_database_mb
        self.target_headroom_ratio = target_headroom_ratio  # Cleans down to 90% of limit
        self.check_interval_sec = check_interval_sec
        self.enabled = enabled


class RetentionManager:
    """
    Manages local filesystem and SQLite database storage limits.
    Separates concerns from video ingestion and recording.
    """

    def __init__(
        self,
        db: EdgeDatabase,
        evidence_dir: str = "data/evidence",
        config: Optional[RetentionConfig] = None,
        active_events_getter: Optional[Callable[[], Set[str]]] = None
    ):
        self.db = db
        self.evidence_dir = evidence_dir
        self.config = config or RetentionConfig()
        self.active_events_getter = active_events_getter or (lambda: set())
        self.lock = threading.Lock()

        # State tracking
        self.last_cleanup_time: Optional[float] = None
        self.last_cleanup_result: str = "IDLE"
        self.current_status: str = "NORMAL"  # NORMAL, NEAR_LIMIT, CLEANUP_ACTIVE, LIMIT_REACHED_PROTECTED

        # Background worker
        self._worker_thread: Optional[threading.Thread] = None
        self._is_running = False

    def get_evidence_usage(self) -> Dict[str, Any]:
        """Calculates total bytes and file count in the local evidence directory."""
        total_bytes = 0
        file_count = 0
        if os.path.exists(self.evidence_dir):
            for f in os.listdir(self.evidence_dir):
                fp = os.path.join(self.evidence_dir, f)
                if os.path.isfile(fp):
                    total_bytes += os.path.getsize(fp)
                    file_count += 1

        return {
            "bytes": total_bytes,
            "mb": round(total_bytes / (1024 * 1024), 2),
            "files": file_count
        }

    def get_database_usage(self) -> Dict[str, Any]:
        """Measures SQLite database size including WAL and SHM sidecars."""
        db_path = self.db.db_path
        main_bytes = os.path.getsize(db_path) if os.path.exists(db_path) else 0
        wal_bytes = os.path.getsize(db_path + "-wal") if os.path.exists(db_path + "-wal") else 0
        shm_bytes = os.path.getsize(db_path + "-shm") if os.path.exists(db_path + "-shm") else 0
        total_bytes = main_bytes + wal_bytes + shm_bytes

        return {
            "bytes": total_bytes,
            "mb": round(total_bytes / (1024 * 1024), 2),
            "mainBytes": main_bytes,
            "walBytes": wal_bytes,
            "shmBytes": shm_bytes
        }

    def get_status(self) -> Dict[str, Any]:
        """Returns comprehensive storage status for dashboard and diagnostics."""
        ev_usage = self.get_evidence_usage()
        db_usage = self.get_database_usage()

        # Query eligible vs protected counts
        with self.db.lock:
            conn = self.db._get_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT COUNT(*)
                FROM events e
                JOIN transmission_queue q ON e.event_id = q.event_id
                WHERE q.status = 'SENT' AND e.central_delivery_status = 'SENT'
                  AND e.evidence_clip_path IS NOT NULL
            """)
            eligible_count = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*)
                FROM transmission_queue
                WHERE status IN ('PENDING', 'RECORDING', 'IN_FLIGHT', 'FAILED')
            """)
            protected_count = cur.fetchone()[0]
            conn.close()

        # Evaluate status badge
        status = "NORMAL"
        if ev_usage["mb"] > self.config.max_evidence_mb or db_usage["mb"] > self.config.max_database_mb:
            if eligible_count == 0:
                status = "LIMIT_REACHED_PROTECTED"
            else:
                status = "CLEANUP_ACTIVE"
        elif ev_usage["mb"] >= self.config.max_evidence_mb * 0.85 or db_usage["mb"] >= self.config.max_database_mb * 0.85:
            status = "NEAR_LIMIT"

        self.current_status = status

        return {
            "evidenceMB": ev_usage["mb"],
            "maxEvidenceMB": self.config.max_evidence_mb,
            "databaseMB": db_usage["mb"],
            "maxDatabaseMB": self.config.max_database_mb,
            "retentionStatus": status,
            "eligibleClips": eligible_count,
            "protectedClips": protected_count,
            "totalEvidenceFiles": ev_usage["files"],
            "lastCleanupTime": self.last_cleanup_time,
            "lastCleanupResult": self.last_cleanup_result
        }

    def enforce_evidence_retention(self) -> Dict[str, Any]:
        """
        Enforces MAX EVIDENCE STORAGE limit.
        Deletes oldest eligible evidence files until storage drops below the headroom target.
        STRICT RULE: Only deletes files whose transmission is complete and ACKed.
        Never deletes currently recording, finalizing, or pending files.
        """
        ev_usage = self.get_evidence_usage()
        max_bytes = int(self.config.max_evidence_mb * 1024 * 1024)
        target_bytes = int(max_bytes * self.config.target_headroom_ratio)

        if ev_usage["bytes"] <= max_bytes:
            return {
                "triggered": False,
                "freedBytes": 0,
                "deletedFiles": 0,
                "status": "NORMAL",
                "message": f"Evidence storage within limits ({ev_usage['mb']} MB / {self.config.max_evidence_mb} MB)"
            }

        bytes_to_free = ev_usage["bytes"] - target_bytes
        freed_bytes = 0
        deleted_count = 0
        active_eids = self.active_events_getter()

        # 1. Fetch eligible records from SQLite (ordered oldest-first)
        eligible_records = self.db.get_eligible_evidence_for_pruning(limit=100)

        for rec in eligible_records:
            if freed_bytes >= bytes_to_free:
                break

            eid = rec["event_id"]
            # Double-check active safety
            if eid in active_eids:
                continue

            clip_path = rec.get("clip_path")
            keyframe_path = rec.get("keyframe_path")
            event_freed = 0

            if clip_path and os.path.exists(clip_path):
                # Ensure not modified within the last 15 seconds (active writing guard)
                if time.time() - os.path.getmtime(clip_path) > 15.0:
                    sz = os.path.getsize(clip_path)
                    try:
                        os.remove(clip_path)
                        event_freed += sz
                        deleted_count += 1
                    except Exception as e:
                        print(f"[RetentionManager] Error removing {clip_path}: {e}")

            if keyframe_path and os.path.exists(keyframe_path):
                sz = os.path.getsize(keyframe_path)
                try:
                    os.remove(keyframe_path)
                    event_freed += sz
                    deleted_count += 1
                except Exception as e:
                    print(f"[RetentionManager] Error removing {keyframe_path}: {e}")

            # Update DB reference
            self.db.prune_event_evidence_record(eid)
            freed_bytes += event_freed

        # Check final storage level
        new_ev_usage = self.get_evidence_usage()
        self.last_cleanup_time = time.time()

        if new_ev_usage["bytes"] > max_bytes and deleted_count == 0:
            msg = f"Evidence storage limit reached ({new_ev_usage['mb']:.1f} MB / {self.config.max_evidence_mb:.1f} MB), but all eligible files are protected."
            self.last_cleanup_result = msg
            self.current_status = "LIMIT_REACHED_PROTECTED"
            self.db.log_system_message("WARNING", "STORAGE", msg)
            return {
                "triggered": True,
                "freedBytes": 0,
                "deletedFiles": 0,
                "status": "LIMIT_REACHED_PROTECTED",
                "message": msg
            }

        msg = f"Cleaned {deleted_count} evidence files, freed {freed_bytes / (1024 * 1024):.2f} MB (new total: {new_ev_usage['mb']} MB)"
        self.last_cleanup_result = msg
        self.current_status = "NORMAL" if new_ev_usage["bytes"] <= max_bytes else "LIMIT_REACHED_PROTECTED"
        self.db.log_system_message("INFO", "STORAGE", msg)
        return {
            "triggered": True,
            "freedBytes": freed_bytes,
            "deletedFiles": deleted_count,
            "status": self.current_status,
            "message": msg
        }

    def enforce_database_retention(self) -> Dict[str, Any]:
        """
        Enforces MAX SQLITE STORAGE limit (200 MB).
        Prunes oldest fully-transmitted historical events from SQLite and executes VACUUM.
        STRICT RULE: Never deletes pending or un-transmitted events.
        """
        db_usage = self.get_database_usage()
        max_bytes = int(self.config.max_database_mb * 1024 * 1024)

        if db_usage["bytes"] <= max_bytes:
            return {
                "triggered": False,
                "prunedEvents": 0,
                "message": f"Database within limits ({db_usage['mb']} MB / {self.config.max_database_mb} MB)"
            }

        # Fetch eligible historical events
        eligible_eids = self.db.get_eligible_events_for_db_pruning(limit=200)
        if not eligible_eids:
            msg = f"Database storage limit reached ({db_usage['mb']:.1f} MB / {self.config.max_database_mb:.1f} MB), but all records are protected."
            self.db.log_system_message("WARNING", "STORAGE", msg)
            return {
                "triggered": True,
                "prunedEvents": 0,
                "message": msg
            }

        pruned_count = 0
        for eid in eligible_eids:
            if self.db.prune_historical_event(eid):
                pruned_count += 1

        # Run VACUUM to reclaim filesystem pages
        self.db.vacuum_database()
        new_usage = self.get_database_usage()
        msg = f"Pruned {pruned_count} historical DB records and ran VACUUM (new size: {new_usage['mb']} MB)"
        self.db.log_system_message("INFO", "STORAGE", msg)

        return {
            "triggered": True,
            "prunedEvents": pruned_count,
            "newMb": new_usage["mb"],
            "message": msg
        }

    def check_and_enforce(self) -> Dict[str, Any]:
        """Executes full retention check for both evidence and database storage."""
        with self.lock:
            ev_res = self.enforce_evidence_retention()
            db_res = self.enforce_database_retention()
            status = self.get_status()
            return {
                "evidence": ev_res,
                "database": db_res,
                "status": status
            }

    def trigger_async_check(self):
        """Spawns an asynchronous check in a background thread so the caller is never blocked."""
        threading.Thread(target=self.check_and_enforce, daemon=True).start()

    def start_worker(self):
        """Starts the periodic background storage monitor."""
        if self._is_running:
            return
        self._is_running = True
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker_thread.start()
        print(f"[RetentionManager] Storage retention daemon started (check every {self.config.check_interval_sec}s, limits: {self.config.max_evidence_mb}MB ev / {self.config.max_database_mb}MB db)")

    def stop_worker(self):
        """Stops the periodic background monitor."""
        self._is_running = False
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=2.0)

    def _worker_loop(self):
        while self._is_running:
            try:
                self.check_and_enforce()
            except Exception as e:
                print(f"[RetentionManager] Error in retention loop: {e}")

            # Sleep in small increments to allow quick shutdown
            for _ in range(int(self.config.check_interval_sec * 2)):
                if not self._is_running:
                    break
                time.sleep(0.5)
