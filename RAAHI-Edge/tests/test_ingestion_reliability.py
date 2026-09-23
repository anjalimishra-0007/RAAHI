"""
Comprehensive Regression Test Suite for RAAHI-Edge Ingestion & Queue Reliability.

Tests all 8 required criteria without third-party test dependencies:
A. IN_FLIGHT older than 120s -> recovered to PENDING.
B. IN_FLIGHT newer than 120s -> not recovered.
C. Cold-start orphan recovery.
D. CENTRAL_URL environment override.
E. config.yaml fallback.
F. localhost fallback for development.
G. Duplicate edgeEventId does not create duplicate CandidateEvent.
H. Zero-GPS event is never published as (0,0) authoritative GIS data.
"""

import contextlib
import datetime
import http.server
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from typing import Dict, Any
import unittest
import yaml

# Ensure project root is on sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from events.event_engine import EventEngine
from storage.sqlite_db import EdgeDatabase
from transmission.central_client import CentralClient, TransmissionQueueWorker
from utils.config import resolve_central_url, sanitize_url


@contextlib.contextmanager
def temporary_edge_environment():
    """Provides an isolated temporary directory and clean environment."""
    tmpdir = tempfile.mkdtemp(prefix="raahi_test_")
    db_path = os.path.join(tmpdir, "test_edge.db")
    evidence_dir = os.path.join(tmpdir, "evidence")
    os.makedirs(evidence_dir, exist_ok=True)

    orig_env = os.environ.get("CENTRAL_URL")
    if "CENTRAL_URL" in os.environ:
        del os.environ["CENTRAL_URL"]

    db = EdgeDatabase(db_path=db_path)

    try:
        yield {
            "tmpdir": tmpdir,
            "db_path": db_path,
            "evidence_dir": evidence_dir,
            "db": db
        }
    finally:
        if orig_env is not None:
            os.environ["CENTRAL_URL"] = orig_env
        elif "CENTRAL_URL" in os.environ:
            del os.environ["CENTRAL_URL"]
        shutil.rmtree(tmpdir, ignore_errors=True)


def _insert_mock_event(
    db: EdgeDatabase,
    event_id: str,
    status: str = "IN_FLIGHT",
    last_attempt_iso: str = None,
    attempts: int = 1,
    lat: float = 28.6487,
    lon: float = 77.5041,
    delivery_status: str = "PENDING"
):
    """Helper to insert an event and queue item with specified timestamps."""
    pkg = {
        "eventId": event_id,
        "eventType": "pothole",
        "className": "pothole",
        "busId": "RAAHI-001",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "latitude": lat,
        "longitude": lon,
        "gpsAccuracy": 5.0,
        "gpsTimestamp": None,
        "isGpsFallback": False,
        "edgeModel": "YOLO11n",
        "edgeConfidence": 0.85,
        "bbox": {"x1": 10, "y1": 10, "x2": 50, "y2": 50},
        "frameNumber": 100,
        "source": "RAAHI-Eye",
        "evidence": {"clipPath": None, "framePaths": [], "fileSizeBytes": 0},
        "verification": {"status": "PENDING_VERIFICATION"},
        "centralDelivery": {"status": delivery_status}
    }
    db.insert_event(pkg)

    with db.lock:
        conn = db._get_connection()
        cur = conn.cursor()
        cur.execute("""
            UPDATE transmission_queue
            SET status = ?, last_attempt = ?, attempts = ?
            WHERE event_id = ?
        """, (status, last_attempt_iso, attempts, event_id))
        conn.commit()
        conn.close()


class MockCentralHandler(http.server.BaseHTTPRequestHandler):
    ingestion_count = 0
    received_event_ids = []

    def do_GET(self):
        if self.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy", "database": "connected"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/central/events":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            payload = json.loads(body.decode("utf-8"))
            eid = payload.get("eventId")

            if eid in MockCentralHandler.received_event_ids:
                MockCentralHandler.ingestion_count += 1
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "created": False,
                    "duplicate": True,
                    "candidateId": "CAN-000001",
                    "edgeEventId": eid
                }).encode())
            else:
                MockCentralHandler.received_event_ids.append(eid)
                MockCentralHandler.ingestion_count += 1
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "created": True,
                    "duplicate": False,
                    "candidateId": "CAN-000001",
                    "edgeEventId": eid
                }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Quiet logging for tests


