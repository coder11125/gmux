import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// ---------------------------------------------------------------------------
// In-memory filesystem simulation for SessionStore
// ---------------------------------------------------------------------------

const mockFs = new Map<string, string>();
let fdCounter = 0;
const mkdirCalls: string[] = [];

const MOCK_HOME = "/mock/home";

mock.module("node:os", () => ({
  homedir: () => MOCK_HOME,
}));

mock.module("node:fs/promises", () => ({
  mkdir: async (dirPath: string) => {
    mkdirCalls.push(dirPath);
  },
  open: async (path: string, flags: string) => {
    if (flags.includes("x") && mockFs.has(path)) {
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: "EEXIST" });
    }
    if (flags.includes("w") || flags.includes("x")) {
      mockFs.set(path, "");
    }
    const fd = ++fdCounter;
    return {
      write: async (data: string | Buffer | ArrayBuffer) => {
        const content = typeof data === "string" ? data : String(data);
        const existing = mockFs.get(path) ?? "";
        mockFs.set(path, existing + content);
      },
      close: async () => {},
    };
  },
  readFile: async (path: string, _encoding?: string) => {
    const content = mockFs.get(path);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }
    return content;
  },
  rename: async (oldPath: string, newPath: string) => {
    const content = mockFs.get(oldPath);
    if (content !== undefined) {
      mockFs.set(newPath, content);
      mockFs.delete(oldPath);
    }
  },
  unlink: async (path: string) => {
    mockFs.delete(path);
  },
  writeFile: async (path: string, content: string | Buffer) => {
    mockFs.set(path, typeof content === "string" ? content : content.toString());
  },
}));

