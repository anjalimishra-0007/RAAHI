#!/usr/bin/env python3
"""
scripts/test_manual_cleanup.py
Unit tests for ManualDevCleanupManager verifying safety, dry-run accuracy,
token guarding, and SQLite integrity in an isolated temporary environment.
"""

import os
import sys
import tempfile
import shutil
import unittest

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from storage.sqlite_db import EdgeDatabase
from storage.manual_cleanup import ManualDevCleanupManager, REQUIRED_CONFIRMATION_TOKEN
from storage.retention_manager import RetentionManager, RetentionConfig


class TestManualCleanup(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="raahi_test_cleanup_")
        self.db_path = os.path.join(self.temp_dir, "test.db")
        self.evidence_dir = os.path.join(self.temp_dir, "evidence")
        os.makedirs(self.evidence_dir, exist_ok=True)

        self.db = EdgeDatabase(db_path=self.db_path)
        self.cleanup_mgr = ManualDevCleanupManager(db=self.db, evidence_dir=self.evidence_dir)

        # Seed test data: 3 events (1 SENT, 2 PENDING)
        self._seed_test_data()

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _seed_test_data(self):
        # Event 1: SENT
        pkg1 = {
            "eventId": "EVT-TEST-SENT-001",
            "eventType": "POTHOLE",
            "busId": "DL-1PC-0001",
            "confidence": 0.88,
            "timestamp": 1000.0,
            "latitude": 28.61,
            "longitude": 77.20,
            "speedKmh": 35.0,
            "headingDeg": 90.0,
            "evidence": {
                "clipPath": os.path.join(self.evidence_dir, "EVT-TEST-SENT-001.mp4"),
                "framePaths": [os.path.join(self.evidence_dir, "EVT-TEST-SENT-001.jpg")],
                "fileSizeBytes": 1024 * 1024
            },
            "centralDelivery": {"status": "SENT"}
        }
        self.db.insert_event(pkg1)
        self.db.update_event_evidence("EVT-TEST-SENT-001", pkg1["evidence"]["clipPath"], pkg1["evidence"]["framePaths"][0], 1024 * 1024)
        self.db.update_queue_status("EVT-TEST-SENT-001", "SENT")
        # Ensure central_delivery_status on events is also SENT
        with self.db.lock:
            conn = self.db._get_connection()
            conn.execute("UPDATE events SET central_delivery_status = 'SENT' WHERE event_id = 'EVT-TEST-SENT-001'")
            conn.commit()
            conn.close()

        # Event 2: PENDING
        pkg2 = {
            "eventId": "EVT-TEST-PENDING-002",
            "eventType": "POTHOLE",
            "busId": "DL-1PC-0001",
            "confidence": 0.92,
            "timestamp": 1010.0,
            "latitude": 28.62,
            "longitude": 77.21,
            "speedKmh": 40.0,
            "headingDeg": 92.0,
            "evidence": {
                "clipPath": os.path.join(self.evidence_dir, "EVT-TEST-PENDING-002.mp4"),
                "framePaths": [os.path.join(self.evidence_dir, "EVT-TEST-PENDING-002.jpg")],
                "fileSizeBytes": 2 * 1024 * 1024
            },
            "centralDelivery": {"status": "PENDING"}
        }
        self.db.insert_event(pkg2)
        self.db.update_event_evidence("EVT-TEST-PENDING-002", pkg2["evidence"]["clipPath"], pkg2["evidence"]["framePaths"][0], 2 * 1024 * 1024)

        # Event 3: IN_FLIGHT
        pkg3 = {
            "eventId": "EVT-TEST-PENDING-003",
            "eventType": "BUMP",
            "busId": "DL-1PC-0001",
            "confidence": 0.78,
            "timestamp": 1020.0,
            "latitude": 28.63,
            "longitude": 77.22,
            "speedKmh": 30.0,
            "headingDeg": 95.0,
            "evidence": {
                "clipPath": os.path.join(self.evidence_dir, "EVT-TEST-PENDING-003.mp4"),
                "framePaths": [os.path.join(self.evidence_dir, "EVT-TEST-PENDING-003.jpg")],
                "fileSizeBytes": 3 * 1024 * 1024
            },
            "centralDelivery": {"status": "PENDING"}
        }
        self.db.insert_event(pkg3)
        self.db.update_event_evidence("EVT-TEST-PENDING-003", pkg3["evidence"]["clipPath"], pkg3["evidence"]["framePaths"][0], 3 * 1024 * 1024)
        self.db.update_queue_status("EVT-TEST-PENDING-003", "IN_FLIGHT")

        # Create physical dummy files
        for eid in ["EVT-TEST-SENT-001", "EVT-TEST-PENDING-002", "EVT-TEST-PENDING-003"]:
            with open(os.path.join(self.evidence_dir, f"{eid}.mp4"), "wb") as f:
                f.write(b"x" * 1024)
            with open(os.path.join(self.evidence_dir, f"{eid}.jpg"), "wb") as f:
                f.write(b"y" * 512)

        # Add 1 unreferenced benchmark file
        with open(os.path.join(self.evidence_dir, "benchmark_sample.mp4"), "wb") as f:
            f.write(b"z" * 2048)

        # Log a system message
        self.db.log_system_message("INFO", "TEST", "System booted normally.")

    def test_dry_run_audit_accuracy(self):
        """Verify dry run accurately audits without deleting anything."""
        audit = self.cleanup_mgr.inspect_cleanup_scope()

        self.assertEqual(audit["totalEvents"], 3)
        self.assertEqual(audit["sentEvents"], 1)
        self.assertEqual(audit["pendingEvents"], 2)
        self.assertEqual(audit["evidenceDbRows"], 3)
        self.assertEqual(audit["queueDbRows"], 3)
        self.assertEqual(audit["totalMp4Files"], 4)  # 3 events + 1 benchmark
        self.assertEqual(audit["totalKeyframes"], 3)
        self.assertEqual(audit["unreferencedFilesCount"], 1)
        self.assertGreater(audit["totalEvidenceBytes"], 0)

        # Verify nothing was deleted
        self.assertEqual(len(os.listdir(self.evidence_dir)), 7)
        events = self.db.get_events(limit=10)
        self.assertEqual(len(events), 3)

    def test_rejection_without_valid_token(self):
        """Verify cleanup aborts if confirmation token is incorrect."""
        res = self.cleanup_mgr.execute_cleanup("WRONG_TOKEN")
        self.assertFalse(res["success"])
        self.assertIn("Invalid confirmation token", res["error"])

        # Verify nothing deleted
        self.assertEqual(len(os.listdir(self.evidence_dir)), 7)

    def test_execution_with_token(self):
        """Verify explicit cleanup deletes files, prunes DB, vacuums, and preserves system logs."""
        res = self.cleanup_mgr.execute_cleanup(REQUIRED_CONFIRMATION_TOKEN)
        self.assertTrue(res["success"])
        self.assertEqual(res["deletedFiles"], 7)

        # Verify evidence dir is now empty of mp4/jpg
        files = [f for f in os.listdir(self.evidence_dir) if f.endswith((".mp4", ".jpg"))]
        self.assertEqual(len(files), 0)

        # Verify database tables
        audit_after = self.cleanup_mgr.inspect_cleanup_scope()
        self.assertEqual(audit_after["totalEvents"], 0)
        self.assertEqual(audit_after["evidenceDbRows"], 0)
        self.assertEqual(audit_after["queueDbRows"], 0)

        # Verify system_logs is preserved
        logs = self.db.get_system_logs(limit=10)
        self.assertGreaterEqual(len(logs), 1)
        # Should include our test log and the cleanup log
        log_messages = [l["message"] for l in logs]
        self.assertTrue(any("ManualDevCleanup" in m for m in log_messages))

    def test_automatic_retention_leaves_pending_alone(self):
        """Verify automatic retention manager STILL refuses to delete pending events."""
        # Set retention limit very low (0.0001 MB) so it triggers
        cfg = RetentionConfig(max_evidence_mb=0.00001, max_database_mb=0.00001)
        ret_mgr = RetentionManager(db=self.db, evidence_dir=self.evidence_dir, config=cfg)

        # Run automatic retention
        ret_mgr.check_and_enforce()

        # The SENT event should be cleaned, but the 2 PENDING events MUST be protected!
        self.assertTrue(os.path.exists(os.path.join(self.evidence_dir, "EVT-TEST-PENDING-002.mp4")))
        self.assertTrue(os.path.exists(os.path.join(self.evidence_dir, "EVT-TEST-PENDING-003.mp4")))


if __name__ == "__main__":
    unittest.main()
