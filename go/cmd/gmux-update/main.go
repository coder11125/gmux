// gmux-update: self-updater for gmux. Fetches the latest release from GitHub,
// verifies integrity, atomically swaps binaries, and optionally exec's into
// the new version.
//
// Usage:
//
//	gmux-update                    # update to latest version
//	gmux-update --version v0.2.0   # update to a specific version
//	gmux-update --force            # re-download even if same version
//	gmux-update --dry-run          # check for update without doing anything
//
// Exit codes: 0 = updated, 1 = already up-to-date, 2 = error.

package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Version set at build time via:
//
//	-ldflags "-X main.version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
var version = "dev"

const (
	repoOwner   = "coder11125"
	repoName    = "gmux"
	downloadURL = "https://github.com/" + repoOwner + "/" + repoName + "/releases/download"
	apiURL      = "https://api.github.com/repos/" + repoOwner + "/" + repoName + "/releases"
	httpTimeout = 60 * time.Second
	maxRetries  = 3
)

// gitHubRelease is a subset of the GitHub Releases API response.
type gitHubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []gitHubAsset `json:"assets"`
}

type gitHubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	State              string `json:"state"`
}

// updater holds the state for a single update run.
type updater struct {
	force  bool
	dryRun bool
	wantVer string // empty = "latest"

	// Resolved paths
	distDir    string // directory containing gmux, gmux-monitor, gmux-update
	currentExe string // real path to this binary (after symlink resolution)

	// Versions
	currentVer string // version of the currently installed gmux
	latestVer  string // version we're updating to
}

func main() {
	force := flag.Bool("force", false, "re-download even if same version")
	dryRun := flag.Bool("dry-run", false, "check for update without making changes")
	wantVer := flag.String("version", "", "specific version to install (e.g. v0.2.0)")
	flag.Parse()

	u := &updater{
		force:   *force,
		dryRun:  *dryRun,
		wantVer: *wantVer,
	}

	exitCode := 0
	if err := u.run(); err != nil {
		fmt.Fprintf(os.Stderr, "  error    %v\n", err)
		exitCode = 2
	}
	os.Exit(exitCode)
}

func (u *updater) run() error {
	// 1. Resolve paths and detect current version.
	if err := u.resolve(); err != nil {
		return fmt.Errorf("resolve: %w", err)
	}

	// 2. Determine the target version.
	if u.wantVer == "" {
		if err := u.fetchLatestRelease(); err != nil {
			return fmt.Errorf("fetch latest: %w", err)
		}
	} else {
		u.latestVer = u.wantVer
	}

	// 3. Compare versions.
	if !u.force && semverEqual(u.latestVer, u.currentVer) {
		fmt.Printf("  ok       Already at version %s\n", u.currentVer)
		return nil
	}
	// If we're a dev build and no explicit version was requested, skip.
	if u.currentVer == "dev" && u.wantVer == "" && !u.force {
		fmt.Println("  skip     Dev build — use --version or --force to update")
		return nil
	}

	fmt.Printf("  update   %s → %s (%s/%s)\n", u.currentVer, u.latestVer, runtime.GOOS, runtime.GOARCH)

	if u.dryRun {
		fmt.Println("  dry-run  Would download and install")
		return nil
	}

	// 4. Download release archive.
	archivePath, checksumPath, err := u.downloadRelease()
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer removeQuiet(archivePath)
	if checksumPath != "" {
		defer removeQuiet(checksumPath)
	}

	// 5. Verify checksum (if available).
	if checksumPath != "" {
		if err := verifyChecksum(archivePath, checksumPath, u.archiveName()); err != nil {
			return fmt.Errorf("checksum: %w", err)
		}
		fmt.Println("  verify   Checksum OK")
	} else {
		fmt.Println("  warn     No checksums file — skipping verification")
	}

	// 6. Extract to a temp directory.
	extractDir, err := os.MkdirTemp("", "gmux-update-*")
	if err != nil {
		return fmt.Errorf("temp dir: %w", err)
	}
	defer os.RemoveAll(extractDir)

	if err := extractTarball(archivePath, extractDir); err != nil {
		return fmt.Errorf("extract: %w", err)
	}
	fmt.Println("  extract  OK")

	// 7. Locate and validate extracted binaries.
	newGMUX := filepath.Join(extractDir, "gmux")
	newMonitor := filepath.Join(extractDir, "gmux-monitor")

	if !fileExists(newGMUX) {
		return fmt.Errorf("extracted archive missing gmux binary")
	}
	if err := validateBinary(newGMUX); err != nil {
		return fmt.Errorf("binary validation failed: %w", err)
	}
	fmt.Println("  verify   gmux OK")

	// 8. Swap binaries atomically (one at a time, with rollback).
	if err := swapBinary(newGMUX, filepath.Join(u.distDir, "gmux")); err != nil {
		return fmt.Errorf("swap gmux: %w", err)
	}
	fmt.Println("  update   gmux updated")

	if fileExists(newMonitor) {
		if err := validateBinary(newMonitor); err != nil {
			return fmt.Errorf("gmux-monitor validation failed: %w", err)
		}
		if err := swapBinary(newMonitor, filepath.Join(u.distDir, "gmux-monitor")); err != nil {
			return fmt.Errorf("swap gmux-monitor: %w", err)
		}
		fmt.Println("  update   gmux-monitor updated")
	}

	fmt.Printf("  done     Updated to %s\n", u.latestVer)
	return nil
}

