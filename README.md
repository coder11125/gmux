# gmux – tmux + git worktrees for better simultaneous ai agents

Launch AI agent coding sessions in isolated git worktrees with live tmux monitoring and a full git overlay.

```
gmux my-feature "Build a CLI game" -A codex       # single OpenAI Codex agent
gmux my-feature "Build a CLI game" -A pi          # single pi agent
gmux my-feature "Refactor auth" -A aider -a 4     # 4 aider agents, 4 windows
gmux my-feature "Add tests" -A claude-code -a 4 -p   # 4 claude-code agents, 1 window split 4 ways
gmux list                                          # show tracked sessions
gmux doctor                                        # repair stale state
gmux attach my-feature                             # attach to a running session
gmux diff my-feature                               # show everything the agent changed vs base branch
gmux diff my-feature --stat                        # file-level summary only
gmux git status                                    # show git status for active worktree
gmux git diff                                      # show diff in a tmux pane
```

## Features

### Tmux Integration
- **Session management** — attach, detach, kill, rename sessions
- **Window management** — create, kill, rename, swap, cycle, and set layouts
- **Pane management** — split, resize, zoom, join, break panes into windows
- **Copy mode** — use tmux copy mode (`Ctrl+b [`) for scrolling and text selection
- **Mouse support** — click, drag, scroll, and resize panes with mouse
- **Key bindings** — customizable prefix key and command bindings
- **Status bar** — live session info, git branch, pane dimensions, and clock
- **Pane synchronization** — type in multiple panes simultaneously

### Git Overlay
- **Branch display** — see the current git branch for each worktree in the status bar
- **Diff viewer** — view diffs inline in a tmux pane
- **Log viewer** — browse commit history with `--graph` and `--oneline`
- **Blame** — see who last modified each line of a file
- **Stash management** — push, pop, list, and drop stashes
- **Conflict detection** — auto-detect merge conflicts and display them with ours/theirs markers
- **Conflict resolution** — resolve conflicts with `--ours`, `--theirs`, or `--both`
- **Ahead/behind indicators** — see how many commits you're ahead or behind upstream
- **File status counts** — staged, unstaged, and untracked file counts at a glance

## How it works

1. `git worktree add -b gmux-<name>` — creates an isolated branch + worktree per agent so no two agents can clobber each other
2. `ConfigProvisioner` — copies `.env`, lockfiles, runs `bun install` and `.gmux/provision.sh`
3. `tmux new-window` — opens a new tmux window (or `split-window` with `-p`) with the worktree as its working directory
4. `tmux send-keys` — dispatches the agent command (`pi`, `aider`, `claude-code`, etc.) into the pane
5. `SessionStore` — persists state to `~/.gmux/sessions.json`
6. `ProcessMonitor` — spawns one `gmux-monitor` (Go) process per session; it polls the pane's process tree every 500 ms and writes `idle` to stdout when the agent exits. Falls back to TypeScript polling at 2 s if the binary is not found. Renders a live `[● session]` status bar; teardown fires on idle (merge prompt, worktree removal, window kill).

Any agent that accepts a prompt on the command line works out of the box — **OpenAI Codex**, **pi**, **aider**, **Claude Code**, and more.

## Install