class TestIngestionReliability(unittest.TestCase):

    # -----------------------------------------------------------------------
    # Test A: IN_FLIGHT older than 120s -> recovered to PENDING
    # -----------------------------------------------------------------------
    def test_a_stale_in_flight_older_than_120s_recovered(self):
        with temporary_edge_environment() as env:
            db = env["db"]
            eid = "EVT-STALE-OLD-120S"

            old_time = datetime.datetime.now() - datetime.timedelta(seconds=180)
            _insert_mock_event(db, eid, status="IN_FLIGHT", last_attempt_iso=old_time.isoformat(), attempts=2)

            recovered_count = db.recover_stale_in_flight(stale_threshold_sec=120.0, is_cold_start=False)
            self.assertEqual(recovered_count, 1, "Expected exactly 1 stale item recovered")

            with db.lock:
                conn = db._get_connection()
                cur = conn.cursor()
                cur.execute("SELECT status, attempts, last_error FROM transmission_queue WHERE event_id = ?", (eid,))
                row = cur.fetchone()
                conn.close()

            self.assertEqual(row[0], "PENDING", f"Expected status 'PENDING', got '{row[0]}'")
            self.assertEqual(row[1], 2, f"Expected attempts preserved at 2, got {row[1]}")
            self.assertIn("Recovered from stale IN_FLIGHT", row[2] or "")

            pending = db.get_pending_transmissions(limit=10)
            self.assertTrue(any(p["event_id"] == eid for p in pending))

    # -----------------------------------------------------------------------
    # Test B: IN_FLIGHT newer than 120s -> not recovered
    # -----------------------------------------------------------------------
    def test_b_fresh_in_flight_newer_than_120s_not_recovered(self):
        with temporary_edge_environment() as env:
            db = env["db"]
            eid = "EVT-FRESH-IN-FLIGHT"

            fresh_time = datetime.datetime.now() - datetime.timedelta(seconds=30)
            _insert_mock_event(db, eid, status="IN_FLIGHT", last_attempt_iso=fresh_time.isoformat(), attempts=1)

            recovered_count = db.recover_stale_in_flight(stale_threshold_sec=120.0, is_cold_start=False)
            self.assertEqual(recovered_count, 0, "Fresh IN_FLIGHT (<120s) must NOT be recovered during runtime")

            with db.lock:
                conn = db._get_connection()
                cur = conn.cursor()
                cur.execute("SELECT status FROM transmission_queue WHERE event_id = ?", (eid,))
                row = cur.fetchone()
                conn.close()

            self.assertEqual(row[0], "IN_FLIGHT")

    # -----------------------------------------------------------------------
    # Test C: Cold-start orphan recovery
    # -----------------------------------------------------------------------
    def test_c_cold_start_orphan_recovery(self):
        with temporary_edge_environment() as env:
            db = env["db"]
            eid_1 = "EVT-COLD-1"
            eid_2 = "EVT-COLD-2"

            recent_time = datetime.datetime.now() - datetime.timedelta(seconds=5)
            _insert_mock_event(db, eid_1, status="IN_FLIGHT", last_attempt_iso=recent_time.isoformat(), attempts=1)
            _insert_mock_event(db, eid_2, status="IN_FLIGHT", last_attempt_iso=recent_time.isoformat(), attempts=3)

            recovered_count = db.recover_stale_in_flight(is_cold_start=True)
            self.assertEqual(recovered_count, 2, "Cold-start recovery must reset all orphaned IN_FLIGHT records")

            with db.lock:
                conn = db._get_connection()
                cur = conn.cursor()
                cur.execute("SELECT event_id, status, attempts, last_error FROM transmission_queue WHERE event_id IN (?, ?)", (eid_1, eid_2))
                rows = cur.fetchall()
                conn.close()

            for r in rows:
                self.assertEqual(r[1], "PENDING")
                self.assertIn("cold start", r[3] or "")

    # -----------------------------------------------------------------------
    # Test D: CENTRAL_URL environment override
    # -----------------------------------------------------------------------
    def test_d_central_url_environment_override(self):
        os.environ["CENTRAL_URL"] = "https://azure-production-tunnel.raahi.in"
        try:
            resolved = resolve_central_url()
            self.assertEqual(resolved, "https://azure-production-tunnel.raahi.in")
        finally:
            del os.environ["CENTRAL_URL"]

    # -----------------------------------------------------------------------
    # Test E: config.yaml fallback
    # -----------------------------------------------------------------------
    def test_e_config_yaml_fallback(self):
        with temporary_edge_environment() as env:
            cfg_file = os.path.join(env["tmpdir"], "test_config.yaml")
            with open(cfg_file, "w") as f:
                yaml.dump({"central": {"url": "http://192.168.1.150:5001"}}, f)

            if "CENTRAL_URL" in os.environ:
                del os.environ["CENTRAL_URL"]

            resolved = resolve_central_url(config_path=cfg_file)
            self.assertEqual(resolved, "http://192.168.1.150:5001")

    # -----------------------------------------------------------------------
    # Test F: localhost fallback for development
    # -----------------------------------------------------------------------
    def test_f_localhost_development_fallback(self):
        with temporary_edge_environment() as env:
            if "CENTRAL_URL" in os.environ:
                del os.environ["CENTRAL_URL"]

            resolved = resolve_central_url(config_path=os.path.join(env["tmpdir"], "missing.yaml"))
            self.assertEqual(resolved, "http://localhost:5001")

    # -----------------------------------------------------------------------
    # Test G: Duplicate edgeEventId does not create duplicate CandidateEvent
    # -----------------------------------------------------------------------
    def test_g_duplicate_edge_event_id_idempotency(self):
        MockCentralHandler.ingestion_count = 0
        MockCentralHandler.received_event_ids = []

        server = http.server.HTTPServer(("127.0.0.1", 0), MockCentralHandler)
        port = server.server_port
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()

        try:
            client = CentralClient(f"http://127.0.0.1:{port}")
            event_payload = {
                "eventId": "EVT-IDEMPOTENCY-001",
                "latitude": 28.6487,
                "longitude": 77.5041,
                "confidence": 0.90,
                "className": "pothole",
                "bbox": {"x1": 10, "y1": 10, "x2": 60, "y2": 60}
            }

            res1 = client.send_candidate_event(event_payload)
            self.assertTrue(res1["success"])
            self.assertTrue(res1["response"]["created"])
            self.assertFalse(res1["response"]["duplicate"])

            # Replay same event ID
            res2 = client.send_candidate_event(event_payload)
            self.assertTrue(res2["success"])
            self.assertFalse(res2["response"]["created"])
            self.assertTrue(res2["response"]["duplicate"])
            self.assertEqual(res2["response"]["candidateId"], "CAN-000001")
            self.assertEqual(len(MockCentralHandler.received_event_ids), 1)
        finally:
            server.shutdown()
            server.server_close()

    # -----------------------------------------------------------------------
    # Test H: Zero-GPS event is never published as (0,0) authoritative GIS data
    # -----------------------------------------------------------------------
    def test_h_zero_gps_event_preservation_and_withholding(self):
        with temporary_edge_environment() as env:
            db = env["db"]
            engine = EventEngine(default_bus_id="RAAHI-001")

            unreferenced_gps = {
                "matched": False,
                "latitude": 0.0,
                "longitude": 0.0,
                "accuracy": None,
                "isFallback": True
            }

            pkg, suppressed, reason = engine.create_candidate_event(
                event_type="pothole",
                class_name="pothole",
                confidence=0.88,
                bbox={"x1": 20, "y1": 20, "x2": 80, "y2": 80},
                frame_number=120,
                gps_match=unreferenced_gps
            )

            self.assertFalse(suppressed)
            self.assertIsNotNone(pkg)
            self.assertEqual(pkg["verification"]["status"], "GEOMETRY_UNREFERENCED")
            self.assertEqual(pkg["centralDelivery"]["status"], "LOCAL_AUDIT_ONLY")
            self.assertEqual(pkg["latitude"], 0.0)
            self.assertEqual(pkg["longitude"], 0.0)

            db.insert_event(pkg)
            eid = pkg["eventId"]

            with db.lock:
                conn = db._get_connection()
                cur = conn.cursor()
                cur.execute("SELECT status FROM transmission_queue WHERE event_id = ?", (eid,))
                q_row = cur.fetchone()
                conn.close()

            self.assertIsNotNone(q_row)
            self.assertEqual(q_row[0], "LOCAL_AUDIT_ONLY")

            pending_items = db.get_pending_transmissions(limit=50)
            self.assertFalse(any(item["event_id"] == eid for item in pending_items))

            client = CentralClient("http://localhost:5001")
            dispatch_res = client.send_candidate_event(pkg)
            self.assertFalse(dispatch_res["success"])
            self.assertTrue(dispatch_res.get("skipped", False))
            self.assertIn("withheld", dispatch_res["error"].lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
