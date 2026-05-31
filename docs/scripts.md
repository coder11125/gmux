# Scripts

gmux includes bundled scripts for session management, git automation, monitoring, and utilities. These scripts automate common workflows.

## Running Scripts

```sh
gmux scripts --list                  # list all available scripts
gmux scripts <script-name> [options] # run a specific script
```

## Implementation

Scripts use different runtimes by category based on language fit:

| Category | Runtime | Reason |
|----------|---------|--------|
| Session | Python | Data processing (`datetime`, `json`), file operations (`pathlib`, `shutil`) |
| Monitoring | Python | Logging frameworks, HTTP/webhook support, external service integrations |
| Utility | Python | Archive handling (`shutil.make_archive`, `tarfile`), system checks (`platform`, `shutil.which`) |
| Git | Ruby | Git subprocess orchestration; backtick syntax + `$?` is more concise than Python's `subprocess.run()` |

The runtime is resolved in `src/scripts.ts` based on `script.category`. Session, monitoring, and utility scripts use `python3`; only git scripts use `ruby`.

## Session Management

Session scripts manage gmux sessions and worktrees.

| Script | Description |
|---|---|
| `cleanup` | Remove stale sessions/worktrees older than N days |
| `health` | Check session health and repair issues |
| `export` | Export session configuration (JSON/YAML/TOML) |
| `stats` | Show session usage statistics |

### Examples

```sh
gmux scripts cleanup --max-days 7 --dry-run
gmux scripts health --repair --verbose
gmux scripts export --all --format json --output sessions.json
gmux scripts stats --json
```

## Git Automation

Git scripts automate common git operations.

| Script | Description |
|---|---|
| `auto-commit` | Auto-commit changes with smart messages |
| `branch-cleanup` | Delete merged branches automatically |
| `conflict-helper` | Interactive conflict resolution |
| `pr-ready` | Prepare branch for PR (test, lint, push) |

### Examples

```sh
gmux scripts auto-commit --all --conventional
gmux scripts branch-cleanup --merged-only --dry-run
gmux scripts conflict-helper --auto-resolve ours
gmux scripts pr-ready --skip-tests --force
```

## Monitoring

Monitoring scripts are implemented in **Python** for better logging frameworks, HTTP/webhook support, and integrations with external services.

| Script | Description |
|---|---|
| `watcher` | Monitor agent output for errors (pattern matching, logging) |
| `notifier` | Send notifications on session events (webhook, Slack, Discord, Telegram, email, sound) |
| `logger` | Capture tmux pane output to files (rotation, compression) |

### Watcher

Monitor agent output for errors and exceptions:

```sh
gmux scripts watcher --interval 5         # check every 5 seconds
gmux scripts watcher --session my-feature # watch specific session
gmux scripts watcher --tail               # tail pane output in real-time
gmux scripts watcher --pattern "error"    # custom error pattern (regex)
gmux scripts watcher --log-file /tmp/errors.log
```

**Error patterns detected:**
- Standard errors: `error`, `exception`, `failed`, `fatal`, `panic`, `crash`
- System errors: `EACCES`, `ENOENT`, `ENOMEM`, `permission denied`, `no such file`
- Runtime errors: `syntax error`, `undefined symbol`, `module not found`, `import error`
- Timeouts: `timeout`, `timed out`, `connection refused`

### Notifier

Send notifications when sessions complete or error:

```sh
gmux scripts notifier --interval 5 --sound
gmux scripts notifier --webhook https://hooks.example.com/...
gmux scripts notifier --slack https://hooks.slack.com/services/...
gmux scripts notifier --discord https://discordapp.com/api/webhooks/...
gmux scripts notifier --telegram BOT_TOKEN:CHAT_ID
gmux scripts notifier --email user@example.com
gmux scripts notifier --notify-on complete error
```

**Notification methods:**
- Webhook (generic HTTP POST)
- Slack (rich message format)
- Discord (embeds)
- Telegram (Markdown formatted)
- Email (via mail command)
- Sound (macOS: afplay, Linux: aplay)

### Logger

Capture and manage session logs:

```sh
gmux scripts logger --interval 10            # capture every 10 seconds
gmux scripts logger --session my-feature     # capture specific session
gmux scripts logger --log-dir ~/.gmux/logs   # custom log directory
gmux scripts logger --rotate --max-size 10485760 # rotate at 10MB
gmux scripts logger --compress               # gzip rotated logs
gmux scripts logger --format json            # JSON output instead of text
```

## Utility

Utility scripts provide system-level operations.

| Script | Description |
|---|---|
| `backup` | Backup sessions and config files |
| `restore` | Restore from backup |
| `diagnostics` | System health check |

### Examples

```sh
gmux scripts backup --compress --keep-count 10
gmux scripts restore --list
gmux scripts restore --file /path/to/backup.tar.gz
gmux scripts diagnostics --verbose
```

## Common Options

All scripts support these options:

| Option | Description |
|---|---|
| `--dry-run` | Show what would be done without doing it |
| `--verbose` | Show detailed output |
| `--force` | Skip confirmation prompts |
| `--json` | Output as JSON |

## Examples

### Monitor for Errors While Coding

In one tmux pane, run the agent:

```sh
gmux my-feature "Implement feature X" -A claude-code
```

In another pane, monitor for errors:

```sh
gmux scripts watcher --session my-feature --tail
```

### Send Slack Notifications on Completion

```sh
gmux scripts notifier --slack $SLACK_WEBHOOK_URL --notify-on complete error
```

### Rotate Logs Automatically

Capture logs every 10 seconds and rotate when they hit 10MB:

```sh
gmux scripts logger --interval 10 --rotate --max-size 10485760 --compress
```

### Health Check Before Cleanup

Run health check and repair any issues:

```sh
gmux scripts health --repair --verbose
```

Then clean up old sessions:

```sh
gmux scripts cleanup --max-days 7 --dry-run  # preview what would be deleted
gmux scripts cleanup --max-days 7            # actually delete
```
