import { $ } from "../shell.ts";
import type { PaneInfo, PaneSplitOptions, PaneResizeOptions, WindowInfo, TmuxLayout } from "../types.ts";

/**
 * Split a tmux pane.
 */
export async function splitPane(
  options: PaneSplitOptions & { windowId: string },
): Promise<PaneInfo> {
  const { windowId, direction, size, targetPaneId } = options;
  const dirFlag = direction === "horizontal" ? "-h" : "-v";
  const format = "#{pane_id}#{pane_width}#{pane_height}#{pane_current_command}#{cursor_x}#{cursor_y}";
  const target = targetPaneId ?? windowId;

  const args: string[] = ["tmux", "split-window", "-t", target, dirFlag];
  if (size !== undefined) {
    if (size > 0 && size < 1) {
      args.push("-p", String(Math.round(size * 100)));
    } else {
      args.push("-l", String(Math.round(size)));
    }
  }
  args.push("-P", "-F", format);

  const result = await $`${args}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to split pane in window ${windowId}: ${stderr}`);
  }

  const output = result.text().trim();
  const parts = output.split("\x01");
  const paneId = parts[0] ?? "";
  const paneIndex = 0; // New pane, index determined after creation
  const width = parseInt(parts[1] ?? "0", 10);
  const height = parseInt(parts[2] ?? "0", 10);
  const currentCommand = parts[3] ?? "";
  const cursorX = parseInt(parts[4] ?? "0", 10);
  const cursorY = parseInt(parts[5] ?? "0", 10);

  if (!paneId) {
    throw new Error(`Unexpected tmux output: ${output}`);
  }

  // Fetch the actual pane index
  const indexResult = await $`tmux list-panes -t ${paneId} -F "#{pane_index}"`.nothrow();
  const actualIndex = indexResult.exitCode === 0
    ? parseInt(indexResult.text().trim(), 10)
    : paneIndex;

  return { paneId, paneIndex: actualIndex, width, height, currentCommand, cursorX, cursorY };
}

/**
 * Kill a tmux pane. Optionally force kill.
 */
export async function killPane(paneId: string, force?: boolean): Promise<void> {
  const args = ["tmux", "kill-pane"];
  if (force) args.push("-f");
  args.push("-t", paneId);
  const result = await $`${args}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to kill pane ${paneId}: ${stderr}`);
  }
}

/**
 * Resize a tmux pane.
 */
export async function resizePane(
  paneId: string,
  options: PaneResizeOptions,
): Promise<void> {
  const { direction, amount } = options;
  const dirMap: Record<PaneResizeOptions["direction"], string> = {
    up: "-U",
    down: "-D",
    left: "-L",
    right: "-R",
  };
  const dirFlag = dirMap[direction];

  const result = await $`tmux resize-pane -t ${paneId} ${dirFlag} ${amount}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to resize pane ${paneId}: ${stderr}`);
  }
}

/**
 * Zoom a tmux pane (toggle zoom on).
 */
export async function zoomPane(paneId: string): Promise<void> {
  const result = await $`tmux resize-pane -t ${paneId} -Z`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to zoom pane ${paneId}: ${stderr}`);
  }
}

/**
 * Unzoom a tmux pane (toggle zoom off).
 */
export async function unzoomPane(paneId: string): Promise<void> {
  // -Z is a toggle, so calling it once zooms, calling it again unzooms.
  const result = await $`tmux resize-pane -t ${paneId} -Z`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to unzoom pane ${paneId}: ${stderr}`);
  }
}

/**
 * Select a tmux pane.
 */
export async function selectPane(paneId: string): Promise<void> {
  const result = await $`tmux select-pane -t ${paneId}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to select pane ${paneId}: ${stderr}`);
  }
}

/**
 * Cycle to the next or previous pane in a window.
 */
export async function cyclePanes(
  windowId: string,
  direction: "next" | "previous",
): Promise<void> {
  const target = direction === "next" ? "+" : "-";
  const result = await $`tmux select-pane -t ${windowId}:${target}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to cycle panes in window ${windowId}: ${stderr}`);
  }
}

/**
 * Get detailed info about a tmux pane.
 */
export async function getPaneInfo(paneId: string): Promise<PaneInfo> {
  const result = await $`tmux list-panes -t ${paneId} -F ${"#{pane_id}#{pane_index}#{pane_width}#{pane_height}#{pane_current_command}#{cursor_x}#{cursor_y}"}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to get pane info for ${paneId}: ${stderr}`);
  }

  const output = result.text().trim();
  const parts = output.split("\x01");
  const paneIdStr = parts[0] ?? "";
  const paneIndex = parseInt(parts[1] ?? "0", 10);
  const width = parseInt(parts[2] ?? "0", 10);
  const height = parseInt(parts[3] ?? "0", 10);
  const currentCommand = parts[4] ?? "";
  const cursorX = parseInt(parts[5] ?? "0", 10);
  const cursorY = parseInt(parts[6] ?? "0", 10);

  if (!paneIdStr) {
    throw new Error(`Unexpected tmux output: ${output}`);
  }

  return { paneId: paneIdStr, paneIndex, width, height, currentCommand, cursorX, cursorY };
}

/**
 * Break a pane out into its own window.
 */
export async function convertPaneToWindow(paneId: string): Promise<WindowInfo> {
  const result = await $`tmux break-pane -t ${paneId} -P -F "#{window_id}:#{pane_id}"`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to convert pane ${paneId} to window: ${stderr}`);
  }

  const output = result.text().trim();
  const parts = output.split(":");
  const windowId = parts[0] ?? "";

  if (!windowId) {
    throw new Error(`Unexpected tmux output: ${output}`);
  }

  // Fetch the new window's full info
  const cvFmt = "#{window_id}#{window_name}#{window_index}";
  const windowResult = await $`tmux display-message -t ${windowId} -p ${cvFmt}`.nothrow();

  if (windowResult.exitCode !== 0) {
    const stderr = windowResult.stderr.toString().trim();
    throw new Error(`Failed to get new window info: ${stderr}`);
  }

  const windowOutput = windowResult.text().trim();
  const windowParts = windowOutput.split("\x01");
  const finalWindowId = windowParts[0] ?? windowId;
  const windowName = windowParts[1] ?? "";
  const windowIndex = parseInt(windowParts[2] ?? "0", 10);

  // Fetch pane IDs for the new window
  const paneResult = await $`tmux list-panes -t ${finalWindowId} -F "#{pane_id}"`.nothrow();
  const paneIds = paneResult.exitCode === 0
    ? paneResult.text().trim().split("\n").filter(Boolean)
    : [];

  // Fetch current layout
  const layoutResult = await $`tmux display-message -t ${finalWindowId} -p "#{window_layout}"`.nothrow();
  const layout: TmuxLayout = layoutResult.exitCode === 0
    ? parseLayout(layoutResult.text().trim())
    : "custom";

  return { windowId: finalWindowId, windowName, windowIndex, paneIds, layout };
}

/**
 * Join a source pane into a target window.
 */
export async function joinPane(
  sourcePaneId: string,
  targetWindowId: string,
  direction: "left" | "right" | "top" | "bottom",
): Promise<void> {
  const dirMap: Record<string, string> = {
    left: "L",
    right: "R",
    top: "U",
    bottom: "D",
  };
  const dirFlag = dirMap[direction];

  const result = await $`tmux join-pane -s ${sourcePaneId} -t ${targetWindowId} -${dirFlag}`.nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `Failed to join pane ${sourcePaneId} into window ${targetWindowId}: ${stderr}`,
    );
  }
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
