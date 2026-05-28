# gmux – tmux + git worktrees for better simultaneous ai agents

Launch AI agent coding sessions in isolated git worktrees with live tmux monitoring.

```
gmux my-feature "Build a CLI game" -A pi         # single pi agent
gmux my-feature "Refactor auth" -A aider -a 4    # 4 aider agents, 4 windows
gmux my-feature "Add tests" -A claude-code -a 4 -p  # 4 claude-code agents, 1 window split 4 ways
gmux list                                         # show tracked sessions
gmux doctor                                       # repair stale state
```

## How it works

1. `git worktree add -b gmux-<name>` — creates an isolated branch + worktree per agent so no two agents can clobber each other
2. `ConfigProvisioner` — copies `.env`, lockfiles, runs `bun install` and `.gmux/provision.sh`
3. `tmux new-window` — opens a new tmux window (or `split-window` with `-p`) with the worktree as its working directory
4. `tmux send-keys` — dispatches the agent command (`pi`, `aider`, `claude-code`, etc.) into the pane
5. `SessionStore` — persists state to `~/.gmux/sessions.json`
6. `ProcessMonitor` — polls every 2s and renders a live `[● session]` status bar; when a session finishes, runs teardown (merge prompt, worktree removal, window kill)

## Install

```sh
git clone https://github.com/coder11125/gmux
cd gmux
bun install
bun run build    # produces ./dist/gmux
```

Or link globally:

```sh
bun link
gmux my-session "Fix the bug"
```

## Usage

```
Usage: gmux [options] [command] <session-name> <agent-prompt>

Arguments:
  session-name           name of the agent session
  agent-prompt           prompt to send to the agent

Options:
  -V, --version          output the version number
  -A, --agent <name>     agent command (overrides .gmuxrc)
  -a, --agents <number>  number of agent instances (default: 1)
  -p, --panes            show all agents in split panes (one window)
  --auto-merge           skip merge prompt and auto-merge branches
  -h, --help             display help for command

Commands:
  list [options]         List all tracked sessions
  doctor [options]       Check session state against reality
```

### Subcommands

| Command | Description |
|---|---|
| `list` | Table of tracked sessions. `--json` for raw output, `--verbose` for agent/pane/started columns. |
| `doctor` | Cross-references JSON state against reality. Detects orphaned JSON entries, missing tmux panes, missing worktree dirs, and missing branches. Interactive repair prompt. `--json` outputs issues as JSON. |

### Agent selection

Set the agent via `-A`:

```sh
gmux my-session "Build a game" -A pi
gmux my-session "Build a game" -A aider
gmux my-session "Build a game" -A claude-code
```

Or set a default in `.gmuxrc` (checked in `cwd` → repo root → `~/.gmuxrc`):

```json
{ "agent": "aider --message" }
```

### Multiple agents

```sh
gmux my-session "Build a game" -a 4              # 4 agents, 4 tmux windows
gmux my-session "Build a game" -a 4 -p           # 4 agents, 1 window with 4 panes
```

Each agent gets its own unique branch (`gmux-my-session-a3f8c21a`) and worktree, zero file contention.

### Provisioning

Files listed in `.gmuxignore` are skipped. These are always copied regardless:

`.env`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`

If `package.json` is detected in the worktree, `bun install` runs automatically.

A user-defined hook at `.gmux/provision.sh` (in the source repo) runs after all copies, receiving the worktree path as `$1`.

### Cleanup

When a session finishes:
1. Prompts to merge `gmux-<name>` into the current branch
2. Removes the worktree via `git worktree remove`
3. Prunes stale worktree metadata
4. Kills the tmux window

Pass `--auto-merge` to skip the prompt and merge automatically.

## License

MIT
