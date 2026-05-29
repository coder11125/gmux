import { $ } from "../shell.ts";
import type { WindowInfo, PaneInfo, TmuxLayout } from "../types.ts";

/**
 * List all windows, optionally scoped to a session.
 */
export async function listWindows(sessionName?: string): Promise<WindowInfo[]> {
  const target = sessionName ? `-t ${sessionName}` : "";
  const result = await $`tmux list-windows ${target} -F "#{window_id}:#{window_name}:#{window_index}:#{pane_count}"`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("no server running")) {
      throw new Error("No tmux server is running. Start tmux first.");
    }
    if (sessionName && stderr.includes("can't find session")) {
      throw new Error(`Session '${sessionName}' not found.`);
    }
    throw new Error(`Failed to list windows: ${stderr}`);
  }

  const output = result.text().trim();
  if (!output) return [];

  const windows: WindowInfo[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split(":");
    const windowId = parts[0] ?? "";
    const windowName = parts[1] ?? "";
    const windowIndex = parseInt(parts[2] ?? "0", 10);

    if (!windowId) {
      throw new Error(`Unexpected tmux output: ${line}`);
    }

    // Fetch pane IDs for this window
    const paneResult = await $`tmux list-panes -t ${windowId} -F "#{pane_id}"`.nothrow();
    const paneIds = paneResult.exitCode === 0
      ? paneResult.text().trim().split("\n").filter(Boolean)
      : [];

    // Fetch current layout
    const layoutResult = await $`tmux display-message -t ${windowId} -p "#{window_layout}"`.nothrow();
    const layout: TmuxLayout = layoutResult.exitCode === 0
      ? parseLayout(layoutResult.text().trim())
      : "custom";

    windows.push({ windowId, windowName, windowIndex, paneIds, layout });
  }

  return windows;
}

/**
 * Parse a tmux window_layout string into a TmuxLayout type.
 */
function parseLayout(layoutStr: string): TmuxLayout {
  const normalized = layoutStr.toLowerCase();
  if (normalized.includes("even-horizontal")) return "even-horizontal";
  if (normalized.includes("even-vertical")) return "even-vertical";
  if (normalized.includes("main-horizontal")) return "main-horizontal";
  if (normalized.includes("main-vertical")) return "main-vertical";
  if (normalized.includes("tiled")) return "tiled";
  return "custom";
}

/**
 * Create a new tmux window in the current session.
 */
export async function createWindow(
  sessionName: string,
  worktreePath: string,
): Promise<WindowInfo> {
  const result = await $`tmux new-window -P -F "#{window_id}:#{pane_id}" -n ${sessionName} -c ${worktreePath}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    if (stderr.includes("duplicate")) {
      throw new Error(`A window named '${sessionName}' already exists.`);
    }
    if (stderr.includes("no current session")) {
      throw new Error("No active tmux session. Start a session first.");
    }
    throw new Error(`Failed to create window: ${stderr}`);
  }

  const output = result.text().trim();
  const parts = output.split(":");
  const windowId = parts[0] ?? "";
  const paneId = parts[1] ?? "";

  if (!windowId || !paneId) {
    throw new Error(`Unexpected tmux output: ${output}`);
  }

  // Fetch the window info to get name, index, and layout
  const windowResult = await $`tmux list-windows -t ${windowId} -F "#{window_name}:#{window_index}"`.nothrow();
  const windowName = windowResult.exitCode === 0
    ? (windowResult.text().trim().split(":")[0] ?? sessionName)
    : sessionName;
  const windowIndex = windowResult.exitCode === 0
    ? parseInt(windowResult.text().trim().split(":")[1] ?? "0", 10)
    : 0;

  const layoutResult = await $`tmux display-message -t ${windowId} -p "#{window_layout}"`.nothrow();
  const layout: TmuxLayout = layoutResult.exitCode === 0
    ? parseLayout(layoutResult.text().trim())
    : "custom";

  return { windowId, windowName, windowIndex, paneIds: [paneId], layout };
}

/**
 * Kill a tmux window. Optionally force kill.
 */
export async function killWindow(windowId: string, force?: boolean): Promise<void> {
  const forceFlag = force ? "-f" : "";
  const result = await $`tmux kill-window ${forceFlag} -t ${windowId}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to kill window ${windowId}: ${stderr}`);
  }
}

/**
 * Rename a tmux window.
 */
export async function renameWindow(windowId: string, newName: string): Promise<void> {
  const result = await $`tmux rename-window -t ${windowId} ${newName}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to rename window ${windowId}: ${stderr}`);
  }
}

/**
 * Swap two tmux windows.
 */
export async function swapWindows(sourceId: string, targetId: string): Promise<void> {
  const result = await $`tmux swap-window -s ${sourceId} -t ${targetId}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to swap windows ${sourceId} and ${targetId}: ${stderr}`);
  }
}

/**
 * Move a tmux window to another session.
 */
export async function moveToWindow(windowId: string, targetSession: string): Promise<void> {
  const result = await $`tmux move-window -s ${windowId} -t ${targetSession}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to move window ${windowId} to session ${targetSession}: ${stderr}`);
  }
}

/**
 * Select a tmux window (bring it into view).
 */
export async function selectWindow(windowId: string): Promise<void> {
  const result = await $`tmux select-window -t ${windowId}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to select window ${windowId}: ${stderr}`);
  }
}

/**
 * Cycle to the next or previous window.
 */
export async function cycleWindows(direction: "next" | "previous"): Promise<void> {
  const target = direction === "next" ? "+" : "-";
  const result = await $`tmux select-window -t ${target}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to cycle ${direction}: ${stderr}`);
  }
}

/**
 * Set the layout for a tmux window.
 */
export async function setLayout(windowId: string, layout: TmuxLayout): Promise<void> {
  const result = await $`tmux select-layout -t ${windowId} ${layout}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to set layout for window ${windowId}: ${stderr}`);
  }
}

/**
 * Get detailed info about a tmux window including its panes.
 */
export async function getWindowInfo(windowId: string): Promise<WindowInfo> {
  const windowResult = await $`tmux list-windows -t ${windowId} -F "#{window_id}:#{window_name}:#{window_index}"`.nothrow();

  if (windowResult.exitCode !== 0) {
    const stderr = windowResult.stderr.toString().trim();
    throw new Error(`Failed to get window info for ${windowId}: ${stderr}`);
  }

  const windowOutput = windowResult.text().trim();
  const parts = windowOutput.split(":");
  const windowIdStr = parts[0] ?? "";
  const windowName = parts[1] ?? "";
  const windowIndex = parseInt(parts[2] ?? "0", 10);

  if (!windowIdStr) {
    throw new Error(`Unexpected tmux output: ${windowOutput}`);
  }

  // Fetch pane IDs for this window
  const paneResult = await $`tmux list-panes -t ${windowIdStr} -F "#{pane_id}"`.nothrow();
  const paneIds = paneResult.exitCode === 0
    ? paneResult.text().trim().split("\n").filter(Boolean)
    : [];

  // Fetch current layout
  const layoutResult = await $`tmux display-message -t ${windowIdStr} -p "#{window_layout}"`.nothrow();
  const layout: TmuxLayout = layoutResult.exitCode === 0
    ? parseLayout(layoutResult.text().trim())
    : "custom";

  return { windowId: windowIdStr, windowName, windowIndex, paneIds, layout };
}
