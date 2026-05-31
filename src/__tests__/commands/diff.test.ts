import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resolve } from "node:path";

let mockExitCode = 0;
let mockStdout = "";
let mockStderr = "";

function shellResult() {
  return { exitCode: mockExitCode, text: () => mockStdout, stderr: Buffer.from(mockStderr) };
}

const shellChain = (): any => {
  const r = shellResult();
  const p = Promise.resolve(r);
  const n = Object.assign(p, { nothrow: () => n, cwd: () => shellChain() });
  return n;
};

const $ = mock((strings: TemplateStringsArray, ...values: unknown[]) => shellChain());
mock.module(resolve(import.meta.dir, "../../shell.ts"), () => ({ $ }));

import { sessionDiff } from "../../commands/diff.ts";

// Flatten all $ call arguments into a single string for easy assertion.
function allArgs(): string {
  return $.mock.calls
    .flatMap((c) => [...(c[0] as string[]), ...(c as unknown[]).slice(1).flat()])
    .join(" ");
}

describe("sessionDiff", () => {
  beforeEach(() => {
    $.mockReset();
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain());
    mockExitCode = 0;
    mockStdout = "";
    mockStderr = "";
  });

  it("returns diff text when merge-base is found", async () => {
    mockStdout = "diff --git a/f b/f\n+added line";
    const result = await sessionDiff("/tmp/worktree");
    expect(result).toContain("diff --git");
  });

  it("returns empty string when git exits non-zero", async () => {
    mockExitCode = 1;
    mockStderr = "not a git repo";
    const result = await sessionDiff("/tmp/worktree");
    expect(result).toBe("");
  });

  it("tries main as the first base branch candidate", async () => {
    mockStdout = "abc1234";
    await sessionDiff("/tmp/worktree");
    expect(allArgs()).toContain("main");
  });

  it("calls merge-base before running the diff", async () => {
    mockStdout = "abc1234";
    await sessionDiff("/tmp/worktree");
    expect(allArgs()).toContain("merge-base");
  });

  it("passes merge-base hash to git diff", async () => {
    mockStdout = "abc1234";
    await sessionDiff("/tmp/worktree");
    // merge-base returns "abc1234"; the diff call should include it
    expect(allArgs()).toContain("abc1234");
  });

  it("uses custom base branch when --base is specified", async () => {
    mockStdout = "deadbeef";
    await sessionDiff("/tmp/worktree", { base: "develop" });
    expect(allArgs()).toContain("develop");
  });

  describe("--staged", () => {
    it("passes --cached to git diff", async () => {
      mockStdout = "staged diff";
      await sessionDiff("/tmp/worktree", { staged: true });
      expect(allArgs()).toContain("--cached");
    });

    it("skips merge-base lookup when staged is true", async () => {
      mockStdout = "staged diff";
      await sessionDiff("/tmp/worktree", { staged: true });
      expect(allArgs()).not.toContain("merge-base");
    });
  });

  describe("--stat", () => {
    it("passes --stat to git diff", async () => {
      mockStdout = "abc1234";
      await sessionDiff("/tmp/worktree", { stat: true });
      expect(allArgs()).toContain("--stat");
    });

    it("combines --stat with --cached when both are set", async () => {
      mockStdout = "stat output";
      await sessionDiff("/tmp/worktree", { stat: true, staged: true });
      const a = allArgs();
      expect(a).toContain("--stat");
      expect(a).toContain("--cached");
    });
  });

  describe("--path", () => {
    it("appends path restriction after --", async () => {
      mockStdout = "abc1234";
      await sessionDiff("/tmp/worktree", { path: "src/api.ts" });
      expect(allArgs()).toContain("src/api.ts");
    });

    it("combines path with --stat", async () => {
      mockStdout = "abc1234";
      await sessionDiff("/tmp/worktree", { stat: true, path: "src/" });
      const a = allArgs();
      expect(a).toContain("--stat");
      expect(a).toContain("src/");
    });
  });

  it("returns empty string when no changes exist", async () => {
    mockStdout = "";
    mockExitCode = 0;
    const result = await sessionDiff("/tmp/worktree");
    expect(result).toBe("");
  });
});
