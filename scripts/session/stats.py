#!/usr/bin/env python3
"""GMUX Session Stats - Show session usage statistics."""

import json
import sys
from argparse import ArgumentParser
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_PATH = Path.home() / ".gmux" / "sessions.json"


class SessionStats:
    def __init__(self, options: dict):
        self.verbose = options.get("verbose", False)
        self.detailed = options.get("detailed", False)
        self.json_output = options.get("json", False)

    def run(self):
        sessions = self._load_sessions()
        if not sessions:
            print("No sessions found.")
            return

        stats = self._calculate_stats(sessions)

        if self.json_output:
            print(json.dumps(stats, indent=2))
        else:
            self._display_stats(stats)

    def _load_sessions(self) -> dict:
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"Error parsing sessions file: {e}")
            return {}

    def _calculate_stats(self, sessions: dict) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        total_duration = 0.0
        status_counts: dict[str, int] = defaultdict(int)
        agent_counts: dict[str, int] = defaultdict(int)
        daily_counts: dict[str, int] = defaultdict(int)
        durations: list[float] = []
        started_times: list[str] = []

        for session in sessions.values():
            status = session.get("status", "unknown")
            status_counts[status] += 1

            agent = session.get("agentCommand")
            if agent:
                agent_counts[agent] += 1

            started_str = session.get("startedAt")
            if started_str:
                started_times.append(started_str)
                try:
                    started = datetime.fromisoformat(started_str)
                    ended_str = session.get("endedAt")
                    ended = datetime.fromisoformat(ended_str) if ended_str else now
                    duration = (ended - started).total_seconds()
                    total_duration += duration
                    durations.append(duration)

                    day = started.strftime("%Y-%m-%d")
                    daily_counts[day] += 1
                except (ValueError, TypeError):
                    continue

        oldest = min(started_times) if started_times else None
        newest = max(started_times) if started_times else None
        avg_duration = (sum(durations) / len(durations)) if durations else 0

        return {
            "total_sessions": len(sessions),
            "status_counts": dict(status_counts),
            "agent_usage": dict(
                sorted(agent_counts.items(), key=lambda x: -x[1])
            ),
            "daily_sessions": dict(sorted(daily_counts.items())),
            "total_duration_hours": round(total_duration / 3600, 2),
            "avg_duration_minutes": round(avg_duration / 60, 2),
            "oldest_session": oldest,
            "newest_session": newest,
        }

    def _display_stats(self, stats: dict[str, Any]):
        print("=== GMUX Session Statistics ===")
        print()
        print(f"Total Sessions: {stats['total_sessions']}")
        print(f"Total Duration: {stats['total_duration_hours']} hours")
        print(f"Avg Duration:   {stats['avg_duration_minutes']} minutes")
        print()
        print("Status Breakdown:")
        for status, count in stats["status_counts"].items():
            print(f"  {status}: {count}")
        print()
        print("Agent Usage:")
        for agent, count in stats["agent_usage"].items():
            print(f"  {agent}: {count}")
        print()
        print("Daily Sessions (last 7 days):")
        for day in list(stats["daily_sessions"].keys())[-7:]:
            print(f"  {day}: {stats['daily_sessions'][day]}")
        print()
        print("Session Range:")
        print(f"  Oldest: {stats['oldest_session']}")
        print(f"  Newest: {stats['newest_session']}")


def main():
    parser = ArgumentParser(description="Show GMUX session statistics")
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed output",
    )
    parser.add_argument(
        "-d", "--detailed",
        action="store_true",
        help="Show detailed statistics",
    )
    parser.add_argument(
        "-j", "--json",
        action="store_true",
        dest="json",
        help="Output as JSON",
    )

    args = parser.parse_args()
    SessionStats(vars(args)).run()


if __name__ == "__main__":
    main()
