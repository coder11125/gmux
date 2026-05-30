import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resolve } from "node:path";

let mockExitCode = 0;
let mockStdout = "";
let mockStderr = "";
function shellResult() { return { exitCode: mockExitCode, text: () => mockStdout, stderr: Buffer.from(mockStderr) }; }
const shellChain = (): any => { const r = shellResult(); const p = Promise.resolve(r); const n = Object.assign(p, { nothrow: () => n, cwd: () => shellChain() }); return n; };
const $ = mock((strings: TemplateStringsArray, ...values: unknown[]) => shellChain());
mock.module(resolve(import.meta.dir, "../../shell.ts"), () => ({ $ }));

import { GitOverlay } from "../../git-overlay.ts";
import type { GitOverlayState } from "../../types.ts";

function makeState(overrides: Partial<GitOverlayState> = {}): GitOverlayState {
  return { enabled: true, worktreePath: "/tmp", branchName: "", isDirty: false, ahead: 0, behind: 0, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, lastCommitHash: "", lastCommitMessage: "", ...overrides };
}

describe("GitOverlay", () => {
  let overlay: GitOverlay;
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; overlay = new GitOverlay(); });

  describe("getState", () => {
    it("returns complete state object", async () => {
      // getState uses Promise.all with .cwd() which bypasses mockImplementation
      // Set globals so shellChain() returns useful data for all parallel calls
      mockStdout = "main";
      mockExitCode = 0;
      const state = await overlay.getState("/tmp/worktree");
      expect(state).toBeDefined();
      expect(state.worktreePath).toBe("/tmp/worktree");
      expect(typeof state.branchName).toBe("string");
      expect(typeof state.isDirty).toBe("boolean");
      expect(typeof state.ahead).toBe("number");
      expect(typeof state.behind).toBe("number");
      expect($).toHaveBeenCalled();
    });
  });

  describe("getBranchName", () => {
    it("returns branch name", async () => { mockStdout = "feature/my-branch"; expect(await overlay.getBranchName("/tmp/worktree")).toBe("feature/my-branch"); });
    it("returns empty string on failure", async () => { mockExitCode = 1; mockStderr = "not a git repo"; expect(await overlay.getBranchName("/tmp/worktree")).toBe(""); });
  });

  describe("isDirty", () => {
    it("returns true when dirty", async () => { mockStdout = " M file.txt"; expect(await overlay.isDirty("/tmp/worktree")).toBe(true); });
    it("returns false when clean", async () => { mockStdout = ""; expect(await overlay.isDirty("/tmp/worktree")).toBe(false); });
    it("returns false on failure", async () => { mockExitCode = 1; mockStderr = "error"; expect(await overlay.isDirty("/tmp/worktree")).toBe(false); });
  });

  describe("getAheadBehind", () => {
    it("returns counts", async () => { mockStdout = "2\t3"; const r = await overlay.getAheadBehind("/tmp/worktree"); expect(r.ahead).toBe(3); expect(r.behind).toBe(2); });
    it("returns 0,0 on failure", async () => { mockExitCode = 1; mockStderr = "no upstream"; const r = await overlay.getAheadBehind("/tmp/worktree"); expect(r.ahead).toBe(0); expect(r.behind).toBe(0); });
  });

  describe("getFileCounts", () => {
    it("counts staged, unstaged, untracked", async () => { mockStdout = "M  a.txt\n M b.txt\n?? c.txt"; const r = await overlay.getFileCounts("/tmp/worktree"); expect(r.staged).toBe(1); expect(r.unstaged).toBe(1); expect(r.untracked).toBe(1); });
    it("returns 0,0,0 when clean", async () => { mockStdout = ""; const r = await overlay.getFileCounts("/tmp/worktree"); expect(r.staged).toBe(0); expect(r.unstaged).toBe(0); expect(r.untracked).toBe(0); });
  });

  describe("getLastCommit", () => {
    it("returns commit info", async () => { mockStdout = "abc1234feat: add feature2025-01-15"; const r = await overlay.getLastCommit("/tmp/worktree"); expect(r.hash).toBe("abc1234"); expect(r.message).toBe("feat: add feature"); });
    it("returns empty on failure", async () => { mockExitCode = 1; mockStderr = "no commits"; const r = await overlay.getLastCommit("/tmp/worktree"); expect(r.hash).toBe(""); });
  });

  describe("getDiff", () => {
    it("returns diff text", async () => { mockStdout = "diff --git a/f b/f\n+line"; expect(await overlay.getDiff("/tmp/worktree")).toContain("diff --git"); });
    it("returns empty on failure", async () => { mockExitCode = 1; mockStderr = "not a repo"; expect(await overlay.getDiff("/tmp/worktree")).toBe(""); });
    it("handles staged option", async () => { mockStdout = "staged"; await overlay.getDiff("/tmp/worktree", { staged: true }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("--cached"); });
    it("handles statOnly option", async () => { mockStdout = "stat"; await overlay.getDiff("/tmp/worktree", { statOnly: true }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("--stat"); });
    it("handles path option", async () => { mockStdout = "diff"; await overlay.getDiff("/tmp/worktree", { path: "src/index.ts" }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("src/index.ts"); });
  });

  describe("getLog", () => {
    it("returns log text", async () => { mockStdout = "abc1234 feat"; expect(await overlay.getLog("/tmp/worktree")).toContain("abc1234"); });
    it("returns empty on failure", async () => { mockExitCode = 1; mockStderr = "error"; expect(await overlay.getLog("/tmp/worktree")).toBe(""); });
    it("handles oneline option", async () => { mockStdout = "abc1234"; await overlay.getLog("/tmp/worktree", { oneline: true }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("--oneline"); });
    it("handles graph option", async () => { mockStdout = "* abc"; await overlay.getLog("/tmp/worktree", { graph: true }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("--graph"); });
    it("handles count option", async () => { mockStdout = "abc"; await overlay.getLog("/tmp/worktree", { count: 5 }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("-n"); });
    it("handles since option", async () => { mockStdout = "abc"; await overlay.getLog("/tmp/worktree", { since: "2.weeks.ago" }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("--since=2.weeks.ago"); });
    it("handles path option", async () => { mockStdout = "abc"; await overlay.getLog("/tmp/worktree", { path: "src/main.ts" }); const cmd = $.mock.calls[0]![0].join("") + $.mock.calls[0]!.slice(1).flat().join(""); expect(cmd).toContain("src/main.ts"); });
  });

  describe("getDiffStat", () => {
    it("returns diff stat", async () => { mockStdout = " 1 file changed, 5 insertions(+)"; expect(await overlay.getDiffStat("/tmp/worktree")).toContain("1 file changed"); });
    it("returns empty on failure", async () => { mockExitCode = 1; mockStderr = "error"; expect(await overlay.getDiffStat("/tmp/worktree")).toBe(""); });
  });

  describe("formatForStatusBar", () => {
    it("formats branch name", () => { expect(overlay.formatForStatusBar(makeState({ branchName: "main" }))).toContain("main"); });
    it("includes ahead count", () => { const f = overlay.formatForStatusBar(makeState({ branchName: "main", ahead: 3 })); expect(f).toContain("3"); });
    it("includes behind count", () => { const f = overlay.formatForStatusBar(makeState({ branchName: "main", behind: 2 })); expect(f).toContain("2"); });
    it("includes staged count", () => { const f = overlay.formatForStatusBar(makeState({ branchName: "main", stagedCount: 5 })); expect(f).toContain("5"); });
    it("includes unstaged count", () => { const f = overlay.formatForStatusBar(makeState({ branchName: "main", unstagedCount: 3 })); expect(f).toContain("3"); });
    it("includes untracked count", () => { const f = overlay.formatForStatusBar(makeState({ branchName: "main", untrackedCount: 2 })); expect(f).toContain("2"); });
    it("returns empty when no branch", () => { expect(overlay.formatForStatusBar(makeState({ branchName: "" }))).toBe(""); });
  });

  describe("formatDiffStat", () => {
    it("returns formatted stat string", () => { const f = overlay.formatDiffStat(makeState({ stagedCount: 3, unstagedCount: 1, untrackedCount: 2 })); expect(f).toContain("3"); expect(f).toContain("1"); expect(f).toContain("2"); });
  });

  describe("refresh", () => {
    it("returns updated state", async () => {
      // refresh uses Promise.all with .cwd() which bypasses mockImplementation
      mockStdout = "develop";
      mockExitCode = 0;
      const state = await overlay.refresh("/tmp/worktree");
      expect(state).toBeDefined();
      expect(typeof state.branchName).toBe("string");
      expect(state.worktreePath).toBe("/tmp/worktree");
      expect($).toHaveBeenCalled();
    });
  });
});
