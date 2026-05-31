#!/usr/bin/env python3
"""GMUX Restore - Restore sessions and config from backup."""

import json
import os
import shutil
import tarfile
import tempfile
from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path
from typing import Optional

GMUX_DIR = Path.home() / ".gmux"
BACKUP_DIR = GMUX_DIR / "backups"


def format_size(bytes_: int) -> str:
    if bytes_ >= 1024 * 1024:
        return f"{bytes_ / (1024.0 * 1024.0):.2f} MB"
    elif bytes_ >= 1024:
        return f"{bytes_ / 1024.0:.2f} KB"
    else:
        return f"{bytes_} B"


def dir_size(path: Path) -> int:
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total


class Restore:
    def __init__(self, options: dict):
        self.dry_run = options.get("dry_run", False)
        self.verbose = options.get("verbose", False)
        self.force = options.get("force", False)
        self.backup_name: Optional[str] = options.get("backup_name")
        self.list_only = options.get("list_only", False)
        self.restore_file: Optional[str] = options.get("restore_file")

    def run(self):
        print("=== GMUX Restore ===")
        print()

        if self.list_only:
            self._list_backups()
            return

        if self.restore_file:
            self._restore_from_file(Path(self.restore_file))
            return

        backup_path = self._find_backup()
        if backup_path is None:
            return

        manifest = self._load_manifest(backup_path)
        if manifest is None:
            print("Error: Invalid backup (no manifest.json)")
            return

        self._display_backup_info(manifest)

        if self.dry_run:
            print(f"[DRY RUN] Would restore from: {backup_path.name}")
            return

        if not self.force:
            ans = input(
                f"Restore from {backup_path.name}? "
                "This will overwrite current config. [y/N] "
            )
            if ans.strip().lower() != "y":
                return

        self._restore_files(backup_path, manifest)
        self._restore_dirs(backup_path, manifest)

        print()
        print("Restore complete!")

    def _list_backups(self):
        backups = sorted(BACKUP_DIR.glob("gmux_backup_*"), key=lambda p: p.stat().st_mtime, reverse=True)

        if not backups:
            print(f"No backups found in {BACKUP_DIR}")
            return

        print("Available backups:")
        print()
        for path in backups:
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            name = path.name
            if path.is_dir():
                size = format_size(dir_size(path))
            elif path.suffix == ".gz" and "tar" in path.suffixes:
                size = format_size(path.stat().st_size)
            else:
                size = format_size(path.stat().st_size)

            print(f"  {name}")
            print(f"    Time: {mtime.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"    Size: {size}")
            print()

    def _find_backup(self) -> Optional[Path]:
        if self.backup_name:
            if self.backup_name.startswith("gmux_backup_"):
                backup_path = BACKUP_DIR / self.backup_name
            else:
                backup_path = BACKUP_DIR / f"gmux_backup_{self.backup_name}"

            if backup_path.is_dir():
                return backup_path

            # Try with .tar.gz
            tar_path = backup_path.with_suffix(".tar.gz")
            if tar_path.exists():
                print("Extracting compressed backup...")
                self._extract_backup(tar_path)
                return backup_path

            print(f"Error: Backup not found: {self.backup_name}")
            return None
        else:
            backups = sorted(
                BACKUP_DIR.glob("gmux_backup_*"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if not backups:
                print("Error: No backups found")
                print("Create one first with: gmux scripts backup")
                return None
            return backups[0]

    def _extract_backup(self, tar_path: Path):
        with tarfile.open(str(tar_path), "r:gz") as tar:
            tar.extractall(path=str(BACKUP_DIR))

    @staticmethod
    def _load_manifest(backup_path: Path) -> Optional[dict]:
        manifest_path = backup_path / "manifest.json"
        if not manifest_path.exists():
            return None
        try:
            return json.loads(manifest_path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    @staticmethod
    def _display_backup_info(manifest: dict):
        print("Backup info:")
        print(f"  Time:    {manifest.get('timestamp', 'unknown')}")
        print(f"  Version: {manifest.get('version', 'unknown')}")
        print(f"  Files:   {len(manifest.get('files', []))}")
        print(f"  Dirs:    {len(manifest.get('dirs', []))}")
        print()

    def _restore_files(self, backup_path: Path, manifest: dict):
        for file in manifest.get("files", []):
            source = backup_path / file
            if not source.exists():
                continue
            dest = GMUX_DIR / file
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(source), str(dest))
            if self.verbose:
                print(f"  Restored: {file}")

    def _restore_dirs(self, backup_path: Path, manifest: dict):
        for dir_name in manifest.get("dirs", []):
            source = backup_path / dir_name
            if not source.is_dir():
                continue
            dest = GMUX_DIR / dir_name
            if dest.is_dir():
                shutil.rmtree(str(dest))
            shutil.copytree(str(source), str(dest), symlinks=True)
            if self.verbose:
                print(f"  Restored: {dir_name}/")

    def _restore_from_file(self, file_path: Path):
        if not file_path.exists():
            print(f"Error: File not found: {file_path}")
            return

        print(f"Restoring from: {file_path}")

        if self.dry_run:
            print("[DRY RUN] Would restore from file")
            return

        if not self.force:
            ans = input(
                f"Restore from {file_path}? "
                "This will overwrite current config. [y/N] "
            )
            if ans.strip().lower() != "y":
                return

        if file_path.suffix == ".gz" and "tar" in file_path.suffixes:
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_path = Path(tmpdir)
                with tarfile.open(str(file_path), "r:gz") as tar:
                    tar.extractall(path=tmpdir)

                # Find the backup directory inside the archive
                backup_dirs = sorted(tmp_path.glob("gmux_backup_*"))
                if not backup_dirs:
                    print("Error: No backup directory found in archive")
                    return

                manifest = self._load_manifest(backup_dirs[0])
                if manifest:
                    self._restore_files(backup_dirs[0], manifest)
                    self._restore_dirs(backup_dirs[0], manifest)
                else:
                    print("Error: Invalid backup archive (no manifest.json)")
                    return
        elif file_path.is_dir():
            manifest = self._load_manifest(file_path)
            if manifest:
                self._restore_files(file_path, manifest)
                self._restore_dirs(file_path, manifest)
            else:
                print("Error: Invalid backup directory (no manifest.json)")
                return
        else:
            print("Error: Unsupported file format. Use a .tar.gz archive or a backup directory.")
            return

        print()
        print("Restore complete!")


def main():
    parser = ArgumentParser(description="Restore GMUX sessions and config from backup")
    parser.add_argument(
        "backup_name",
        nargs="?",
        help="Backup name or timestamp to restore",
    )
    parser.add_argument(
        "-l", "--list",
        action="store_true",
        dest="list_only",
        help="List available backups",
    )
    parser.add_argument(
        "-f", "--file",
        dest="restore_file",
        help="Restore from a specific file or directory",
    )
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Show what would be restored",
    )
    parser.add_argument(
        "-y", "--force",
        action="store_true",
        help="Skip confirmation prompt",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed output",
    )

    args = parser.parse_args()
    Restore(vars(args)).run()


if __name__ == "__main__":
    main()
