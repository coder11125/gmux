import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import Path from "node:path";
import { homedir } from "node:os";

export type SessionStatus = "running" | "complete" | "error";

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

const storeDir = Path.join(homedir(), ".gmux");
const storePath = Path.join(storeDir, "sessions.json");

export class SessionStore {
  private data = new Map<string, SessionRecord>();
  private loaded = false;

  async addSession(record: SessionRecord): Promise<void> {
    await this.ensureLoaded();
    this.data.set(record.sessionName, record);
    await this.flush();
  }

  async getSession(sessionName: string): Promise<SessionRecord | null> {
    await this.ensureLoaded();
    return this.data.get(sessionName) ?? null;
  }

  async listSessions(): Promise<SessionRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.data.values());
  }

  async updateStatus(sessionName: string, status: SessionStatus): Promise<void> {
    await this.ensureLoaded();
    const record = this.data.get(sessionName);
    if (!record) throw new Error(`Session '${sessionName}' not found`);
    record.status = status;
    await this.flush();
  }

  async removeSession(sessionName: string): Promise<void> {
    await this.ensureLoaded();
    this.data.delete(sessionName);
    await this.flush();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await mkdir(storeDir, { recursive: true });

    try {
      const raw = await readFile(storePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const value of Object.values(parsed)) {
          const record = value as SessionRecord;
          if (record && typeof record === "object" && record.sessionName) {
            this.data.set(record.sessionName, record);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    this.loaded = true;
  }

  private async flush(): Promise<void> {
    const obj: Record<string, SessionRecord> = {};
    for (const [key, value] of this.data) {
      obj[key] = value;
    }

    const tmpPath = storePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(obj, null, 2), { mode: 0o644 });
    await rename(tmpPath, storePath);
  }
}
