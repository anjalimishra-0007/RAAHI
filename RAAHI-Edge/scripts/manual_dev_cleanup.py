#!/usr/bin/env python3
"""
scripts/manual_dev_cleanup.py
Manual Development Storage Cleanup CLI for RAAHI-Edge.
STRICTLY FOR LOCAL MACBOOK DEVELOPMENT/TESTING.

Requirements:
- Requires explicit operator invocation.
- Defaults to DRY-RUN mode.
- Requires explicit confirmation token 'CONFIRM_DELETE_LOCAL_DEV_DATA' to execute.
- Never runs automatically or at startup.
- Does not affect source code, git, Android, Central, or Google Drive.
- Strictly keeps existing automatic retention policy unchanged.
"""

import sys
import os
import argparse
import json

# Ensure repository root is on sys.path
repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from storage.sqlite_db import EdgeDatabase
from storage.manual_cleanup import ManualDevCleanupManager, REQUIRED_CONFIRMATION_TOKEN


def format_bytes(num_bytes: int) -> str:
    """Format bytes into human-readable string."""
    if num_bytes < 1024:
        return f"{num_bytes} B"
    elif num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.2f} KB"
    elif num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.2f} MB"
    else:
        return f"{num_bytes / (1024 * 1024 * 1024):.2f} GB"


def run_dry_run_audit(manager: ManualDevCleanupManager) -> dict:
    """Performs dry-run inspection and prints detailed report."""
    audit = manager.inspect_cleanup_scope()

    print("\n" + "=" * 76)
    print("      RAAHI-EDGE MANUAL DEVELOPMENT CLEANUP — DRY-RUN AUDIT REPORT")
    print("=" * 76)
    print(f"Scope:                    {audit['scope']}")
    print(f"Evidence Directory:       {audit['evidenceDir']}")
    print(f"Database Path:            {audit['databasePath']}")
    print("-" * 76)
    print("DATABASE INVENTORY:")
    print(f"  • Total Events:         {audit['totalEvents']}")
    print(f"  • Sent Events (safe):   {audit['sentEvents']}")
    print(f"  • Pending Events:       {audit['pendingEvents']}  (PROTECTED by auto-retention)")
    print(f"  • Evidence Rows:        {audit['evidenceDbRows']}")
    print(f"  • Queue Rows:           {audit['queueDbRows']}")
    print(f"  • Database File Size:   {format_bytes(audit['databaseSizeBytes'])} ({audit['databaseSizeMB']} MB)")
    print("-" * 76)
    print("FILESYSTEM EVIDENCE INVENTORY:")
    print(f"  • MP4 Video Clips:      {audit['totalMp4Files']} files  ({format_bytes(audit['mp4Bytes'])} / {audit['mp4MB']} MB)")
    print(f"  • Keyframe Images:      {audit['totalKeyframes']} files  ({format_bytes(audit['keyframeBytes'])} / {audit['keyframeMB']} MB)")
    print(f"  • Other Evidence Files: {audit['otherFiles']} files")
    print(f"  • Total Evidence Files: {audit['totalEvidenceFiles']} files")
    print(f"  • Total Evidence Size:  {format_bytes(audit['totalEvidenceBytes'])} ({audit['totalEvidenceMB']} MB)")
    if audit['unreferencedFilesCount'] > 0:
        print(f"  • Unreferenced Files:   {audit['unreferencedFilesCount']} files (test/benchmark artifacts)")
    print("-" * 76)
    print("ESTIMATED RECOVERABLE SPACE:")
    print(f"  • Evidence Storage:     ~{audit['totalEvidenceMB']} MB ({format_bytes(audit['totalEvidenceBytes'])})")
    print(f"  • Database Space:       ~{max(0.0, audit['databaseSizeMB'] - 0.06):.2f} MB (via SQLite VACUUM)")
    print(f"  • TOTAL ESTIMATED:      ~{audit['totalEvidenceMB'] + max(0.0, audit['databaseSizeMB'] - 0.06):.2f} MB")
    print("-" * 76)
    print("SAFETY WARNING & RETENTION POLICY CONTEXT:")
    print("  [!] The 800 MB automatic retention policy protects these files because they are")
    print("      PENDING Central transmission. That automatic protection remains active.")
    print("  [!] Executing manual cleanup will PERMANENTLY delete local evidence clips and")
    print("      reset local event records. These events will NO LONGER be available for")
    print("      subsequent transmission to Central or upload to Google Drive.")
    print("  [!] It will NOT affect source code, git, Android, or Central systems.")
    print("=" * 76)
    print(">>> STATUS: DRY-RUN ONLY. NO FILES OR DATABASE RECORDS WERE DELETED. <<<")
    print("=" * 76 + "\n")

    return audit


def main():
    parser = argparse.ArgumentParser(
        description="RAAHI-Edge Manual Development Storage Cleanup Utility"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Perform non-destructive inspection of what would be deleted (default: True)"
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        default=False,
        help="Execute the destructive cleanup (requires --confirm or interactive prompt)"
    )
    parser.add_argument(
        "--confirm",
        type=str,
        default="",
        help=f"Confirmation token. Must be '{REQUIRED_CONFIRMATION_TOKEN}'"
    )
    parser.add_argument(
        "--evidence-dir",
        type=str,
        default="data/evidence",
        help="Evidence directory path (default: data/evidence)"
    )
    parser.add_argument(
        "--db-path",
        type=str,
        default="data/raahi_edge.db",
        help="Database file path (default: data/raahi_edge.db)"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON results instead of human-readable report"
    )

    args = parser.parse_args()

    # Safety: If execute is requested, dry-run must be explicitly overridden
    is_execute = args.execute

    db = EdgeDatabase(db_path=args.db_path)
    manager = ManualDevCleanupManager(db=db, evidence_dir=args.evidence_dir)

    if not is_execute:
        # Strictly DRY-RUN
        audit = run_dry_run_audit(manager)
        if args.json:
            print(json.dumps(audit, indent=2))
        sys.exit(0)

    # EXECUTE requested: enforce explicit operator confirmation
    print("\n" + "!" * 76)
    print("     CAUTION: DESTRUCTIVE MANUAL CLEANUP OPERATION REQUESTED")
    print("!" * 76)
    print("This will permanently delete local development evidence and prune SQLite records.")
    print("Pending events will be deleted and CANNOT be transmitted to Central later.\n")

    token = args.confirm
    if not token:
        if sys.stdin.isatty():
            prompt = f"To confirm, type the exact token '{REQUIRED_CONFIRMATION_TOKEN}': "
            token = input(prompt).strip()
        else:
            print(f"[ERROR] Non-interactive execution requires --confirm {REQUIRED_CONFIRMATION_TOKEN}")
            sys.exit(1)

    if token != REQUIRED_CONFIRMATION_TOKEN:
        print(f"\n[ABORTED] Confirmation token mismatch. Expected '{REQUIRED_CONFIRMATION_TOKEN}'.")
        print("No files or records were modified or deleted.")
        sys.exit(1)

    print("\nExecuting manual cleanup...")
    res = manager.execute_cleanup(confirm_token=token)
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print("\nCleanup completed successfully:")
        print(f"  • Files deleted:       {res['deletedFiles']}")
        print(f"  • Evidence freed:      {res['freedEvidenceMB']} MB")
        print(f"  • DB records pruned:   {res['dbRecordsPruned']}")
        print(f"  • New DB size:         {res['postCleanupAudit']['databaseSizeMB']} MB")
        print(f"  • Message:             {res['message']}")


if __name__ == "__main__":
    main()
