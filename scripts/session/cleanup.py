#!/usr/bin/env python3
"""GMUX Session Cleanup - Remove stale sessions/worktrees older than N days."""

import json
import logging
import os
import shutil
import subprocess
import sys
import time
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

STORE_PATH = Path.home() / ".gmux" / "sessions.json"
DEFAULT_MAX_AGE_DAYS = 7


class SessionCleanup:
    def __init__(self, options: dict):
        self.max_age_days = options.get("max_age_days", DEFAULT_MAX_AGE_DAYS)
        self.dry_run = options.get("dry_run", False)
        self.verbose = options.get("verbose", False)
        self.force = options.get("force", False)

    def run(self):
        print("=== GMUX Session Cleanup ===")
        print(f"Max age: {self.max_age_days} days")
        print(f"Dry run: {self.dry_run}")
        print()

        sessions = self._load_sessions()
        if not sessions:
            print("No sessions found.")
            return

        print(f"Found {len(sessions)} session(s)")
        print()

        stale = self._find_stale_sessions(sessions)
        if not stale:
            print("No stale sessions found.")
            return

        print(f"Found {len(stale)} stale session(s):")
        for name, session in stale:
            age = self._session_age(session)
            print(f"  - {name} ({age:.1f} days old, status: {session.get('status')})")
        print()

        if self.dry_run:
            print(f"[DRY RUN] Would remove {len(stale)} session(s)")
            return

        if not self.force:
            response = input(f"Remove {len(stale)} stale session(s)? [y/N] ")
            if response.strip().lower() != "y":
                print("Aborted.")
                return

        self._remove_sessions(stale)
        print(f"Done. Removed {len(stale)} session(s).")

    def _load_sessions(self) -> dict:
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"Error parsing sessions file: {e}")
            return {}

    def _find_stale_sessions(self, sessions: dict) -> list:
        now = datetime.now(timezone.utc)
        stale = []
        for name, session in sessions.items():
            started_str = session.get("startedAt")
            if not started_str:
                continue
            try:
                started = datetime.fromisoformat(started_str)
                age_days = (now - started).total_seconds() / (24 * 3600)
                if age_days > self.max_age_days:
                    stale.append((name, session))
            except (ValueError, TypeError):
                continue
        return stale

    def _session_age(self, session: dict) -> float:
        started_str = session.get("startedAt")
        if not started_str:
            return 0.0
        try:
            started = datetime.fromisoformat(started_str)
            return (datetime.now(timezone.utc) - started).total_seconds() / (24 * 3600)
        except (ValueError, TypeError):
            return 0.0

    def _remove_sessions(self, stale: list):
        for name, session in stale:
            self._remove_worktree(session.get("worktreePath"))
            self._remove_tmux_window(session.get("tmuxWindowId"))
            self._remove_session_record(name)
            if self.verbose:
                print(f"  Removed: {name}")

    def _remove_worktree(self, path):
        if not path or not os.path.isdir(path):
            return
        if self.verbose:
            print(f"  Removing worktree: {path}")
        shutil.rmtree(path, ignore_errors=True)

    def _remove_tmux_window(self, window_id):
        if not window_id:
            return
        if self.verbose:
            print(f"  Killing tmux window: {window_id}")
        subprocess.run(
            ["tmux", "kill-window", "-t", window_id],
            capture_output=True,
        )

    def _remove_session_record(self, name: str):
        sessions = self._load_sessions()
        sessions.pop(name, None)
        STORE_PATH.write_text(json.dumps(sessions, indent=2))


def main():
    parser = ArgumentParser(description="Remove stale GMUX sessions")
    parser.add_argument(
        "-d", "--max-days",
        type=int,
        default=DEFAULT_MAX_AGE_DAYS,
        help=f"Max age in days (default: {DEFAULT_MAX_AGE_DAYS})",
    )
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Show what would be removed without doing it",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed output",
    )
    parser.add_argument(
        "-f", "--force",
        action="store_true",
        help="Skip confirmation prompt",
    )

    args = parser.parse_args()
    SessionCleanup(vars(args)).run()


if __name__ == "__main__":
    main()