const { SessionStore } = await import("../session-store.ts");
type SessionRecord = import("../session-store.ts").SessionRecord;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionName: "test-session",
    branchName: "gmux-test-session",
    worktreePath: "/worktrees/gmux-test-session",
    tmuxWindowId: "@1",
    tmuxPaneId: "%1",
    agentCommand: "claude-code",
    status: "running",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionStore", () => {
  let store: InstanceType<typeof SessionStore>;

  beforeEach(() => {
    store = new SessionStore();
    mockFs.clear();
    mkdirCalls.length = 0;
    fdCounter = 0;
  });

  // -----------------------------------------------------------------------
  // addSession
  // -----------------------------------------------------------------------

  describe("addSession", () => {
    it("should add a session and persist to disk", async () => {
      const record = makeRecord();
      await store.addSession(record);

      const storePath = `${MOCK_HOME}/.gmux/sessions.json`;
      expect(mockFs.has(storePath)).toBe(true);

      const raw = mockFs.get(storePath);
      expect(raw).toBeDefined();
      const parsed = JSON.parse(raw!);
      expect(parsed["test-session"]).toBeDefined();
      expect(parsed["test-session"].sessionName).toBe("test-session");
      expect(parsed["test-session"].branchName).toBe("gmux-test-session");
    });

    it("should overwrite an existing session with the same name", async () => {
      await store.addSession(makeRecord({ status: "running" }));
      await store.addSession(makeRecord({ status: "complete" }));

      const retrieved = await store.getSession("test-session");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.status).toBe("complete");
    });

    it("should handle adding multiple sessions", async () => {
      await store.addSession(makeRecord({ sessionName: "session-a" }));
      await store.addSession(makeRecord({ sessionName: "session-b" }));
      await store.addSession(makeRecord({ sessionName: "session-c" }));

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(3);
    });

    it("should persist all record fields", async () => {
      const record = makeRecord({
        sessionName: "detailed",
        branchName: "feature/xyz",
        worktreePath: "/wt/xyz",
        tmuxWindowId: "@42",
        tmuxPaneId: "%7",
        agentCommand: "codex",
        status: "running",
        startedAt: "2025-06-15T10:30:00.000Z",
      });
      await store.addSession(record);

      const retrieved = await store.getSession("detailed");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.branchName).toBe("feature/xyz");
      expect(retrieved!.worktreePath).toBe("/wt/xyz");
      expect(retrieved!.tmuxWindowId).toBe("@42");
      expect(retrieved!.tmuxPaneId).toBe("%7");
      expect(retrieved!.agentCommand).toBe("codex");
      expect(retrieved!.startedAt).toBe("2025-06-15T10:30:00.000Z");
    });
  });

  // -----------------------------------------------------------------------
  // getSession
  // -----------------------------------------------------------------------

  describe("getSession", () => {
    it("should retrieve an existing session by name", async () => {
      await store.addSession(
        makeRecord({ sessionName: "my-session", branchName: "branch-alpha" }),
      );

      const result = await store.getSession("my-session");
      expect(result).not.toBeNull();
      expect(result!.sessionName).toBe("my-session");
      expect(result!.branchName).toBe("branch-alpha");
      expect(result!.tmuxWindowId).toBe("@1");
      expect(result!.tmuxPaneId).toBe("%1");
      expect(result!.agentCommand).toBe("claude-code");
      expect(result!.status).toBe("running");
    });

    it("should return null for a nonexistent session", async () => {
      const result = await store.getSession("nonexistent");
      expect(result).toBeNull();
    });

    it("should return the correct session when multiple exist", async () => {
      await store.addSession(
        makeRecord({ sessionName: "alpha", branchName: "branch-alpha" }),
      );
      await store.addSession(
        makeRecord({ sessionName: "beta", branchName: "branch-beta" }),
      );

      const alpha = await store.getSession("alpha");
      expect(alpha!.branchName).toBe("branch-alpha");

      const beta = await store.getSession("beta");
      expect(beta!.branchName).toBe("branch-beta");
    });
  });

  // -----------------------------------------------------------------------
  // listSessions
  // -----------------------------------------------------------------------

  describe("listSessions", () => {
    it("should return an empty array when no sessions exist", async () => {
      const sessions = await store.listSessions();
      expect(sessions).toEqual([]);
    });

    it("should return all sessions", async () => {
      await store.addSession(makeRecord({ sessionName: "s1" }));
      await store.addSession(makeRecord({ sessionName: "s2" }));
      await store.addSession(makeRecord({ sessionName: "s3" }));

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(3);

      const names = sessions.map((s) => s.sessionName).sort();
      expect(names).toEqual(["s1", "s2", "s3"]);
    });

    it("should reflect updates after modifications", async () => {
      await store.addSession(
        makeRecord({ sessionName: "s1", status: "running" }),
      );

      let sessions = await store.listSessions();
      expect(sessions[0]!.status).toBe("running");

      await store.updateStatus("s1", "complete");

      sessions = await store.listSessions();
      expect(sessions[0]!.status).toBe("complete");
    });
  });

  // -----------------------------------------------------------------------
  // updateStatus
  // -----------------------------------------------------------------------

  describe("updateStatus", () => {
    it("should update the status of an existing session", async () => {
      await store.addSession(makeRecord({ status: "running" }));
      await store.updateStatus("test-session", "complete");

      const session = await store.getSession("test-session");
      expect(session).not.toBeNull();
      expect(session!.status).toBe("complete");
    });

    it("should persist the status change to disk", async () => {
      await store.addSession(makeRecord({ status: "running" }));
      await store.updateStatus("test-session", "error");

      const newStore = new SessionStore();
      const session = await newStore.getSession("test-session");
      expect(session!.status).toBe("error");
    });

    it("should throw when updating a nonexistent session", async () => {
      await expect(
        store.updateStatus("nonexistent", "complete"),
      ).rejects.toThrow("Session 'nonexistent' not found");
    });

    it("should handle all valid status transitions", async () => {
      await store.addSession(makeRecord({ status: "running" }));

      await store.updateStatus("test-session", "complete");
      expect((await store.getSession("test-session"))!.status).toBe("complete");

      await store.updateStatus("test-session", "running");
      expect((await store.getSession("test-session"))!.status).toBe("running");

      await store.updateStatus("test-session", "error");
      expect((await store.getSession("test-session"))!.status).toBe("error");
    });
  });

  // -----------------------------------------------------------------------
  // removeSession
  // -----------------------------------------------------------------------

  describe("removeSession", () => {
    it("should remove an existing session", async () => {
      await store.addSession(makeRecord({ sessionName: "to-remove" }));
      await store.removeSession("to-remove");

      const result = await store.getSession("to-remove");
      expect(result).toBeNull();
    });

    it("should persist the removal to disk", async () => {
      await store.addSession(makeRecord({ sessionName: "to-remove" }));
      await store.removeSession("to-remove");

      const newStore = new SessionStore();
      const result = await newStore.getSession("to-remove");
      expect(result).toBeNull();
    });

    it("should not affect other sessions", async () => {
      await store.addSession(makeRecord({ sessionName: "keep" }));
      await store.addSession(makeRecord({ sessionName: "remove" }));

      await store.removeSession("remove");

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.sessionName).toBe("keep");
    });

    it("should silently succeed for nonexistent session", async () => {
      await store.removeSession("nonexistent");
      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Concurrent access handling
  // -----------------------------------------------------------------------

  describe("concurrent access handling", () => {
    it("should handle concurrent addSession calls without data loss", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.addSession(makeRecord({ sessionName: `concurrent-${i}` })),
      );

      await Promise.all(promises);

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(10);
    });

    it("should handle concurrent read and write operations", async () => {
      await store.addSession(makeRecord({ sessionName: "reader-writer" }));

      const writes = [
        store.updateStatus("reader-writer", "complete"),
        store.updateStatus("reader-writer", "error"),
      ];

      const reads = [
        store.getSession("reader-writer"),
        store.listSessions(),
      ];

      await Promise.all([...writes, ...reads]);

      const final = await store.getSession("reader-writer");
      expect(final).not.toBeNull();
      expect(["complete", "error"]).toContain(final!.status);
    });

    it("should handle concurrent add and remove operations", async () => {
      const adds = Array.from({ length: 5 }, (_, i) =>
        store.addSession(makeRecord({ sessionName: `add-${i}` })),
      );

      await Promise.all(adds);

      const removes = Array.from({ length: 3 }, (_, i) =>
        store.removeSession(`add-${i}`),
      );

      await Promise.all(removes);

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid session data handling
  // -----------------------------------------------------------------------

  describe("invalid session data handling", () => {
    it("should skip invalid records loaded from disk", async () => {
      const storePath = `${MOCK_HOME}/.gmux/sessions.json`;
      const invalidData = {
        "valid-session": makeRecord({ sessionName: "valid-session" }),
        "invalid-missing-field": {
          sessionName: "broken",
        },
        "invalid-status": {
          ...makeRecord({ sessionName: "bad-status" }),
          status: "invalid-status-value",
        },
        "invalid-types": {
          sessionName: 12345,
          branchName: true,
          worktreePath: [],
          tmuxWindowId: {},
          tmuxPaneId: null,
          agentCommand: 42,
          status: "running",
          startedAt: false,
        },
      };

      mockFs.set(storePath, JSON.stringify(invalidData));

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.sessionName).toBe("valid-session");
    });

    it("should handle empty JSON object gracefully", async () => {
      const storePath = `${MOCK_HOME}/.gmux/sessions.json`;
      mockFs.set(storePath, "{}");

      const sessions = await store.listSessions();
      expect(sessions).toEqual([]);
    });

    it("should handle non-object JSON gracefully", async () => {
      const storePath = `${MOCK_HOME}/.gmux/sessions.json`;
      mockFs.set(storePath, "[]");

      const sessions = await store.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Full lifecycle
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("should support add → get → update → remove flow", async () => {
      await store.addSession(
        makeRecord({ sessionName: "lifecycle", status: "running" }),
      );

      let session = await store.getSession("lifecycle");
      expect(session).not.toBeNull();
      expect(session!.status).toBe("running");

      await store.updateStatus("lifecycle", "complete");
      session = await store.getSession("lifecycle");
      expect(session!.status).toBe("complete");

      await store.removeSession("lifecycle");
      session = await store.getSession("lifecycle");
      expect(session).toBeNull();
    });

    it("should maintain data integrity across multiple operations", async () => {
      const records = Array.from({ length: 20 }, (_, i) =>
        makeRecord({
          sessionName: `session-${i}`,
          branchName: `branch-${i}`,
          worktreePath: `/wt/${i}`,
        }),
      );

      for (const record of records) {
        await store.addSession(record);
      }

      let sessions = await store.listSessions();
      expect(sessions).toHaveLength(20);

      for (let i = 0; i < 10; i++) {
        await store.updateStatus(`session-${i}`, "complete");
      }

      for (let i = 0; i < 5; i++) {
        await store.removeSession(`session-${i}`);
      }

      sessions = await store.listSessions();
      expect(sessions).toHaveLength(15);

      const completed = sessions.filter((s) => s.status === "complete");
      expect(completed).toHaveLength(5);
    });
  });
});
