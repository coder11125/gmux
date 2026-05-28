import { $ } from "bun";
import { exists } from "node:fs/promises";
import { createInterface } from "node:readline";
import { SessionStore } from "../session-store.ts";

interface Issue {
  sessionName: string;
  type: "json-stale" | "tmux-missing" | "worktree-missing" | "branch-missing";
  message: string;
  fix: () => Promise<void>;
}

export interface DoctorOptions {
  json?: boolean;
  verbose?: boolean;
}

export async function doctorSessions(store: SessionStore, opts: DoctorOptions = {}): Promise<void> {
  const sessions = await store.listSessions();
  if (sessions.length === 0) {
    console.log("No sessions tracked.");
    return;
  }

  const inRepo =
    (await $`git rev-parse --is-inside-work-tree`.nothrow()).exitCode === 0;

  const issues: Issue[] = [];

  for (const s of sessions) {
    const tmuxOk = await tmuxPaneExists(s.tmuxPaneId);
    const worktreeOk = await exists(s.worktreePath).catch(() => false);
    const branchOk = inRepo ? await branchExists(s.branchName) : true;

    if (opts.verbose && tmuxOk && worktreeOk && branchOk) {
      console.log(`  ok       ${s.sessionName}`);
    }

    if (!tmuxOk) {
      issues.push({
        sessionName: s.sessionName,
        type: "tmux-missing",
        message: `tmux pane ${s.tmuxPaneId} for "${s.sessionName}" no longer exists`,
        fix: () => store.updateStatus(s.sessionName, "complete"),
      });
    }

    if (!worktreeOk) {
      issues.push({
        sessionName: s.sessionName,
        type: "worktree-missing",
        message: `Worktree folder for "${s.sessionName}" not found at ${s.worktreePath}`,
        fix: () => store.updateStatus(s.sessionName, "complete"),
      });
    }

    if (!branchOk) {
      issues.push({
        sessionName: s.sessionName,
        type: "branch-missing",
        message: `Branch ${s.branchName} no longer exists`,
        fix: async () => {
          await store.updateStatus(s.sessionName, "complete");
          if (!tmuxOk && !worktreeOk) await store.removeSession(s.sessionName);
        },
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  if (issues.length === 0) {
    console.log("All sessions are consistent with reality.");
    return;
  }

  console.log(`\nFound ${issues.length} issue(s):\n`);
  for (const issue of issues) {
    console.log(`  [${issue.type}] ${issue.message}`);
  }

  const answer = await readInput("\nAttempt to auto-fix these issues? [Y/n] ");
  if (answer.toLowerCase() === "n" || answer.toLowerCase() === "no") {
    console.log("No changes made.");
    return;
  }

  for (const issue of issues) {
    const yn = await readInput(`  Fix "${issue.sessionName}" (${issue.type})? [Y/n] `);
    if (yn.toLowerCase() === "n" || yn.toLowerCase() === "no") {
      console.log(`    skipped`);
      continue;
    }
    await issue.fix();
    console.log(`    fixed`);
  }

  console.log("\nDoctor completed.");
}

async function tmuxPaneExists(paneId: string): Promise<boolean> {
  const result = await $`tmux list-panes -t ${paneId}`.nothrow();
  return result.exitCode === 0;
}

async function branchExists(branchName: string): Promise<boolean> {
  const result = await $`git branch --list ${branchName}`.nothrow();
  return result.exitCode === 0 && result.text().trim().length > 0;
}

function readInput(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
