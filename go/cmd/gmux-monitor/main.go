// gmux-monitor: watches a tmux pane's process tree and prints "idle" when the
// target agent process is no longer running. Replaces the Node.js polling loop
// in ProcessMonitor with a faster, lower-overhead Go process.
//
// Usage:
//
//	gmux-monitor --pane-id %1 --process claude-code [--interval 500ms]
//
// Exits after printing "idle\n" to stdout.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func main() {
	paneID := flag.String("pane-id", "", "tmux pane ID (e.g. %1)")
	processName := flag.String("process", "", "agent process name to watch (e.g. claude-code)")
	interval := flag.Duration("interval", 500*time.Millisecond, "poll interval")
	flag.Parse()

	if *paneID == "" || *processName == "" {
		fmt.Fprintln(os.Stderr, "usage: gmux-monitor --pane-id <id> --process <name> [--interval <duration>]")
		os.Exit(1)
	}

	for {
		running, err := isAgentRunning(*paneID, *processName)
		if err != nil {
			// pane is gone — treat as idle
			fmt.Println("idle")
			return
		}
		if !running {
			fmt.Println("idle")
			return
		}
		time.Sleep(*interval)
	}
}

// isAgentRunning returns true if any process in the pane's process tree
// has a command name containing processName.
func isAgentRunning(paneID, processName string) (bool, error) {
	panePid, err := getPanePid(paneID)
	if err != nil {
		return false, err
	}

	children, err := buildProcessTree()
	if err != nil {
		return false, err
	}

	return bfsFind(panePid, processName, children), nil
}

func getPanePid(paneID string) (int, error) {
	out, err := exec.Command("tmux", "list-panes", "-t", paneID, "-F", "#{pane_pid}").Output()
	if err != nil {
		return 0, fmt.Errorf("tmux list-panes: %w", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil || pid == 0 {
		return 0, fmt.Errorf("invalid pane PID: %q", strings.TrimSpace(string(out)))
	}
	return pid, nil
}

type procEntry struct {
	pid  int
	comm string
}

func buildProcessTree() (map[int][]procEntry, error) {
	out, err := exec.Command("ps", "-o", "pid,ppid,comm", "-A").Output()
	if err != nil {
		return nil, fmt.Errorf("ps: %w", err)
	}

	children := make(map[int][]procEntry)
	lines := strings.Split(string(out), "\n")
	for _, line := range lines[1:] { // skip header
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		if err1 != nil || err2 != nil || pid == 0 {
			continue
		}
		comm := strings.Join(fields[2:], " ")
		children[ppid] = append(children[ppid], procEntry{pid: pid, comm: comm})
	}
	return children, nil
}

// bfsFind walks the process tree from root via BFS looking for processName.
func bfsFind(root int, processName string, children map[int][]procEntry) bool {
	visited := make(map[int]bool)
	queue := []int{root}
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		if visited[pid] {
			continue
		}
		visited[pid] = true
		for _, child := range children[pid] {
			if strings.Contains(child.comm, processName) {
				return true
			}
			queue = append(queue, child.pid)
		}
	}
	return false
}
