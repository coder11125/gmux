/**
 * Shared type system and interface contracts for gmux.
 *
 * This module is the single source of truth for all types used across the
 * gmux tmux-features + git-overlay implementation. Every other module
 * imports from here to guarantee a consistent, well-typed API surface.
 *
 * @module types
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current gmux version — kept in sync with package.json. */
export const VERSION = "0.2.0" as const;

// ---------------------------------------------------------------------------
// Session Management Types
// ---------------------------------------------------------------------------

/**
 * Represents a single gmux session — an isolated git worktree paired with
 * a tmux window that runs an AI agent.
 */
export interface GmuxSession {
  /** Unique session identifier (e.g. `my-session-a1b2c3d4`). */
  id: string;

  /** Human-readable session name supplied by the user. */
  name: string;

  /** Git branch associated with this session's worktree. */
  branchName: string;

  /** Absolute path to the git worktree for this session. */
  worktreePath: string;

  /** tmux session name (may differ from `name` when multiple sessions share a server). */
  tmuxSessionName: string;

  /** tmux window identifier (e.g. `@5`). */
  tmuxWindowId: string;

  /** Pane identifiers owned by this session. A single-window layout has one entry; a multi-pane layout has many. */
  tmuxPaneIds: string[];

  /** Shell command that launches the AI agent inside the pane(s). */
  agentCommand: string;

  /** Current lifecycle status of the session. */
  status: SessionStatus;

  /** ISO-8601 timestamp of when the session was created. */
  createdAt: string;

  /** ISO-8601 timestamp of the last status or metadata update. */
  updatedAt: string;

  /** Snapshot of the git overlay state for this session's worktree. */
  gitOverlay: GitOverlayState;
}

/**
 * Lifecycle status of a gmux session.
 *
 * - `"running"` — the agent process is active.
 * - `"complete"` — the agent exited successfully.
 * - `"error"` — the agent exited with a non-zero code or was killed.
 * - `"attached"` — a user is attached to the tmux session (interactive mode).
 * - `"detached"` — the session exists but no user is attached.
 */
export type SessionStatus = "running" | "complete" | "error" | "attached" | "detached";

// ---------------------------------------------------------------------------
// Window Management Types
// ---------------------------------------------------------------------------

/**
 * Describes a tmux window within a gmux session.
 */
export interface WindowInfo {
  /** tmux window identifier (e.g. `@5`). */
  windowId: string;

  /** Display name of the window in tmux. */
  windowName: string;

  /** Zero-based index of the window within its session. */
  windowIndex: number;

  /** Pane identifiers belonging to this window. */
  paneIds: string[];

  /** Current tmux layout applied to the window. */
  layout: TmuxLayout;
}

/**
 * Built-in tmux layout strategies.
 *
 * - `"even-horizontal"` — panes split horizontally with equal widths.
 * - `"even-vertical"` — panes split vertically with equal heights.
 * - `"tiled"` — panes arranged in a grid to fill the window.
 * - `"main-horizontal"` — one main pane on top, remaining panes below.
 * - `"main-vertical"` — one main pane on the left, remaining panes on the right.
 * - `"custom"` — a user-applied layout that doesn't match a preset.
 */
export type TmuxLayout =
  | "even-horizontal"
  | "even-vertical"
  | "tiled"
  | "main-horizontal"
  | "main-vertical"
  | "custom";

// ---------------------------------------------------------------------------
// Pane Management Types
// ---------------------------------------------------------------------------

/**
 * Runtime information for a single tmux pane.
 */
export interface PaneInfo {
  /** tmux pane identifier (e.g. `%3`). */
  paneId: string;

  /** Zero-based index of the pane within its window. */
  paneIndex: number;

  /** Current width of the pane in cells. */
  width: number;

  /** Current height of the pane in cells. */
  height: number;

  /** The command currently running in the pane (e.g. `bash`, `vim`). */
  currentCommand: string;

  /** Horizontal cursor position (0-indexed). */
  cursorX: number;

  /** Vertical cursor position (0-indexed). */
  cursorY: number;
}

/**
 * Options for splitting an existing pane.
 */
export interface PaneSplitOptions {
  /** Whether the split should be horizontal (side-by-side) or vertical (top-bottom). */
  direction: "horizontal" | "vertical";

  /**
   * Size of the new pane.
   * - If between 0 and 1 exclusive, treated as a percentage of the parent.
   * - If >= 1, treated as a cell count.
   * - If omitted, tmux uses its default (50%).
   */
  size?: number;

  /** Target pane to split. Defaults to the currently focused pane. */
  targetPaneId?: string;
}

/**
 * Options for resizing an existing pane.
 */
export interface PaneResizeOptions {
  /** Direction to grow/shrink the pane. */
  direction: "up" | "down" | "left" | "right";

  /** Number of cells to resize by. */
  amount: number;
}

// ---------------------------------------------------------------------------
// Git Overlay Types
// ---------------------------------------------------------------------------

/**
 * Snapshot of the git state for a session's worktree, surfaced by the
 * git overlay and rendered in the tmux status bar.
 */