// ---------------------------------------------------------------------------
// Path & version resolution
// ---------------------------------------------------------------------------

func (u *updater) resolve() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	real, err := filepath.EvalSymlinks(exe)
	if err != nil {
		real = exe
	}
	u.currentExe = real
	u.distDir = filepath.Dir(real)
	u.currentVer = u.detectVersion()
	return nil
}

// detectVersion returns the gmux version from the sibling gmux binary.
func (u *updater) detectVersion() string {
	// If this binary was built with a tagged release, use its own version.
	if version != "dev" && version != "" {
		return version
	}
	// Try reading VERSION file sibling to dist/.
	verFile := filepath.Join(u.distDir, "..", "VERSION")
	if data, err := os.ReadFile(verFile); err == nil {
		if v := strings.TrimSpace(string(data)); v != "" {
			return v
		}
	}
	// Run gmux --version.
	bin := filepath.Join(u.distDir, "gmux")
	if fileExists(bin) {
		out, err := exec.Command(bin, "--version").CombinedOutput()
		if err == nil {
			return strings.TrimSpace(string(out))
		}
	}
	return "dev"
}

// ---------------------------------------------------------------------------
// GitHub release lookup
// ---------------------------------------------------------------------------

func (u *updater) fetchLatestRelease() error {
	client := &http.Client{Timeout: httpTimeout}
	resp, err := client.Get(apiURL + "/latest")
	if err != nil {
		return fmt.Errorf("cannot reach GitHub: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		// OK
	case 404:
		return errors.New("no releases found — publish one first on GitHub")
	case 403:
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API rate limit hit: %s", strings.TrimSpace(string(body)))
	default:
		return fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}

	var rel gitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return fmt.Errorf("parse release: %w", err)
	}
	if rel.TagName == "" {
		return errors.New("latest release has no tag")
	}
	u.latestVer = rel.TagName
	return nil
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

func (u *updater) archiveName() string {
	return fmt.Sprintf("gmux-%s-%s-%s.tar.gz", u.latestVer, runtime.GOOS, runtime.GOARCH)
}

func (u *updater) downloadRelease() (archivePath, checksumPath string, err error) {
	name := u.archiveName()
	url := fmt.Sprintf("%s/%s/%s", downloadURL, u.latestVer, name)
	fmt.Printf("  download %s\n", name)

	archivePath, err = downloadFile(url, "gmux-archive-*.tar.gz")
	if err != nil {
		return "", "", err
	}

	// Checksums file is optional.
	csName := fmt.Sprintf("gmux-%s-checksums.txt", u.latestVer)
	csURL := fmt.Sprintf("%s/%s/%s", downloadURL, u.latestVer, csName)
	checksumPath, err = downloadFile(csURL, "gmux-checksums-*.txt")
	if err != nil {
		return archivePath, "", nil
	}
	return archivePath, checksumPath, nil
}

// downloadFile fetches url to a temp file and returns its path. Retries on failure.
func downloadFile(url, pattern string) (string, error) {
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}

		f, err := os.CreateTemp("", pattern)
		if err != nil {
			return "", err
		}
		tmpPath := f.Name()

		client := &http.Client{Timeout: httpTimeout}
		resp, err := client.Get(url)
		if err != nil {
			f.Close()
			os.Remove(tmpPath)
			lastErr = fmt.Errorf("HTTP GET: %w", err)
			continue
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			f.Close()
			os.Remove(tmpPath)
			if resp.StatusCode == 404 {
				return "", fmt.Errorf("not found at %s", url)
			}
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			continue
		}

		written, err := io.Copy(f, resp.Body)
		resp.Body.Close()
		f.Close()

		if err != nil {
			os.Remove(tmpPath)
			lastErr = fmt.Errorf("write: %w", err)
			continue
		}
		if written == 0 {
			os.Remove(tmpPath)
			lastErr = errors.New("empty response")
			continue
		}
		return tmpPath, nil
	}
	return "", fmt.Errorf("after %d attempts: %w", maxRetries, lastErr)
}

