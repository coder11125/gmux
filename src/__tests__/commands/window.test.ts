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

import { listWindows, createWindow, killWindow, renameWindow, swapWindows, selectWindow, cycleWindows, setLayout } from "../../commands/window.ts";

describe("listWindows", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("returns parsed window info array", async () => {
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      let o = ""; const c = s.join("");
      if (c.includes("list-panes")) o = "%1";
      else if (c.includes("display-message")) o = "even-horizontal";
      else o = mockStdout;
      const r = { exitCode: 0, text: () => o, stderr: Buffer.from("") }; const p = Promise.resolve(r); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
    });
    mockStdout = "@1main01\n@2editor12";
    const windows = await listWindows();
    expect(windows).toHaveLength(2);
    expect(windows[0]!.windowId).toBe("@1");
    expect(windows[0]!.windowName).toBe("main");
    expect(windows[0]!.windowIndex).toBe(0);
    expect(windows[0]!.paneIds).toEqual(["%1"]);
    expect(windows[0]!.layout).toBe("even-horizontal");
  });

  it("returns empty array for empty output", async () => { mockStdout = ""; const windows = await listWindows(); expect(windows).toEqual([]); });
  it("includes session name in target when provided", async () => { mockStdout = "@1:main:0:1"; await listWindows("my-session"); expect($).toHaveBeenCalled(); });
  it("throws when no tmux server is running", async () => { mockExitCode = 1; mockStderr = "no server running on /tmp/tmux-1000/default"; await expect(listWindows()).rejects.toThrow("No tmux server is running"); });
  it("throws when session not found", async () => { mockExitCode = 1; mockStderr = "can't find session: nonexistent"; await expect(listWindows("nonexistent")).rejects.toThrow("Session 'nonexistent' not found"); });
  it("throws on general tmux failure", async () => { mockExitCode = 1; mockStderr = "some other error"; await expect(listWindows()).rejects.toThrow("Failed to list windows"); });
});

describe("createWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("creates window and returns window info", async () => {
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      let o = ""; let c = ""; for (let i = 0; i < s.length; i++) { c += s[i]!; if (i < v.length) { const x = v[i]; c += Array.isArray(x) ? x.join(" ") : String(x); } }
      if (c.includes("window_name")) o = "new-window2";
      else if (c.includes("display-message")) o = "even-vertical";
      else o = "@3:p1";
      const r = { exitCode: 0, text: () => o, stderr: Buffer.from("") }; const p = Promise.resolve(r); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
    });
    const result = await createWindow("my-session", "/tmp/worktree");
    expect(result.windowId).toBe("@3");
    expect(result.windowName).toBe("new-window");
    expect(result.paneIds).toEqual(["p1"]);
  });

  it("throws on duplicate window name", async () => { mockExitCode = 1; mockStderr = "duplicate window name: existing-window"; await expect(createWindow("existing-window", "/tmp/worktree")).rejects.toThrow("already exists"); });
  it("throws when no active tmux session", async () => { mockExitCode = 1; mockStderr = "no current session"; await expect(createWindow("my-session", "/tmp/worktree")).rejects.toThrow("No active tmux session"); });
  it("throws on general failure", async () => { mockExitCode = 1; mockStderr = "some error"; await expect(createWindow("my-session", "/tmp/worktree")).rejects.toThrow("Failed to create window"); });
});

describe("killWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("kills window by ID", async () => { await killWindow("@1"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux kill-window"); expect(cmd).toContain("@1"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such window"; await expect(killWindow("@99")).rejects.toThrow("Failed to kill window"); });
});

describe("renameWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("renames window", async () => { await renameWindow("@1", "new-name"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux rename-window"); expect(cmd).toContain("new-name"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "duplicate name"; await expect(renameWindow("@1", "dup")).rejects.toThrow("Failed to rename window"); });
});

describe("swapWindows", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("swaps two windows", async () => { await swapWindows("@1", "@2"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux swap-window"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such window"; await expect(swapWindows("@1", "@99")).rejects.toThrow("Failed to swap windows"); });
});

describe("selectWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("selects a window", async () => { await selectWindow("@3"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux select-window"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such window"; await expect(selectWindow("@99")).rejects.toThrow("Failed to select window"); });
});

describe("cycleWindows", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("cycles to next window", async () => { await cycleWindows("next"); expect($).toHaveBeenCalled(); });
  it("cycles to previous window", async () => { await cycleWindows("previous"); expect($).toHaveBeenCalled(); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "error"; await expect(cycleWindows("next")).rejects.toThrow("Failed to cycle"); });
});

describe("setLayout", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("sets layout for a window", async () => { await setLayout("@1", "tiled"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux select-layout"); expect(cmd).toContain("tiled"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such window"; await expect(setLayout("@99", "tiled")).rejects.toThrow("Failed to set layout"); });
  it("handles all layout types", async () => { for (const l of ["even-horizontal", "even-vertical", "tiled", "main-horizontal", "main-vertical"] as const) { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); await setLayout("@1", l); expect($).toHaveBeenCalled(); } });
});
