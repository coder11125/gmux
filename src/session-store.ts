import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import Path from "node:path";
import { homedir } from "node:os";
import type { SessionStatus } from "./types.ts";

export type { SessionStatus };

const VALID_STATUSES = new Set<SessionStatus>(["running", "complete", "error", "attached", "detached"]);

export interface SessionRecord {
  sessionName: string;
  branchName: string;
  worktreePath: string;
  tmuxWindowId: string;
  tmuxPaneId: string;
  agentCommand: string;
  status: SessionStatus;
  startedAt: string;
}

function isValidSessionRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionName === "string" &&
    typeof r.branchName === "string" &&
    typeof r.worktreePath === "string" &&
    typeof r.tmuxWindowId === "string" &&
    typeof r.tmuxPaneId === "string" &&
    typeof r.agentCommand === "string" &&
    VALID_STATUSES.has(r.status as SessionStatus) &&
    typeof r.startedAt === "string"
  );
}

const storeDir = Path.join(homedir(), ".gmux");
const storePath = Path.join(storeDir, "sessions.json");
const lockPath = Path.join(storeDir, "sessions.json.lock");

const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 100;

async function acquireLock(): Promise<void> {
  await mkdir(storeDir, { recursive: true });

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      // O_CREAT | O_EXCL — fails atomically if file already exists
      const fd = await open(lockPath, "wx", 0o644);
      await fd.write(String(process.pid));
      await fd.close();
      return;
    } catch {
      // Lock exists — check if it's stale
      try {
        const raw = await readFile(lockPath, "utf-8");
        const lockPid = parseInt(raw.trim(), 10);
        if (!isNaN(lockPid) && !isPidAlive(lockPid)) {
          // Stale lock — remove and retry
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // Lock file disappeared between check and read — retry
      }

      await sleep(LOCK_RETRY_MS);
    }
  }

  throw new Error(`Timed out waiting for lock at ${lockPath}`);
}

async function releaseLock(): Promise<void> {
  try {
    const raw = await readFile(lockPath, "utf-8");
    if (parseInt(raw.trim(), 10) === process.pid) {
      await unlink(lockPath).catch(() => {});
    }
  } catch {
    // lock file already gone
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SessionStore {
  private data = new Map<string, SessionRecord>();

  async addSession(record: SessionRecord): Promise<void> {
    await this.withLock(async () => {
      await this.read();
      this.data.set(record.sessionName, record);
      await this.write();
    });
  }

  async getSession(sessionName: string): Promise<SessionRecord | null> {
    return this.withLock(async () => {
      await this.read();
      return this.data.get(sessionName) ?? null;
    });
  }

  async listSessions(): Promise<SessionRecord[]> {
    return this.withLock(async () => {
      await this.read();
      return Array.from(this.data.values());
    });
  }

  async updateStatus(sessionName: string, status: SessionStatus): Promise<void> {
    await this.withLock(async () => {
      await this.read();
      const record = this.data.get(sessionName);
      if (!record) throw new Error(`Session '${sessionName}' not found`);
      record.status = status;
      await this.write();
    });
  }

  async removeSession(sessionName: string): Promise<void> {
    await this.withLock(async () => {
      await this.read();
      this.data.delete(sessionName);
      await this.write();
    });
  }

  // Holds the lock for the entire duration of fn so load→mutate→flush is atomic.
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await acquireLock();
    try {
      return await fn();
    } finally {
      await releaseLock();
    }
  }

  private async read(): Promise<void> {
    this.data.clear();
    try {
      const raw = await readFile(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const skipped: string[] = [];
        for (const [key, value] of Object.entries(parsed)) {
          if (isValidSessionRecord(value)) {
            this.data.set(key, value);
          } else {
            skipped.push(key);
          }
        }
        if (skipped.length > 0) {
          console.warn(
            `  warn     Skipped ${skipped.length} invalid session record(s): ${skipped.join(", ")}`,
          );
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private async write(): Promise<void> {
    const obj: Record<string, SessionRecord> = {};
    for (const [key, value] of this.data) {
      obj[key] = value;
    }
    const tmpPath = storePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(obj, null, 2), { mode: 0o644 });
    await rename(tmpPath, storePath);
  }
}
