# Configuration

gmux can be configured via a JSON config file at `~/.gmux/config.json`.

## Default Configuration

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
  "keyBindings": [],
  "hooks": [],
  "gitOverlay": {
    "enabled": true,
    "showBranchInStatusBar": true,
    "showDiffStat": true,
    "autoRefreshInterval": 10000,
    "diffViewerCommand": "delta",
    "logViewerCommand": "tig"
  }
}
```

## Options

### General

| Option | Type | Default | Description |
|---|---|---|---|
| `defaultAgent` | `string` | — | Default AI agent command (e.g., `"claude-code"`, `"codex"`) |
| `prefixKey` | `string` | `"C-b"` | tmux prefix key |
| `mouseEnabled` | `boolean` | `true` | Enable mouse support in tmux |

### Status Bar

| Option | Type | Default | Description |
|---|---|---|---|
| `status_bar.showGitOverlay` | `boolean` | `true` | Show git overlay segment |
| `status_bar.showSessionInfo` | `boolean` | `true` | Show session name and count |
| `status_bar.showPaneInfo` | `boolean` | `true` | Show pane dimensions |
| `status_bar.showClock` | `boolean` | `true` | Show clock |
| `status_bar.refreshInterval` | `number` | `5000` | Refresh interval in milliseconds |
| `status_bar.format` | `string` | — | Format string with placeholders |

### Status Bar Placeholders

| Placeholder | Description |
|---|---|
| `{{session}}` | Current session name |
| `{{branch}}` | Current git branch |
| `{{status}}` | Session status |
| `{{pane}}` | Pane info (width×height command) |
| `{{clock}}` | Current time (HH:MM) |
| `{{ahead}}` | Commits ahead of upstream |
| `{{behind}}` | Commits behind upstream |

### Git Overlay

| Option | Type | Default | Description |
|---|---|---|---|
| `gitOverlay.enabled` | `boolean` | `true` | Enable git overlay |
| `gitOverlay.showBranchInStatusBar` | `boolean` | `true` | Show branch in status bar |
| `gitOverlay.showDiffStat` | `boolean` | `true` | Show diff stat after operations |
| `gitOverlay.autoRefreshInterval` | `number` | `10000` | Git refresh interval (ms) |
| `gitOverlay.diffViewerCommand` | `string` | `"delta"` | External diff viewer |
| `gitOverlay.logViewerCommand` | `string` | `"tig"` | External log viewer |

### Key Bindings

```json
{
  "keyBindings": [
    {
      "key": "r",
      "command": "refresh-client",
      "description": "Refresh tmux"
    },
    {
      "key": "g",
      "command": "popup gmux git status",
      "description": "Git status popup"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Key combination (e.g., `"C-a"`, `"M-1"`, `"r"`) |
| `command` | `string` | tmux command or shell command to execute |
| `description` | `string` | Human-readable description |

### Hooks

```json
{
  "hooks": [
    {
      "event": "session-start",
      "command": "echo 'Session ${SESSION_NAME} started in ${WORKTREE_PATH}'"
    },
    {
      "event": "git-commit",
      "command": "echo 'New commit in ${WORKTREE_PATH}'"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `event` | `string` | Event that triggers the hook |
| `command` | `string` | Shell command to execute |

#### Hook Events

| Event | Description |
|---|---|
| `session-start` | A session was created |
| `session-end` | A session ended |
| `pane-create` | A pane was split |
| `pane-kill` | A pane was killed |
| `window-create` | A window was created |
| `window-kill` | A window was killed |
| `git-commit` | A commit was created |
| `git-merge` | A merge completed |

#### Hook Context Variables

| Variable | Description |
|---|---|
| `${SESSION_NAME}` | Current session name |
| `${WORKTREE_PATH}` | Worktree path |
| `${BRANCH_NAME}` | Git branch name |
| `${PANE_ID}` | tmux pane ID |
| `${WINDOW_ID}` | tmux window ID |

## Agent Configuration

Set a default agent in `.gmuxrc` (checked in `cwd` → repo root → `~/.gmuxrc`):

```json
{ "agent": "claude-code" }
```

Use `{prompt}` placeholder if the agent expects the prompt elsewhere:

```json
{ "agent": "aider --message {prompt}" }
```

## Provisioning Configuration

### .gmuxignore

Files listed in `.gmuxignore` are skipped during provisioning (gitignore syntax):

```
*.log
tmp/
.env.local
```

### .gmux/provision.sh

A shell script that runs after provisioning. Receives the worktree path as `$1`:

```bash
#!/bin/bash
WORKTREE_PATH="$1"
echo "Provisioning $WORKTREE_PATH"
# Custom setup commands here
```

## Example Configurations

### Minimal

```json
{
  "defaultAgent": "claude-code"
}
```

### Full-Featured

```json
{
  "prefixKey": "C-a",
  "mouseEnabled": true,
  "defaultAgent": "claude-code",
  "status_bar": {
    "showGitOverlay": true,
    "showSessionInfo": true,
    "showPaneInfo": true,
    "showClock": true,
    "refreshInterval": 3000,
    "format": "#[fg=white,bg=blue] #S #[fg=white,bg=green] {{branch}} {{ahead}} {{behind}} #[fg=white,bg=black] {{pane}} #[fg=white,bg=yellow] {{clock}} "
  },
  "keyBindings": [
    { "key": "r", "command": "refresh-client", "description": "Refresh" },
    { "key": "g", "command": "popup gmux git status", "description": "Git status" },
    { "key": "d", "command": "detach", "description": "Detach" },
    { "key": "s", "command": "list-sessions", "description": "Sessions" },
    { "key": "w", "command": "list-windows", "description": "Windows" }
  ],
  "hooks": [
    { "event": "session-start", "command": "echo '[gmux] Session ${SESSION_NAME} started'" },
    { "event": "session-end", "command": "echo '[gmux] Session ${SESSION_NAME} ended'" }
  ],
  "gitOverlay": {
    "enabled": true,
    "showBranchInStatusBar": true,
    "showDiffStat": true,
    "autoRefreshInterval": 5000,
    "diffViewerCommand": "delta",
    "logViewerCommand": "tig"
  }
}
```

### Multi-Agent with Panes

```sh
# Start 4 Claude Code agents in tiled panes
gmux my-feature "Build a game" -A claude-code -a 4 -p

# Start 2 aider agents in separate windows
gmux my-feature "Refactor auth" -A aider -a 2
```