export interface GitOverlayState {
  /** Whether the git overlay is enabled for this session. */
  enabled: boolean;

  /** Current branch name in the worktree. */
  branchName: string;

  /** Absolute path to the worktree. */
  worktreePath: string;

  /** `true` when the worktree has any staged, unstaged, or untracked changes. */
  isDirty: boolean;

  /** Number of commits the local branch is ahead of its remote tracking branch. */
  ahead: number;

  /** Number of commits the local branch is behind its remote tracking branch. */
  behind: number;

  /** Count of files with staged changes. */
  stagedCount: number;

  /** Count of files with unstaged modifications. */
  unstagedCount: number;

  /** Count of untracked files. */
  untrackedCount: number;

  /** Short hash of the most recent commit (e.g. `a1b2c3d`). */
  lastCommitHash: string;

  /** First line of the most recent commit message. */
  lastCommitMessage: string;
}

/**
 * Options for generating a git diff.
 */
export interface GitDiffOptions {
  /** Restrict the diff to a specific file or directory path. */
  path?: string;

  /** If `true`, show only staged changes (`--cached`). */
  staged?: boolean;

  /** If provided, show the diff between this commit and the working tree (or HEAD). */
  commitHash?: string;

  /** If `true`, show only `--stat` summary instead of the full patch. */
  statOnly?: boolean;
}

/**
 * Options for querying the git log.
 */
export interface GitLogOptions {
  /** Maximum number of commits to return. */
  count?: number;

  /** Restrict log to a specific file or directory path. */
  path?: string;

  /** If `true`, use `--oneline` format. */
  oneline?: boolean;

  /** If `true`, include an ASCII graph of the branch topology. */
  graph?: boolean;

  /** Only include commits after this date/ref (e.g. `"2025-01-01"` or `"2.weeks.ago"`). */
  since?: string;
}

/**
 * Options for running `git blame` on a file.
 */
export interface GitBlameOptions {
  /** Path to the file to blame, relative to the worktree root. */
  filePath: string;

  /** 1-indexed starting line number. If omitted, blame from the beginning. */
  startLine?: number;

  /** 1-indexed ending line number. If omitted, blame to the end. */
  endLine?: number;
}

/**
 * Represents a single entry from `git stash list`.
 */
export interface GitStashEntry {
  /** Zero-based stash index (corresponding to `stash@{n}`). */
  stashIndex: number;

  /** Branch that the stash was created on. */
  branchName: string;

  /** Stash commit message. */
  message: string;

  /** ISO-8601 timestamp of the stash commit. */
  timestamp: string;
}

/**
 * A file involved in a merge conflict.
 */
export interface GitConflictFile {
  /** Path to the conflicting file, relative to the worktree root. */
  filePath: string;

  /** Conflict type as reported by `git status`. */
  status:
    | "both-modified"
    | "both-added"
    | "deleted-by-us"
    | "deleted-by-them"
    | "added-by-us"
    | "added-by-them";

  /** Parsed conflict marker regions within the file. */
  markers: ConflictMarker[];
}

/**
 * A single conflict marker region inside a file.
 */
export interface ConflictMarker {
  /** 1-indexed line where `<<<<<<<` appears. */
  startLine: number;

  /** 1-indexed line where `>>>>>>>` appears. */
  endLine: number;

  /** Lines belonging to the "ours" side of the conflict. */
  ours: string[];

  /** Lines belonging to the "theirs" side of the conflict. */
  theirs: string[];
}

// ---------------------------------------------------------------------------
// Status Bar Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the tmux status bar integration.
 */
export interface StatusBarConfig {
  /** Show the git overlay segment (branch, ahead/behind, dirty state). */
  showGitOverlay: boolean;

  /** Show the current session name and status. */
  showSessionInfo: boolean;

  /** Show focused pane index and dimensions. */
  showPaneInfo: boolean;

  /** Show a clock segment. */
  showClock: boolean;

  /** How often to refresh the status bar, in milliseconds. */
  refreshInterval: number;

  /**
   * Format string with placeholders for customising the status bar.
   *
   * Supported placeholders:
   * - `{{session}}` — session name
   * - `{{branch}}` — current git branch
   * - `{{status}}` — session status
   * - `{{pane}}` — pane info
   * - `{{clock}}` — current time
   * - `{{ahead}}` / `{{behind}}` — git ahead/behind counts
   */
  format: string;
}

/**
 * A rendered segment of the status bar.
 */
export interface StatusBarSegment {
  /** Identifier for the segment (e.g. `"git"`, `"session"`, `"clock"`). */
  name: string;

  /** Rendered text content of the segment. */
  content: string;

  /** tmux colour code or colour name for the segment (e.g. `"green"`, `"colour2"`). */
  color: string;

  /** Ordering priority — lower values appear first in the status bar. */
  priority: number;
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/**
 * Top-level gmux configuration, loaded from `.gmuxrc` or `~/.gmuxrc`.
 */
export interface GmuxConfig {
  /** Default AI agent command (e.g. `"claude-code"`, `"codex"`). */
  defaultAgent?: string;

