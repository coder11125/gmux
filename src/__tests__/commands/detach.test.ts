import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resolve } from "node:path";

let mockExitCode = 0;
let mockStdout = "";
let mockStderr = "";
function shellResult() { return { exitCode: mockExitCode, text: () => mockStdout, stderr: Buffer.from(mockStderr) }; }
const shellChain = (): any => { const r = shellResult(); const p = Promise.resolve(r); const n = Object.assign(p, { nothrow: () => n, cwd: () => shellChain() }); return n; };
const $ = mock((strings: TemplateStringsArray, ...values: unknown[]) => shellChain());
mock.module(resolve(import.meta.dir, "../../shell.ts"), () => ({ $ }));
function getCommand(call: any[]): string { const s: string[] = call[0]; const v = call.slice(1); let c = ""; for (let i = 0; i < s.length; i++) { c += s[i]!; if (i < v.length) { const x = v[i]; c += Array.isArray(x) ? x.join(" ") : String(x); } } return c; }

import { detachSession } from "../../commands/detach.ts";
import type { SessionRecord } from "../../session-store.ts";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { sessionName: "test-session", branchName: "gmux-test-session", worktreePath: "/tmp/worktrees/gmux-test-session", tmuxWindowId: "@1", tmuxPaneId: "%1", agentCommand: "claude-code", status: "running", startedAt: new Date().toISOString(), ...overrides };
}

describe("detachSession", () => {
  let mockStore: any;
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; mockStore = { getSession: mock(() => Promise.resolve(null)), updateStatus: mock(() => Promise.resolve()), listSessions: mock(() => Promise.resolve([])) }; });

  it("throws when no target is specified", async () => { await expect(detachSession(mockStore, {})).rejects.toThrow("Specify a session name or use --all"); });
  it("calls tmux detach-client for a specific session", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); await detachSession(mockStore, { sessionName: "test-session" }); expect(mockStore.getSession).toHaveBeenCalledWith("test-session"); expect($).toHaveBeenCalled(); });
  it("updates session status after successful detach", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); await detachSession(mockStore, { sessionName: "test-session" }); expect(mockStore.updateStatus).toHaveBeenCalledWith("test-session", "running"); });
  it("throws when session not found in store", async () => { mockStore.getSession.mockResolvedValue(null); await expect(detachSession(mockStore, { sessionName: "nonexistent" })).rejects.toThrow("not found"); });
  it("updates status to error when tmux pane not found", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); mockExitCode = 1; mockStderr = "can't find session"; await expect(detachSession(mockStore, { sessionName: "test-session" })).rejects.toThrow(); expect(mockStore.updateStatus).toHaveBeenCalledWith("test-session", "error"); });
  it("calls tmux detach-client without target when all flag is set", async () => { await detachSession(mockStore, { all: true }); expect($).toHaveBeenCalled(); });
  it("does not call updateStatus when detaching all sessions", async () => { await detachSession(mockStore, { all: true }); expect(mockStore.updateStatus).not.toHaveBeenCalled(); });
  it("warns when no client is attached", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); mockExitCode = 1; mockStderr = "no client is attached"; const w = mock(() => {}); const orig = console.warn; console.warn = w; await detachSession(mockStore, { sessionName: "test-session" }); expect(w).toHaveBeenCalled(); console.warn = orig; });
  it("warns when no tmux clients are attached (detach all)", async () => { mockExitCode = 1; mockStderr = "no client"; const l = mock(() => {}); const orig = console.log; console.log = l; await detachSession(mockStore, { all: true }); expect(l).toHaveBeenCalled(); console.log = orig; });
});
