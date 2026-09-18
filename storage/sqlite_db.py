"""
Local Persistent Storage (SQLite) for RAAHI-Edge.
Maintains persistent records for events, evidence, transmission queue,
GPS telemetry, system logs, and edge settings.
"""

import json
import os
import sqlite3
import threading
from typing import Dict, List, Optional, Any, Tuple


class EdgeDatabase:
    """
    Thread-safe SQLite database manager for RAAHI-Edge with WAL journaling.
    """

    def __init__(self, db_path: str = "data/raahi_edge.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.lock = threading.Lock()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Creates an optimized SQLite connection with dictionary row access."""
        conn = sqlite3.connect(self.db_path, timeout=15.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self):
        """Initializes tables and indexes."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()

            # 1. Events Table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    bus_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    gps_accuracy REAL,
                    is_gps_fallback INTEGER DEFAULT 0,
                    edge_model TEXT,
                    edge_confidence REAL,
                    class_name TEXT,
                    bbox_json TEXT,
                    frame_number INTEGER,
                    source TEXT,
                    evidence_clip_path TEXT,
                    evidence_frame_paths_json TEXT,
                    evidence_size_bytes INTEGER DEFAULT 0,
                    verification_status TEXT DEFAULT 'PENDING_VERIFICATION',
                    central_delivery_status TEXT DEFAULT 'PENDING',
                    traffic_telemetry_json TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_bus_time ON events(bus_id, timestamp);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_events_delivery ON events(central_delivery_status);")

            # Column migration: Ensure traffic_telemetry_json exists in existing DBs
            cur.execute("PRAGMA table_info(events);")
            col_names = [col[1] for col in cur.fetchall()]
            if "traffic_telemetry_json" not in col_names:
                cur.execute("ALTER TABLE events ADD COLUMN traffic_telemetry_json TEXT;")

            # 2. Evidence Table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS evidence (
                    evidence_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    clip_path TEXT,
                    keyframe_path TEXT,
                    duration_sec REAL,
                    size_bytes INTEGER DEFAULT 0,
                    fps REAL,
                    resolution TEXT,
                    uploaded_to_central INTEGER DEFAULT 0,
                    central_url TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (event_id) REFERENCES events(event_id)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_evidence_event ON evidence(event_id);")

            # 3. Transmission Queue Table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS transmission_queue (
                    queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT UNIQUE NOT NULL,
                    status TEXT DEFAULT 'PENDING',
                    attempts INTEGER DEFAULT 0,
                    last_attempt TEXT,
                    last_error TEXT,
                    sent_at TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (event_id) REFERENCES events(event_id)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_queue_status ON transmission_queue(status);")

            # 4. GPS Telemetry Table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS gps_telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bus_id TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    accuracy REAL,
                    speed REAL,
                    timestamp TEXT NOT NULL,
                    received_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_gps_bus_time ON gps_telemetry(bus_id, timestamp);")

            # 5. System Logs Table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    level TEXT NOT NULL,
                    category TEXT NOT NULL,
                    message TEXT NOT NULL,
                    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # 6. Settings Table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)

            conn.commit()
            conn.close()

    # ------------------ EVENT OPERATIONS ------------------

    def insert_event(self, package: Dict[str, Any]) -> bool:
        """Inserts an event and automatically queues it for central transmission."""
        with self.lock:
            conn = self._get_connection()
            try:
                cur = conn.cursor()
                bbox_json = json.dumps(package.get("bbox", {}))
                evidence_frames_json = json.dumps(package.get("evidence", {}).get("framePaths", []))
                traffic_telemetry_json = json.dumps(package.get("trafficTelemetry", {})) if package.get("trafficTelemetry") else None

                cur.execute("""
                    INSERT OR REPLACE INTO events (
                        event_id, event_type, bus_id, timestamp, latitude, longitude,
                        gps_accuracy, is_gps_fallback, edge_model, edge_confidence,
                        class_name, bbox_json, frame_number, source,
                        evidence_clip_path, evidence_frame_paths_json, evidence_size_bytes,
                        verification_status, central_delivery_status, traffic_telemetry_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    package["eventId"],
                    package["eventType"],
                    package["busId"],
                    package["timestamp"],
                    package.get("latitude"),
                    package.get("longitude"),
                    package.get("gpsAccuracy"),
                    1 if package.get("isGpsFallback") else 0,
                    package.get("edgeModel"),
                    package.get("edgeConfidence"),
                    package.get("className"),
                    bbox_json,
                    package.get("frameNumber", 0),
                    package.get("source", "RAAHI-Eye"),
                    package.get("evidence", {}).get("clipPath"),
                    evidence_frames_json,
                    package.get("evidence", {}).get("fileSizeBytes", 0),
                    package.get("verification", {}).get("status", "PENDING_VERIFICATION"),
                    package.get("centralDelivery", {}).get("status", "PENDING"),
                    traffic_telemetry_json
                ))

                # Also insert into transmission queue with RECORDING status
                # Will transition to PENDING once the evidence MP4 is finalized on disk
                cur.execute("""
                    INSERT OR IGNORE INTO transmission_queue (event_id, status)
                    VALUES (?, 'RECORDING')
                """, (package["eventId"],))

                conn.commit()
                return True
            except Exception as e:
                conn.rollback()
                print(f"[DB Error] Failed to insert event {package.get('eventId')}: {e}")
                return False
            finally:
                conn.close()

    def update_event_evidence(
        self,
        event_id: str,
        clip_path: str,
        keyframe_path: Optional[str] = None,
        size_bytes: int = 0,
        duration_sec: float = 15.0,
        fps: float = 30.0,
        resolution: str = "1920x1080"
    ) -> bool:
        """Updates event evidence references upon clip generation and marks queue ready for transmission."""
        with self.lock:
            conn = self._get_connection()
            try:
                cur = conn.cursor()
                frame_paths_json = json.dumps([keyframe_path] if keyframe_path else [])

                # Update events table
                cur.execute("""
                    UPDATE events
                    SET evidence_clip_path = ?, evidence_frame_paths_json = ?, evidence_size_bytes = ?
                    WHERE event_id = ?
                """, (clip_path, frame_paths_json, size_bytes, event_id))

                # Insert into evidence table
                evidence_id = f"EVI-{event_id}"
                cur.execute("""
                    INSERT OR REPLACE INTO evidence (
                        evidence_id, event_id, clip_path, keyframe_path, duration_sec, size_bytes, fps, resolution
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (evidence_id, event_id, clip_path, keyframe_path, duration_sec, size_bytes, fps, resolution))

                # Transition transmission queue status to PENDING for central uplink
                cur.execute("""
                    UPDATE transmission_queue
                    SET status = 'PENDING'
                    WHERE event_id = ? AND status = 'RECORDING'
                """, (event_id,))

                conn.commit()
                return True
            except Exception as e:
                conn.rollback()
                print(f"[DB Error] Failed to update evidence for {event_id}: {e}")
                return False
            finally:
                conn.close()

    def get_events(self, limit: int = 50, offset: int = 0, event_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves paginated events."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            query = "SELECT * FROM events"
            params = []

            if event_type:
                query += " WHERE event_type = ?"
                params.append(event_type)

            query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])

            cur.execute(query, params)
            rows = cur.fetchall()
            result = []
            for r in rows:
                item = dict(r)
                item["bbox"] = json.loads(item["bbox_json"]) if item.get("bbox_json") else {}
                item["evidence_frame_paths"] = json.loads(item["evidence_frame_paths_json"]) if item.get("evidence_frame_paths_json") else []
                result.append(item)
            conn.close()
            return result

    def get_event_by_id(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetches single event with associated evidence."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM events WHERE event_id = ?", (event_id,))
            row = cur.fetchone()
            if not row:
                conn.close()
                return None
            item = dict(row)
            item["bbox"] = json.loads(item["bbox_json"]) if item.get("bbox_json") else {}
            item["evidence_frame_paths"] = json.loads(item["evidence_frame_paths_json"]) if item.get("evidence_frame_paths_json") else []

            # Attach evidence details
            cur.execute("SELECT * FROM evidence WHERE event_id = ?", (event_id,))
            ev_row = cur.fetchone()
            item["evidence_record"] = dict(ev_row) if ev_row else None
            conn.close()
            return item

    # ------------------ TRANSMISSION QUEUE ------------------

    def get_pending_transmissions(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Retrieves pending transmission jobs."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT q.*, e.*
                FROM transmission_queue q
                JOIN events e ON q.event_id = e.event_id
                WHERE q.status IN ('PENDING', 'FAILED')
                ORDER BY q.created_at ASC
                LIMIT ?
            """, (limit,))
            rows = cur.fetchall()
            result = [dict(r) for r in rows]
            conn.close()
            return result

    def update_queue_status(
        self,
        event_id: str,
        status: str,
        error: Optional[str] = None
    ):
        """Updates queue item status (e.g. SENT, FAILED, IN_FLIGHT)."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            now_iso = sqlite3.datetime.datetime.now().isoformat()
            if status == "SENT":
                cur.execute("""
                    UPDATE transmission_queue
                    SET status = 'SENT', sent_at = ?, last_attempt = ?, last_error = NULL
                    WHERE event_id = ?
                """, (now_iso, now_iso, event_id))
                cur.execute("UPDATE events SET central_delivery_status = 'SENT' WHERE event_id = ?", (event_id,))
            elif status == "FAILED":
                cur.execute("""
                    UPDATE transmission_queue
                    SET status = 'FAILED', attempts = attempts + 1, last_attempt = ?, last_error = ?
                    WHERE event_id = ?
                """, (now_iso, error or "Transmission error", event_id))
                cur.execute("UPDATE events SET central_delivery_status = 'FAILED' WHERE event_id = ?", (event_id,))
            else:
                cur.execute("""
                    UPDATE transmission_queue
                    SET status = ?, last_attempt = ?
                    WHERE event_id = ?
                """, (status, now_iso, event_id))
            conn.commit()
            conn.close()

    # ------------------ TELEMETRY & STATS ------------------

    def insert_gps_telemetry(self, bus_id: str, lat: float, lon: float, accuracy: Optional[float], speed: Optional[float], ts: str):
        """Persists GPS fix to telemetry table."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO gps_telemetry (bus_id, latitude, longitude, accuracy, speed, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (bus_id, lat, lon, accuracy, speed, ts))
            conn.commit()
            conn.close()

    def log_system_message(self, level: str, category: str, message: str):
        """Appends log entry to system_logs table."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO system_logs (level, category, message)
                VALUES (?, ?, ?)
            """, (level.upper(), category.upper(), message))
            conn.commit()
            conn.close()

    def get_system_logs(self, limit: int = 100, category: Optional[str] = None, level: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves filtered system logs."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            query = "SELECT * FROM system_logs"
            conditions = []
            params = []

            if category and category.upper() != "ALL":
                conditions.append("category = ?")
                params.append(category.upper())
            if level and level.upper() != "ALL":
                conditions.append("level = ?")
                params.append(level.upper())

            if conditions:
                query += " WHERE " + " AND ".join(conditions)

            query += " ORDER BY id DESC LIMIT ?"
            params.append(limit)

            cur.execute(query, params)
            rows = cur.fetchall()
            conn.close()
            return [dict(r) for r in rows]

    def get_storage_stats(self, evidence_dir: str = "data/evidence") -> Dict[str, Any]:
        """Calculates storage breakdown (DB + WAL/SHM file size, evidence directory size, record counts)."""
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()

            cur.execute("SELECT COUNT(*) FROM events")
            total_events = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM evidence")
            total_clips = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM transmission_queue WHERE status = 'PENDING'")
            pending_queue = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM transmission_queue WHERE status = 'SENT'")
            sent_queue = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM transmission_queue WHERE status = 'FAILED'")
            failed_queue = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM transmission_queue WHERE status IN ('RECORDING', 'IN_FLIGHT')")
            in_flight_queue = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM gps_telemetry")
            total_gps = cur.fetchone()[0]

            conn.close()

        # Measure file sizes including SQLite WAL and SHM sidecars
        db_size_bytes = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0
        if os.path.exists(self.db_path + "-wal"):
            db_size_bytes += os.path.getsize(self.db_path + "-wal")
        if os.path.exists(self.db_path + "-shm"):
            db_size_bytes += os.path.getsize(self.db_path + "-shm")

        # Scan evidence dir size
        evidence_size_bytes = 0
        if os.path.exists(evidence_dir):
            for f in os.listdir(evidence_dir):
                fp = os.path.join(evidence_dir, f)
                if os.path.isfile(fp):
                    evidence_size_bytes += os.path.getsize(fp)

        return {
            "databaseSizeBytes": db_size_bytes,
            "databaseSizeMB": round(db_size_bytes / (1024 * 1024), 2),
            "evidenceSizeBytes": evidence_size_bytes,
            "evidenceSizeMB": round(evidence_size_bytes / (1024 * 1024), 2),
            "totalStorageBytes": db_size_bytes + evidence_size_bytes,
            "totalStorageMB": round((db_size_bytes + evidence_size_bytes) / (1024 * 1024), 2),
            "totalEvents": total_events,
            "totalClips": total_clips,
            "pendingQueue": pending_queue,
            "sentQueue": sent_queue,
            "failedQueue": failed_queue,
            "inFlightQueue": in_flight_queue,
            "totalGpsSamples": total_gps
        }

    # ------------------ RETENTION & PRUNING ------------------

    def get_eligible_evidence_for_pruning(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves oldest evidence records that are eligible for local disk pruning.
        CRITICAL SAFETY RULE: Only events whose transmission is complete and ACKed
        (status = 'SENT' in transmission_queue and central_delivery_status = 'SENT')
        can be pruned.
        """
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT e.event_id, ev.clip_path, ev.keyframe_path, ev.size_bytes, e.created_at
                FROM events e
                JOIN evidence ev ON e.event_id = ev.event_id
                JOIN transmission_queue q ON e.event_id = q.event_id
                WHERE q.status = 'SENT' 
                  AND e.central_delivery_status = 'SENT'
                  AND (ev.clip_path IS NOT NULL OR ev.keyframe_path IS NOT NULL)
                ORDER BY e.created_at ASC
                LIMIT ?
            """, (limit,))
            rows = cur.fetchall()
            result = [dict(r) for r in rows]
            conn.close()
            return result

    def prune_event_evidence_record(self, event_id: str) -> bool:
        """
        Updates metadata after physical evidence files are pruned from disk.
        Retains the event record itself while zeroing out local file paths.
        """
        with self.lock:
            conn = self._get_connection()
            try:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE events
                    SET evidence_clip_path = NULL,
                        evidence_frame_paths_json = NULL,
                        evidence_size_bytes = 0
                    WHERE event_id = ?
                """, (event_id,))

                cur.execute("""
                    UPDATE evidence
                    SET clip_path = NULL,
                        keyframe_path = NULL,
                        size_bytes = 0
                    WHERE event_id = ?
                """, (event_id,))

                conn.commit()
                return True
            except Exception as e:
                print(f"[EdgeDatabase] Error pruning evidence record for {event_id}: {e}")
                conn.rollback()
                return False
            finally:
                conn.close()

    def get_eligible_events_for_db_pruning(self, limit: int = 100) -> List[str]:
        """
        Retrieves oldest historical event IDs whose transmission is complete
        and whose records can safely be pruned from local SQLite.
        """
        with self.lock:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT e.event_id
                FROM events e
                JOIN transmission_queue q ON e.event_id = q.event_id
                WHERE q.status = 'SENT' AND e.central_delivery_status = 'SENT'
                ORDER BY e.created_at ASC
                LIMIT ?
            """, (limit,))
            rows = cur.fetchall()
            result = [r[0] for r in rows]
            conn.close()
            return result

    def prune_historical_event(self, event_id: str) -> bool:
        """
        Deletes a single fully-transmitted historical event and its references.
        Preserves referential integrity by cleaning child tables first.
        """
        with self.lock:
            conn = self._get_connection()
            try:
                cur = conn.cursor()
                cur.execute("DELETE FROM evidence WHERE event_id = ?", (event_id,))
                cur.execute("DELETE FROM transmission_queue WHERE event_id = ?", (event_id,))
                cur.execute("DELETE FROM events WHERE event_id = ?", (event_id,))
                conn.commit()
                return True
            except Exception as e:
                print(f"[EdgeDatabase] Error pruning event {event_id}: {e}")
                conn.rollback()
                return False
            finally:
                conn.close()

    def vacuum_database(self) -> bool:
        """Runs VACUUM on the database to reclaim freed disk space."""
        with self.lock:
            conn = self._get_connection()
            try:
                cur = conn.cursor()
                cur.execute("VACUUM;")
                conn.commit()
                return True
            except Exception as e:
                print(f"[EdgeDatabase] VACUUM error: {e}")
                return False
            finally:
                conn.close()

    def clean_all_development_records(self) -> Dict[str, Any]:
        """
        Explicit operator-invoked method to safely delete all local development
        event, evidence, and transmission queue records.
        Preserves referential integrity and system_logs / settings / gps_telemetry.
        """
        with self.lock:
            conn = self._get_connection()
            try:
                cur = conn.cursor()
                cur.execute("DELETE FROM evidence;")
                ev_deleted = cur.rowcount
                cur.execute("DELETE FROM transmission_queue;")
                q_deleted = cur.rowcount
                cur.execute("DELETE FROM events;")
                events_deleted = cur.rowcount
                conn.commit()
                return {
                    "eventsDeleted": events_deleted,
                    "evidenceDeleted": ev_deleted,
                    "queueDeleted": q_deleted,
                    "success": True
                }
            except Exception as e:
                print(f"[EdgeDatabase] Error cleaning development records: {e}")
                conn.rollback()
                return {
                    "eventsDeleted": 0,
                    "evidenceDeleted": 0,
                    "queueDeleted": 0,
                    "success": False,
                    "error": str(e)
                }
            finally:
                conn.close()

