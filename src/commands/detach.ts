import { $ } from "../shell.ts";
import { SessionStore } from "../session-store.ts";
import type { DetachOptions } from "../types.ts";

/**
 * Detach the current tmux client from a session (or all sessions).
 *
 * Wraps `tmux detach-client` and updates the session store to reflect
 * that no user is attached to the target session(s).
 *
 * @throws When no target is specified, or the tmux command fails.
 */
export async function detachSession(
  store: SessionStore,
  opts: DetachOptions,
): Promise<void> {
  const { sessionName, all = false } = opts;

  if (!sessionName && !all) {
    throw new Error(
      "Specify a session name or use --all to detach from every session.",
    );
  }

  if (all) {
    await detachAll(store);
    return;
  }

  await detachOne(store, sessionName!);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Detach the current client from every session it is attached to.
 */
async function detachAll(store: SessionStore): Promise<void> {
  const result = await $`tmux detach-client`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("no client")) {
      console.log("  info     No tmux clients are currently attached.");
      return;
    }
    throw new Error(`Failed to detach from all sessions: ${stderr}`);
  }

  console.log("  detach   Detached from all sessions.");
}

/**
 * Detach the current client from a single named session.
 */
async function detachOne(store: SessionStore, sessionName: string): Promise<void> {
  const record = await store.getSession(sessionName);
  if (!record) {
    throw new Error(
      `Session '${sessionName}' not found in the session store.\n` +
        `Run \`gmux list\` to see tracked sessions.`,
    );
  }

  // Verify the tmux pane still exists.
  const paneCheck = await $`tmux list-panes -t ${record.tmuxPaneId} -F "#{pane_id}"`.nothrow();
  if (paneCheck.exitCode !== 0) {
    const stderr = paneCheck.stderr.toString().trim();
    if (stderr.includes("can't find") || stderr.includes("session not found")) {
      console.warn(
        `  warn     tmux pane ${record.tmuxPaneId} no longer exists for session '${sessionName}'.`,
      );
      await store.updateStatus(sessionName, "error");
      throw new Error(
        `tmux pane ${record.tmuxPaneId} for session '${sessionName}' no longer exists.`,
      );
    }
  }

  // Resolve the tmux session name from the window id so we can use
  // `detach-client -s <session>` — detach-client's -t flag takes a
  // client name (tty path), not a pane/window id.
  const sessionResult = await $`tmux display-message -t ${record.tmuxWindowId} -p "#{session_name}"`.nothrow();
  const tmuxSession = sessionResult.exitCode === 0
    ? sessionResult.text().trim()
    : record.tmuxWindowId;

  const result = await $`tmux detach-client -s ${tmuxSession}`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("no client")) {
      console.warn(`  warn     No client is attached to session '${sessionName}'.`);
      return;
    }
    throw new Error(`Failed to detach from session '${sessionName}': ${stderr}`);
  }

  await store.updateStatus(sessionName, "running");
  console.log(`  detach   Session '${sessionName}' detached.`);
}
