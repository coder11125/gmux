#!/usr/bin/env python3
"""GMUX Session Export - Export session configuration."""

import json
import sys
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STORE_PATH = Path.home() / ".gmux" / "sessions.json"


def _try_import_yaml():
    try:
        import yaml
        return yaml
    except ImportError:
        return None


def _try_import_toml():
    try:
        import tomllib
        return tomllib
    except ImportError:
        pass
    try:
        import tomli
        return tomli
    except ImportError:
        return None


class SessionExport:
    def __init__(self, options: dict):
        self.session_name = options.get("session_name")
        self.output_format = options.get("format", "json")
        self.output_file = options.get("output_file")
        self.all_sessions = options.get("all", False)
        self.verbose = options.get("verbose", False)

    def run(self):
        print("=== GMUX Session Export ===")
        print()

        sessions = self._load_sessions()
        if not sessions:
            print("No sessions found.")
            return

        if self.all_sessions:
            self._export_sessions(sessions)
        elif self.session_name:
            session = sessions.get(self.session_name)
            if session is None:
                print(f"Session '{self.session_name}' not found.")
                return
            self._export_session(self.session_name, session)
        else:
            print("Specify a session name or use --all")

    def _load_sessions(self) -> dict:
        if not STORE_PATH.exists():
            return {}
        try:
            return json.loads(STORE_PATH.read_text())
        except (json.JSONDecodeError, OSError) as e:
            print(f"Error parsing sessions file: {e}")
            return {}

    def _export_sessions(self, sessions: dict):
        data = [self._build_export(name, session) for name, session in sessions.items()]
        self._write(data)

    def _export_session(self, name: str, session: dict):
        data = self._build_export(name, session)
        self._write(data)

    def _build_export(self, name: str, session: dict) -> dict[str, Any]:
        return {
            "name": name,
            "branch": session.get("branchName"),
            "worktree": session.get("worktreePath"),
            "agent": session.get("agentCommand"),
            "status": session.get("status"),
            "started": session.get("startedAt"),
            "exported_at": datetime.now(timezone.utc).isoformat(),
        }

    def _write(self, data: Any):
        match self.output_format:
            case "json":
                output = json.dumps(data, indent=2)
            case "yaml":
                yaml = _try_import_yaml()
                if yaml is None:
                    print("Error: PyYAML is required for YAML export. Install with: pip install pyyaml")
                    return
                output = yaml.dump(data, default_flow_style=False)
            case "toml":
                output = self._to_toml(data)
            case _:
                print(f"Unknown format: {self.output_format}")
                return

        if self.output_file:
            Path(self.output_file).write_text(output)
            print(f"Exported to: {self.output_file}")
        else:
            print(output)

    def _to_toml(self, data: Any) -> str:
        items = data if isinstance(data, list) else [data]
        lines: list[str] = []
        for item in items:
            lines.append("[[session]]")
            for key, value in item.items():
                value_str = str(value) if value is not None else ""
                lines.append(f'{key} = "{value_str}"')
            lines.append("")
        return "\n".join(lines)


def main():
    parser = ArgumentParser(description="Export GMUX session configuration")
    parser.add_argument(
        "session_name",
        nargs="?",
        help="Session name to export",
    )
    parser.add_argument(
        "-a", "--all",
        action="store_true",
        dest="all",
        help="Export all sessions",
    )
    parser.add_argument(
        "-f", "--format",
        choices=["json", "yaml", "toml"],
        default="json",
        help="Output format (default: json)",
    )
    parser.add_argument(
        "-o", "--output",
        dest="output_file",
        help="Write to file instead of stdout",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed output",
    )

    args = parser.parse_args()
    SessionExport(vars(args)).run()


if __name__ == "__main__":
    main()
