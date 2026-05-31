#!/usr/bin/env bun
import { $ } from "./shell.ts";
import Path from "node:path";

const SCRIPTS_DIR = Path.join(import.meta.dir, "..", "scripts");

interface ScriptInfo {
  name: string;
  category: "session" | "git" | "monitoring" | "utility";
  description: string;
  usage: string;
}

const AVAILABLE_SCRIPTS: ScriptInfo[] = [
  // Session scripts
  {
    name: "cleanup",
    category: "session",
    description: "Remove stale sessions/worktrees older than N days",
    usage: "gmux scripts cleanup [--max-days 7] [--dry-run] [--force]",
  },
  {
    name: "health",
    category: "session",
    description: "Check session health and repair issues",
    usage: "gmux scripts health [--repair] [--verbose]",
  },
  {
    name: "export",
    category: "session",
    description: "Export session configuration",
    usage: "gmux scripts export [session-name] [--all] [--format json|yaml|toml]",
  },
  {
    name: "stats",
    category: "session",
    description: "Show session usage statistics",
    usage: "gmux scripts stats [--json] [--verbose]",
  },
  // Git scripts
  {
    name: "auto-commit",
    category: "git",
    description: "Auto-commit changes with smart messages",
    usage: "gmux scripts auto-commit [--all] [--conventional] [--message MSG]",
  },
  {
    name: "branch-cleanup",
    category: "git",
    description: "Delete merged branches automatically",
    usage: "gmux scripts branch-cleanup [--merged-only] [--older-than DAYS] [--dry-run]",
  },
  {
    name: "conflict-helper",
    category: "git",
    description: "Interactive conflict resolution",
    usage: "gmux scripts conflict-helper [--auto-resolve ours|theirs|both]",
  },
  {
    name: "pr-ready",
    category: "git",
    description: "Prepare branch for PR",
    usage: "gmux scripts pr-ready [--skip-tests] [--skip-lint] [--force]",
  },
  // Monitoring scripts
  {
    name: "watcher",
    category: "monitoring",
    description: "Monitor agent output for errors",
    usage: "gmux scripts watcher [--interval 5] [--session NAME] [--tail]",
  },
  {
    name: "notifier",
    category: "monitoring",
    description: "Send notifications on session events",
    usage: "gmux scripts notifier [--webhook URL] [--slack URL] [--discord URL] [--sound]",
  },
  {
    name: "logger",
    category: "monitoring",
    description: "Capture tmux pane output to files",
    usage: "gmux scripts logger [--interval 10] [--rotate] [--compress]",
  },
  // Utility scripts
  {
    name: "backup",
    category: "utility",
    description: "Backup sessions and config files",
    usage: "gmux scripts backup [--compress] [--keep-count 5] [--dry-run]",
  },
  {
    name: "restore",
    category: "utility",
    description: "Restore from backup",
    usage: "gmux scripts restore [--list] [--file FILE] [--force]",
  },
  {
    name: "diagnostics",
    category: "utility",
    description: "System health check",
    usage: "gmux scripts diagnostics [--verbose] [--json]",
  },
];

export function listScripts(): void {
  const sessionScripts = AVAILABLE_SCRIPTS.filter((s) => s.category === "session");
  const gitScripts = AVAILABLE_SCRIPTS.filter((s) => s.category === "git");
  const monitoringScripts = AVAILABLE_SCRIPTS.filter((s) => s.category === "monitoring");
  const utilityScripts = AVAILABLE_SCRIPTS.filter((s) => s.category === "utility");

  console.log("=== Available Session Scripts ===\n");
  for (const script of sessionScripts) {
    console.log(`  ${script.name}`);
    console.log(`    ${script.description}`);
    console.log(`    Usage: ${script.usage}`);
    console.log();
  }

  console.log("=== Available Git Scripts ===\n");
  for (const script of gitScripts) {
    console.log(`  ${script.name}`);
    console.log(`    ${script.description}`);
    console.log(`    Usage: ${script.usage}`);
    console.log();
  }

  console.log("=== Available Monitoring Scripts ===\n");
  for (const script of monitoringScripts) {
    console.log(`  ${script.name}`);
    console.log(`    ${script.description}`);
    console.log(`    Usage: ${script.usage}`);
    console.log();
  }

  console.log("=== Available Utility Scripts ===\n");
  for (const script of utilityScripts) {
    console.log(`  ${script.name}`);
    console.log(`    ${script.description}`);
    console.log(`    Usage: ${script.usage}`);
    console.log();
  }
}

export async function runScript(
  scriptName: string,
  options: Record<string, unknown> = {},
): Promise<void> {
  const script = AVAILABLE_SCRIPTS.find((s) => s.name === scriptName);
  if (!script) {
    console.error(`  error    Unknown script: ${scriptName}`);
    console.error(`  hint     Run 'gmux scripts --list' to see available scripts`);
    process.exit(1);
  }

  const scriptDir = Path.join(SCRIPTS_DIR, script.category);
  // Only git scripts remain in Ruby; all others migrated to Python
  let ext = ".py";
  if (script.category === "git") {
    ext = ".rb";
  }
  const scriptPath = Path.join(scriptDir, `${scriptName}${ext}`);

  // Build command arguments
  const args: string[] = [];

  // Common options
  if (options.all) args.push("--all");
  if (options.dryRun) args.push("--dry-run");
  if (options.verbose) args.push("--verbose");
  if (options.force) args.push("--force");
  if (options.json) args.push("--json");
  if (options.output) args.push("--output", String(options.output));
  if (options.maxDays) args.push("--max-days", String(options.maxDays));

  // Git-specific options
  if (script.category === "git") {
    if (options.mergedOnly) args.push("--merged-only");
    if (options.olderThan) args.push("--older-than", String(options.olderThan));
    if (options.keep) args.push("--keep", String(options.keep));
    if (options.worktree) args.push("--worktree", String(options.worktree));
    if (options.message) args.push("--message", String(options.message));
    if (options.conventional) args.push("--conventional");
    if (options.autoResolve) args.push("--auto-resolve", String(options.autoResolve));
    if (options.skipTests) args.push("--skip-tests");
    if (options.skipLint) args.push("--skip-lint");
  }

  // Monitoring-specific options
  if (script.category === "monitoring") {
    if (options.interval) args.push("--interval", String(options.interval));
    if (options.session) args.push("--session", String(options.session));
    if (options.tail) args.push("--tail");
    if (options.webhook) args.push("--webhook", String(options.webhook));
    if (options.slack) args.push("--slack", String(options.slack));
    if (options.discord) args.push("--discord", String(options.discord));
    if (options.telegram) args.push("--telegram", String(options.telegram));
    if (options.email) args.push("--email", String(options.email));
    if (options.sound) args.push("--sound");
    if (options.notifyOn) args.push("--notify-on", String(options.notifyOn));
    if (options.logDir) args.push("--log-dir", String(options.logDir));
    if (options.rotate) args.push("--rotate");
    if (options.maxSize) args.push("--max-size", String(options.maxSize));
    if (options.compress) args.push("--compress");
    if (options.format) args.push("--format", String(options.format));
  }

  // Utility-specific options
  if (script.category === "utility") {
    if (options.keepCount) args.push("--keep-count", String(options.keepCount));
    if (options.list) args.push("--list");
    if (options.file) args.push("--file", String(options.file));
  }

  try {
    console.log(`  run      ${scriptName}`);
    const runtime = script.category === "git" ? "ruby" : "python3";
    const result = await $`${runtime} ${scriptPath} ${args}`.text();
    console.log(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  error    Script failed: ${msg}`);
    process.exit(1);
  }
}