  /** tmux prefix key. Defaults to `"C-b"`. */
  prefixKey: string;

  /** Enable mouse support in tmux. */
  mouseEnabled: boolean;

  /** Status bar configuration. */
  status_bar: StatusBarConfig;

  /** Custom key bindings to register in tmux. */
  keyBindings: KeyBinding[];

  /** Lifecycle hooks that run shell commands on specific events. */
  hooks: HookConfig[];

  /** Git overlay settings. */
  gitOverlay: GitOverlayConfig;
}

/**
 * A custom tmux key binding.
 */
export interface KeyBinding {
  /** Key combination (e.g. `"C-a"`, `"M-1"`, `"Prefix + c"`). */
  key: string;

  /** Shell command or tmux command to execute when the key is pressed. */
  command: string;

  /** Human-readable description shown in help output. */
  description: string;
}

/**
 * A lifecycle hook that executes a shell command on a specific event.
 */
export interface HookConfig {
  /** The event that triggers this hook. */
  event:
    | "session-start"
    | "session-end"
    | "pane-create"
    | "pane-kill"
    | "window-create"
    | "window-kill"
    | "git-commit"
    | "git-merge";

  /** Shell command to execute when the event fires. */
  command: string;
}

/**
 * Configuration for the git overlay feature.
 */
export interface GitOverlayConfig {
  /** Enable or disable the git overlay entirely. */
  enabled: boolean;

  /** Show the branch name in the tmux status bar. */
  showBranchInStatusBar: boolean;

  /** Show `git diff --stat` summary after operations. */
  showDiffStat: boolean;

  /** How often to refresh git state, in milliseconds. */
  autoRefreshInterval: number;

  /** External diff viewer command (e.g. `"delta"`, `"diff-so-fancy"`). */
  diffViewerCommand: string;

  /** External log viewer command (e.g. `"tig"`). */
  logViewerCommand: string;
}

// ---------------------------------------------------------------------------
// Command Options Types
// ---------------------------------------------------------------------------

/**
 * Options for the `attach` command.
 */
export interface AttachOptions {
  /** Name of the session to attach to. */
  sessionName: string;

  /** If `true`, open the session in read-only mode (no agent writes). */
  readOnly?: boolean;
}

/**
 * Options for the `detach` command.
 */
export interface DetachOptions {
  /** Name of a specific session to detach from. Mutually exclusive with `all`. */
  sessionName?: string;

  /** If `true`, detach from all sessions. Mutually exclusive with `sessionName`. */
  all?: boolean;
}

/**
 * Options for the `kill` command.
 */
export interface KillOptions {
  /** Name of the session to kill. */
  sessionName?: string;

  /** tmux window identifier to kill. */
  windowId?: string;

  /** tmux pane identifier to kill. */
  paneId?: string;

  /** If `true`, force-kill without confirmation prompts. */
  force?: boolean;
}

/**
 * Options for the `log` command.
 */
export interface LogOptions {
  /** Poll every 2 s and stream new output to stdout. */
  follow?: boolean;

  /** Only show lines from captures within this duration (e.g. `"10m"`, `"1h"`). */
  since?: string;

  /** Write log to this path instead of `~/.gmux/logs/<session>.log`. */
  out?: string;
}

/**
 * Options for renaming sessions, windows, or panes.
 */
export interface RenameOptions {
  /** What to rename. */
  target: "session" | "window" | "pane";

  /** The new name to apply. */
  newName: string;

  /** Identifier of the target. If omitted, the currently focused element is renamed. */
  targetId?: string;
}

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

/**
 * Union of all events emitted by gmux subsystems.
 *
 * Use a discriminated `type` field to narrow in a switch or if-chain.
 */
export type GmuxEvent =
  | { type: "session-created"; session: GmuxSession }
  | { type: "session-ended"; sessionId: string }
  | { type: "session-attached"; sessionId: string }
  | { type: "session-detached"; sessionId: string }
  | { type: "window-created"; window: WindowInfo }
  | { type: "window-killed"; windowId: string }
  | { type: "pane-created"; pane: PaneInfo }
  | { type: "pane-killed"; paneId: string }
  | { type: "git-status-changed"; overlay: GitOverlayState }
  | { type: "git-conflict-detected"; conflicts: GitConflictFile[] };

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

/**
 * Default gmux configuration used when no `.gmuxrc` is present.
 */
export const DEFAULT_CONFIG: GmuxConfig = {
  prefixKey: "C-b",
  mouseEnabled: true,
  status_bar: {
    showGitOverlay: true,
    showSessionInfo: true,
    showPaneInfo: true,
    showClock: true,
    refreshInterval: 5_000,
    format: "{{session}} | {{branch}} {{status}} | {{pane}} | {{clock}}",
  },
  keyBindings: [],
  hooks: [],
  gitOverlay: {
    enabled: true,
    showBranchInStatusBar: true,
    showDiffStat: true,
    autoRefreshInterval: 10_000,
    diffViewerCommand: "delta",
    logViewerCommand: "tig",
  },
};