**Prerequisites:** [Bun](https://bun.sh) and [Go](https://go.dev) (≥ 1.21)

```sh
git clone https://github.com/coder11125/gmux
cd gmux
bun install
bun run build    # compiles dist/gmux-monitor (Go) then dist/gmux (Bun)
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
  attach <session>       Attach to a running session
  detach                 Detach from the current session
  kill <target>          Kill a session, window, or pane
  rename <target> <name> Rename a session, window, or pane
  window <action>        Manage tmux windows
  pane <action>          Manage tmux panes
  git <action>           Git overlay commands
  scripts [name]         Run or list bundled management scripts
  completion <shell>     Print shell completion script (bash or zsh)
```

### Subcommands

| Command | Description |
|---|---|
| `list` | Table of tracked sessions. `--json` for raw output, `--verbose` for agent/pane/started columns. |
| `doctor` | Cross-references JSON state against reality. Detects orphaned JSON entries, missing tmux panes, missing worktree dirs, and missing branches. Interactive repair prompt. `--json` outputs issues as JSON. |
| `attach <session>` | Attach to a running session. Use `-r` for read-only mode. |
| `detach` | Detach from the current session. Use `--all` to detach from all sessions. |
| `kill --session <name>` | Kill a session and clean up its worktree. Use `--force` to skip confirmation. |
| `kill --window <id>` | Kill a specific tmux window. |
| `kill --pane <id>` | Kill a specific tmux pane. |
| `rename session <name>` | Rename a tmux session. |
| `rename window <name>` | Rename a tmux window. |
| `window list` | List all windows in the current session. |
| `window create <name>` | Create a new tmux window. |
| `window swap <src> <dst>` | Swap two windows. |
| `window layout <type>` | Set layout: `even-horizontal`, `even-vertical`, `tiled`, `main-horizontal`, `main-vertical`. |
| `pane split -d horizontal` | Split the current pane horizontally. |
| `pane split -d vertical` | Split the current pane vertically. |
| `pane resize <dir> <amount>` | Resize a pane by `up`/`down`/`left`/`right`. |
| `pane zoom` | Toggle zoom on the current pane. |
| `pane break` | Convert a pane into its own window. |
| `pane join <src> <dst> <dir>` | Join a pane into another window. |
| `diff <session> [options]` | Show everything the agent changed in its worktree vs the base branch. `--stat` for summary, `--staged` for staged only, `--base <branch>` to override auto-detected base, `--path <path>` to restrict, `--no-pager` for raw stdout. |
| `git status` | Show git status for the active worktree. |
| `git diff` | Show diff in a tmux pane. |
| `git log` | Show commit log in a tmux pane. |
| `git blame <file>` | Show blame for a file in a tmux pane. |
| `git stash list` | List all stashes. |
| `git stash push [-m msg]` | Create a stash. |
| `git stash pop [index]` | Apply and remove a stash. |
| `git commit -m <msg>` | Create a commit in the active worktree. |
| `git branch <name>` | Create and switch to a new branch. |
| `git merge <branch>` | Merge a branch into the current branch. |
| `completion <bash\|zsh>` | Print the shell completion script to stdout. Pipe to a file or source directly. |

### Agent selection

Set the agent via `-A`:

```sh
gmux my-session "Build a game" -A codex       # OpenAI Codex
gmux my-session "Build a game" -A pi           # pi
gmux my-session "Build a game" -A aider        # aider
gmux my-session "Build a game" -A claude-code  # Claude Code
```

Any command that accepts a prompt as an argument works. Use `{prompt}` in `.gmuxrc` if the agent expects the prompt elsewhere (e.g., via flag).

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

## Configuration

gmux can be configured via `~/.gmux/config.json`:

```json
{
  "prefixKey": "C-b",
  "mouseEnabled": true,
  "status_bar": {
    "showGitOverlay": true,
    "showSessionInfo": true,
    "showPaneInfo": true,
    "showClock": true,
    "refreshInterval": 5000,
    "format": "{{session}} | {{branch}} {{status}} | {{pane}} | {{clock}}"
  },
  "gitOverlay": {
    "enabled": true,
    "showBranchInStatusBar": true,
    "showDiffStat": true,
    "autoRefreshInterval": 10000,
    "diffViewerCommand": "delta",
    "logViewerCommand": "tig"
  },
  "keyBindings": [
    { "key": "r", "command": "refresh-client", "description": "Refresh tmux" },
    { "key": "g", "command": "popup gmux git status", "description": "Git status popup" },
    { "key": "d", "command": "detach", "description": "Detach session" }
  ],
  "hooks": [
    { "event": "session-start", "command": "echo 'Session ${SESSION_NAME} started'" },
    { "event": "git-commit", "command": "echo 'Commit in ${WORKTREE_PATH}'" }
  ]
}
```

### Hook Events

| Event | Description |
|---|---|
| `session-start` | Fires when a session is created |
| `session-end` | Fires when a session ends |
| `pane-create` | Fires when a pane is split |
| `pane-kill` | Fires when a pane is killed |
| `window-create` | Fires when a window is created |
| `window-kill` | Fires when a window is killed |
| `git-commit` | Fires after a commit is created |
| `git-merge` | Fires after a merge completes |

### Hook Context Variables

- `${SESSION_NAME}` — current session name
- `${WORKTREE_PATH}` — worktree path
- `${BRANCH_NAME}` — git branch name
- `${PANE_ID}` — tmux pane ID
- `${WINDOW_ID}` — tmux window ID

## Scripts

gmux includes bundled scripts for session management, git automation, monitoring, and utilities. Monitoring scripts are written in Python for superior logging and integration capabilities; others are Ruby.

### Running Scripts

```sh
gmux scripts --list                    # list all available scripts
gmux scripts <script-name> [options]   # run a script
```

### Session Management

| Script | Description |
|---|---|
| `cleanup` | Remove stale sessions/worktrees older than N days |
| `health` | Check session health and repair issues |
| `export` | Export session configuration (JSON/YAML/TOML) |
| `stats` | Show session usage statistics |

```sh
gmux scripts cleanup --max-days 7 --dry-run
gmux scripts health --repair --verbose
gmux scripts export --all --format json --output sessions.json
gmux scripts stats --json
```

### Git Automation

| Script | Description |
|---|---|
| `auto-commit` | Auto-commit changes with smart messages |
| `branch-cleanup` | Delete merged branches automatically |
| `conflict-helper` | Interactive conflict resolution |
| `pr-ready` | Prepare branch for PR (test, lint, push) |

```sh
gmux scripts auto-commit --all --conventional
gmux scripts branch-cleanup --merged-only --dry-run
gmux scripts conflict-helper --auto-resolve ours
gmux scripts pr-ready --skip-tests --force
```

### Monitoring

Monitoring scripts are implemented in **Python** for better logging, HTTP/webhook support, and external service integrations.

| Script | Description |
|---|---|
| `watcher` | Monitor agent output for errors (error pattern detection, logging) |
| `notifier` | Send notifications on session events (webhook, Slack, Discord, Telegram, email, sound) |
| `logger` | Capture tmux pane output to files (with rotation and compression) |

```sh
gmux scripts watcher --interval 5 --tail
gmux scripts notifier --webhook https://hooks.example.com/... --sound
gmux scripts logger --rotate --compress
```

### Utility

| Script | Description |
|---|---|
| `backup` | Backup sessions and config files |
| `restore` | Restore from backup |
| `diagnostics` | System health check |

```sh
gmux scripts backup --compress --keep-count 10
gmux scripts restore --list
gmux scripts diagnostics --verbose
```

### Script Options

Common options for all scripts:

| Option | Description |
|---|---|
| `--dry-run` | Show what would be done without doing it |
| `--verbose` | Show detailed output |
| `--force` | Skip confirmation prompts |
| `--json` | Output as JSON |

## License

MIT
