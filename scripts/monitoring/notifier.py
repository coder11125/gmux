#!/usr/bin/env python3
"""GMUX Session Notifier - Send notifications on session events."""

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
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

STORE_PATH = Path.home() / ".gmux" / "sessions.json"


class Notifier:
    def __init__(self, options: Dict[str, Any]):
        self.interval = options.get("interval", 5)
        self.verbose = options.get("verbose", False)
        self.webhook = options.get("webhook")
        self.email = options.get("email")
        self.slack = options.get("slack")
        self.discord = options.get("discord")
        self.telegram = options.get("telegram")
        self.sound = options.get("sound", False)
        self.watch_session = options.get("session")
        self.notify_on = options.get("notify_on", ["complete", "error"])
        self.running = True
        self.last_status = {}

        signal.signal(signal.SIGINT, self._handle_interrupt)

    def _handle_interrupt(self, signum, frame):
        self.running = False

    def run(self):
        print("=== GMUX Session Notifier ===")
        print(f"Interval: {self.interval}s")
        print(f"Notify on: {', '.join(self.notify_on)}")
        print(f"Methods: {', '.join(self._notification_methods())}")
        print()

        self.watch_sessions()

    def _notification_methods(self) -> List[str]:
        methods = []
        if self.webhook:
            methods.append("webhook")
        if self.email:
            methods.append("email")
        if self.slack:
            methods.append("slack")
        if self.discord:
            methods.append("discord")
        if self.telegram:
            methods.append("telegram")
        if self.sound:
            methods.append("sound")
        if not methods:
            methods.append("stdout")
        return methods

    def load_sessions(self) -> Dict[str, Any]:
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    def watch_sessions(self):
        print("Watching for session completion... (Ctrl+C to stop)")
        print()

        while self.running:
            sessions = self.load_sessions()
            sessions_to_watch = (
                {k: v for k, v in sessions.items() if k == self.watch_session}
                if self.watch_session
                else sessions
            )

            for name, session in sessions_to_watch.items():
                current_status = session.get("status")
                last_status = self.last_status.get(name)

                if (
                    last_status
                    and last_status != current_status
                    and current_status in self.notify_on
                ):
                    self._notify(name, session, last_status)

                self.last_status[name] = current_status

            time.sleep(self.interval)

        print("\nStopped watching.")

    def _notify(self, session_name: str, session: Dict[str, Any], previous_status: str):
        message = self._build_message(session_name, session, previous_status)

        if self.verbose:
            print()
            print(f"  Notification: {session_name} is now {session.get('status')}")

        # Send via all configured methods
        if self.webhook:
            self._send_webhook(message)
        if self.email:
            self._send_email(message)
        if self.slack:
            self._send_slack(message)
        if self.discord:
            self._send_discord(message)
        if self.telegram:
            self._send_telegram(message)
        if self.sound:
            self._play_sound()

        # Print to stdout if no other method configured
        if not any([self.webhook, self.email, self.slack, self.discord, self.telegram]):
            self._display_notification(message)

    def _build_message(
        self, session_name: str, session: Dict[str, Any], previous_status: str
    ) -> Dict[str, Any]:
        return {
            "session": session_name,
            "status": session.get("status"),
            "previous_status": previous_status,
            "agent": session.get("agentCommand"),
            "branch": session.get("branchName"),
            "worktree": session.get("worktreePath"),
            "started": session.get("startedAt"),
            "timestamp": datetime.now().isoformat(),
        }

    def _display_notification(self, message: Dict[str, Any]):
        print()
        print("=" * 50)
        print("SESSION NOTIFICATION")
        print("=" * 50)
        print(f"Session: {message['session']}")
        print(f"Status: {message['status'].upper()}")
        print(f"Previous: {message['previous_status']}")
        print(f"Agent: {message['agent']}")
        print(f"Branch: {message['branch']}")
        print(f"Time: {message['timestamp']}")
        print("=" * 50)

    def _send_webhook(self, message: Dict[str, Any]):
        try:
            payload = {
                "text": f"GMUX Session {message['status'].upper()}",
                "session": message["session"],
                "status": message["status"],
                "agent": message["agent"],
                "timestamp": message["timestamp"],
            }

            req = Request(
                self.webhook,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urlopen(req, timeout=5) as response:
                if self.verbose:
                    print(f"  Webhook sent: {response.status}")
        except Exception as e:
            logger.error(f"  Webhook error: {e}")

    def _send_email(self, message: Dict[str, Any]):
        subject = f"GMUX: {message['session']} is {message['status']}"
        body = f"""Session: {message['session']}
Status: {message['status']}
Agent: {message['agent']}
Branch: {message['branch']}
Time: {message['timestamp']}
"""

        try:
            if "@" in self.email:
                # Send to email address
                cmd = f"echo '{body}' | mail -s '{subject}' {self.email}"
            else:
                # Use as mail command
                cmd = f"echo '{body}' | {self.email} -s '{subject}'"

            subprocess.run(cmd, shell=True, check=False)
            if self.verbose:
                print(f"  Email sent to: {self.email}")
        except Exception as e:
            logger.error(f"  Email error: {e}")

    def _send_slack(self, message: Dict[str, Any]):
        try:
            payload = {
                "text": f"GMUX Session {message['status'].upper()}",
                "attachments": [
                    {
                        "color": "good" if message["status"] == "complete" else "danger",
                        "fields": [
                            {"title": "Session", "value": message["session"], "short": True},
                            {"title": "Status", "value": message["status"], "short": True},
                            {"title": "Agent", "value": message["agent"], "short": True},
                            {"title": "Branch", "value": message["branch"], "short": True},
                        ],
                        "ts": int(datetime.now().timestamp()),
                    }
                ],
            }

            req = Request(
                self.slack,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urlopen(req, timeout=5) as response:
                if self.verbose:
                    print(f"  Slack sent: {response.status}")
        except Exception as e:
            logger.error(f"  Slack error: {e}")

    def _send_discord(self, message: Dict[str, Any]):
        try:
            payload = {
                "content": f"GMUX Session {message['status'].upper()}",
                "embeds": [
                    {
                        "title": f"Session {message['status'].capitalize()}",
                        "description": f"Session `{message['session']}` has {message['status']}.",
                        "color": 0x00FF00 if message["status"] == "complete" else 0xFF0000,
                        "fields": [
                            {"name": "Agent", "value": message["agent"], "inline": True},
                            {"name": "Branch", "value": message["branch"], "inline": True},
                            {"name": "Time", "value": message["timestamp"], "inline": False},
                        ],
                    }
                ],
            }

            req = Request(
                self.discord,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urlopen(req, timeout=5) as response:
                if self.verbose:
                    print(f"  Discord sent: {response.status}")
        except Exception as e:
            logger.error(f"  Discord error: {e}")

    def _send_telegram(self, message: Dict[str, Any]):
        try:
            parts = self.telegram.split(":")
            if len(parts) != 2:
                logger.error("Invalid Telegram format. Use: BOT_TOKEN:CHAT_ID")
                return

            bot_token, chat_id = parts
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"

            text = f"""*GMUX Session {message['status'].upper()}*

Session: {message['session']}
Status: {message['status']}
Agent: {message['agent']}
Branch: {message['branch']}
Time: {message['timestamp']}
"""

            payload = {
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
            }

            req = Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urlopen(req, timeout=5) as response:
                if self.verbose:
                    print(f"  Telegram sent: {response.status}")
        except Exception as e:
            logger.error(f"  Telegram error: {e}")

    def _play_sound(self):
        try:
            # Try macOS sound
            if subprocess.run(["which", "afplay"], capture_output=True).returncode == 0:
                subprocess.run(
                    ["afplay", "/System/Library/Sounds/Glass.aiff"],
                    check=False,
                )
            # Try Linux sound
            elif subprocess.run(["which", "aplay"], capture_output=True).returncode == 0:
                subprocess.run(
                    ["aplay", "/usr/share/sounds/freedesktop/stereo/complete.oga"],
                    check=False,
                )
        except Exception as e:
            logger.debug(f"Sound error: {e}")


def main():
    parser = ArgumentParser(description="Send GMUX session notifications")
    parser.add_argument(
        "-i",
        "--interval",
        type=int,
        default=5,
        help="Check interval in seconds (default: 5)",
    )
    parser.add_argument("-s", "--session", help="Watch specific session")
    parser.add_argument("-w", "--webhook", help="Send webhook notification")
    parser.add_argument("--slack", help="Send Slack notification")
    parser.add_argument("--discord", help="Send Discord notification")
    parser.add_argument("--telegram", help="Send Telegram notification (BOT:CHAT_ID)")
    parser.add_argument("-e", "--email", help="Send email notification")
    parser.add_argument("--sound", action="store_true", help="Play sound on notification")
    parser.add_argument(
        "-n",
        "--notify-on",
        nargs="+",
        default=["complete", "error"],
        help="Notify on status (default: complete error)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Show detailed output")

    args = parser.parse_args()

    notifier = Notifier(vars(args))
    notifier.run()


if __name__ == "__main__":
    main()
