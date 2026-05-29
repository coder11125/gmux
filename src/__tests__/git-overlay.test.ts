import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import Path from "node:path";
import { GitOverlay } from "../git-overlay.ts";
import type { GitOverlayState } from "../types.ts";

// ---------------------------------------------------------------------------
// Real git repo fixture for integration-style tests
// ---------------------------------------------------------------------------

let testDir: string;
let worktreePath: string;

async function createTestRepo(): Promise<void> {
  testDir = await mkdtemp(Path.join(tmpdir(), "gmux-git-overlay-"));
  worktreePath = Path.join(testDir, "worktree");

  // Use Bun's shell to create a real git repo
  const { $ } = await import("bun");

  await $`git init ${testDir}`;
  await $`git -C ${testDir} config user.email "test@test.com"`;
  await $`git -C ${testDir} config user.name "Test"`;
  await writeFile(Path.join(testDir, "README.md"), "# Test\n");
  await $`git -C ${testDir} add .`;
  await $`git -C ${testDir} commit -m "Initial commit"`;
  await $`git -C ${testDir} worktree add ${worktreePath} -b test-branch`;

  // Create some changes in the worktree
  await writeFile(Path.join(worktreePath, "modified.txt"), "original\n");
  await $`git -C ${worktreePath} add modified.txt`;
  await $`git -C ${worktreePath} commit -m "Add modified.txt"`;

  // Make a modification
  await writeFile(Path.join(worktreePath, "modified.txt"), "changed\n");

  // Stage something
  await writeFile(Path.join(worktreePath, "staged.txt"), "staged content\n");
  await $`git -C ${worktreePath} add staged.txt`;

  // Create an untracked file
  await writeFile(Path.join(worktreePath, "untracked.txt"), "untracked\n");
}

