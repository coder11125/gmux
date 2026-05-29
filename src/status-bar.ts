/**
 * Tmux-style status bar module that shows session info, git overlay data,
 * and pane information in the tmux status line.
 *
 * @module status-bar
 */

import { $ } from "bun";
import {
  type GitOverlayState,
  type GmuxSession,
  type StatusBarConfig,
  type StatusBarSegment,
  DEFAULT_CONFIG,
} from "./types.ts";
import { GitOverlay } from "./git-overlay.ts";
import { SessionStore } from "./session-store.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padZero(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

export class StatusBar {
  private config: StatusBarConfig;
  private gitOverlay: GitOverlay;
  private sessionStore: SessionStore;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<StatusBarConfig>) {
    this.config = {
      ...DEFAULT_CONFIG.status_bar,
      ...config,
    };
    this.gitOverlay = new GitOverlay();
    this.sessionStore = new SessionStore();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the status bar: configure tmux status line options and begin
   * periodic refresh.
   */
  async start(): Promise<void> {
    const intervalSec = Math.max(
      1,
      Math.round(this.config.refreshInterval / 1000),
    );

    await $`tmux set-option -g status-interval ${String(intervalSec)}`.nothrow();
    await this.refresh();

    this.refreshInterval = setInterval(() => {
      this.refresh().catch(() => {
        /* swallow – tmux may not be running */
      });
    }, this.config.refreshInterval);
  }

  /** Stop the status bar refresh loop. */
  stop(): void {
    if (this.refreshInterval !== null) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Force an immediate refresh of the tmux status line.
   */
  async refresh(): Promise<void> {
    const segments = await this.getSegments();
    const line = this.formatStatusLine(segments);
    await this.setTmuxStatusLine(line);
  }

  // -------------------------------------------------------------------------
  // Segment builders
  // -------------------------------------------------------------------------

  /**
   * Build all segments for the current state.
   */
  async getSegments(): Promise<StatusBarSegment[]> {
    const segments: StatusBarSegment[] = [];

    if (this.config.showSessionInfo) {
      segments.push(await this.getSessionSegment());
    }

    if (this.config.showGitOverlay) {
      const sessions = await this.sessionStore.listSessions();
      for (const s of sessions) {
        if (s.status === "running") {
          segments.push(await this.getGitSegment(s.worktreePath));
          break; // show the first active session's git info
        }
      }
    }

    if (this.config.showPaneInfo) {
      segments.push(await this.getPaneSegment());
    }

    if (this.config.showClock) {
      segments.push(this.getClockSegment());
    }

    return segments.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Format segments into a tmux `status-right` string.
   *
   * Each segment is wrapped in tmux colour/style escape sequences.
   */
  formatStatusLine(segments: StatusBarSegment[]): string {
    if (segments.length === 0) return "";

    const parts = segments.map((seg) => {
      return `#[fg=${seg.color},bg=colour0,bold] ${seg.content} `;
    });

    // Reset style at the end
    parts.push("#[fg=colour255,bg=colour0,nobold]");

    return parts.join("");
  }

  /**
   * Push a formatted string to the tmux `status-right` option.
   */
  async setTmuxStatusLine(content: string): Promise<void> {
    await $`tmux set-option -g status-right ${content}`.nothrow();
  }

  // -------------------------------------------------------------------------
  // Individual segment builders
  // -------------------------------------------------------------------------

  /**
   * Session info segment — shows count and comma-separated names.
   */
  async getSessionSegment(): Promise<StatusBarSegment> {
    const sessions = await this.sessionStore.listSessions();
    const running = sessions.filter((s) => s.status === "running");
    const names = running.map((s) => s.sessionName).join(", ") || "none";

    return {
      name: "session",
      content: `[${running.length}] ${names}`,
      color: "colour75",
      priority: 10,
    };
  }

  /**
   * Git overlay segment for a given worktree path.
   */
  async getGitSegment(worktreePath: string): Promise<StatusBarSegment> {
    let state: GitOverlayState;

    try {
      state = await this.gitOverlay.getState(worktreePath);
    } catch {
      // If git state can't be read, return a disabled segment
      return {
        name: "git",
        content: "git:?",
        color: "colour243",
        priority: 20,
      };
    }

    const display = this.formatGitStatus(state);
    const color = this.getGitStatusColor(state);

    return {
      name: "git",
      content: display,
      color,
      priority: 20,
    };
  }

  /**
   * Pane info segment — shows pane dimensions and running command.
   *
   * When `paneId` is provided the query targets that specific pane;
   * otherwise it targets the currently focused pane.
   */
  async getPaneSegment(paneId?: string): Promise<StatusBarSegment> {
    const target = paneId ? `-t ${paneId}` : "";
    let width = "?";
    let height = "?";
    let command = "?";

    try {
      const w = await $`tmux display-message -p ${target} "#{pane_width}"`.text();
      width = w.trim();
    } catch { /* tmux may not be running */ }

    try {
      const h = await $`tmux display-message -p ${target} "#{pane_height}"`.text();
      height = h.trim();
    } catch { /* tmux may not be running */ }

    try {
      const c = await $`tmux display-message -p ${target} "#{pane_current_command}"`.text();
      command = c.trim();
    } catch { /* tmux may not be running */ }

    return {
      name: "pane",
      content: `${width}x${height} ${command}`,
      color: "colour109",
      priority: 30,
    };
  }

  /**
   * Clock segment — current time in HH:MM format.
   */
  getClockSegment(): StatusBarSegment {
    const now = new Date();
    const time = `${padZero(now.getHours())}:${padZero(now.getMinutes())}`;

    return {
      name: "clock",
      content: time,
      color: "colour248",
      priority: 40,
    };
  }

  // -------------------------------------------------------------------------
  // Window title updater
  // -------------------------------------------------------------------------

  /**
   * Rename each tmux window to include the git branch so users can identify
   * sessions at a glance.
   */
  async updateWindowTitles(sessions: GmuxSession[]): Promise<void> {
    for (const session of sessions) {
      if (session.status !== "running") continue;

      let branch = "?";
      try {
        const state = await this.gitOverlay.getState(session.worktreePath);
        branch = state.branchName;
      } catch { /* best-effort */ }

      const label = `${session.name} (${branch})`;
      await $`tmux rename-window -t ${session.tmuxWindowId} ${label}`.nothrow();
    }
  }

  // -------------------------------------------------------------------------
  // Git formatting helpers
  // -------------------------------------------------------------------------

  /**
   * Compact git status string, e.g. `main ▲2 ▼1 ●3 ○2 ?1`.
   *
   * Omits tokens when the count is zero to keep the bar clean.
   */
  formatGitStatus(state: GitOverlayState): string {
    const parts: string[] = [state.branchName || "detached"];

    if (state.ahead > 0) parts.push(`▲${state.ahead}`);
    if (state.behind > 0) parts.push(`▼${state.behind}`);
    if (state.stagedCount > 0) parts.push(`●${state.stagedCount}`);
    if (state.unstagedCount > 0) parts.push(`○${state.unstagedCount}`);
    if (state.untrackedCount > 0) parts.push(`?${state.untrackedCount}`);

    return parts.join(" ");
  }

  /**
   * Determine the tmux colour for the git segment based on the overlay state.
   *
   * - **green** if clean
   * - **yellow** if there are unstaged changes
   * - **red** if there are merge conflicts (detected via unstageable files)
   * - **cyan** if there are untracked files
   */
  getGitStatusColor(state: GitOverlayState): string {
    // Red takes priority: conflicts are most important
    if (state.unstagedCount > 0 && state.stagedCount > 0) {
      // Possible conflict state — staged + unstaged simultaneously
      return "red";
    }

    if (state.unstagedCount > 0) {
      return "yellow";
    }

    if (state.untrackedCount > 0) {
      return "cyan";
    }

    // Clean
    return "green";
  }
}
