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

import { killWindow } from "../../commands/window.ts";
import { killPane } from "../../commands/pane.ts";

describe("killWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("calls tmux kill-window with correct target", async () => { await killWindow("@1"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux kill-window"); expect(cmd).toContain("@1"); });
  it("uses -f flag when force is set", async () => { await killWindow("@1", true); const vals = $.mock.calls[0]!.slice(1).flat(); expect(vals).toContain("-f"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such window: @99"; await expect(killWindow("@99")).rejects.toThrow("Failed to kill window"); });
  it("includes window ID in error message", async () => { mockExitCode = 1; mockStderr = "error"; try { await killWindow("@42"); expect.unreachable(); } catch (e: any) { expect(e.message).toContain("@42"); } });
});

describe("killPane", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("calls tmux kill-pane with correct target", async () => { await killPane("%1"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux kill-pane"); expect(cmd).toContain("%1"); });
  it("uses -f flag when force is set", async () => { await killPane("%1", true); const vals = $.mock.calls[0]!.slice(1).flat(); expect(vals).toContain("-f"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "no such pane: %99"; await expect(killPane("%99")).rejects.toThrow("Failed to kill pane"); });
  it("includes pane ID in error message", async () => { mockExitCode = 1; mockStderr = "error"; try { await killPane("%42"); expect.unreachable(); } catch (e: any) { expect(e.message).toContain("%42"); } });
  it("does not use force flag when force is undefined", async () => { await killPane("%1"); const vals = $.mock.calls[0]!.slice(1).flat(); expect(vals).not.toContain("-f"); });
  it("includes -f flag when force is true", async () => { await killPane("%1", true); const vals = $.mock.calls[0]!.slice(1).flat(); expect(vals).toContain("-f"); });
});
