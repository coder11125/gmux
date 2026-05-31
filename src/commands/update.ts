import { spawn } from "node:child_process";
import Path from "node:path";

export interface UpdateOptions {
  force?: boolean;
  dryRun?: boolean;
  version?: string;
}

// Resolve gmux-update binary: next to this script in dev, next to the gmux
// binary in production (both live in dist/).
function resolveUpdateBin(): string {
  const candidates = [
    Path.join(Path.dirname(Bun.argv[1]!), "gmux-update"),
    Path.join(import.meta.dir, "..", "..", "dist", "gmux-update"),
  ];
  for (const p of candidates) {
    try {
      const stat = Bun.file(p);
      if (stat.size > 0) return p;
    } catch {
      // not found — try next
    }
  }
  return "";
}

export async function runUpdate(opts: UpdateOptions = {}): Promise<void> {
  const bin = resolveUpdateBin();
  if (!bin) {
    console.error("  error    gmux-update binary not found");
    console.error("  hint     Build it first: bun run build:go");
    process.exit(2);
  }

  const args: string[] = [];
  if (opts.force) args.push("--force");
  if (opts.dryRun) args.push("--dry-run");
  if (opts.version) args.push("--version", opts.version);

  const child = spawn(bin, args, {
    stdio: ["ignore", "inherit", "inherit"],
  });

  return new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else if (code === 1) resolve(); // up-to-date is not an error
      else process.exit(code ?? 2);
    });
    child.on("error", (err) => {
      console.error(`  error    Failed to start updater: ${err.message}`);
      process.exit(2);
    });
  });
}
