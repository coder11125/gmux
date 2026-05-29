import { $ } from "./shell.ts";
import { createInterface } from "node:readline";

export interface TeardownOptions {
  sessionName: string;
  worktreePath: string;
  windowId: string;
  autoMerge?: boolean;
}

export class TeardownManager {
  private merged = new Set<string>();

  async teardown(options: TeardownOptions): Promise<void> {
    const { sessionName, worktreePath, windowId, autoMerge = false } = options;
    const branchName = `gmux-${sessionName}`;

    const doMerge = autoMerge || await this.shouldMerge(branchName);
    if (doMerge && (await this.mergeBranch(branchName))) {
      this.merged.add(sessionName);
    }

    const rmResult = await $`git worktree remove ${worktreePath}`.nothrow();
    if (rmResult.exitCode !== 0) {
      const r = rmResult.stderr.toString().trim();
      if (r.includes("not a valid worktree") || r.includes("is not a working tree")) {
        console.warn(`  warn     Worktree not found: ${worktreePath}`);
      } else {
        console.warn(`  warn     Failed to remove worktree: ${r}`);
      }
    }

    await $`git worktree prune`.nothrow();

    const killResult = await $`tmux kill-window -t ${windowId}`.nothrow();
    if (killResult.exitCode !== 0) {
      const k = killResult.stderr.toString().trim();
      if (!k.includes("no such window") && !k.includes("can't find")) {
        console.warn(`  warn     Failed to kill tmux window: ${k}`);
      }
    }
  }

  wasMerged(sessionName: string): boolean {
    return this.merged.has(sessionName);
  }

  private async shouldMerge(branchName: string): Promise<boolean> {
    const answer = await this.readInput(`\n  prompt   Merge branch ${branchName}? [Y/n] `);
    if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
      console.log(`  skip     Merge skipped for ${branchName}.`);
      return false;
    }
    return true;
  }

  private async mergeBranch(branchName: string): Promise<boolean> {
    const result = await $`git merge --no-edit ${branchName}`.nothrow();
    if (result.exitCode === 0) return true;

    const stderr = result.stderr.toString().trim();
    const stdout = result.text().trim();

    if (stdout.includes("Already up to date")) return true;

    if (
      stderr.includes("conflict") ||
      stderr.includes("merge failed") ||
      stderr.includes("Merge conflict") ||
      stderr.includes("fix conflicts")
    ) {
      await $`git merge --abort`.nothrow();
      console.warn(`  conflict  Merge conflict in ${branchName}. Skipped.`);
      console.warn(`  conflict  Resolve manually: git merge ${branchName}`);
      return false;
    }

    if (stderr.includes("not something we can merge")) {
      console.warn(`  warn     Branch ${branchName} not found, skip merge.`);
      return false;
    }

    console.warn(`  warn     Merge failed: ${stderr}`);
    return false;
  }

  private async readInput(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
