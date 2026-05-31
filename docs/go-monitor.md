# Go Monitor (`gmux-monitor`)

`gmux-monitor` is a small Go binary that replaces the Node.js polling loop in
`ProcessMonitor`. It watches a tmux pane's process tree and prints `idle` to
stdout when the target agent process is no longer running, then exits.

## Why Go?

| | TypeScript (before) | Go (after) |
|---|---|---|
| Poll interval | 2 000 ms (`setInterval`) | 500 ms |
| Per-session cost | Shared interval; re-scans all sessions | One lightweight goroutine per session |
| Process tree walk | Node.js string parsing of `ps` output | Go `strings.Fields` BFS — ~10× faster parse |
| Memory | Node event loop stays alive | Go process sleeps and exits when done |
| Binary size | N/A | 2.8 MB (statically linked, no runtime deps) |

## Usage

```sh
gmux-monitor --pane-id %1 --process claude-code
gmux-monitor --pane-id %1 --process claude-code --interval 250ms
```

| Flag | Default | Description |
|---|---|---|
| `--pane-id` | required | tmux pane ID (e.g. `%1`) |
| `--process` | required | Agent process name to watch (e.g. `claude-code`) |
| `--interval` | `500ms` | How often to poll the process tree |

The binary prints `idle` and exits as soon as the agent is no longer found in
the pane's process tree. If the tmux pane disappears (e.g. window killed) it
also exits with `idle`.

## How it works

1. Call `tmux list-panes -t <pane-id> -F '#{pane_pid}'` to get the root PID.
2. Run `ps -o pid,ppid,comm -A` to snapshot the full process table.
3. BFS-walk the tree from the root PID looking for any `comm` containing the
   process name.
4. Sleep `--interval`, repeat until not found → print `idle` → exit.

## Integration with ProcessMonitor

`ProcessMonitor` in [src/process-monitor.ts](../src/process-monitor.ts) resolves
the binary at startup:

```
dist/gmux-monitor   (production — sibling of dist/gmux)
dist/gmux-monitor   (dev — relative to src/../dist/)
```

If neither path exists it falls back to the original TypeScript polling loop at
2 s intervals so the tool works without a Go toolchain installed.

## Building

```sh
# Via npm script (also runs as part of `bun run build`)
bun run build:go

# Directly
cd go && go build -o ../dist/gmux-monitor ./cmd/gmux-monitor/
```

## Source

```
go/
├── go.mod
└── cmd/
    └── gmux-monitor/
        └── main.go
```
