#!/usr/bin/env python3
"""GMUX Diagnostics - System health check for gmux."""

import json
import os
import platform
import shutil
import subprocess
import sys
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

GMUX_DIR = Path.home() / ".gmux"
STORE_PATH = GMUX_DIR / "sessions.json"


class Diagnostics:
    def __init__(self, options: dict):
        self.verbose = options.get("verbose", False)
        self.json_output = options.get("json", False)
        self.fix = options.get("fix", False)

    def run(self):
        results = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "system": self._check_system(),
            "dependencies": self._check_dependencies(),
            "tmux": self._check_tmux(),
            "git": self._check_git(),
            "gmux": self._check_gmux(),
            "sessions": self._check_sessions(),
            "issues": [],
        }

        results["issues"] = self._collect_issues(results)

        if self.json_output:
            print(json.dumps(results, indent=2))
        else:
            self._display_results(results)

    @staticmethod
    def _check_system() -> dict[str, Any]:
        return {
            "os": f"{platform.system()} {platform.release()}",
            "python": platform.python_version(),
            "shell": os.environ.get("SHELL", ""),
            "home": str(Path.home()),
            "user": os.environ.get("USER", ""),
        }

    @staticmethod
    def _check_dependencies() -> dict[str, Any]:
        deps = {}

        for name, cmd in [
            ("git", "git"),
            ("tmux", "tmux"),
            ("bun", "bun"),
            ("python3", "python3"),
            ("ruby", "ruby"),
            ("node", "node"),
        ]:
            path = shutil.which(cmd)
            version = ""
            if path:
                result = subprocess.run(
                    [cmd, "--version"],
                    capture_output=True, text=True, timeout=5,
                )
                version = result.stdout.strip() or result.stderr.strip()
            deps[name] = {
                "installed": path is not None,
                "path": path if path else "",
                "version": version,
            }

        return deps

    @staticmethod
    def _check_tmux() -> dict[str, Any]:
        info: dict[str, Any] = {
            "server_running": False,
            "sessions": [],
        }

        result = subprocess.run(
            ["tmux", "list-sessions"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            info["server_running"] = True
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                if ":" in line:
                    name = line.split(":")[0]
                    # Extract window count from eg "3 windows"
                    parts = line.split(":")
                    info["sessions"].append({
                        "name": name,
                        "windows": parts[1].strip() if len(parts) > 1 else "",
                    })

        return info

    @staticmethod
    def _check_git() -> dict[str, Any]:
        info: dict[str, Any] = {
            "configured": False,
            "user_name": "",
            "user_email": "",
            "default_branch": "",
        }

        for key in ("user.name", "user.email"):
            result = subprocess.run(
                ["git", "config", key],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                if key == "user.name":
                    info["user_name"] = result.stdout.strip()
                    info["configured"] = True
                elif key == "user.email":
                    info["user_email"] = result.stdout.strip()

        result = subprocess.run(
            ["git", "symbolic-ref", "refs/remotes/origin/HEAD"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            branch = result.stdout.strip().replace("refs/remotes/origin/", "")
            info["default_branch"] = branch

        return info

    @staticmethod
    def _check_gmux() -> dict[str, Any]:
        info: dict[str, Any] = {
            "config_dir": GMUX_DIR.is_dir(),
            "config_file": (GMUX_DIR / "config.json").is_file(),
            "sessions_file": STORE_PATH.is_file(),
            "logs_dir": (GMUX_DIR / "logs").is_dir(),
            "plugins_dir": (GMUX_DIR / "plugins").is_dir(),
            "backups_dir": (GMUX_DIR / "backups").is_dir(),
        }

        config_path = GMUX_DIR / "config.json"
        if info["config_file"]:
            try:
                json.loads(config_path.read_text())
                info["config_valid"] = True
            except (json.JSONDecodeError, OSError):
                info["config_valid"] = False

        if info["sessions_file"]:
            try:
                sessions = json.loads(STORE_PATH.read_text())
                info["session_count"] = len(sessions)
                info["sessions_valid"] = True
            except (json.JSONDecodeError, OSError):
                info["sessions_valid"] = False

        return info

    @staticmethod
    def _check_sessions() -> dict[str, Any]:
        if not STORE_PATH.is_file():
            return {"exists": False}

        try:
            sessions = json.loads(STORE_PATH.read_text())
            statuses = [s.get("status", "unknown") for s in sessions.values()]
            return {
                "exists": True,
                "count": len(sessions),
                "running": statuses.count("running"),
                "complete": statuses.count("complete"),
                "error": statuses.count("error"),
            }
        except (json.JSONDecodeError, OSError):
            return {"exists": True, "valid": False}

    def _collect_issues(self, results: dict) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []

        required = ["git", "tmux", "bun", "python3"]
        for dep in required:
            info = results.get("dependencies", {}).get(dep, {})
            if not info.get("installed"):
                issues.append({
                    "severity": "error",
                    "message": f"{dep} is not installed",
                    "fix": f"Install {dep}",
                })

        if not results.get("tmux", {}).get("server_running"):
            issues.append({
                "severity": "warning",
                "message": "tmux server is not running",
                "fix": "Start tmux with: tmux",
            })

        git_info = results.get("git", {})
        if not git_info.get("configured"):
            issues.append({
                "severity": "warning",
                "message": "git user not configured",
                "fix": 'Set with: git config --global user.name "Your Name"',
            })

        gmux_info = results.get("gmux", {})
        if not gmux_info.get("config_dir"):
            issues.append({
                "severity": "info",
                "message": "gmux config directory not found",
                "fix": "Create with: mkdir -p ~/.gmux",
            })

        if gmux_info.get("config_file") and not gmux_info.get("config_valid"):
            issues.append({
                "severity": "error",
                "message": "gmux config file is invalid JSON",
                "fix": "Fix or delete: ~/.gmux/config.json",
            })

        if gmux_info.get("sessions_file") and not gmux_info.get("sessions_valid"):
            issues.append({
                "severity": "error",
                "message": "gmux sessions file is invalid JSON",
                "fix": "Fix or delete: ~/.gmux/sessions.json",
            })

        return issues

    def _display_results(self, results: dict):
        print("=== GMUX Diagnostics ===")
        print(f"Time: {results['timestamp']}")
        print()

        sys_info = results["system"]
        print("System:")
        print(f"  OS:    {sys_info['os']}")
        print(f"  Shell: {sys_info['shell']}")
        print(f"  User:  {sys_info['user']}")
        print()

        print("Dependencies:")
        for name, info in results["dependencies"].items():
            status = "\u2713" if info["installed"] else "\u2717"
            version = info.get("version", "") or "not found"
            print(f"  {status} {name}: {version}")
        print()

        tmux_info = results["tmux"]
        print("tmux:")
        status = "running" if tmux_info["server_running"] else "not running"
        print(f"  Server: {status}")
        for s in tmux_info.get("sessions", []):
            print(f"    - {s['name']} ({s['windows']})")
        print()

        git_info = results["git"]
        print("Git:")
        configured = "yes" if git_info["configured"] else "no"
        print(f"  Configured: {configured}")
        print(
            f"  User: {git_info['user_name']} "
            f"<{git_info['user_email']}>"
        )
        print(
            f"  Default branch: "
            f"{git_info['default_branch'] or 'not set'}"
        )
        print()

        gmux_info = results["gmux"]
        print("gmux:")
        print(f"  Config dir:    {'exists' if gmux_info['config_dir'] else 'missing'}")
        print(f"  Config file:   {'exists' if gmux_info['config_file'] else 'missing'}")
        print(f"  Sessions file: {'exists' if gmux_info['sessions_file'] else 'missing'}")
        if "session_count" in gmux_info:
            print(f"  Sessions:      {gmux_info['session_count']}")
        print()

        sessions_info = results["sessions"]
        if sessions_info.get("exists"):
            print("Sessions:")
            print(f"  Total:    {sessions_info.get('count', 0)}")
            print(f"  Running:  {sessions_info.get('running', 0)}")
            print(f"  Complete: {sessions_info.get('complete', 0)}")
            print(f"  Error:    {sessions_info.get('error', 0)}")
            print()

        issues = results.get("issues", [])
        if not issues:
            print("No issues found!")
        else:
            print(f"Issues ({len(issues)}):")
            for i, issue in enumerate(issues, 1):
                print(f"  {i}. {issue['severity'].upper()}: {issue['message']}")
                if issue.get("fix") and self.verbose:
                    print(f"     Fix: {issue['fix']}")


def main():
    parser = ArgumentParser(description="GMUX system health check")
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show fix suggestions",
    )
    parser.add_argument(
        "-j", "--json",
        action="store_true",
        dest="json",
        help="Output as JSON",
    )

    args = parser.parse_args()
    Diagnostics(vars(args)).run()


if __name__ == "__main__":
    main()
