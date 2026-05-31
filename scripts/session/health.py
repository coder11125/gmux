#!/usr/bin/env python3
"""GMUX Session Health - Check and repair session issues."""

import json
import os
import shutil
import subprocess
import sys
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_PATH = Path.home() / ".gmux" / "sessions.json"


class SessionHealth:
    def __init__(self, options: dict):
        self.verbose = options.get("verbose", False)
        self.repair = options.get("repair", False)
        self.issues: list[dict[str, Any]] = []

    def run(self):
        print("=== GMUX Session Health Check ===")
        print()

        sessions = self._load_sessions()
        if not sessions:
            print("No sessions found.")
            return

        print(f"Checking {len(sessions)} session(s)...")
        print()

        self._check_orphaned_worktrees(sessions)
        self._check_missing_tmux_windows(sessions)
        self._check_missing_branches(sessions)
        self._check_stale_sessions(sessions)
        self._check_duplicate_worktrees(sessions)

        if not self.issues:
            print("All sessions are healthy!")
        else:
            print(f"Found {len(self.issues)} issue(s):")
            for i, issue in enumerate(self.issues, 1):
                print(f"  {i}. {issue['severity'].upper()}: {issue['message']}")
                if issue.get("session"):
                    print(f"     Session: {issue['session']}")
                if issue.get("fix") and self.verbose:
                    print(f"     Fix: {issue['fix']}")
            print()

            if self.repair:
                self._repair_issues()
            else:
                print("Run with --repair to fix issues automatically.")

    def _load_sessions(self) -> dict:
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"Error parsing sessions file: {e}")
            return {}

    def _check_orphaned_worktrees(self, sessions: dict):
        tracked_paths = {
            os.path.normpath(s["worktreePath"])
            for s in sessions.values()
            if s.get("worktreePath")
        }
        worktrees_dir = STORE_PATH.parent / "worktrees"

        if not worktrees_dir.is_dir():
            return

        for path in worktrees_dir.iterdir():
            if not path.is_dir():
                continue
            if os.path.normpath(str(path)) in tracked_paths:
                continue

            self.issues.append({
                "severity": "warning",
                "message": f"Orphaned worktree: {path}",
                "session": None,
                "fix": f"Remove with: rm -rf {path}",
                "type": "orphaned_worktree",
                "path": str(path),
            })

    def _check_missing_tmux_windows(self, sessions: dict):
        for name, session in sessions.items():
            window_id = session.get("tmuxWindowId")
            if not window_id:
                continue

            result = subprocess.run(
                ["tmux", "list-windows", "-t", window_id],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                self.issues.append({
                    "severity": "error",
                    "message": f"Missing tmux window: {window_id}",
                    "session": name,
                    "fix": "Session may need to be recreated",
                    "type": "missing_window",
                    "session_name": name,
                })

    def _check_missing_branches(self, sessions: dict):
        for name, session in sessions.items():
            branch = session.get("branchName")
            worktree = session.get("worktreePath")
            if not branch or not worktree or not os.path.isdir(worktree):
                continue

            result = subprocess.run(
                ["git", "-C", worktree, "branch", "--list", branch],
                capture_output=True,
                text=True,
            )
            if branch not in result.stdout.strip():
                self.issues.append({
                    "severity": "warning",
                    "message": f"Missing branch: {branch}",
                    "session": name,
                    "fix": "Branch may have been deleted",
                    "type": "missing_branch",
                    "session_name": name,
                })

    def _check_stale_sessions(self, sessions: dict):
        now = datetime.now(timezone.utc)
        for name, session in sessions.items():
            if session.get("status") != "running":
                continue
            started_str = session.get("startedAt")
            if not started_str:
                continue
            try:
                started = datetime.fromisoformat(started_str)
                age_hours = (now - started).total_seconds() / 3600
                if age_hours > 24:
                    self.issues.append({
                        "severity": "warning",
                        "message": f"Stale running session ({age_hours:.1f} hours old)",
                        "session": name,
                        "fix": "Consider marking as complete or cleaning up",
                        "type": "stale_session",
                        "session_name": name,
                    })
            except (ValueError, TypeError):
                continue

    def _check_duplicate_worktrees(self, sessions: dict):
        worktree_groups: dict[str, list[str]] = {}
        for name, session in sessions.items():
            path = session.get("worktreePath")
            if not path:
                continue
            norm = os.path.normpath(path)
            worktree_groups.setdefault(norm, []).append(name)

        for path, names in worktree_groups.items():
            if len(names) > 1:
                self.issues.append({
                    "severity": "error",
                    "message": f"Duplicate worktree: {path}",
                    "session": ", ".join(names),
                    "fix": "Multiple sessions share the same worktree",
                    "type": "duplicate_worktree",
                    "path": path,
                })

    def _repair_issues(self):
        print("Repairing issues...")
        repaired = 0

        for issue in self.issues:
            if issue["type"] == "orphaned_worktree":
                shutil.rmtree(issue["path"], ignore_errors=True)
                print(f"  Removed orphaned worktree: {issue['path']}")
                repaired += 1
            elif issue["type"] == "missing_window":
                self._remove_session_record(issue["session_name"])
                print(f"  Removed session record: {issue['session_name']}")
                repaired += 1

        print(f"Repaired {repaired} issue(s).")

    def _remove_session_record(self, name: str):
        sessions = self._load_sessions()
        sessions.pop(name, None)
        STORE_PATH.write_text(json.dumps(sessions, indent=2))


def main():
    parser = ArgumentParser(description="Check GMUX session health")
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed output",
    )
    parser.add_argument(
        "-r", "--repair",
        action="store_true",
        help="Automatically fix issues",
    )

    args = parser.parse_args()
    SessionHealth(vars(args)).run()


if __name__ == "__main__":
    main()
