import { $ } from "./shell.ts";
import type {
  GitOverlayState,
  GitDiffOptions,
  GitLogOptions,
  GitBlameOptions,
} from "./types.ts";

function parseCount(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value.trim(), 10);
  return Number.isNaN(n) ? fallback : n;
}

export class GitOverlay {
  async getState(worktreePath: string): Promise<GitOverlayState> {
    const [
      branchName,
      isDirty,
      aheadBehind,
      fileCounts,
      lastCommit,
    ] = await Promise.all([
      this.getBranchName(worktreePath),
      this.isDirty(worktreePath),
      this.getAheadBehind(worktreePath),
      this.getFileCounts(worktreePath),
      this.getLastCommit(worktreePath),
    ]);

    return {
      enabled: true,
      worktreePath,
      branchName,
      isDirty,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      stagedCount: fileCounts.staged,
      unstagedCount: fileCounts.unstaged,
      untrackedCount: fileCounts.untracked,
      lastCommitHash: lastCommit.hash,
      lastCommitMessage: lastCommit.message,
    };
  }

  async getDiff(worktreePath: string, options?: GitDiffOptions): Promise<string> {
    try {
      const args: string[] = ["git", "diff"];

      if (options?.staged) {
        args.push("--cached");
      }

      if (options?.commitHash) {
        args.push(`${options.commitHash}~1..${options.commitHash}`);
      }

      if (options?.statOnly) {
        args.push("--stat");
      }

      if (options?.path) {
        args.push("--", options.path);
      }

      const result = await $`${args}`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return "";
      return result.text();
    } catch {
      return "";
    }
  }

  async getDiffStat(worktreePath: string): Promise<string> {
    try {
      const result = await $`git diff --stat`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return "";
      return result.text();
    } catch {
      return "";
    }
  }

  async getLog(worktreePath: string, options?: GitLogOptions): Promise<string> {
    try {
      const args: string[] = ["git", "log"];

      if (options?.oneline) {
        args.push("--oneline");
      }

      if (options?.graph) {
        args.push("--graph");
      }

      if (options?.count !== undefined && options.count > 0) {
        args.push(`-n`, String(options.count));
      }

      if (options?.since) {
        args.push(`--since=${options.since}`);
      }

      if (options?.path) {
        args.push("--", options.path);
      }

      const result = await $`${args}`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return "";
      return result.text();
    } catch {
      return "";
    }
  }

  async getBlame(worktreePath: string, options: GitBlameOptions): Promise<string> {
    try {
      const args: string[] = ["git", "blame"];

      if (options.startLine !== undefined && options.endLine !== undefined) {
        args.push("-L", `${options.startLine},${options.endLine}`);
      } else if (options.startLine !== undefined) {
        args.push("-L", `${options.startLine},$`);
      } else if (options.endLine !== undefined) {
        args.push("-L", `1,${options.endLine}`);
      }

      args.push(options.filePath);

      const result = await $`${args}`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return "";
      return result.text();
    } catch {
      return "";
    }
  }

  async getBranchName(worktreePath: string): Promise<string> {
    try {
      const result = await $`git branch --show-current`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return "";
      return result.text().trim();
    } catch {
      return "";
    }
  }

  async isDirty(worktreePath: string): Promise<boolean> {
    try {
      const result = await $`git status --porcelain`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return false;
      return result.text().trim().length > 0;
    } catch {
      return false;
    }
  }

  async getAheadBehind(worktreePath: string): Promise<{ ahead: number; behind: number }> {
    try {
      const result = await $`git rev-list --left-right --count @{u}...HEAD`
        .cwd(worktreePath)
        .nothrow();
      if (result.exitCode !== 0) return { ahead: 0, behind: 0 };
      const parts = result.text().trim().split(/\s+/);
      const behind = parseCount(parts[0], 0);
      const ahead = parseCount(parts[1], 0);
      return { ahead, behind };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  async getFileCounts(worktreePath: string): Promise<{ staged: number; unstaged: number; untracked: number }> {
    try {
      const result = await $`git status --porcelain`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return { staged: 0, unstaged: 0, untracked: 0 };

      let staged = 0;
      let unstaged = 0;
      let untracked = 0;

      const lines = result.text().split("\n").filter((line) => line.length > 0);

      for (const line of lines) {
        const indexStatus = line[0] ?? " ";
        const workStatus = line[1] ?? " ";

        if (indexStatus === "?" && workStatus === "?") {
          untracked++;
          continue;
        }

        if (indexStatus !== " " && indexStatus !== "?") {
          staged++;
        }

        if (workStatus !== " " && workStatus !== "?") {
          unstaged++;
        }
      }

      return { staged, unstaged, untracked };
    } catch {
      return { staged: 0, unstaged: 0, untracked: 0 };
    }
  }

  async getLastCommit(worktreePath: string): Promise<{ hash: string; message: string; timestamp: string }> {
    try {
      const result = await $`git log -1 --format="%h|%s|%ai"`.cwd(worktreePath).nothrow();
      if (result.exitCode !== 0) return { hash: "", message: "", timestamp: "" };
      const parts = result.text().trim().split("|");
      return {
        hash: parts[0] ?? "",
        message: parts[1] ?? "",
        timestamp: parts[2] ?? "",
      };
    } catch {
      return { hash: "", message: "", timestamp: "" };
    }
  }

  async refresh(worktreePath: string): Promise<GitOverlayState> {
    return this.getState(worktreePath);
  }

  formatForStatusBar(state: GitOverlayState): string {
    const parts: string[] = [];

    if (state.branchName) {
      parts.push(state.branchName);
    }

    if (state.ahead > 0) {
      parts.push(`▲${state.ahead}`);
    }

    if (state.behind > 0) {
      parts.push(`▼${state.behind}`);
    }

    if (state.stagedCount > 0) {
      parts.push(`●${state.stagedCount}`);
    }

    if (state.unstagedCount > 0) {
      parts.push(`○${state.unstagedCount}`);
    }

    if (state.untrackedCount > 0) {
      parts.push(`?${state.untrackedCount}`);
    }

    return parts.join(" ");
  }

  formatDiffStat(state: GitOverlayState): string {
    return `staged: ${state.stagedCount} unstaged: ${state.unstagedCount} untracked: ${state.untrackedCount}`;
  }
}
