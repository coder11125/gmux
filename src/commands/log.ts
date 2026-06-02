import { $ } from "../shell.ts";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import Path from "node:path";
import { homedir } from "node:os";
import { SessionStore } from "../session-store.ts";

export interface LogOptions {
  follow?: boolean;
  since?: string;
  out?: string;
}

const logsDir = Path.join(homedir(), ".gmux", "logs");

/** Parse a duration string like "10m", "1h", "30s" into milliseconds. */
function parseDuration(s: string): number | null {
  const m = s.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "s": return n * 1_000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: return null;
  }
}

/** Filter lines to those within the given duration window. */
function filterSince(content: string, sinceMs: number): string {
  const cutoff = Date.now() - sinceMs;
  const lines = content.split("\n");
  const out: string[] = [];
  let inBlock = false;
  let blockTimestamp = 0;

  for (const line of lines) {
    // Detect our timestamp headers: "=== capture @ <ISO> ==="
    const hdr = line.match(/^=== capture @ (.+) ===$/);
    if (hdr) {
      blockTimestamp = new Date(hdr[1]).getTime();
      inBlock = blockTimestamp >= cutoff;
      if (inBlock) out.push(line);
      continue;
    }
    if (inBlock) out.push(line);
  }
  return out.join("\n");
}

/** Capture the current pane output via tmux capture-pane. */
async function capturePane(paneId: string): Promise<string> {
  const result = await $`tmux capture-pane -p -S - -t ${paneId}`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`tmux capture-pane failed for pane ${paneId}: ${stderr}`);
  }
  return result.stdout.toString();
}

export async function logSession(
  store: SessionStore,
  sessionName: string,
  opts: LogOptions,
): Promise<void> {
  const record = await store.getSession(sessionName);
  if (!record) {
    console.error(`  error    Session '${sessionName}' not found`);
    process.exit(1);
  }

  const logPath = opts.out ?? Path.join(logsDir, `${sessionName}.log`);

  await mkdir(Path.dirname(logPath), { recursive: true });

  console.log(`  log      ${logPath}`);

  const sinceMs = opts.since ? parseDuration(opts.since) : null;
  if (opts.since && sinceMs === null) {
    console.error(`  error    Invalid --since value '${opts.since}'. Use e.g. 10m, 1h, 30s.`);
    process.exit(1);
  }

  if (!opts.follow) {
    // Single capture
    const output = await capturePane(record.tmuxPaneId);
    const header = `=== capture @ ${new Date().toISOString()} ===\n`;
    await appendFile(logPath, header + output + "\n");

    if (sinceMs !== null) {
      const full = await readFile(logPath, "utf8");
      process.stdout.write(filterSince(full, sinceMs));
    } else {
      process.stdout.write(output);
    }
    return;
  }

  // --follow mode: poll every 2s, diff against last capture, append new lines
  let lastCapture = "";

  const printAndAppend = async () => {
    const output = await capturePane(record.tmuxPaneId);

    // Compute new lines added since last capture
    let newContent: string;
    if (lastCapture === "") {
      newContent = output;
    } else if (output.startsWith(lastCapture)) {
      newContent = output.slice(lastCapture.length);
    } else {
      // Pane was cleared or scrolled beyond history; emit full output
      newContent = output;
    }

    if (newContent.trim().length > 0) {
      const header = `=== capture @ ${new Date().toISOString()} ===\n`;
      await appendFile(logPath, header + newContent);

      const filtered =
        sinceMs !== null ? filterSince(header + newContent, sinceMs) : newContent;
      if (filtered.trim().length > 0) {
        process.stdout.write(filtered);
      }
    }

    lastCapture = output;
  };

  // Initial capture
  await printAndAppend();

  // Poll every 2 seconds until SIGINT
  const interval = setInterval(printAndAppend, 2_000);

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log("\n  log      stopped.");
      resolve();
    });
  });
}
