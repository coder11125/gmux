# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build all binaries: dist/gmux-monitor (Go) + dist/gmux-update (Go) + dist/gmux (Bun)
bun run build

# Build only the Go binaries
bun run build:go   # builds both gmux-monitor and gmux-update into dist/
#   cd go && go build -ldflags="-X main.version=..." -o ../dist/gmux-update ./cmd/gmux-update/ && go build -o ../dist/gmux-monitor ./cmd/gmux-monitor/

# Run from source (uses TypeScript polling fallback — no Go binary needed)
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
5. `ProcessMonitor` spawns one `gmux-monitor` (Go) process per session; it polls every 500 ms and prints `idle` when the agent exits. Falls back to TypeScript polling at 2 s if the binary is absent.
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
| `src/process-monitor.ts` | Spawns `gmux-monitor` (Go) per session to watch process tree; fires `onIdle` when idle; falls back to 2 s TypeScript polling |
| `src/commands/update.ts` | `gmux update` CLI command; resolves and spawns the Go updater binary |
| `go/cmd/gmux-update/main.go` | Go binary: fetches latest GitHub release, verifies SHA256 checksum, atomically swaps gmux + gmux-monitor |
| `go/cmd/gmux-monitor/main.go` | Go binary: polls pane process tree at 500 ms, prints `idle` and exits when agent is gone |
| `src/teardown-manager.ts` | Merge prompt, worktree cleanup, tmux window kill |
| `src/tmux-manager.ts` | Window/pane creation helpers |
| `src/config-provisioner.ts` | Copies config files into new worktrees; handles `**` glob patterns |
| `src/config.ts` | `ConfigManager`: loads/saves/validates `~/.gmux/config.json`; manages status-bar, git-overlay, hooks, and key-binding settings |
| `src/git-overlay.ts` | `GitOverlay`: reads branch name, dirty flag, ahead/behind, diff, log, and blame from a worktree path |
| `src/hooks.ts` | `HookManager`: fires user-defined shell commands on gmux lifecycle events (session create, pane kill, git ops, etc.) |
| `src/key-bindings.ts` | `KeyBindingManager`: applies custom tmux key bindings from config; exports bindings in `tmux.conf` syntax |
| `src/status-bar.ts` | Renders git overlay + session info into the tmux status line |
| `src/scripts.ts` | Backs `gmux scripts`: discovers and runs bundled management scripts (Python for session, monitoring, and utility; Ruby for git only) |
| `src/completion.ts` | Generates embedded bash/zsh completion scripts returned by `gmux completion <shell>` |
| `src/shell.ts` | Re-exports Bun's `$` from a named module so tests can intercept it via `mock.module` |
| `src/commands/` | Subcommand implementations: `list`, `doctor`, `git`, `pane`, `window`, `attach`, `detach`, `kill`, `rename` |
| `src/__tests__/` | Bun test suites; integration tests invoke the real CLI via `Bun.spawnSync` |

### CLI subcommands

| Subcommand | Description |
|------------|-------------|
| `gmux <session> <prompt> [-A agent] [-a N] [-p]` | Launch N agent instances; `-p` uses split panes instead of separate windows |
| `gmux list [--json] [--verbose]` | List tracked sessions |
| `gmux doctor [--json] [--verbose]` | Check and repair session state |
| `gmux attach <session>` | Attach tmux client to an existing session |
| `gmux detach [session]` | Detach the current tmux client |
| `gmux kill <session>` | Kill session, remove worktree, and close tmux window |
| `gmux rename <session> <new-name>` | Rename a tracked session |
| `gmux diff <session> [--stat] [--staged] [--base <branch>] [--path <path>] [--no-pager]` | Show all agent changes vs base branch (committed + uncommitted) |
| `gmux update [--force] [--dry-run] [--version <tag>]` | Update gmux to the latest (or specific) version from GitHub |
| `gmux git <subcommand>` | Git overlay: `status`, `diff`, `log`, `blame`, `stash`, `conflict` |
| `gmux pane <subcommand>` | Pane management: split, focus, resize, convert |
| `gmux window <subcommand>` | Window management: create, focus, move, list |
| `gmux scripts [name] [--list]` | Run or list bundled management scripts |
| `gmux completion <bash\|zsh>` | Print shell completion script to stdout |

### Agent resolution

Agent command is read from the first `.gmuxrc` JSON file found at: `cwd/.gmuxrc` → `<repo-root>/.gmuxrc` → `~/.gmuxrc`. Minimum config: `{ "agent": "claude-code" }`. Can also be overridden per invocation with `-A <agent>`.

### Tmux conventions

- Window IDs use the `@N` format; pane IDs use `%N`.
- `tmux display-message` (not `list-windows`) is used for per-window/pane queries to avoid scoping issues.
- Commands with multiple tokens are passed as arrays to Bun's `$` tagged template to avoid shell-quoting bugs.

### Script language split

Bundled management scripts live under `scripts/` and use different runtimes by category:

| Category | Runtime | Scripts |
|----------|---------|--------|
| Session | Python | `cleanup`, `health`, `export`, `stats` |
| Monitoring | Python | `watcher`, `notifier`, `logger` |
| Utility | Python | `backup`, `restore`, `diagnostics` |
| Git | Ruby | `auto-commit`, `branch-cleanup`, `conflict-helper`, `pr-ready` |

The runtime is resolved in `src/scripts.ts` based on `script.category`. Only git scripts remain in Ruby; all others have been migrated to Python for better stdlib support (`shutil`, `tarfile`, `platform`, `pathlib`).

### Persistence

`SessionStore` uses `O_CREAT | O_EXCL` file locking. The entire load → mutate → flush cycle runs inside `withLock()`. Writes go to a `.tmp` file then `rename()` for atomicity.
