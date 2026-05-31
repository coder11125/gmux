# Git Overlay in gmux

The git overlay provides real-time git status information integrated into tmux panes and the status bar. Each gmux session runs in an isolated git worktree, and the git overlay shows the state of that worktree.

## Status Bar Integration

The tmux status bar automatically shows:

- **Branch name** — current git branch for the active worktree
- **Ahead/behind** — `▲2` (2 ahead), `▼1` (1 behind)
- **File counts** — `●3` (3 staged), `○2` (2 unstaged), `?1` (1 untracked)
- **Session info** — active session count and names
- **Pane info** — current pane dimensions
- **Clock** — current time

Example status bar: `[2] my-session | main ▲2 ▼1 ●3 ○2 ?1 | 120×40 bash | 14:30`

## Session Diff

`gmux diff <session>` shows everything an agent has changed since the worktree was created — both committed and uncommitted work — compared to the base branch (auto-detected as `main`, `master`, `origin/main`, or `origin/master`).

```sh
gmux diff my-session                      # full diff in less pager
gmux diff my-session --stat               # file-level summary (lines added/removed)
gmux diff my-session --staged             # staged (cached) changes only
gmux diff my-session --base develop       # compare against a custom base branch
gmux diff my-session --path src/api.ts    # restrict to a single file or directory
gmux diff my-session --no-pager           # print raw diff to stdout (pipe-friendly)
```

The command uses `git merge-base HEAD <base>` to find the exact point the branch diverged, so the output faithfully reflects only the agent's work — not unrelated upstream commits.

**Pipe-friendly examples:**

```sh
gmux diff my-session --no-pager | grep "^+"         # added lines only
gmux diff my-session --no-pager | wc -l              # rough line count
gmux diff my-session --stat --no-pager | tail -1     # summary line
```

## Git Commands in tmux

### Show Git Status

```sh
gmux git status                    # full git status output
gmux git status --porcelain        # machine-readable status
gmux git status --short            # condensed status
```

### Show Diff in a Pane

```sh
gmux git diff                      # show unstaged diff in a tmux pane
gmux git diff --staged             # show staged diff
gmux git diff --stat               # show diff stat only
gmux git diff --path src/          # diff a specific path
```

### Show Log in a Pane

```sh
gmux git log                       # show recent commits in a tmux pane
gmux git log --oneline             # compact one-line format
gmux git log --graph               # include branch topology graph
gmux git log -n 20                 # show last 20 commits
gmux git log --since "2 weeks ago" # commits from the last 2 weeks
```

### Show Blame in a Pane

```sh
gmux git blame <file>              # show line-by-line blame for a file
```

### Open in Pager

For interactive scrolling through large outputs:

```sh
gmux git open-log                  # open log in `less -R`
gmux git open-diff                 # open diff in `less -R`
```

## Stash Management

```sh
gmux git stash list                # list all stashes
gmux git stash push                # stash current changes
gmux git stash push -m "WIP"      # stash with a message
gmux git stash pop                 # apply and remove latest stash
gmux git stash pop 2               # apply and remove stash@{2}
gmux git stash drop 0              # delete stash@{0}
```

## Branch Operations

```sh
gmux git branch <name>             # create and switch to a new branch
gmux git switch <name>             # switch to an existing branch
gmux git merge <branch>            # merge a branch into the current branch
```

## Commit Operations

```sh
gmux git commit -m "feat: add X"   # commit staged changes
gmux git commit -m "fix: bug" --all # commit all changes (tracked files)
```

## Conflict Detection and Resolution

gmux automatically detects merge conflicts and can display them with ours/theirs markers:

### Detect Conflicts

```sh
gmux git conflicts                 # list all conflicted files
```

### View Conflicts in a Pane

```sh
gmux git show-conflict <file>      # display conflict markers with ours/theirs highlighted
```

### Resolve Conflicts

```sh
gmux git resolve <file> ours       # keep our version
gmux git resolve <file> theirs     # keep their version
gmux git resolve <file> both       # keep both versions
```

After resolution, the file is automatically staged.

## Worktree Integration

Each gmux session creates an isolated git worktree:

- **Branch naming**: `gmux-<session-name>-<hex>` (e.g., `gmux-my-feature-a1b2c3d4`)
- **Worktree location**: `../worktrees/gmux-<session-name>-<hex>`
- **Per-worktree status**: the git overlay shows status for each worktree independently
- **Automatic cleanup**: worktrees are removed when sessions end (unless `--auto-merge` is used)

## Configuration

Configure the git overlay in `~/.gmux/config.json`:

```json
{
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

| Option | Description | Default |
|---|---|---|
| `enabled` | Enable/disable the git overlay | `true` |
| `showBranchInStatusBar` | Show branch name in the status bar | `true` |
| `showDiffStat` | Show diff stat after operations | `true` |
| `autoRefreshInterval` | How often to refresh git state (ms) | `10000` |
| `diffViewerCommand` | External diff viewer | `"delta"` |
| `logViewerCommand` | External log viewer | `"tig"` |
