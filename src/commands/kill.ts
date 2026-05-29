import { $ } from "bun";
import { createInterface } from "node:readline";
import { SessionStore } from "../session-store.ts";
import type { KillOptions } from "../types.ts";

/**
 * Kill a gmux session, tmux window, or tmux pane.
 *
 * This command tears down the requested tmux resource and, when a full
 * session is killed, also removes the associated git worktree and cleans
 * up the session store.
 *
 * Targeting is exclusive — exactly one of `sessionName`, `windowId`, or
 * `paneId` must be provided.
 *
 * @throws When no target is specified, multiple targets are specified,
 *         the target is not found, or the tmux command fails.
 */
export async function killSession(
  store: SessionStore,
  opts: KillOptions,
): Promise<void> {
  const { sessionName, windowId, paneId, force = false } = opts;

  const targetCount = [sessionName, windowId, paneId].filter(Boolean).length;
  if (targetCount === 0) {
    throw new Error(
      "Specify a target: --session <name>, --window <id>, or --pane <id>.",
    );
  }
  if (targetCount > 1) {
    throw new Error(
      "Only one target can be specified at a time " +
        "(use --session, --window, or --pane).",
    );
  }

  if (sessionName) {
    await killByName(store, sessionName, force);
  } else if (windowId) {
    await killWindow(windowId);
  } else if (paneId) {
    await killPane(paneId);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Kill a full session by name: tmux pane → tmux window → git worktree → store.
 */
async function killByName(
  store: SessionStore,
  sessionName: string,
  force: boolean,
): Promise<void> {
  const record = await store.getSession(sessionName);
  if (!record) {
    throw new Error(
      `Session '${sessionName}' not found in the session store.\n` +
        `Run \`gmux list\` to see tracked sessions.`,
    );
  }

  if (!force) {
    const answer = await readInput(
      `\n  prompt   Kill session '${sessionName}'? This will remove the tmux window ` +
        `and git worktree at ${record.worktreePath}. [y/N] `,
    );
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.log("  skip     Kill cancelled.");
      return;
    }
  }

  // 1. Kill the tmux pane.
  const paneResult = await $`tmux kill-pane -t ${record.tmuxPaneId}`.nothrow();
  if (paneResult.exitCode !== 0) {
    const stderr = paneResult.stderr.toString().trim();
    if (!stderr.includes("can't find") && !stderr.includes("pane not found")) {
      console.warn(`  warn     Failed to kill tmux pane ${record.tmuxPaneId}: ${stderr}`);
    }
  }

  // 2. Kill the tmux window.
  const windowResult = await $`tmux kill-window -t ${record.tmuxWindowId}`.nothrow();
  if (windowResult.exitCode !== 0) {
    const stderr = windowResult.stderr.toString().trim();
    if (!stderr.includes("can't find") && !stderr.includes("no such window")) {
      console.warn(`  warn     Failed to kill tmux window ${record.tmuxWindowId}: ${stderr}`);
    }
  }

  // 3. Remove the git worktree.
  const worktreeResult = await $`git worktree remove ${record.worktreePath}`.nothrow();
  if (worktreeResult.exitCode !== 0) {
    const stderr = worktreeResult.stderr.toString().trim();
    if (stderr.includes("not a valid worktree") || stderr.includes("is not a working tree")) {
      console.warn(`  warn     Worktree not found: ${record.worktreePath}`);
    } else {
      console.warn(`  warn     Failed to remove worktree: ${stderr}`);
    }
  }

  // 4. Prune stale worktree references.
  await $`git worktree prune`.nothrow();

  // 5. Remove from the session store.
  await store.removeSession(sessionName);
  console.log(`  kill     Session '${sessionName}' killed and cleaned up.`);
}

/**
 * Kill a single tmux window by its identifier.
 */
async function killWindow(windowId: string): Promise<void> {
  const result = await $`tmux kill-window -t ${windowId}`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("can't find") || stderr.includes("no such window")) {
      throw new Error(`tmux window '${windowId}' not found.`);
    }
    throw new Error(`Failed to kill tmux window '${windowId}': ${stderr}`);
  }
  console.log(`  kill     Window ${windowId} killed.`);
}

/**
 * Kill a single tmux pane by its identifier.
 */
async function killPane(paneId: string): Promise<void> {
  const result = await $`tmux kill-pane -t ${paneId}`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("can't find") || stderr.includes("pane not found")) {
      throw new Error(`tmux pane '${paneId}' not found.`);
    }
    throw new Error(`Failed to kill tmux pane '${paneId}': ${stderr}`);
  }
  console.log(`  kill     Pane ${paneId} killed.`);
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
