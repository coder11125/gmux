#!/usr/bin/env python3
"""GMUX Backup - Backup sessions, config, and data."""

import json
import os
import shutil
import subprocess
import sys
from argparse import ArgumentParser
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

GMUX_DIR = Path.home() / ".gmux"
BACKUP_DIR = GMUX_DIR / "backups"

FILES_TO_BACKUP = [
    "sessions.json",
    "config.json",
    ".gmuxrc",
]

DIRS_TO_BACKUP = [
    "logs",
    "plugins",
]


def format_size(bytes_: int) -> str:
    if bytes_ >= 1024 * 1024:
        return f"{bytes_ / (1024.0 * 1024.0):.2f} MB"
    elif bytes_ >= 1024:
        return f"{bytes_ / 1024.0:.2f} KB"
    else:
        return f"{bytes_} B"


class Backup:
    def __init__(self, options: dict):
        self.dry_run = options.get("dry_run", False)
        self.verbose = options.get("verbose", False)
        self.compress = options.get("compress", False)
        self.output_dir = Path(options.get("output_dir", BACKUP_DIR))
        self.keep_count = options.get("keep_count", 5)

    def run(self):
        print("=== GMUX Backup ===")
        print(f"Output: {self.output_dir}")
        print(f"Compress: {self.compress}")
        print()

        self._ensure_dir(self.output_dir)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_name = f"gmux_backup_{timestamp}"
        backup_path = self.output_dir / backup_name

        if self.dry_run:
            print("[DRY RUN] Would create backup:")
            self._display_contents()
            return

        backup_path.mkdir(parents=True, exist_ok=True)

        backed_up_files = self._backup_files(backup_path)
        backed_up_dirs = self._backup_dirs(backup_path)

        self._create_manifest(backup_path, backed_up_files, backed_up_dirs)

        if self.compress:
            final_path = self._compress_backup(backup_path)
            size = os.path.getsize(final_path)
            print()
            print(f"Backup created: {final_path}")
            print(f"Size: {format_size(size)}")
        else:
            print()
            print(f"Backup created: {backup_path}")
            print(f"Files: {len(backed_up_files)}")
            print(f"Dirs:  {len(backed_up_dirs)}")

        self._cleanup_old()

    @staticmethod
    def _ensure_dir(path: Path):
        path.mkdir(parents=True, exist_ok=True)

    def _backup_files(self, backup_path: Path) -> list[str]:
        backed_up: list[str] = []

        for file in FILES_TO_BACKUP:
            source = GMUX_DIR / file
            if not source.exists():
                continue
            dest = backup_path / file
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(source), str(dest))
            backed_up.append(file)
            if self.verbose:
                print(f"  Backed up: {file}")

        # Also backup local .gmuxrc from cwd
        local_gmuxrc = Path.cwd() / ".gmuxrc"
        if local_gmuxrc.exists():
            dest = backup_path / ".gmuxrc"
            shutil.copy2(str(local_gmuxrc), str(dest))
            backed_up.append(".gmuxrc")
            if self.verbose:
                print("  Backed up: .gmuxrc (local)")

        return backed_up

    def _backup_dirs(self, backup_path: Path) -> list[str]:
        backed_up: list[str] = []

        for dir_name in DIRS_TO_BACKUP:
            source = GMUX_DIR / dir_name
            if not source.is_dir():
                continue
            dest = backup_path / dir_name
            shutil.copytree(str(source), str(dest), symlinks=True)
            backed_up.append(dir_name)
            if self.verbose:
                print(f"  Backed up: {dir_name}/")

        return backed_up

    def _create_manifest(self, backup_path: Path, files: list[str], dirs: list[str]):
        manifest = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "1.0",
            "files": files,
            "dirs": dirs,
            "gmux_dir": str(GMUX_DIR),
        }
        (backup_path / "manifest.json").write_text(
            json.dumps(manifest, indent=2)
        )
        if self.verbose:
            print("  Created: manifest.json")

    def _compress_backup(self, backup_path: Path) -> Path:
        # shutil.make_archive produces {backup_name}.tar.gz directly
        archive_path = shutil.make_archive(
            str(backup_path),
            "gztar",
            root_dir=str(backup_path.parent),
            base_dir=backup_path.name,
        )
        shutil.rmtree(str(backup_path))
        return Path(archive_path)

    def _cleanup_old(self):
        backups = sorted(
            self.output_dir.glob("gmux_backup_*"),
            key=lambda p: p.stat().st_mtime,
        )
        if len(backups) <= self.keep_count:
            return

        to_delete = backups[: len(backups) - self.keep_count]
        for path in to_delete:
            if path.is_dir():
                shutil.rmtree(str(path))
            else:
                path.unlink()
            if self.verbose:
                print(f"  Cleaned up: {path.name}")

    def _display_contents(self):
        print("  Files:")
        for file in FILES_TO_BACKUP:
            source = GMUX_DIR / file
            status = "exists" if source.exists() else "missing"
            print(f"    - {file} ({status})")
        print("  Dirs:")
        for dir_name in DIRS_TO_BACKUP:
            source = GMUX_DIR / dir_name
            status = "exists" if source.is_dir() else "missing"
            print(f"    - {dir_name}/ ({status})")


def main():
    parser = ArgumentParser(description="Backup GMUX sessions and config")
    parser.add_argument(
        "-o", "--output-dir",
        dest="output_dir",
        default=str(BACKUP_DIR),
        help="Backup output directory",
    )
    parser.add_argument(
        "-k", "--keep-count",
        type=int,
        default=5,
        help="Number of backups to keep (default: 5)",
    )
    parser.add_argument(
        "-z", "--compress",
        action="store_true",
        help="Compress backup with gzip",
    )
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Show what would be backed up",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed output",
    )

    args = parser.parse_args()
    Backup(vars(args)).run()


if __name__ == "__main__":
    main()
