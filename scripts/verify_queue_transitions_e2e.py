"""
Verification script for end-to-end transmission queue state transitions:
1. PENDING -> IN_FLIGHT -> SENT
2. Stale: IN_FLIGHT (>120s) -> PENDING -> IN_FLIGHT -> SENT
3. Duplicate event idempotency
4. Zero-GPS withholding (LOCAL_AUDIT_ONLY)
"""

import datetime
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import time

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from storage.sqlite_db import EdgeDatabase
from transmission.central_client import CentralClient, TransmissionQueueWorker
from events.event_engine import EventEngine


class MockCentralHandler(http.server.BaseHTTPRequestHandler):
    received_events = {}
    request_log = []

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
            MockCentralHandler.request_log.append(eid)

            if eid in MockCentralHandler.received_events:
                # Duplicate acknowledged
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "created": False,
                    "duplicate": True,
                    "candidateId": MockCentralHandler.received_events[eid],
                    "edgeEventId": eid
                }).encode())
            else:
                cid = f"CAN-{len(MockCentralHandler.received_events)+1:06d}"
                MockCentralHandler.received_events[eid] = cid
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "created": True,
                    "duplicate": False,
                    "candidateId": cid,
                    "edgeEventId": eid
                }).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def run_e2e_verification():
    print("=" * 70)
    print("      RAAHI EDGE TRANSMISSION & RECOVERY END-TO-END VERIFICATION")
    print("=" * 70)

    tmpdir = tempfile.mkdtemp(prefix="raahi_e2e_")
    db_path = os.path.join(tmpdir, "test_e2e.db")
    evidence_dir = os.path.join(tmpdir, "evidence")
    os.makedirs(evidence_dir, exist_ok=True)

    # 1. Start Mock Central
    server = http.server.HTTPServer(("127.0.0.1", 0), MockCentralHandler)
    port = server.server_port
    central_url = f"http://127.0.0.1:{port}"
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"\n[Step 1] Mock Central Server listening on {central_url}")

    try:
        db = EdgeDatabase(db_path=db_path)
        client = CentralClient(central_url)
        engine = EventEngine(default_bus_id="RAAHI-001")

        # -------------------------------------------------------------------
        # Test 1: PENDING -> IN_FLIGHT -> SENT
        # -------------------------------------------------------------------
        print("\n[Step 2] Testing normal lifecycle: PENDING -> IN_FLIGHT -> SENT...")
        gps_fix = {"latitude": 28.6487, "longitude": 77.5041, "accuracy": 3.2, "isFallback": False}
        pkg1, _, _ = engine.create_candidate_event("pothole", "pothole", 0.92, {"x1": 5, "y1": 5, "x2": 50, "y2": 50}, 1, gps_fix)
        eid1 = pkg1["eventId"]
        db.insert_event(pkg1)

        # Simulate evidence clip completion -> transitions to PENDING
        dummy_clip = os.path.join(evidence_dir, f"{eid1}_clip.mp4")
        with open(dummy_clip, "wb") as f:
            f.write(b"\x00" * 1024)
        db.update_event_evidence(eid1, dummy_clip, size_bytes=1024)

        # Start worker and observe drain
        worker = TransmissionQueueWorker(db, client, poll_interval_sec=0.2)
        worker.start()

        time.sleep(1.0)

        with db.lock:
            conn = db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT status, sent_at FROM transmission_queue WHERE event_id = ?", (eid1,))
            row = cur.fetchone()
            conn.close()

        assert row[0] == "SENT", f"Expected SENT, got {row[0]}"
        assert row[1] is not None, "Expected sent_at timestamp"
        assert eid1 in MockCentralHandler.received_events
        print(f"  [+] SUCCESS: Event {eid1} transitioned PENDING -> IN_FLIGHT -> SENT!")

        # -------------------------------------------------------------------
        # Test 2: Stale IN_FLIGHT (>120s) -> PENDING -> IN_FLIGHT -> SENT
        # -------------------------------------------------------------------
        print("\n[Step 3] Testing stale recovery: IN_FLIGHT (>120s) -> PENDING -> IN_FLIGHT -> SENT...")
        gps_fix2 = {"latitude": 28.6550, "longitude": 77.5120, "accuracy": 2.5, "isFallback": False}
        pkg2, _, _ = engine.create_candidate_event("pothole", "pothole", 0.85, {"x1": 10, "y1": 10, "x2": 40, "y2": 40}, 2, gps_fix2)
        assert pkg2 is not None, "Candidate event must be created"
        eid2 = pkg2["eventId"]
        db.insert_event(pkg2)

        # Manually force into stale IN_FLIGHT state (150s old)
        stale_time = (datetime.datetime.now() - datetime.timedelta(seconds=150)).isoformat()
        with db.lock:
            conn = db._get_connection()
            cur = conn.cursor()
            cur.execute("""
                UPDATE transmission_queue
                SET status = 'IN_FLIGHT', last_attempt = ?, attempts = 1
                WHERE event_id = ?
            """, (stale_time, eid2))
            conn.commit()
            conn.close()

        # Worker loop auto-recovers stale items (>120s) and transmits them
        time.sleep(1.5)

        with db.lock:
            conn = db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT status, attempts, last_error, sent_at FROM transmission_queue WHERE event_id = ?", (eid2,))
            row2 = cur.fetchone()
            conn.close()

        # Verify status is SENT, attempts preserved at 1
        assert row2[0] == "SENT", f"Expected SENT after recovery, got {row2[0]}"
        assert row2[1] == 1, f"Expected attempts preserved at 1, got {row2[1]}"

        # Verify recovery was recorded in system_logs
        with db.lock:
            conn = db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT message FROM system_logs WHERE category = 'NETWORK' AND message LIKE '%stale IN_FLIGHT%'")
            log_row = cur.fetchone()
            conn.close()

        assert log_row is not None, "Expected stale recovery log in system_logs"
        assert eid2 in MockCentralHandler.received_events
        print(f"  [+] SUCCESS: Event {eid2} recovered from stale IN_FLIGHT and reached SENT!")

        # -------------------------------------------------------------------
        # Test 3: Idempotent Replay (Duplicate Event Handling)
        # -------------------------------------------------------------------
        print("\n[Step 4] Testing duplicate event idempotency (Replay)...")
        # Re-send eid1 directly to mock Central
        replay_res = client.send_candidate_event(pkg1)
        assert replay_res["success"] is True
        assert replay_res["response"]["duplicate"] is True
        print(f"  [+] SUCCESS: Replay of {eid1} safely acknowledged as duplicate without error!")

        # -------------------------------------------------------------------
        # Test 4: Zero-GPS Event Withholding
        # -------------------------------------------------------------------
        print("\n[Step 5] Testing zero-GPS event withholding (LOCAL_AUDIT_ONLY)...")
        engine_zero = EventEngine(default_bus_id="RAAHI-002")
        no_gps = {"latitude": 0.0, "longitude": 0.0, "accuracy": None, "isFallback": True}
        pkg3, _, _ = engine_zero.create_candidate_event("pothole", "pothole", 0.75, {"x1": 0, "y1": 0, "x2": 10, "y2": 10}, 3, no_gps)
        assert pkg3 is not None, "Candidate event must be created"
        eid3 = pkg3["eventId"]
        db.insert_event(pkg3)

        time.sleep(0.5)

        with db.lock:
            conn = db._get_connection()
            cur = conn.cursor()
            cur.execute("SELECT status FROM transmission_queue WHERE event_id = ?", (eid3,))
            row3 = cur.fetchone()
            conn.close()

        assert row3[0] == "LOCAL_AUDIT_ONLY", f"Expected LOCAL_AUDIT_ONLY, got {row3[0]}"
        assert eid3 not in MockCentralHandler.received_events, "Zero-GPS event must NOT be transmitted to Central"
        print(f"  [+] SUCCESS: Zero-GPS event {eid3} marked LOCAL_AUDIT_ONLY and withheld from Central GIS!")

        worker.stop()
        print("\n" + "=" * 70)
        print("      ALL END-TO-END TRANSMISSION VERIFICATIONS PASSED!")
        print("=" * 70)
        return True
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    success = run_e2e_verification()
    exit(0 if success else 1)
