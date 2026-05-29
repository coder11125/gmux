import { $ } from "./shell.ts";

export type IdleCallback = (sessionName: string, paneId: string) => void | Promise<void>;

interface SessionEntry {
  sessionName: string;
  paneId: string;
  processName: string;
  running: boolean;
}

export class ProcessMonitor {
  private sessions: Map<string, SessionEntry> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  onIdle: IdleCallback | null = null;

  add(sessionName: string, paneId: string, agent: string): void {
    const processName = agent.split(/\s+/)[0]!.split("/").pop()!;
    this.sessions.set(sessionName, { sessionName, paneId, processName, running: true });
  }

  remove(sessionName: string): void {
    this.sessions.delete(sessionName);
  }

  start(): void {
    this.render();
    this.intervalId = setInterval(() => this.poll(), 2000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    process.stdout.write("\r\x1b[K");
  }

  private async poll(): Promise<void> {
    const idle: SessionEntry[] = [];

    for (const entry of this.sessions.values()) {
      const wasRunning = entry.running;
      entry.running = await this.isAgentRunning(entry.paneId, entry.processName);
      if (wasRunning && !entry.running) {
        idle.push(entry);
      }
    }

    this.render();

    if (idle.length > 0 && this.onIdle) {
      // Only tear down the first idle session. The onIdle callback calls
      // monitor.stop() which halts further polling, so processing more
      // than one would race on concurrent git/teardown mutations.
      await this.onIdle(idle[0]!.sessionName, idle[0]!.paneId);
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
      const dot = entry.running ? "\u25cf" : "\u25cb";
      parts.push(`[${dot} ${entry.sessionName}]`);
    }
    process.stdout.write(`\r\x1b[K${parts.join(" ")}`);
  }
}
