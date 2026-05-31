# Update (`gmux update`)

`gmux update` downloads and installs the latest (or a specific) version of gmux
from GitHub. It is backed by a Go binary (`gmux-update`) that handles fetching,
verification, and atomic binary swap.

## Usage

```sh
gmux update                          # update to latest version
gmux update --dry-run                # check for update without making changes
gmux update --force                  # re-download even if same version
gmux update --version v0.2.0         # install a specific version
```

| Flag | Default | Description |
|---|---|---|
| `--dry-run` | `false` | Check for update without downloading or installing |
| `--force` | `false` | Re-download even if already at the requested version |
| `--version` | latest | Install a specific version tag (e.g. `v0.2.0`) |

## How it works

1. **Version detection** — reads the embedded version from the `gmux-update`
   binary (set at build time via `-ldflags`), falling back to `gmux --version`
   or a `VERSION` file.
2. **Release lookup** — queries the GitHub Releases API for the latest
   non-prerelease tag, or uses the explicitly requested version.
3. **Download** — fetches the platform-specific tarball
   (`gmux-<version>-<os>-<arch>.tar.gz`) and optional checksums file
   (`gmux-<version>-checksums.txt`) from GitHub releases.
4. **Verification** — if a checksums file is found, computes SHA256 of the
   archive and compares against the published hash. Skips verification
   gracefully if the checksums file is absent.
5. **Extraction** — extracts the tarball to a temp directory.
6. **Validation** — runs `--version` on the extracted `gmux` binary to confirm
   it's executable and functional.
7. **Atomic swap** — renames the current binary to `.bak`, renames the new
   binary into place, ensures 0755 permissions, removes the backup. If the
   rename fails, the backup is restored (rollback).
8. **Cleanup** — removes temp files and the old gmux-monitor backup.

## Robustness

- **Retries** — HTTP downloads retry up to 3 times with exponential backoff.
- **Rollback** — every binary swap backs up the original first; if the rename
   fails, the backup is restored automatically.
- **Checksum optional** — verification is skipped if no checksums file is
   published, with a warning to the user.
- **Dev builds** — if the binary was built from source (version = `dev`), the
   updater skips unless `--version` or `--force` is provided.

## Release archive structure

A release tarball named `gmux-v0.2.0-darwin-arm64.tar.gz` contains:

```
gmux-v0.2.0/
├── gmux             # the main Bun-compiled binary
└── gmux-monitor     # the Go process monitor
```

The checksums file `gmux-v0.2.0-checksums.txt` contains SHA256 hashes for all
platform archives in standard `sha256sum` format.

## Building

```sh
cd go && go build \
  -ldflags="-X main.version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" \
  -o ../dist/gmux-update \
  ./cmd/gmux-update/
```

The updater is also built as part of `bun run build:go` and `bun run build`.
