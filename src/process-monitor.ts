import { $ } from "./shell.ts";
import { spawn } from "node:child_process";
import Path from "node:path";

export type IdleCallback = (sessionName: string, paneId: string) => void | Promise<void>;

interface SessionEntry {
  sessionName: string;
  paneId: string;
  processName: string;
  running: boolean;
}

// Resolve gmux-monitor binary: next to this script in dev, next to the gmux
// binary in production (both live in dist/).
function resolveMonitorBin(): string {
  const candidates = [
    Path.join(Path.dirname(Bun.argv[1]!), "gmux-monitor"),
    Path.join(import.meta.dir, "..", "dist", "gmux-monitor"),
  ];
  for (const p of candidates) {
    try {
      const stat = Bun.file(p);
      if (stat.size > 0) return p;
    } catch {
      // not found — try next
    }
  }
  return ""; // signals fallback to TypeScript polling
}

const MONITOR_BIN = resolveMonitorBin();

export class ProcessMonitor {
  private sessions: Map<string, SessionEntry> = new Map();
  private goWatched: Set<string> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  onIdle: IdleCallback | null = null;

  add(sessionName: string, paneId: string, agent: string): void {
    const processName = agent.split(/\s+/)[0]!.split("/").pop()!;
    const entry: SessionEntry = { sessionName, paneId, processName, running: true };
    this.sessions.set(sessionName, entry);

    if (MONITOR_BIN) {
      this.goWatched.add(sessionName);
      this.watchWithGo(entry);
    }
  }

  remove(sessionName: string): void {
    this.sessions.delete(sessionName);
    this.goWatched.delete(sessionName);
  }

  start(): void {
    this.render();
    if (!MONITOR_BIN) {
      // Fallback: TypeScript polling at 2 s intervals
      this.intervalId = setInterval(() => this.poll(), 2000);
    }
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    process.stdout.write("\r\x1b[K");
  }

  // ---------------------------------------------------------------------------
  // Go-backed path: spawn one gmux-monitor per session
  // ---------------------------------------------------------------------------

  private watchWithGo(entry: SessionEntry): void {
    const child = spawn(MONITOR_BIN, [
      "--pane-id", entry.paneId,
      "--process", entry.processName,
      "--interval", "500ms",
    ]);

    child.stdout.on("data", async (chunk: Buffer) => {
      if (chunk.toString().trim() === "idle") {
        entry.running = false;
        this.render();
        this.sessions.delete(entry.sessionName);
        if (this.onIdle) {
          await this.onIdle(entry.sessionName, entry.paneId);
        }
        if (this.sessions.size === 0) {
          this.stop();
        }
      }
    });

    child.on("error", () => {
      // Go binary failed for this entry — fall back to TS polling for it only
      this.goWatched.delete(entry.sessionName);
      if (!this.intervalId) {
        this.intervalId = setInterval(() => this.poll(), 2000);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // TypeScript fallback path (used when gmux-monitor is not available)
  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    const idle: SessionEntry[] = [];

    for (const entry of this.sessions.values()) {
      // Skip sessions with a healthy Go watcher — they self-report idle
      if (this.goWatched.has(entry.sessionName)) continue;
      const wasRunning = entry.running;
      entry.running = await this.isAgentRunning(entry.paneId, entry.processName);
      if (wasRunning && !entry.running) {
        idle.push(entry);
      }
    }

    this.render();

    if (this.onIdle) {
      for (const entry of idle) {
        await this.onIdle(entry.sessionName, entry.paneId);
      }
    }

    if (this.sessions.size === 0) {
      this.stop();
    }
  }

  private async isAgentRunning(paneId: string, processName: string): Promise<boolean> {
    const pidResult = await $`tmux list-panes -t ${paneId} -F "#{pane_pid}"`.nothrow();
    if (pidResult.exitCode !== 0) return false;

    const panePid = parseInt(pidResult.text().trim(), 10);
    if (isNaN(panePid)) return false;

    const psResult = await $`ps -o pid,ppid,comm -A`.nothrow();
    if (psResult.exitCode !== 0) return false;

    const lines = psResult.text().trim().split("\n").slice(1);

    const children = new Map<number, Array<{ pid: number; comm: string }>>();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = parseInt(parts[0]!, 10);
      const ppid = parseInt(parts[1]!, 10);
      const comm = parts.slice(2).join(" ");
      if (isNaN(pid) || isNaN(ppid)) continue;
      const list = children.get(ppid) ?? [];
      list.push({ pid, comm });
      children.set(ppid, list);
    }

    const queue = [panePid];
    const visited = new Set<number>();
    while (queue.length > 0) {
      const pid = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);

      const kids = children.get(pid) ?? [];
      for (const kid of kids) {
        if (kid.comm.includes(processName)) return true;
        queue.push(kid.pid);
      }
    }

    return false;
  }

  private render(): void {
    const parts: string[] = [];
    for (const entry of this.sessions.values()) {
      const dot = entry.running ? "●" : "○";
      parts.push(`[${dot} ${entry.sessionName}]`);
    }
    process.stdout.write(`\r\x1b[K${parts.join(" ")}`);
  }
}