async function cleanupTestRepo(): Promise<void> {
  if (testDir) {
    const { $ } = await import("bun");
    await $`git -C ${testDir} worktree remove --force ${worktreePath}`.nothrow();
    await $`git -C ${testDir} worktree prune`.nothrow();
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitOverlay", () => {
  let overlay: InstanceType<typeof GitOverlay>;

  beforeEach(async () => {
    overlay = new GitOverlay();
    await createTestRepo();
  });

  afterEach(async () => {
    await cleanupTestRepo();
  });

  // -----------------------------------------------------------------------
  // getBranchName
  // -----------------------------------------------------------------------

  describe("getBranchName", () => {
    it("should return the current branch name", async () => {
      const result = await overlay.getBranchName(worktreePath);
      expect(result).toBe("test-branch");
    });

    it("should return empty string for a non-git directory", async () => {
      const result = await overlay.getBranchName("/tmp/not-a-repo");
      expect(result).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // isDirty
  // -----------------------------------------------------------------------

  describe("isDirty", () => {
    it("should return true when working tree has changes", async () => {
      // The worktree has modified modified.txt
      const result = await overlay.isDirty(worktreePath);
      expect(result).toBe(true);
    });

    it("should return false for a clean worktree", async () => {
      // Create a clean worktree
      const { $ } = await import("bun");
      const cleanPath = Path.join(testDir, "clean-worktree");
      await $`git -C ${testDir} worktree add ${cleanPath} -b clean-branch`;

      const result = await overlay.isDirty(cleanPath);
      expect(result).toBe(false);

      await $`git -C ${testDir} worktree remove --force ${cleanPath}`.nothrow();
    });

    it("should return false for a non-git directory", async () => {
      const result = await overlay.isDirty("/tmp/not-a-repo");
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getAheadBehind
  // -----------------------------------------------------------------------

  describe("getAheadBehind", () => {
    it("should return 0/0 when no upstream is configured", async () => {
      // Fresh worktree with no upstream
      const result = await overlay.getAheadBehind(worktreePath);
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getFileCounts
  // -----------------------------------------------------------------------

  describe("getFileCounts", () => {
    it("should count staged, unstaged, and untracked files", async () => {
      const result = await overlay.getFileCounts(worktreePath);

      // staged.txt is staged
      expect(result.staged).toBeGreaterThanOrEqual(1);
      // modified.txt has unstaged changes
      expect(result.unstaged).toBeGreaterThanOrEqual(1);
      // untracked.txt is untracked
      expect(result.untracked).toBeGreaterThanOrEqual(1);
    });

    it("should return zeros for a clean worktree", async () => {
      const { $ } = await import("bun");
      const cleanPath = Path.join(testDir, "clean-counts");
      await $`git -C ${testDir} worktree add ${cleanPath} -b clean-counts-branch`;

      const result = await overlay.getFileCounts(cleanPath);
      expect(result.staged).toBe(0);
      expect(result.unstaged).toBe(0);
      expect(result.untracked).toBe(0);

      await $`git -C ${testDir} worktree remove --force ${cleanPath}`.nothrow();
    });

    it("should return zeros on error", async () => {
      const result = await overlay.getFileCounts("/tmp/not-a-repo");
      expect(result).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // getLastCommit
  // -----------------------------------------------------------------------

  describe("getLastCommit", () => {
    it("should parse commit hash, message, and timestamp", async () => {
      const result = await overlay.getLastCommit(worktreePath);
      expect(result.hash).toBeTruthy();
      expect(result.message).toBe("Add modified.txt");
      expect(result.timestamp).toBeTruthy();
    });

    it("should return empty fields for a non-git directory", async () => {
      const result = await overlay.getLastCommit("/tmp/not-a-repo");
      expect(result).toEqual({ hash: "", message: "", timestamp: "" });
    });
  });

  // -----------------------------------------------------------------------
  // getDiffStat
  // -----------------------------------------------------------------------

  describe("getDiffStat", () => {
    it("should return diff stat output", async () => {
      const result = await overlay.getDiffStat(worktreePath);
      expect(result).toContain("modified.txt");
    });

    it("should return empty string on error", async () => {
      const result = await overlay.getDiffStat("/tmp/not-a-repo");
      expect(result).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // getDiff
  // -----------------------------------------------------------------------

  describe("getDiff", () => {
    it("should return diff output", async () => {
      const result = await overlay.getDiff(worktreePath);
      expect(result).toContain("changed");
    });

    it("should return empty string on error", async () => {
      const result = await overlay.getDiff("/tmp/not-a-repo");
      expect(result).toBe("");
    });

    it("should handle staged option", async () => {
      const result = await overlay.getDiff(worktreePath, { staged: true });
      expect(result).toContain("staged content");
    });

    it("should handle statOnly option", async () => {
      const result = await overlay.getDiff(worktreePath, { statOnly: true });
      expect(result).toContain("modified.txt");
    });

    it("should handle path option", async () => {
      const result = await overlay.getDiff(worktreePath, {
        path: "modified.txt",
      });
      expect(result).toContain("changed");
    });

    it("should handle commitHash option", async () => {
      const result = await overlay.getDiff(worktreePath, {
        commitHash: "HEAD",
      });
      // Should not throw
      expect(typeof result).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // getLog
  // -----------------------------------------------------------------------

  describe("getLog", () => {
    it("should return log output", async () => {
      const result = await overlay.getLog(worktreePath);
      expect(result).toContain("Add modified.txt");
    });

    it("should return empty string on error", async () => {
      const result = await overlay.getLog("/tmp/not-a-repo");
      expect(result).toBe("");
    });

    it("should handle oneline option", async () => {
      const result = await overlay.getLog(worktreePath, { oneline: true });
      expect(result).toContain("Add modified.txt");
    });

    it("should handle count option", async () => {
      const result = await overlay.getLog(worktreePath, { count: 1 });
      // Default format includes author/date, so result has multiple lines per commit
      expect(result).toContain("Add modified.txt");
    });
  });

  // -----------------------------------------------------------------------
  // getBlame
  // -----------------------------------------------------------------------

  describe("getBlame", () => {
    it("should return blame output for a file", async () => {
      const result = await overlay.getBlame(worktreePath, {
        filePath: "modified.txt",
        startLine: 1,
        endLine: 1,
      });
      // Blame returns non-empty output; the file has uncommitted changes
      // so it may show "Not Committed Yet" or the commit message
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle startLine only", async () => {
      const result = await overlay.getBlame(worktreePath, {
        filePath: "modified.txt",
        startLine: 1,
      });
      expect(typeof result).toBe("string");
    });

    it("should handle endLine only", async () => {
      const result = await overlay.getBlame(worktreePath, {
        filePath: "modified.txt",
        endLine: 1,
      });
      expect(typeof result).toBe("string");
    });

    it("should return empty string on error", async () => {
      const result = await overlay.getBlame("/tmp/not-a-repo", {
        filePath: "nonexistent.ts",
        startLine: 1,
        endLine: 10,
      });
      expect(result).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // getState (integration of sub-methods)
  // -----------------------------------------------------------------------

  describe("getState", () => {
    it("should return complete state object", async () => {
      const state = await overlay.getState(worktreePath);

      expect(state.worktreePath).toBe(worktreePath);
      expect(state.branchName).toBe("test-branch");
      expect(state.isDirty).toBe(true);
      expect(typeof state.ahead).toBe("number");
      expect(typeof state.behind).toBe("number");
      expect(typeof state.stagedCount).toBe("number");
      expect(typeof state.unstagedCount).toBe("number");
      expect(typeof state.untrackedCount).toBe("number");
      expect(state.lastCommitHash).toBeTruthy();
      expect(state.lastCommitMessage).toBe("Add modified.txt");
      expect(state.enabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // refresh
  // -----------------------------------------------------------------------

  describe("refresh", () => {
    it("should return fresh state", async () => {
      const state = await overlay.refresh(worktreePath);
      expect(state.branchName).toBe("test-branch");
    });
  });

  // -----------------------------------------------------------------------
  // formatForStatusBar
  // -----------------------------------------------------------------------

  describe("formatForStatusBar", () => {
    it("should format branch name only when clean", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "main",
        isDirty: false,
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatForStatusBar(state)).toBe("main");
    });

    it("should include ahead/behind indicators", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "feature",
        isDirty: true,
        ahead: 3,
        behind: 1,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatForStatusBar(state)).toBe("feature ▲3 ▼1");
    });

    it("should include staged/unstaged/untracked indicators", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "main",
        isDirty: true,
        ahead: 0,
        behind: 0,
        stagedCount: 2,
        unstagedCount: 1,
        untrackedCount: 4,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatForStatusBar(state)).toBe("main ●2 ○1 ?4");
    });

    it("should combine all indicators", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "release/v2",
        isDirty: true,
        ahead: 5,
        behind: 2,
        stagedCount: 3,
        unstagedCount: 1,
        untrackedCount: 2,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatForStatusBar(state)).toBe(
        "release/v2 ▲5 ▼2 ●3 ○1 ?2",
      );
    });

    it("should handle empty branch name", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "",
        isDirty: false,
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        lastCommitHash: "",
        lastCommitMessage: "",
      };

      expect(overlay.formatForStatusBar(state)).toBe("");
    });

    it("should omit zero-count indicators", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "main",
        isDirty: true,
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatForStatusBar(state)).toBe("main ○1");
    });
  });

  // -----------------------------------------------------------------------
  // formatDiffStat
  // -----------------------------------------------------------------------

  describe("formatDiffStat", () => {
    it("should return formatted diff stat from state", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "main",
        isDirty: true,
        ahead: 0,
        behind: 0,
        stagedCount: 3,
        unstagedCount: 1,
        untrackedCount: 2,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatDiffStat(state)).toBe(
        "staged: 3 unstaged: 1 untracked: 2",
      );
    });

    it("should handle zero counts", () => {
      const state: GitOverlayState = {
        enabled: true,
        worktreePath: "/wt",
        branchName: "main",
        isDirty: false,
        ahead: 0,
        behind: 0,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        lastCommitHash: "abc",
        lastCommitMessage: "msg",
      };

      expect(overlay.formatDiffStat(state)).toBe(
        "staged: 0 unstaged: 0 untracked: 0",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Error handling for invalid worktree paths
  // -----------------------------------------------------------------------

  describe("error handling for invalid worktree paths", () => {
    it("should return fallback for getBranchName on invalid path", async () => {
      const result = await overlay.getBranchName("/nonexistent/path");
      expect(result).toBe("");
    });

    it("should return fallback for isDirty on invalid path", async () => {
      const result = await overlay.isDirty("/nonexistent/path");
      expect(result).toBe(false);
    });

    it("should return fallback for getAheadBehind on invalid path", async () => {
      const result = await overlay.getAheadBehind("/nonexistent/path");
      expect(result).toEqual({ ahead: 0, behind: 0 });
    });

    it("should return fallback for getFileCounts on invalid path", async () => {
      const result = await overlay.getFileCounts("/nonexistent/path");
      expect(result).toEqual({ staged: 0, unstaged: 0, untracked: 0 });
    });

    it("should return fallback for getLastCommit on invalid path", async () => {
      const result = await overlay.getLastCommit("/nonexistent/path");
      expect(result).toEqual({ hash: "", message: "", timestamp: "" });
    });

    it("should return empty for getDiff on invalid path", async () => {
      const result = await overlay.getDiff("/nonexistent/path");
      expect(result).toBe("");
    });

    it("should return empty for getDiffStat on invalid path", async () => {
      const result = await overlay.getDiffStat("/nonexistent/path");
      expect(result).toBe("");
    });

    it("should return empty for getLog on invalid path", async () => {
      const result = await overlay.getLog("/nonexistent/path");
      expect(result).toBe("");
    });

    it("should return empty for getBlame on invalid path", async () => {
      const result = await overlay.getBlame("/nonexistent/path", {
        filePath: "file.ts",
        startLine: 1,
        endLine: 10,
      });
      expect(result).toBe("");
    });
  });
});
