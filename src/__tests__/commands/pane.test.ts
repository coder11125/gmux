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

import { splitPane, killPane, resizePane, zoomPane, selectPane, cyclePanes, convertPaneToWindow, joinPane } from "../../commands/pane.ts";

describe("splitPane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("creates a new pane with horizontal split", async () => {
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      let o = "%28024bash00"; const c = s.join("");
      if (c.includes("list-panes")) o = "1";
      const r = { exitCode: 0, text: () => o, stderr: Buffer.from("") }; const p = Promise.resolve(r); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
    });
    const result = await splitPane({ windowId: "@1", direction: "horizontal" });
    expect(result.paneId).toBe("%2");
    expect(result.width).toBe(80);
    expect(result.height).toBe(24);
    expect(result.currentCommand).toBe("bash");
  });

  it("creates a new pane with vertical split", async () => {
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      let o = "%34012zsh53"; const c = s.join("");
      if (c.includes("list-panes")) o = "0";
      const r = { exitCode: 0, text: () => o, stderr: Buffer.from("") }; const p = Promise.resolve(r); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
    });
    const result = await splitPane({ windowId: "@1", direction: "vertical" });
    expect(result.paneId).toBe("%3");
    expect(result.width).toBe(40);
    expect(result.height).toBe(12);
    expect(result.currentCommand).toBe("zsh");
  });

  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "can't find window: @99"; await expect(splitPane({ windowId: "@99", direction: "horizontal" })).rejects.toThrow("Failed to split pane"); });
  it("includes window ID in error message", async () => { mockExitCode = 1; mockStderr = "error"; try { await splitPane({ windowId: "@42", direction: "horizontal" }); expect.unreachable(); } catch (e: any) { expect(e.message).toContain("@42"); } });
});

describe("killPane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("kills a pane", async () => { await killPane("%1"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux kill-pane"); });
  it("uses -f flag when force is set", async () => { await killPane("%1", true); const vals = $.mock.calls[0]!.slice(1).flat(); expect(vals).toContain("-f"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane"; await expect(killPane("%99")).rejects.toThrow("Failed to kill pane"); });
});

describe("resizePane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("resizes pane up", async () => { await resizePane("%1", { direction: "up", amount: 5 }); expect($).toHaveBeenCalled(); });
  it("resizes pane down", async () => { await resizePane("%1", { direction: "down", amount: 10 }); expect($).toHaveBeenCalled(); });
  it("resizes pane left", async () => { await resizePane("%1", { direction: "left", amount: 3 }); expect($).toHaveBeenCalled(); });
  it("resizes pane right", async () => { await resizePane("%1", { direction: "right", amount: 7 }); expect($).toHaveBeenCalled(); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane"; await expect(resizePane("%99", { direction: "up", amount: 5 })).rejects.toThrow("Failed to resize pane"); });
});

describe("zoomPane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("zooms a pane", async () => { await zoomPane("%1"); expect($).toHaveBeenCalled(); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane"; await expect(zoomPane("%99")).rejects.toThrow("Failed to zoom pane"); });
});

describe("selectPane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("selects a pane", async () => { await selectPane("%2"); expect($).toHaveBeenCalled(); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane"; await expect(selectPane("%99")).rejects.toThrow("Failed to select pane"); });
});

describe("cyclePanes", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("cycles to next pane", async () => { await cyclePanes("@1", "next"); expect($).toHaveBeenCalled(); });
  it("cycles to previous pane", async () => { await cyclePanes("@1", "previous"); expect($).toHaveBeenCalled(); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "error"; await expect(cyclePanes("@1", "next")).rejects.toThrow("Failed to cycle panes"); });
});

describe("convertPaneToWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("converts pane to window", async () => {
    $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => {
      let o = ""; let c = ""; for (let i = 0; i < s.length; i++) { c += s[i]!; if (i < v.length) { const x = v[i]; c += Array.isArray(x) ? x.join(" ") : String(x); } }
      if (c.includes("break-pane")) o = "@5:%2";
      else if (c.includes("window_name")) o = "@5new-window3";
      else if (c.includes("list-panes")) o = "%2";
      else if (c.includes("display-message")) o = "tiled";
      const r = { exitCode: 0, text: () => o, stderr: Buffer.from("") }; const p = Promise.resolve(r); return Object.assign(p, { nothrow: () => p, cwd: () => shellChain() });
    });
    const result = await convertPaneToWindow("%2");
    expect(result.windowId).toBe("@5");
    expect(result.windowName).toBe("new-window");
    expect(result.paneIds).toEqual(["%2"]);
  });

  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane"; await expect(convertPaneToWindow("%99")).rejects.toThrow("Failed to convert pane"); });
});

describe("joinPane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });
  it("joins pane to the left", async () => { await joinPane("%2", "@1", "left"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux join-pane"); expect(cmd).toContain("-L"); });
  it("joins pane to the right", async () => { await joinPane("%2", "@1", "right"); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("-R"); });
  it("joins pane to the top", async () => { await joinPane("%2", "@1", "top"); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("-U"); });
  it("joins pane to the bottom", async () => { await joinPane("%2", "@1", "bottom"); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("-D"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane"; await expect(joinPane("%99", "@1", "left")).rejects.toThrow("Failed to join pane"); });
  it("includes source pane and target window in error message", async () => { mockExitCode = 1; mockStderr = "error"; try { await joinPane("%42", "@7", "right"); expect.unreachable(); } catch (e: any) { expect(e.message).toContain("%42"); expect(e.message).toContain("@7"); } });
});
