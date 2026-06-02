import { $ } from "../shell.ts";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import Path from "node:path";
import { GitOverlay } from "../git-overlay.ts";
import type {
  GitOverlayState,
  GitDiffOptions,
  GitLogOptions,
  GitStashEntry,
  GitConflictFile,
  ConflictMarker,
} from "../types.ts";

const overlay = new GitOverlay();

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function gitStatus(
  worktreePath: string,
  options?: { porcelain?: boolean; short?: boolean },
): Promise<string> {
  try {
    const args: string[] = ["git", "status"];
    if (options?.porcelain) args.push("--porcelain");
    if (options?.short) args.push("--short");

    const result = await $`${args}`.cwd(worktreePath).nothrow();
    if (result.exitCode !== 0) return "";
    return result.text();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Pane viewers
// ---------------------------------------------------------------------------

export async function showDiffInPane(
  paneId: string,
  worktreePath: string,
  options?: GitDiffOptions,
): Promise<void> {
  const diff = await overlay.getDiff(worktreePath, options);
  if (!diff) {
    await $`tmux send-keys -t ${paneId} ${"echo 'No changes'"} C-m`.nothrow();
    return;
  }
  const tmp = Path.join(tmpdir(), `gmux-viewer-${Date.now()}.txt`);
  await writeFile(tmp, diff);
  await $`tmux send-keys -t ${paneId} ${`less -R ${tmp}; rm -f ${tmp}`} C-m`.nothrow();
}

export async function showLogInPane(
  paneId: string,
  worktreePath: string,
  options?: GitLogOptions,
): Promise<void> {
  const log = await overlay.getLog(worktreePath, options);
  if (!log) {
    await $`tmux send-keys -t ${paneId} ${"echo 'No commits'"} C-m`.nothrow();
    return;
  }
  const tmp = Path.join(tmpdir(), `gmux-viewer-${Date.now()}.txt`);
  await writeFile(tmp, log);
  await $`tmux send-keys -t ${paneId} ${`less -R ${tmp}; rm -f ${tmp}`} C-m`.nothrow();
}

export async function showBlameInPane(
  paneId: string,
  worktreePath: string,
  filePath: string,
): Promise<void> {
  const blame = await overlay.getBlame(worktreePath, { filePath });
  if (!blame) {
    await $`tmux send-keys -t ${paneId} ${"echo 'No blame data'"} C-m`.nothrow();
    return;
  }
  const tmp = Path.join(tmpdir(), `gmux-viewer-${Date.now()}.txt`);
  await writeFile(tmp, blame);
  await $`tmux send-keys -t ${paneId} ${`less -R ${tmp}; rm -f ${tmp}`} C-m`.nothrow();
}

export async function openLogPager(
  worktreePath: string,
  paneId: string,
  options?: GitLogOptions,
): Promise<void> {
  const log = await overlay.getLog(worktreePath, options);
  if (!log) {
    await $`tmux send-keys -t ${paneId} ${"echo 'No commits'"} C-m`.nothrow();
    return;
  }
  const tmp = Path.join(tmpdir(), `gmux-viewer-${Date.now()}.txt`);
  await writeFile(tmp, log);
  await $`tmux send-keys -t ${paneId} ${`less -R ${tmp}; rm -f ${tmp}`} C-m`.nothrow();
}

export async function openDiffPager(
  worktreePath: string,
  paneId: string,
  options?: GitDiffOptions,
): Promise<void> {
  const diff = await overlay.getDiff(worktreePath, options);
  if (!diff) {
    await $`tmux send-keys -t ${paneId} ${"echo 'No changes'"} C-m`.nothrow();
    return;
  }
  const tmp = Path.join(tmpdir(), `gmux-viewer-${Date.now()}.txt`);
  await writeFile(tmp, diff);
  await $`tmux send-keys -t ${paneId} ${`less -R ${tmp}; rm -f ${tmp}`} C-m`.nothrow();
}

// ---------------------------------------------------------------------------
// Stash operations
// ---------------------------------------------------------------------------

export async function stashList(worktreePath: string): Promise<GitStashEntry[]> {
  try {
    const fmt = "%gd%x01%gs%x01%gI";
    const result = await $`git stash list --format=${fmt}`.cwd(worktreePath).nothrow();
    if (result.exitCode !== 0) return [];

    const entries: GitStashEntry[] = [];
    const lines = result.text().trim().split("\n").filter((l) => l.length > 0);

    for (const line of lines) {
      const parts = line.split("\x01");
      const ref = parts[0] ?? "";
      const message = parts[1] ?? "";
      const timestamp = parts[2] ?? "";

      const indexMatch = ref.match(/\{(\d+)\}/);
      const stashIndex = indexMatch ? parseInt(indexMatch[1] ?? "0", 10) : 0;

      const branchMatch = message.match(/^WIP on (.+?):/);
      const branchName = branchMatch ? (branchMatch[1] ?? "") : "";

      const msgMatch = message.match(/:(.+)$/);
      const cleanMessage = msgMatch ? (msgMatch[1]?.trim() ?? message) : message;

      entries.push({ stashIndex, branchName, message: cleanMessage, timestamp });
    }

    return entries;
  } catch {
    return [];
  }
}

export async function stashPush(worktreePath: string, message?: string): Promise<void> {
  try {
    if (message) {
      await $`git stash push -m ${message}`.cwd(worktreePath).nothrow();
    } else {
      await $`git stash push`.cwd(worktreePath).nothrow();
    }
  } catch {
    // silent
  }
}

export async function stashPop(worktreePath: string, stashIndex?: number): Promise<void> {
  try {
    const ref = stashIndex !== undefined ? `stash@{${stashIndex}}` : "stash@{0}";
    await $`git stash pop ${ref}`.cwd(worktreePath).nothrow();
  } catch {
    // silent
  }
}

export async function stashDrop(worktreePath: string, stashIndex: number): Promise<void> {
  try {
    const ref = `stash@{${stashIndex}}`;
    await $`git stash drop ${ref}`.cwd(worktreePath).nothrow();
  } catch {
    // silent
  }
}

// ---------------------------------------------------------------------------
// Conflict detection and resolution
// ---------------------------------------------------------------------------

export async function detectConflicts(worktreePath: string): Promise<GitConflictFile[]> {
  try {
    const result = await $`git diff --name-only --diff-filter=U`.cwd(worktreePath).nothrow();
    if (result.exitCode !== 0) return [];

    const filePaths = result.text().trim().split("\n").filter((l) => l.length > 0);
    const conflicts: GitConflictFile[] = [];

    for (const filePath of filePaths) {
      const statusResult = await $`git status --porcelain -- ${filePath}`.cwd(worktreePath).nothrow();
      const statusLine = statusResult.exitCode === 0 ? statusResult.text().trim() : "";
      const statusCode = statusLine.substring(0, 2).trim();

      let status: GitConflictFile["status"] = "both-modified";
      if (statusCode === "UU") status = "both-modified";
      else if (statusCode === "AA") status = "both-added";
      else if (statusCode === "DU") status = "deleted-by-us";
      else if (statusCode === "UD") status = "deleted-by-them";
      else if (statusCode === "UA") status = "added-by-them";
      else if (statusCode === "AU") status = "added-by-us";

      const markers = await parseConflictMarkers(worktreePath, filePath);

      conflicts.push({ filePath, status, markers });
    }

    return conflicts;
  } catch {
    return [];
  }
}

async function parseConflictMarkers(
  worktreePath: string,
  filePath: string,
): Promise<ConflictMarker[]> {
  try {
    const content = await readFile(Path.join(worktreePath, filePath), "utf-8");
    const lines = content.split("\n");
    const markers: ConflictMarker[] = [];

    let i = 0;
    while (i < lines.length) {
      if (lines[i]?.startsWith("<<<<<<<")) {
        const startLine = i + 1;
        const ours: string[] = [];
        const theirs: string[] = [];

        i++;
        while (i < lines.length && !lines[i]?.startsWith("=======")) {
          ours.push(lines[i] ?? "");
          i++;
        }
        const foundSeparator = i < lines.length;
        if (foundSeparator) i++; // skip =======

        while (i < lines.length && !lines[i]?.startsWith(">>>>>>>")) {
          theirs.push(lines[i] ?? "");
          i++;
        }
        const foundEnd = i < lines.length;
        const endLine = foundEnd ? i + 1 : -1;
        if (foundEnd) i++; // skip >>>>>>>

        if (foundSeparator && foundEnd) {
          markers.push({ startLine, endLine, ours, theirs });
        }
      } else {
        i++;
      }
    }

    return markers;
  } catch {
    return [];
  }
}

export async function showConflictInPane(
  paneId: string,
  worktreePath: string,
  filePath: string,
): Promise<void> {
  const conflicts = await detectConflicts(worktreePath);
  const file = conflicts.find((c) => c.filePath === filePath);
  if (!file || file.markers.length === 0) {
    await $`tmux send-keys -t ${paneId} ${"echo 'No conflicts found'"} C-m`.nothrow();
    return;
  }

  let display = `=== Conflict: ${filePath} ===\n\n`;
  for (let idx = 0; idx < file.markers.length; idx++) {
    const marker = file.markers[idx]!;
    display += `--- Conflict #${idx + 1} (lines ${marker.startLine}-${marker.endLine}) ---\n`;
    display += `<<<<<<< OURS\n${marker.ours.join("\n")}\n`;
    display += `=======\n${marker.theirs.join("\n")}\n`;
    display += `>>>>>>> THEIRS\n\n`;
  }

  const tmp = Path.join(tmpdir(), `gmux-viewer-${Date.now()}.txt`);
  await writeFile(tmp, display);
  await $`tmux send-keys -t ${paneId} ${`less -R ${tmp}; rm -f ${tmp}`} C-m`.nothrow();
}

export async function resolveConflict(
  worktreePath: string,
  filePath: string,
  resolution: "ours" | "theirs" | "both",
): Promise<void> {
  try {
    if (resolution === "ours") {
      await $`git checkout --ours -- ${filePath}`.cwd(worktreePath).nothrow();
    } else if (resolution === "theirs") {
      await $`git checkout --theirs -- ${filePath}`.cwd(worktreePath).nothrow();
    }
    // For all resolutions (including "both"), stage the file in its current state.
    await $`git add -- ${filePath}`.cwd(worktreePath).nothrow();
  } catch {
    // silent
  }
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

export async function createCommit(
  worktreePath: string,
  message: string,
  options?: { all?: boolean },
): Promise<void> {
  try {
    if (options?.all) {
      await $`git commit -am ${message}`.cwd(worktreePath).nothrow();
    } else {
      await $`git commit -m ${message}`.cwd(worktreePath).nothrow();
    }
  } catch {
    // silent
  }
}

export async function createBranch(worktreePath: string, branchName: string): Promise<void> {
  try {
    await $`git checkout -b ${branchName}`.cwd(worktreePath).nothrow();
  } catch {
    // silent
  }
}

export async function switchBranch(worktreePath: string, branchName: string): Promise<void> {
  try {
    await $`git checkout ${branchName}`.cwd(worktreePath).nothrow();
  } catch {
    // silent
  }
}

export async function mergeBranch(worktreePath: string, branchName: string): Promise<void> {
  try {
    await $`git merge ${branchName}`.cwd(worktreePath).nothrow();
  } catch {
    // silent
  }
}
