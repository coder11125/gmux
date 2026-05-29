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

import { renameWindow } from "../../commands/window.ts";

describe("renameWindow", () => {
  beforeEach(() => { $.mockReset(); $.mockImplementation((s: TemplateStringsArray, ...v: unknown[]) => shellChain()); mockExitCode = 0; mockStdout = ""; mockStderr = ""; });

  it("calls tmux rename-window with correct args", async () => { await renameWindow("@1", "new-name"); expect($).toHaveBeenCalled(); const cmd = getCommand($.mock.calls[0]!); expect(cmd).toContain("tmux rename-window"); expect(cmd).toContain("new-name"); });
  it("throws on failure", async () => { mockExitCode = 1; mockStderr = "duplicate window name: new-name"; await expect(renameWindow("@1", "new-name")).rejects.toThrow("Failed to rename window"); });
  it("includes window ID in error message", async () => { mockExitCode = 1; mockStderr = "error"; try { await renameWindow("@42", "new-name"); expect.unreachable(); } catch (e: any) { expect(e.message).toContain("@42"); } });
  it("handles names with spaces", async () => { await renameWindow("@1", "my window name"); expect($).toHaveBeenCalled(); });
  it("handles special characters in name", async () => { await renameWindow("@1", "window-1_2.0"); expect($).toHaveBeenCalled(); });
  it("propagates tmux error details", async () => { mockExitCode = 1; mockStderr = "can't find window: @99"; try { await renameWindow("@99", "new-name"); expect.unreachable(); } catch (e: any) { expect(e.message).toContain("can't find window"); } });
});
