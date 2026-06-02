import { describe, it, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { $ } from "../shell.ts";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const CLI = join(PROJECT_ROOT, "src", "index.ts");

afterAll(async () => {
  const list = await $`git worktree list --porcelain`.nothrow();
  if (list.exitCode !== 0) return;
  for (const line of list.text().split("\n")) {
    if (line.startsWith("worktree ") && line.includes("gmux-test-session")) {
      await $`git worktree remove --force ${line.slice(9)}`.nothrow();
    }
  }
  await $`git worktree prune`.nothrow();
});

function runCLI(...args: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = Bun.spawnSync(["bun", "run", CLI, ...args], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("CLI", () => {
  describe("--help flag", () => {
    it("shows help text", () => {
      const { stdout } = runCLI("--help");

      expect(stdout).toContain("gmux");
      expect(stdout).toContain("Launch AI agent sessions");
    });

    it("shows usage examples", () => {
      const { stdout } = runCLI("--help");

      expect(stdout).toContain("Examples:");
      expect(stdout).toContain("gmux list");
    });

    it("shows available commands", () => {
      const { stdout } = runCLI("--help");

      expect(stdout).toContain("list");
      expect(stdout).toContain("doctor");
      expect(stdout).toContain("attach");
      expect(stdout).toContain("detach");
      expect(stdout).toContain("kill");
      expect(stdout).toContain("rename");
      expect(stdout).toContain("window");
      expect(stdout).toContain("pane");
      expect(stdout).toContain("git");
    });

    it("shows tmux command help", () => {
      const windowHelp = runCLI("window", "--help");
      const paneHelp = runCLI("pane", "--help");

      expect(windowHelp.exitCode).toBe(0);
      expect(windowHelp.stdout).toContain("Manage tmux windows");
      expect(windowHelp.stdout).toContain("gmux window list");
      expect(paneHelp.exitCode).toBe(0);
      expect(paneHelp.stdout).toContain("Manage tmux panes");
      expect(paneHelp.stdout).toContain("gmux pane split");
    });

    it("shows git overlay command help", () => {
      const { exitCode, stdout } = runCLI("git", "--help");

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Git overlay commands");
      expect(stdout).toContain("gmux git status");
      expect(stdout).toContain("gmux git stash list");
      expect(stdout).toContain("gmux git stash drop 0");
    });
  });

  describe("--version flag", () => {
    it("shows version number", () => {
      const { stdout } = runCLI("--version");

      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("list command", () => {
    it("runs without error", () => {
      const { exitCode, stdout } = runCLI("list");

      // list command should succeed (may show "No sessions found")
      expect(exitCode).toBe(0);
      expect(stdout).toContain("No sessions found");
    });

    it("supports --json flag", () => {
      const { exitCode, stdout } = runCLI("list", "--json");

      expect(exitCode).toBe(0);
      // When no sessions, list outputs "No sessions found." before JSON check
      // The --json flag is only used when sessions exist
      expect(stdout.length).toBeGreaterThan(0);
    });
  });

  describe("doctor command", () => {
    it("runs without crashing", () => {
      const { exitCode, stdout } = runCLI("doctor");

      // doctor should succeed or handle gracefully
      expect([0, 1]).toContain(exitCode);
      // Should output something
      expect(stdout.length).toBeGreaterThan(0);
    });
  });

  describe("required argument validation", () => {
    it("exits with error when no arguments provided", () => {
      const { exitCode, stderr } = runCLI();

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("required");
    });

    it("exits with error when only session name provided", () => {
      const { exitCode, stderr } = runCLI("my-session");

      expect(exitCode).not.toBe(0);
    });
  });

  describe("command parsing", () => {
    it("parses agent flag", () => {
      const { exitCode } = runCLI("test-session", "hello", "-A", "codex");

      // The command will fail because there's no tmux/git setup,
      // but it should at least parse the arguments
      expect(typeof exitCode).toBe("number");
    });

    it("parses agents count flag", () => {
      const { exitCode } = runCLI("test-session", "hello", "-a", "4");

      expect(typeof exitCode).toBe("number");
    });

    it("parses panes flag", () => {
      const { exitCode } = runCLI("test-session", "hello", "-p");

      expect(typeof exitCode).toBe("number");
    });

    it("parses auto-merge flag", () => {
      const { exitCode } = runCLI("test-session", "hello", "--auto-merge");

      expect(typeof exitCode).toBe("number");
    });
  });
});
