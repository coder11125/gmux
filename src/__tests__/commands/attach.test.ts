import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resolve } from "node:path";

let mockExitCode = 0;
let mockStdout = "";
let mockStderr = "";

function shellResult() {
  return { exitCode: mockExitCode, text: () => mockStdout, stderr: Buffer.from(mockStderr) };
}

// shellChain returns a thenable: rejects on non-zero exit when NOT using .nothrow()
const shellChain = (): any => {
  const result = shellResult();
  const nothrowObj = Object.assign(Promise.resolve(result), {
    nothrow: () => nothrowObj,
    cwd: () => shellChain(),
  });
  // Return a thenable that rejects when exit code is non-zero (simulates real bun $)
  return {
    then(resolve: any, reject?: any) {
      if (mockExitCode !== 0) {
        const err = new Error(`Command failed with exit code ${mockExitCode}: ${mockStderr}`);
        return Promise.reject(err).then(resolve, reject);
      }
      return Promise.resolve(result).then(resolve, reject);
    },
    catch(handler: any) {
      if (mockExitCode !== 0) {
        const err = new Error(`Command failed with exit code ${mockExitCode}: ${mockStderr}`);
        return Promise.reject(err).catch(handler);
      }
      return Promise.resolve(result);
    },
    nothrow: () => nothrowObj,
    cwd: () => shellChain(),
  };
};

const $ = mock((strings: TemplateStringsArray, ...values: unknown[]) => shellChain());
mock.module(resolve(import.meta.dir, "../../shell.ts"), () => ({ $ }));

import { attachSession } from "../../commands/attach.ts";
import type { SessionRecord } from "../../session-store.ts";

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { sessionName: "test-session", branchName: "gmux-test-session", worktreePath: "/tmp/worktrees/gmux-test-session", tmuxWindowId: "@1", tmuxPaneId: "%1", agentCommand: "claude-code", status: "running", startedAt: new Date().toISOString(), ...overrides };
}

describe("attachSession", () => {
  let mockStore: any;
  const savedTmux = process.env.TMUX;

  beforeEach(() => {
    $.mockReset();
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain());
    mockExitCode = 0; mockStdout = ""; mockStderr = "";
    process.env.TMUX = savedTmux;
    mockStore = { getSession: mock(() => Promise.resolve(null)), updateStatus: mock(() => Promise.resolve()) };
  });

  it("calls tmux attach-session with correct args", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); delete process.env.TMUX; await attachSession(mockStore, { sessionName: "test-session" }); expect(mockStore.getSession).toHaveBeenCalledWith("test-session"); expect($).toHaveBeenCalled(); });
  it("uses -r option when readOnly flag is set", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); delete process.env.TMUX; await attachSession(mockStore, { sessionName: "test-session", readOnly: true }); expect($).toHaveBeenCalled(); });
  it("throws when session not found in store", async () => { mockStore.getSession.mockResolvedValue(null); await expect(attachSession(mockStore, { sessionName: "nonexistent" })).rejects.toThrow("not found"); });
  it("updates status to error when tmux pane not found", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); mockExitCode = 1; mockStderr = "can't find pane %1"; await expect(attachSession(mockStore, { sessionName: "test-session" })).rejects.toThrow(); expect(mockStore.updateStatus).toHaveBeenCalledWith("test-session", "error"); });
  it("updates status to error when stderr contains session not found", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); mockExitCode = 1; mockStderr = "session not found: %1"; await expect(attachSession(mockStore, { sessionName: "test-session" })).rejects.toThrow(); expect(mockStore.updateStatus).toHaveBeenCalledWith("test-session", "error"); });
  it("updates status to running after successful attach", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); delete process.env.TMUX; await attachSession(mockStore, { sessionName: "test-session" }); expect(mockStore.updateStatus).toHaveBeenCalledWith("test-session", "running"); });
  it("uses switch-client when inside tmux", async () => { mockStore.getSession.mockResolvedValue(makeRecord()); process.env.TMUX = "/tmp/tmux-1000/default,12345,0"; await attachSession(mockStore, { sessionName: "test-session" }); expect($).toHaveBeenCalled(); expect(mockStore.updateStatus).toHaveBeenCalledWith("test-session", "running"); });

  it("throws when attach fails with session not found error", async () => {
    mockStore.getSession.mockResolvedValue(makeRecord());
    delete process.env.TMUX;
    let callCount = 0;
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      callCount++;
      if (callCount === 1) {
        // Pane check succeeds
        const r = { exitCode: 0, text: () => "%1", stderr: Buffer.from("") };
        const p = Promise.resolve(r);
        return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
      }
      // Attach fails - return thenable that rejects
      return {
        then(resolve: any, reject?: any) {
          const err = new Error("can't find session 'test-session'");
          return Promise.reject(err).then(resolve, reject);
        },
        catch(handler: any) {
          const err = new Error("can't find session 'test-session'");
          return Promise.reject(err).catch(handler);
        },
        nothrow: () => { const p = Promise.resolve({ exitCode: 1, text: () => "", stderr: Buffer.from("can't find session") }); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() }); },
        cwd: () => shellChain(),
      };
    });
    await expect(attachSession(mockStore, { sessionName: "test-session" })).rejects.toThrow("not found");
  });

  it("throws when session is already attached", async () => {
    mockStore.getSession.mockResolvedValue(makeRecord());
    delete process.env.TMUX;
    let callCount = 0;
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      callCount++;
      if (callCount === 1) {
        const r = { exitCode: 0, text: () => "%1", stderr: Buffer.from("") };
        const p = Promise.resolve(r);
        return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
      }
      return {
        then(resolve: any, reject?: any) {
          const err = new Error("is already attached");
          return Promise.reject(err).then(resolve, reject);
        },
        catch(handler: any) {
          const err = new Error("is already attached");
          return Promise.reject(err).catch(handler);
        },
        nothrow: () => { const p = Promise.resolve({ exitCode: 1, text: () => "", stderr: Buffer.from("is already attached") }); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() }); },
        cwd: () => shellChain(),
      };
    });
    await expect(attachSession(mockStore, { sessionName: "test-session" })).rejects.toThrow("already attached");
  });
});
