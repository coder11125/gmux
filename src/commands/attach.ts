import { $ } from "../shell.ts";
import { SessionStore } from "../session-store.ts";
import type { AttachOptions } from "../types.ts";

/**
 * Attach to an existing gmux session.
 *
 * Wraps `tmux attach-session` / `tmux switch-client` with git-aware state
 * tracking so the session store reflects whether a user is attached.
 *
 * - When the caller is already inside tmux, `switch-client` is used.
 * - When outside tmux, `attach-session` is used.
 * - The `readOnly` flag maps to tmux's `-r` read-only mode.
 *
 * @throws When the session is not tracked, the tmux session no longer exists,
 *         or the tmux command fails for any other reason.
 */
export async function attachSession(
  store: SessionStore,
  opts: AttachOptions,
): Promise<void> {
  const { sessionName, readOnly = false } = opts;

  const record = await store.getSession(sessionName);
  if (!record) {
    throw new Error(
      `Session '${sessionName}' not found in the session store.\n` +
        `Run \`gmux list\` to see tracked sessions.`,
    );
  }

  // Verify the tmux pane still exists before attempting to attach.
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

  const insideTmux = Boolean(process.env.TMUX);

  try {
    if (insideTmux) {
      // When already inside tmux, switch to the target client.
      const args = ["switch-client", "-t", record.tmuxPaneId];
      await $`tmux ${args}`;
    } else {
      // Outside tmux — attach directly.
      const args = ["attach-session", "-t", record.tmuxPaneId];
      if (readOnly) {
        args.push("-r");
      }
      await $`tmux ${args}`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("can't find session") || msg.includes("session not found")) {
      throw new Error(
        `tmux session for '${sessionName}' not found. It may have been killed.`,
      );
    }
    if (msg.includes("is already attached")) {
      console.warn(
        `  warn     Session '${sessionName}' is already attached to another client.`,
      );
      throw new Error(
        `Session '${sessionName}' is already attached. Use \`gmux detach\` first ` +
          `or kill the other client.`,
      );
    }
    throw new Error(`Failed to attach to session '${sessionName}': ${msg}`);
  }

  // After a successful attach (the tmux command blocks until the user
  // detaches), update the store to reflect the detached state.
  await store.updateStatus(sessionName, "running");
  console.log(`  detach   Session '${sessionName}' detached.`);
}
