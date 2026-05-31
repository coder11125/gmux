#!/usr/bin/env python3
"""GMUX Agent Watcher - Monitor agent output for errors."""

import json
import logging
import os
import re
import signal
import subprocess
import sys
import time
from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
)
logger = logging.getLogger(__name__)

# Error patterns to detect
ERROR_PATTERNS = [
    r"error",
    r"exception",
    r"failed",
    r"fatal",
    r"panic",
    r"crash",
    r"killed",
    r"segfault",
    r"errno",
    r"EACCES",
    r"ENOENT",
    r"ENOMEM",
    r"timeout",
    r"timed out",
    r"connection refused",
    r"permission denied",
    r"no such file",
    r"command not found",
    r"syntax error",
    r"undefined symbol",
    r"module not found",
    r"import error",
    r"cannot find",
    r"not found",
    r"denied",
    r"forbidden",
]

STORE_PATH = Path.home() / ".gmux" / "sessions.json"
LOG_DIR = Path.home() / ".gmux" / "logs"


class Watcher:
    def __init__(self, options):
        self.interval = options.get("interval", 5)
        self.verbose = options.get("verbose", False)
        self.log_file = options.get("log_file")
        self.patterns = options.get("patterns", [])
        self.watch_session = options.get("session")
        self.tail = options.get("tail", False)
        self.running = True
        self.last_sizes = {}

        # Compile patterns
        self.compiled_patterns = [
            re.compile(p, re.IGNORECASE)
            for p in (self.patterns or ERROR_PATTERNS)
        ]

        # Setup signal handler
        signal.signal(signal.SIGINT, self._handle_interrupt)

    def _handle_interrupt(self, signum, frame):
        self.running = False

    def run(self):
        print("=== GMUX Agent Watcher ===")
        print(f"Interval: {self.interval}s")
        patterns_desc = (
            ", ".join(self.patterns) if self.patterns else "default error patterns"
        )
        print(f"Patterns: {patterns_desc}")
        print()

        self.ensure_log_dir()

        if self.tail:
            self.tail_output()
        else:
            self.watch_sessions()

    def ensure_log_dir(self):
        LOG_DIR.mkdir(parents=True, exist_ok=True)

    def load_sessions(self):
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    def watch_sessions(self):
        print("Watching for errors... (Ctrl+C to stop)")
        print()

        while self.running:
            sessions = self.load_sessions()
            sessions_to_watch = (
                {k: v for k, v in sessions.items() if k == self.watch_session}
                if self.watch_session
                else {k: v for k, v in sessions.items() if v.get("status") == "running"}
            )

            if not sessions_to_watch:
                print("\r  No running sessions to watch...", end="", flush=True)
                time.sleep(self.interval)
                continue

            for name, session in sessions_to_watch.items():
                self._watch_session(name, session)

            time.sleep(self.interval)

        print("\nStopped watching.")

    def _watch_session(self, name, session):
        pane_id = session.get("tmuxPaneId")
        if not pane_id:
            return

        output = self._capture_pane_output(pane_id)
        if not output:
            return

        errors = self._detect_errors(output)
        if errors:
            self._log_errors(name, errors)
            self._display_errors(name, errors)

    def _capture_pane_output(self, pane_id):
        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", pane_id, "-p", "-S", "-100"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return result.stdout if result.returncode == 0 else ""
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return ""

    def _detect_errors(self, output):
        errors = []
        seen = set()

        for i, line in enumerate(output.split("\n"), 1):
            if not line.strip():
                continue

            for pattern in self.compiled_patterns:
                if pattern.search(line):
                    error_content = line.strip()
                    if error_content not in seen:
                        errors.append(
                            {
                                "line": i,
                                "content": error_content,
                                "pattern": pattern.pattern,
                            }
                        )
                        seen.add(error_content)
                    break

        return errors

    def _log_errors(self, session_name, errors):
        log_file = self.log_file or (LOG_DIR / f"{session_name}_errors.log")

        with open(log_file, "a") as f:
            f.write("=" * 60 + "\n")
            f.write(f"Session: {session_name}\n")
            f.write(f"Time: {datetime.now().isoformat()}\n")
            f.write(f"Errors found: {len(errors)}\n")
            f.write("-" * 60 + "\n")
            for error in errors:
                f.write(f"Line {error['line']}: {error['content']}\n")
            f.write("\n")

        if self.verbose:
            print(f"  Logged {len(errors)} error(s) to: {log_file}")

    def _display_errors(self, session_name, errors):
        print()
        print(f"  [!] {session_name}: {len(errors)} error(s) detected")
        for error in errors[:5]:
            content = error["content"][:80]
            print(f"      Line {error['line']}: {content}")
        if len(errors) > 5:
            print(f"      ... and {len(errors) - 5} more")

    def tail_output(self):
        print("Tailing output... (Ctrl+C to stop)")
        print()

        sessions = self.load_sessions()
        sessions_to_watch = (
            {k: v for k, v in sessions.items() if k == self.watch_session}
            if self.watch_session
            else {k: v for k, v in sessions.items() if v.get("status") == "running"}
        )

        if not sessions_to_watch:
            print("No running sessions to tail.")
            return

        pane_ids = [s.get("tmuxPaneId") for s in sessions_to_watch.values() if s.get("tmuxPaneId")]

        # Start pipe-pane for each pane
        for pane_id in pane_ids:
            log_file = LOG_DIR / f"pane_{pane_id}.log"
            try:
                subprocess.run(
                    ["tmux", "pipe-pane", "-t", pane_id, f"cat >> {log_file}"],
                    check=False,
                )
            except FileNotFoundError:
                pass

        # Monitor log files
        while self.running:
            for pane_id in pane_ids:
                log_file = LOG_DIR / f"pane_{pane_id}.log"
                if not log_file.exists():
                    continue

                size = log_file.stat().st_size
                last_size = self.last_sizes.get(pane_id, 0)

                if size > last_size:
                    with open(log_file, "r") as f:
                        f.seek(last_size)
                        content = f.read()
                        print(content, end="")
                    self.last_sizes[pane_id] = size

            time.sleep(0.1)

        # Stop pipe-pane for each pane
        for pane_id in pane_ids:
            try:
                subprocess.run(
                    ["tmux", "pipe-pane", "-t", pane_id, "-c"],
                    check=False,
                )
            except FileNotFoundError:
                pass

        print("\nStopped tailing.")


def main():
    parser = ArgumentParser(description="Monitor GMUX agent output for errors")
    parser.add_argument(
        "-i",
        "--interval",
        type=int,
        default=5,
        help="Check interval in seconds (default: 5)",
    )
    parser.add_argument(
        "-s",
        "--session",
        help="Watch specific session",
    )
    parser.add_argument(
        "-p",
        "--pattern",
        action="append",
        dest="patterns",
        help="Custom error patterns (regex)",
    )
    parser.add_argument(
        "-l",
        "--log-file",
        dest="log_file",
        help="Log errors to file",
    )
    parser.add_argument(
        "-t",
        "--tail",
        action="store_true",
        help="Tail pane output in real-time",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show detailed output",
    )

    args = parser.parse_args()

    watcher = Watcher(vars(args))
    watcher.run()


if __name__ == "__main__":
    main()
