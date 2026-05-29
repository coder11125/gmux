import { $ } from "bun";
import { SessionStore } from "../session-store.ts";
import type { RenameOptions } from "../types.ts";

/** Maximum length for a tmux name (matches tmux internals). */
const MAX_NAME_LENGTH = 256;

/** Characters that are illegal in tmux session/window/pane names. */
const ILLEGAL_CHARS = /[.:\s]/;

/**
 * Rename a tmux session, window, or pane.
 *
 * When renaming a session that is tracked in the session store, the store
 * record is updated to reflect the new name. Window and pane renames only
 * affect tmux (the store tracks sessions, not individual windows/panes).
 *
 * @throws When the target is not found, the new name is invalid,
 *         or the tmux command fails.
 */
export async function renameTarget(
  store: SessionStore,
  opts: RenameOptions,
): Promise<void> {
  const { target, newName, targetId } = opts;

  validateName(newName);

  switch (target) {
    case "session":
      await renameSession(store, newName, targetId);
      break;
    case "window":
      await renameWindow(newName, targetId);
      break;
    case "pane":
      await renamePane(newName, targetId);
      break;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Rename a tmux session and update the session store if it is tracked.
 */
async function renameSession(
  store: SessionStore,
  newName: string,
  targetId?: string,
): Promise<void> {
  if (!targetId) {
    throw new Error(
      "A session name is required to rename a session.\n" +
        "Usage: gmux rename --target session --id <current-name> <new-name>",
    );
  }

  const record = await store.getSession(targetId);
  if (!record) {
    throw new Error(
      `Session '${targetId}' not found in the session store.\n` +
        `Run \`gmux list\` to see tracked sessions.`,
    );
  }

  // Check for name collisions in the store.
  const existing = await store.getSession(newName);
  if (existing && existing.sessionName !== targetId) {
    throw new Error(
      `A session named '${newName}' already exists in the session store.`,
    );
  }

  // Check tmux for a name collision.
  const tmuxCheck = await $`tmux list-sessions -F "#{session_name}"`.nothrow();
  if (tmuxCheck.exitCode === 0) {
    const names = tmuxCheck.text().trim().split("\n");
    if (names.includes(newName)) {
      throw new Error(
        `A tmux session named '${newName}' already exists.`,
      );
    }
  }

  const result = await $`tmux rename-session -t ${targetId} ${newName}`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("can't find") || stderr.includes("session not found")) {
      throw new Error(`tmux session '${targetId}' not found.`);
    }
    throw new Error(`Failed to rename tmux session '${targetId}': ${stderr}`);
  }

  // Remove the old record and re-add with the updated name.
  await store.removeSession(targetId);
  await store.addSession({
    ...record,
    sessionName: newName,
  });

  console.log(`  rename   Session '${targetId}' → '${newName}'.`);
}

/**
 * Rename a tmux window.
 */
async function renameWindow(newName: string, targetId?: string): Promise<void> {
  const args = ["rename-window", "-t", targetId ?? ".", newName];
  const result = await $`tmux ${args}`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("can't find") || stderr.includes("no such window")) {
      throw new Error(
        `tmux window '${targetId ?? "current"}' not found.`,
      );
    }
    throw new Error(
      `Failed to rename window to '${newName}': ${stderr}`,
    );
  }
  console.log(`  rename   Window → '${newName}'.`);
}

/**
 * Rename a tmux pane.
 */
async function renamePane(newName: string, targetId?: string): Promise<void> {
  // tmux does not have a native "rename-pane" command. Pane names are
  // derived from the window name or the running process. The closest
  // operation is to rename the containing window, but that would rename
  // the window, not the pane. For panes we update the window title via
  // the pane's title escape sequence.
  if (targetId) {
    // Send the title-change escape sequence directly into the pane.
    const escaped = newName.replace(/'/g, "'\\''");
    const result = await $`tmux send-keys -t ${targetId} "printf '\\033]2;${escaped}\\007'" Enter`.nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      if (stderr.includes("can't find") || stderr.includes("pane not found")) {
        throw new Error(`tmux pane '${targetId}' not found.`);
      }
      throw new Error(
        `Failed to rename pane to '${newName}': ${stderr}`,
      );
    }
    console.log(`  rename   Pane ${targetId} → '${newName}'.`);
  } else {
    // Rename the currently focused pane's window (closest equivalent).
    const result = await $`tmux rename-window -t . ${newName}`.nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(`Failed to rename current pane: ${stderr}`);
    }
    console.log(`  rename   Current pane window → '${newName}'.`);
  }
}

/**
 * Validate that a tmux name is legal.
 *
 * Rules:
 * - Must not be empty.
 * - Must not exceed {@link MAX_NAME_LENGTH} characters.
 * - Must not contain `.`, `:`, or whitespace.
 */
function validateName(name: string): void {
  if (name.length === 0) {
    throw new Error("Name must not be empty.");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Name must not exceed ${MAX_NAME_LENGTH} characters (got ${name.length}).`,
    );
  }
  if (ILLEGAL_CHARS.test(name)) {
    throw new Error(
      `Name '${name}' contains illegal characters. ` +
        `Names must not contain '.', ':', or whitespace.`,
    );
  }
}