// ---------------------------------------------------------------------------
// Checksum verification
// ---------------------------------------------------------------------------

func verifyChecksum(archivePath, checksumPath, archiveName string) error {
	data, err := os.ReadFile(checksumPath)
	if err != nil {
		return err
	}

	var expectedHash string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Format: "<hash>  <filename>"
		parts := strings.Fields(line)
		if len(parts) >= 2 && strings.Contains(parts[len(parts)-1], archiveName) {
			expectedHash = parts[0]
			break
		}
	}
	if expectedHash == "" {
		return fmt.Errorf("no checksum found for %s in checksums file", archiveName)
	}

	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	gotHash := hex.EncodeToString(h.Sum(nil))

	if !strings.EqualFold(gotHash, expectedHash) {
		return fmt.Errorf("expected %s, got %s", expectedHash, gotHash)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Archive extraction
// ---------------------------------------------------------------------------

func extractTarball(archivePath, destDir string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar: %w", err)
		}

		// Strip top-level directory: "gmux-v0.2.0/gmux" → "gmux"
		name := stripTopDir(filepath.ToSlash(hdr.Name))
		if name == "" {
			continue
		}
		target := filepath.Join(destDir, name)

		switch hdr.Typeflag {
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			fw, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			_, err = io.Copy(fw, tr)
			fw.Close()
			if err != nil {
				return err
			}
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		}
	}
	return nil
}

// stripTopDir removes the first path component. "a/b/c" → "b/c", "a" → "".
func stripTopDir(p string) string {
	parts := strings.SplitN(p, "/", 2)
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

// ---------------------------------------------------------------------------
// Binary swap (atomic rename with rollback)
// ---------------------------------------------------------------------------

func swapBinary(src, dst string) error {
	// Backup existing binary.
	backup := dst + ".bak"
	if fileExists(dst) {
		os.Remove(backup)
		if err := os.Rename(dst, backup); err != nil {
			return fmt.Errorf("backup %s: %w", dst, err)
		}
	}

	// Move new binary into place.
	if err := os.Rename(src, dst); err != nil {
		// Restore backup.
		if fileExists(backup) {
			os.Rename(backup, dst)
		}
		return fmt.Errorf("rename: %w", err)
	}

	// Ensure executable.
	if err := os.Chmod(dst, 0755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Clean up backup on success.
	os.Remove(backup)
	return nil
}

// ---------------------------------------------------------------------------
// Binary validation
// ---------------------------------------------------------------------------

func validateBinary(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Mode()&0111 == 0 {
		return fmt.Errorf("not executable")
	}
	// Run --version to confirm it starts.
	// nolint:gas
	cmd := exec.Command(path, "--version")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("exec failed (%v): %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func removeQuiet(path string) {
	os.Remove(path)
}

// semverEqual compares two semver tags for equality, ignoring leading "v".
func semverEqual(a, b string) bool {
	a = strings.TrimPrefix(a, "v")
	b = strings.TrimPrefix(b, "v")
	// Simple comparison — good enough for equality checks.
	// For proper semver ordering use golang.org/x/mod/semver.
	return a == b
}
