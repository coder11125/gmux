# Tmux Features in gmux

gmux wraps tmux to provide isolated AI agent sessions. This document covers all tmux-like features available in gmux.

## Session Management

### Attach to a Session

```sh
gmux attach <session-name>          # attach to a session
gmux attach <session-name> -r       # attach in read-only mode
```

When inside tmux, uses `tmux switch-client`. When outside tmux, uses `tmux attach-session`.

### Detach from a Session

```sh
gmux detach                         # detach from current session
gmux detach --all                   # detach from all sessions
```

### Kill a Session

```sh
gmux kill --session <name>          # kill a session (with confirmation)
gmux kill --session <name> --force  # kill without confirmation
gmux kill --window <id>             # kill a specific window
gmux kill --pane <id>               # kill a specific pane
```

Full session kill cascades: kills panes → kills window → removes git worktree → prunes worktree → removes from store.

### Rename

```sh
gmux rename session <new-name>      # rename the current session
gmux rename window <new-name>       # rename the current window
```

## Window Management

### List Windows

```sh
gmux window list                    # list all windows with layout info
```

### Create a Window

```sh
gmux window create <name>           # create a new window
```

### Kill a Window

```sh
gmux window kill <window-id>        # kill a window
gmux window kill <window-id> --force # force kill
```

### Rename a Window

```sh
gmux window rename <window-id> <new-name>
```

### Swap Windows

```sh
gmux window swap <source-id> <target-id>
```

### Select a Window

```sh
gmux window select <window-id>      # focus a specific window
```

### Cycle Windows

```sh
gmux window next                    # move to next window
gmux window prev                    # move to previous window
```

### Set Layout

```sh
gmux window layout tiled            # arrange panes in a grid
gmux window layout even-horizontal  # equal-width columns
gmux window layout even-vertical    # equal-height rows
gmux window layout main-horizontal  # one main pane on top
gmux window layout main-vertical    # one main pane on left
```

## Pane Management

### Split a Pane

```sh
gmux pane split -d horizontal       # split side-by-side
gmux pane split -d vertical         # split top-bottom
```

### Kill a Pane

```sh
gmux pane kill <pane-id>
```

### Resize a Pane

```sh
gmux pane resize up 5               # grow 5 cells upward
gmux pane resize down 3             # shrink 3 cells downward
gmux pane resize left 10            # grow 10 cells left
gmux pane resize right 10           # grow 10 cells right
```

### Zoom a Pane

```sh
gmux pane zoom                      # toggle fullscreen on current pane
```

### Select a Pane

```sh
gmux pane select <pane-id>          # focus a specific pane
```

### Cycle Panes

```sh
gmux pane next                      # move to next pane
gmux pane prev                      # move to previous pane
```

### Break Pane to Window

```sh
gmux pane break <pane-id>           # convert pane into its own window
```

### Join Panes

```sh
gmux pane join <source-pane-id> <target-window-id> left
gmux pane join <source-pane-id> <target-window-id> right
gmux pane join <source-pane-id> <target-window-id> top
gmux pane join <source-pane-id> <target-window-id> bottom
```

## Copy Mode

Use tmux's built-in copy mode within any gmux pane:

1. Press `Ctrl+b [` to enter copy mode
2. Use arrow keys or vim keys to navigate
3. Press `Space` to start selection
4. Press `Enter` to copy selection
5. Press `Ctrl+b ]` to paste

## Mouse Support

Mouse support is enabled by default. Features:

- **Click** to select panes
- **Drag** borders to resize
- **Scroll wheel** to scroll through pane history
- **Click window names** to switch windows

To disable mouse support, set `mouseEnabled: false` in `~/.gmux/config.json`.

## Key Bindings

Default key bindings (prefix: `Ctrl+b`):

| Key | Command | Description |
|---|---|---|
| `r` | `refresh-client` | Refresh tmux |
| `g` | `popup gmux git status` | Git status popup |
| `d` | `detach` | Detach session |
| `s` | `list-sessions` | Session list |
| `w` | `list-windows` | Window list |
| `p` | `list-panes` | Pane list |

Customize bindings in `~/.gmux/config.json`:

```json
{
  "keyBindings": [
    { "key": "C-a", "command": "source-file ~/.tmux.conf", "description": "Reload config" }
  ]
}
```

## Pane Synchronization

To type in all panes simultaneously (useful for running the same command on multiple servers):

```sh
tmux setw synchronize-panes on      # enable
tmux setw synchronize-panes off     # disable
```

Or bind it to a key:

```sh
tmux bind-key S setw synchronize-panes
```
