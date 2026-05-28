import { $ } from "bun";

export interface TmuxWindowInfo {
  windowId: string;
  paneId: string;
}

export class TmuxManager {
  async isRunning(): Promise<boolean> {
    const result = await $`tmux list-sessions`.nothrow();
    return result.exitCode === 0;
  }

  async createWindow(
    sessionName: string,
    worktreePath: string,
    agentPrompt?: string,
  ): Promise<TmuxWindowInfo> {
    if (!(await this.isRunning())) {
      throw new Error("No tmux server is running. Start tmux first.");
    }

    const result = await $`tmux new-window -P -F "#{window_id}:#{pane_id}" -n ${sessionName} -c ${worktreePath}`.nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(
        stderr.includes("duplicate")
          ? `A window named '${sessionName}' already exists.`
          : stderr.includes("no current session")
            ? "No active tmux session. Start a session first."
            : `Failed to create tmux window: ${stderr}`,
      );
    }

    const output = result.text().trim();
    const parts = output.split(":");
    const windowId = parts[0] ?? "";
    const paneId = parts[1] ?? "";

    if (!windowId || !paneId) {
      throw new Error(`Unexpected tmux output: ${output}`);
    }

    await $`tmux set-window-option -t ${windowId} allow-rename off`.nothrow();

    if (agentPrompt) {
      await $`tmux send-keys -t ${paneId} ${agentPrompt}`.nothrow();
    }

    return { windowId, paneId };
  }

  async createWindowWithPanes(
    name: string,
    worktreePaths: string[],
  ): Promise<{ windowId: string; paneIds: string[] }> {
    if (!(await this.isRunning())) {
      throw new Error("No tmux server is running. Start tmux first.");
    }

    const first = await this.createWindow(`${name}-0`, worktreePaths[0]!);
    const paneIds = [first.paneId];

    for (let i = 1; i < worktreePaths.length; i++) {
      const result = await $`tmux split-window -t ${first.windowId} -P -F "#{pane_id}" -c ${worktreePaths[i]}`.nothrow();
      if (result.exitCode !== 0) {
        throw new Error(`Failed to split pane: ${result.stderr.toString().trim()}`);
      }
      paneIds.push(result.text().trim());
    }

    await $`tmux select-layout -t ${first.windowId} tiled`.nothrow();
    await $`tmux set-window-option -t ${first.windowId} allow-rename off`.nothrow();

    return { windowId: first.windowId, paneIds };
  }
}
