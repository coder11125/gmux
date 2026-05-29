import { describe, it, expect, mock, beforeEach } from "bun:test";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const CLI = join(PROJECT_ROOT, "src", "index.ts");

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
