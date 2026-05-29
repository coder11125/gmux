# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build self-contained binary to dist/gmux
bun run build

# Run from source
bun run start

# Type-check (no emit)
npx tsc --noEmit

# Run all tests
bun test

# Run a single test file
bun test src/__tests__/index.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "list sessions"
```

## Architecture

**gmux** is a CLI tool that spawns AI agents (claude-code, codex, aider, etc.) in isolated git worktrees paired with tmux windows. Built with Bun + TypeScript; the CLI layer uses Commander.js.

### Session lifecycle (happy path)

1. `GitWorktreeManager` creates a branch `gmux-<session>` and a worktree at `../worktrees/gmux-<session>` (sibling of the repo root).
2. `ConfigProvisioner` copies config files (`.env`, editor configs, etc.) into the new worktree.
3. `TmuxManager` creates a tmux window (or split panes via `createWindowWithPanes`) targeting that worktree path.
4. `AgentExecutor` dispatches the prompt via `tmux send-keys`, resolving the agent command from `.gmuxrc` → repo root `.gmuxrc` → `~/.gmuxrc`.
5. `ProcessMonitor` polls every 2 s, walking the process tree from the tmux pane PID to detect when the agent process exits.
6. `TeardownManager` fires on idle: prompts to merge the branch into the current branch (or auto-merges with `--auto-merge`), removes the worktree, and kills the tmux window.
7. `SessionStore` persists `SessionRecord` objects to `~/.gmux/sessions.json` under a PID-based file lock (`~/.gmux/sessions.json.lock`).

### Key source files

| File | Role |
|------|------|
| `src/index.ts` | CLI entry point; wires all components together |
| `src/types.ts` | Single source of truth for all shared types and `DEFAULT_CONFIG` |
| `src/session-store.ts` | Atomic read-modify-write store backed by `~/.gmux/sessions.json` |
| `src/agent-executor.ts` | Resolves agent from `.gmuxrc`, shell-quotes prompt, calls `tmux send-keys` |
| `src/git-worktree-manager.ts` | `git worktree add/remove/prune` wrapper |
| `src/process-monitor.ts` | Interval-based process-tree walker; fires `onIdle` callback |
| `src/teardown-manager.ts` | Merge prompt, worktree cleanup, tmux window kill |
| `src/tmux-manager.ts` | Window/pane creation helpers |
| `src/config-provisioner.ts` | Copies config files into new worktrees; handles `**` glob patterns |
| `src/commands/` | Subcommand implementations (`list`, `doctor`, `git`, `pane`, `window`, etc.) |
| `src/__tests__/` | Bun test suites; integration tests invoke the real CLI via `Bun.spawnSync` |

### Agent resolution

Agent command is read from the first `.gmuxrc` JSON file found at: `cwd/.gmuxrc` → `<repo-root>/.gmuxrc` → `~/.gmuxrc`. Minimum config: `{ "agent": "claude-code" }`. Can also be overridden per invocation with `-A <agent>`.

### Tmux conventions

- Window IDs use the `@N` format; pane IDs use `%N`.
- `tmux display-message` (not `list-windows`) is used for per-window/pane queries to avoid scoping issues.
- Commands with multiple tokens are passed as arrays to Bun's `$` tagged template to avoid shell-quoting bugs.

### Persistence

`SessionStore` uses `O_CREAT | O_EXCL` file locking. The entire load → mutate → flush cycle runs inside `withLock()`. Writes go to a `.tmp` file then `rename()` for atomicity.
