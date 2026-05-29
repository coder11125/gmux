import { $ } from "./shell.ts";
import { exists } from "node:fs/promises";
import Path from "node:path";

export class GitWorktreeManager {
  async isRepo(): Promise<boolean> {
    const result = await $`git rev-parse --is-inside-work-tree`.nothrow();
    return result.exitCode === 0 && result.text().trim() === "true";
  }

  async add(sessionName: string): Promise<string> {
    if (!(await this.isRepo())) {
      throw new Error(
        `Not a git repository: ${process.cwd()}\n` +
          `gmux requires a git repository to manage worktrees.`
      );
    }

    const branchName = `gmux-${sessionName}`;
    const worktreeAbsPath = Path.resolve(`../worktrees/gmux-${sessionName}`);

    const registered = await this.registeredWorktreePath(worktreeAbsPath);
    if (registered) return worktreeAbsPath;

    const dirExists = await exists(worktreeAbsPath);
    if (dirExists) {
      throw new Error(
        `Directory already exists: ${worktreeAbsPath}\n` +
          `This path is not a registered git worktree. Remove it manually or use a different session name.`
      );
    }

    const branchExists = await this.branchExists(branchName);

    try {
      if (branchExists) {
        await $`git worktree add ${worktreeAbsPath} ${branchName}`;
      } else {
        await $`git worktree add -b ${branchName} ${worktreeAbsPath}`;
      }
    } catch (err: unknown) {
      throw new Error(this.formatGitError(err, branchName, worktreeAbsPath));
    }

    return worktreeAbsPath;
  }

  private async branchExists(branchName: string): Promise<boolean> {
    const result = await $`git branch --list ${branchName}`.nothrow();
    return result.exitCode === 0 && result.text().trim().length > 0;
  }

  private async registeredWorktreePath(path: string): Promise<boolean> {
    const porcelain = await $`git worktree list --porcelain`.nothrow();
    if (porcelain.exitCode !== 0) return false;

    for (const line of porcelain.text().split("\n")) {
      if (line.startsWith("worktree ") && Path.resolve(line.slice(9)) === path) {
        return true;
      }
    }
    return false;
  }

  private formatGitError(err: unknown, branchName: string, worktreePath: string): string {
    const stderr =
      (err && typeof err === "object" && "stderr" in err
        ? (err as { stderr: Buffer }).stderr.toString().trim()
        : undefined) ??
      (err instanceof Error ? err.message : "Unknown error");

    if (stderr.includes("already exists")) {
      if (stderr.includes("branch")) {
        return `Branch '${branchName}' already exists. Use a different session name.`;
      }
      if (stderr.includes("working tree") || stderr.includes("worktree")) {
        return `Worktree at '${worktreePath}' already exists.`;
      }
    }
    if (stderr.includes("not a git repository")) {
      return `Not a git repository: ${process.cwd()}`;
    }

    return `Git command failed: ${stderr}`;
  }
}
