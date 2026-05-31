#!/usr/bin/env python3
"""GMUX Session Logger - Capture and manage session logs."""

import gzip
import json
import logging
import os
import signal
import subprocess
import sys
import time
from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

STORE_PATH = Path.home() / ".gmux" / "sessions.json"
LOG_DIR = Path.home() / ".gmux" / "logs"


class Logger:
    def __init__(self, options: Dict[str, Any]):
        self.interval = options.get("interval", 10)
        self.verbose = options.get("verbose", False)
        self.log_dir = Path(options.get("log_dir", LOG_DIR))
        self.watch_session = options.get("session")
        self.rotate = options.get("rotate", False)
        self.max_size = options.get("max_size", 10 * 1024 * 1024)  # 10MB
        self.compress = options.get("compress", False)
        self.format = options.get("format", "text")
        self.running = True

        signal.signal(signal.SIGINT, self._handle_interrupt)

    def _handle_interrupt(self, signum, frame):
        self.running = False

    def run(self):
        print("=== GMUX Session Logger ===")
        print(f"Interval: {self.interval}s")
        print(f"Log dir: {self.log_dir}")
        print()

        self.ensure_log_dir()

        if self.rotate:
            self.rotate_logs()
        else:
            self.capture_logs()

    def ensure_log_dir(self):
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def load_sessions(self) -> Dict[str, Any]:
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    def capture_logs(self):
        print("Capturing logs... (Ctrl+C to stop)")
        print()

        while self.running:
            sessions = self.load_sessions()
            sessions_to_watch = (
                {k: v for k, v in sessions.items() if k == self.watch_session}
                if self.watch_session
                else {k: v for k, v in sessions.items() if v.get("status") == "running"}
            )

            if not sessions_to_watch:
                print("\r  No running sessions to capture...", end="", flush=True)
                time.sleep(self.interval)
                continue

            for name, session in sessions_to_watch.items():
                self._capture_session_log(name, session)

            time.sleep(self.interval)

        print("\nStopped capturing.")

    def _capture_session_log(self, session_name: str, session: Dict[str, Any]):
        pane_id = session.get("tmuxPaneId")
        if not pane_id:
            return

        log_file = self._get_log_file(session_name)

        try:
            result = subprocess.run(
                ["tmux", "capture-pane", "-t", pane_id, "-p", "-S", "-500"],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0:
                return

            output = result.stdout

            # Append to log file
            with open(log_file, "a") as f:
                f.write("=" * 60 + "\n")
                f.write(f"Capture at: {datetime.now().isoformat()}\n")
                f.write(f"Session: {session_name}\n")
                f.write(f"Pane: {pane_id}\n")
                f.write("-" * 60 + "\n")
                f.write(output)
                f.write("\n")

            if self.verbose:
                print(f"  Captured: {session_name} -> {log_file.name}")

        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
            logger.debug(f"Capture error for {session_name}: {e}")

    def _get_log_file(self, session_name: str) -> Path:
        timestamp = datetime.now().strftime("%Y-%m-%d")
        extension = "json" if self.format == "json" else "log"
        return self.log_dir / f"{session_name}_{timestamp}.{extension}"

    def rotate_logs(self):
        print("Rotating logs...")
        print()

        log_files = sorted(self.log_dir.glob("*.log"))

        for log_file in log_files:
            size = log_file.stat().st_size

            if size < self.max_size:
                continue

            print(f"  Rotating: {log_file.name} ({self._format_size(size)})")

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            rotated_file = log_file.with_name(f"{log_file.name}.{timestamp}")

            if self.compress:
                # Compress
                with open(log_file, "rb") as f_in:
                    with gzip.open(f"{rotated_file}.gz", "wb") as f_out:
                        f_out.writelines(f_in)

                log_file.unlink()
                print(f"    Compressed: {rotated_file.name}.gz")
            else:
                # Just rename
                log_file.rename(rotated_file)
                print(f"    Renamed: {rotated_file.name}")

        print("Rotation complete.")

    def _format_size(self, bytes: int) -> str:
        if bytes >= 1024 * 1024:
            return f"{bytes / (1024.0 * 1024.0):.2f} MB"
        elif bytes >= 1024:
            return f"{bytes / 1024.0:.2f} KB"
        else:
            return f"{bytes} B"


def main():
    parser = ArgumentParser(description="Capture and manage GMUX session logs")
    parser.add_argument(
        "-i",
        "--interval",
        type=int,
        default=10,
        help="Capture interval in seconds (default: 10)",
    )
    parser.add_argument("-s", "--session", help="Capture specific session")
    parser.add_argument(
        "-d",
        "--log-dir",
        dest="log_dir",
        default=str(LOG_DIR),
        help=f"Log directory (default: {LOG_DIR})",
    )
    parser.add_argument("-r", "--rotate", action="store_true", help="Rotate large log files")
    parser.add_argument(
        "-m",
        "--max-size",
        type=int,
        default=10 * 1024 * 1024,
        help="Max log size before rotation (default: 10485760)",
    )
    parser.add_argument("-z", "--compress", action="store_true", help="Compress rotated logs")
    parser.add_argument(
        "-f",
        "--format",
        choices=["text", "json"],
        default="text",
        help="Log format (default: text)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Show detailed output")

    args = parser.parse_args()

    logger_instance = Logger(vars(args))
    logger_instance.run()


if __name__ == "__main__":
    main()
