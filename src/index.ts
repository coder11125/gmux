#!/usr/bin/env bun
import { $ } from "./shell.ts";
import { Command } from "commander";
import { GitWorktreeManager } from "./git-worktree-manager.ts";
import { ConfigProvisioner } from "./config-provisioner.ts";
import { TmuxManager } from "./tmux-manager.ts";
import { AgentExecutor, resolveAgent } from "./agent-executor.ts";
import { ProcessMonitor } from "./process-monitor.ts";
import { TeardownManager } from "./teardown-manager.ts";
import { SessionStore } from "./session-store.ts";
import { listSessions, type ListOptions } from "./commands/list.ts";
import { logSession, type LogOptions } from "./commands/log.ts";
import { doctorSessions, type DoctorOptions } from "./commands/doctor.ts";
import { sessionDiff, showSessionDiffInPager, type DiffOptions } from "./commands/diff.ts";
import { runScript, listScripts } from "./scripts.ts";
import { getCompletion } from "./completion.ts";
import { runUpdate } from "./commands/update.ts";
import { attachSession } from "./commands/attach.ts";
import { detachSession } from "./commands/detach.ts";
import { killSession } from "./commands/kill.ts";
import { renameTarget } from "./commands/rename.ts";
import {
  listWindows as listTmuxWindows,
  createWindow as createTmuxWindow,
  swapWindows,
  setLayout,
} from "./commands/window.ts";
import {
  splitPane,
  resizePane,
  zoomPane,
  convertPaneToWindow,
  joinPane,
} from "./commands/pane.ts";
import {
  showDiffInPane,
  showLogInPane,
  showBlameInPane,
  stashList,
  stashPush,
  stashPop,
  stashDrop,
  createCommit,
  createBranch,
  mergeBranch,
} from "./commands/git.ts";
import type { TmuxLayout, PaneResizeOptions, PaneSplitOptions } from "./types.ts";

const program = new Command();

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function handleError(err: unknown): never {
  console.error(`  error    ${toErrorMessage(err)}`);
  process.exit(1);
}

async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    handleError(err);
  }
}

async function currentTmuxPaneId(): Promise<string> {
  const result = await $`tmux display-message -p "#{pane_id}"`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Unable to determine current tmux pane: ${stderr || "not inside tmux"}`);
  }
  return result.text().trim();
}

async function currentTmuxWindowId(): Promise<string> {
  const result = await $`tmux display-message -p "#{window_id}"`.nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Unable to determine current tmux window: ${stderr || "not inside tmux"}`);
  }
  return result.text().trim();
}

function requireChoice<T extends string>(
  value: string,
  choices: readonly T[],
  label: string,
): T {
  if ((choices as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${label} '${value}'. Use one of: ${choices.join(", ")}.`);
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} '${value}'. Use a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} '${value}'. Use zero or a positive integer.`);
  }
  return parsed;
}

function printWindows(windows: Awaited<ReturnType<typeof listTmuxWindows>>): void {
  if (windows.length === 0) {
    console.log("  No windows found.");
    return;
  }
  console.log("ID\tINDEX\tPANES\tLAYOUT\tNAME");
  for (const w of windows) {
    console.log(`${w.windowId}\t${w.windowIndex}\t${w.paneIds.length}\t${w.layout}\t${w.windowName}`);
  }
}


program
  .name("gmux")
  .description("Launch AI agent sessions in isolated git worktrees + tmux")
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Examples:
  gmux my-session "Build a game" -A codex                  single OpenAI Codex agent
  gmux my-session "Build a game" -A pi                     single pi agent
  gmux my-session "Build a game" -A aider                  single aider agent
  gmux my-session "Build a game" -A aider -a 4             4 aider agents (4 windows)
  gmux my-session "Build a game" -A claude-code -a 4 -p    4 claude-code agents (1 window, 4 panes)
  gmux my-session "Build a game" -A codex -a 4 -p          4 codex agents (1 window, 4 panes)
  gmux list                                                 list tracked sessions
  gmux list --json                                          session state as JSON
  gmux list --verbose                                       detailed session list
  gmux doctor                                               check & repair state
  gmux doctor --json                                        issues as JSON
`,
  );

program
  .command("list")
  .description("List all tracked sessions")
  .option("--json", "output as JSON")
  .option("--verbose", "show detailed columns")
  .action(async (opts: ListOptions) => {
    const store = new SessionStore();
    await listSessions(store, opts);
  });

program
  .command("log <session>")
  .description("Capture tmux pane output for a session and append to a log file")
  .option("--follow", "poll every 2 s and stream new lines to stdout (Ctrl+C to stop)")
  .option("--since <duration>", "filter output to recent captures (e.g. 10m, 1h, 30s)")
  .option("--out <file>", "write to a custom path instead of ~/.gmux/logs/<session>.log")
  .action(async (sessionName: string, opts: LogOptions) => {
    const store = new SessionStore();
    await logSession(store, sessionName, opts);
  });

program
  .command("doctor")
  .description("Check session state against reality")
  .option("--json", "output issues as JSON (no interactive fix)")
  .option("--verbose", "show healthy sessions too")
  .action(async (opts: DoctorOptions) => {
    const store = new SessionStore();
    await doctorSessions(store, opts);
  });

program
  .command("scripts")
  .description("Run session management scripts")
  .argument("[script]", "script name to run (cleanup, health, export, stats)")
  .option("-l, --list", "list available scripts")
  .option("-a, --all", "pass --all flag to script")
  .option("-n, --dry-run", "pass --dry-run flag to script")
  .option("-v, --verbose", "pass --verbose flag to script")
  .option("-f, --force", "pass --force flag to script")
  .option("-j, --json", "pass --json flag to script")
  .option("-o, --output <file>", "pass --output flag to script")
  .option("-d, --max-days <days>", "pass --max-days flag to script")
  .action(async (script: string | undefined, opts: Record<string, unknown>) => {
    if (opts.list) {
      listScripts();
      return;
    }
    if (!script) {
      console.error("  error    Specify a script name or use --list");
      process.exit(1);
    }
    await runScript(script, opts);
  });

program
  .command("update")
  .description("Update gmux to the latest version")
  .option("--force", "re-download even if same version")
  .option("--dry-run", "check for update without making changes")
  .option("--version <tag>", "install a specific version (e.g. v0.2.0)")
  .action(async (opts: { force?: boolean; dryRun?: boolean; version?: string }) => {
    await runUpdate(opts);
  });

program
  .command("completion")
  .description("Generate shell completion scripts")
  .argument("<shell>", "shell type (bash or zsh)")
  .action((shell: string) => {
    const script = getCompletion(shell);
    if (!script) {
      console.error(`  error    Unsupported shell: ${shell}. Use bash or zsh.`);
      process.exit(1);
    }
    console.log(script);
  });


program
  .command("attach <session>")
  .description("Attach to a running session")
  .option("-r, --read-only", "attach in read-only mode")
  .action((sessionName: string, opts: { readOnly?: boolean }) => runCommand(async () => {
    const store = new SessionStore();
    await attachSession(store, { sessionName, readOnly: opts.readOnly });
  }));

program
  .command("detach [session]")
  .description("Detach from the current session")
  .option("--all", "detach from all sessions")
  .action((sessionName: string | undefined, opts: { all?: boolean }) => runCommand(async () => {
    const store = new SessionStore();
    await detachSession(store, { sessionName, all: opts.all });
  }));

program
  .command("kill")
  .description("Kill a session, window, or pane")
  .option("--session <name>", "kill a tracked gmux session and clean up its worktree")
  .option("--window <id>", "kill a tmux window")
  .option("--pane <id>", "kill a tmux pane")
  .option("-f, --force", "skip confirmation prompts when killing sessions")
  .action((opts: { session?: string; window?: string; pane?: string; force?: boolean }) =>
    runCommand(async () => {
      const store = new SessionStore();
      await killSession(store, {
        sessionName: opts.session,
        windowId: opts.window,
        paneId: opts.pane,
        force: opts.force,
      });
    }));

program
  .command("rename <target> <name>")
  .description("Rename a session, window, or pane")
  .option("--id <id>", "identifier of the session/window/pane to rename")
  .action((target: string, name: string, opts: { id?: string }) => runCommand(async () => {
    const renameKind = requireChoice(target, ["session", "window", "pane"] as const, "rename target");
    const store = new SessionStore();
    await renameTarget(store, { target: renameKind, newName: name, targetId: opts.id });
  }));

const windowCommand = program
  .command("window <action>")
  .description("Manage tmux windows")
  .option("--session <name>", "session to list windows for")
  .option("--worktree <path>", "working directory for newly-created windows")
  .option("--source <id>", "source window for swap")
  .option("--target <id>", "target window for swap or layout")
  .option("--layout <type>", "layout for the layout action")
  .argument("[name-or-layout]", "window name for create, or layout for layout")
  .action((action: string, value: string | undefined, opts: {
    session?: string;
    worktree?: string;
    source?: string;
    target?: string;
    layout?: string;
  }) => runCommand(async () => {
    switch (action) {
      case "list": {
        printWindows(await listTmuxWindows(opts.session));
        return;
      }
      case "create": {
        if (!value) throw new Error("Usage: gmux window create <name>");
        const window = await createTmuxWindow(value, opts.worktree ?? process.cwd());
        console.log(`  window   ${window.windowId} ${window.windowName}`);
        return;
      }
      case "swap": {
        if (!opts.source || !opts.target) {
          throw new Error("Usage: gmux window swap --source <src> --target <dst>");
        }
        await swapWindows(opts.source, opts.target);
        console.log(`  window   swapped ${opts.source} and ${opts.target}`);
        return;
      }
      case "layout": {
        const layout = requireChoice(opts.layout ?? value ?? "", [
          "even-horizontal",
          "even-vertical",
          "tiled",
          "main-horizontal",
          "main-vertical",
        ] as const, "layout") as TmuxLayout;
        await setLayout(opts.target ?? await currentTmuxWindowId(), layout);
        console.log(`  window   layout ${layout}`);
        return;
      }
      default:
        throw new Error("Unknown window action. Use list, create, swap, or layout.");
    }
  }));
windowCommand.addHelpText("after", "\nExamples:\n  gmux window list\n  gmux window create scratch\n  gmux window swap --source @1 --target @2\n  gmux window layout tiled --target @1\n");

const paneCommand = program
  .command("pane <action>")
  .description("Manage tmux panes")
  .option("-d, --direction <direction>", "split/join/resize direction")
  .option("--window <id>", "target tmux window")
  .option("--pane <id>", "target tmux pane")
  .option("--size <size>", "new pane size as a percentage (0-1) or cells")
  .option("--source <id>", "source pane for join")
  .option("--target <id>", "target window for join")
  .argument("[arg1]", "resize direction, join source pane, or join target window")
  .argument("[arg2]", "resize amount, join target window, or join direction")
  .argument("[arg3]", "join direction")
  .action((action: string, arg1: string | undefined, arg2: string | undefined, arg3: string | undefined, opts: {
    direction?: string;
    window?: string;
    pane?: string;
    size?: string;
    source?: string;
    target?: string;
  }) => runCommand(async () => {
    switch (action) {
      case "split": {
        const direction = requireChoice(opts.direction ?? arg1 ?? "", ["horizontal", "vertical"] as const, "split direction");
        const size = opts.size === undefined ? undefined : Number.parseFloat(opts.size);
        if (opts.size !== undefined && !Number.isFinite(size)) {
          throw new Error(`Invalid pane size '${opts.size}'.`);
        }
        const options: PaneSplitOptions & { windowId: string } = {
          windowId: opts.window ?? await currentTmuxWindowId(),
          direction,
          size,
          targetPaneId: opts.pane,
        };
        const pane = await splitPane(options);
        console.log(`  pane     ${pane.paneId}`);
        return;
      }
      case "resize": {
        const direction = requireChoice(
          opts.direction ?? arg1 ?? "",
          ["up", "down", "left", "right"] as const,
          "resize direction",
        );
        const amount = parsePositiveInteger(arg2 ?? "", "resize amount");
        await resizePane(
          opts.pane ?? await currentTmuxPaneId(),
          { direction, amount } satisfies PaneResizeOptions,
        );
        console.log(`  pane     resized ${direction} ${amount}`);
        return;
      }
      case "zoom": {
        await zoomPane(opts.pane ?? await currentTmuxPaneId());
        console.log("  pane     zoom toggled");
        return;
      }
      case "break": {
        const window = await convertPaneToWindow(opts.pane ?? await currentTmuxPaneId());
        console.log(`  pane     moved to window ${window.windowId}`);
        return;
      }
      case "join": {
        const source = opts.source ?? arg1;
        const target = opts.target ?? arg2;
        const direction = requireChoice(
          opts.direction ?? arg3 ?? "",
          ["left", "right", "top", "bottom"] as const,
          "join direction",
        );
        if (!source || !target) throw new Error("Usage: gmux pane join <src> <dst> <dir>");
        await joinPane(source, target, direction);
        console.log(`  pane     joined ${source} into ${target}`);
        return;
      }
      default:
        throw new Error("Unknown pane action. Use split, resize, zoom, break, or join.");
    }
  }));
paneCommand.addHelpText(
  "after",
  "\nExamples:\n" +
    "  gmux pane split -d horizontal\n" +
    "  gmux pane resize up 5\n" +
    "  gmux pane zoom\n" +
    "  gmux pane break\n" +
    "  gmux pane join %2 @1 right\n",
);

const gitCommand = program
  .command("git <action>")
  .description("Git overlay commands")
  .option("--path <path>", "restrict git diff/log/blame to a path")
  .option("--staged", "show staged diff")
  .option("--stat", "show diff stat")
  .option("--count <count>", "maximum commits for log")
  .option("--since <date>", "only show commits after this date/ref")
  .option("--oneline", "show compact one-line log")
  .option("--graph", "show ASCII graph in log")
  .option("-m, --message <message>", "commit/stash message")
  .option("-a, --all", "commit all tracked changes")
  .argument("[arg1]", "file, branch, stash action, or stash index")
  .argument("[arg2]", "stash index")
  .action((action: string, arg1: string | undefined, arg2: string | undefined, opts: {
    path?: string;
    staged?: boolean;
    stat?: boolean;
    count?: string;
    since?: string;
    oneline?: boolean;
    graph?: boolean;
    message?: string;
    all?: boolean;
  }) => runCommand(async () => {
    const worktreePath = process.cwd();
    switch (action) {
      case "status": {
        const result = await $`git status --short`.cwd(worktreePath).quiet().nothrow();
        if (result.exitCode !== 0) {
          throw new Error(`Failed to get git status: ${result.stderr.toString().trim()}`);
        }
        process.stdout.write(result.text());
        return;
      }
      case "diff": {
        await showDiffInPane(await currentTmuxPaneId(), worktreePath, {
          path: opts.path,
          staged: opts.staged,
          statOnly: opts.stat,
        });
        return;
      }
      case "log": {
        await showLogInPane(await currentTmuxPaneId(), worktreePath, {
          path: opts.path,
          count: opts.count ? parsePositiveInteger(opts.count, "commit count") : undefined,
          since: opts.since,
          oneline: opts.oneline,
          graph: opts.graph,
        });
        return;
      }
      case "blame": {
        const filePath = arg1 ?? opts.path;
        if (!filePath) throw new Error("Usage: gmux git blame <file>");
        await showBlameInPane(await currentTmuxPaneId(), worktreePath, filePath);
        return;
      }
      case "stash": {
        const stashAction = arg1;
        if (stashAction === "list") {
          const stashes = await stashList(worktreePath);
          if (stashes.length === 0) {
            console.log("  No stashes found.");
            return;
          }
          for (const stash of stashes) {
            console.log(`stash@{${stash.stashIndex}}\t${stash.branchName}\t${stash.message}`);
          }
          return;
        }
        if (stashAction === "push") {
          await stashPush(worktreePath, opts.message);
          console.log("  git      stash pushed");
          return;
        }
        if (stashAction === "pop") {
          await stashPop(
            worktreePath,
            arg2 === undefined ? undefined : parseNonNegativeInteger(arg2, "stash index"),
          );
          console.log("  git      stash popped");
          return;
        }
        if (stashAction === "drop") {
          if (arg2 === undefined) throw new Error("Usage: gmux git stash drop <index>");
          await stashDrop(worktreePath, parseNonNegativeInteger(arg2, "stash index"));
          console.log("  git      stash dropped");
          return;
        }
        throw new Error("Usage: gmux git stash <list|push|pop|drop>");
      }
      case "commit": {
        if (!opts.message) throw new Error("Usage: gmux git commit -m <msg>");
        await createCommit(worktreePath, opts.message, { all: opts.all });
        console.log("  git      commit created");
        return;
      }
      case "branch": {
        if (!arg1) throw new Error("Usage: gmux git branch <name>");
        await createBranch(worktreePath, arg1);
        console.log(`  git      branch ${arg1}`);
        return;
      }
      case "merge": {
        if (!arg1) throw new Error("Usage: gmux git merge <branch>");
        await mergeBranch(worktreePath, arg1);
        console.log(`  git      merged ${arg1}`);
        return;
      }
      default:
        throw new Error("Unknown git action. Use status, diff, log, blame, stash, commit, branch, or merge.");
    }
  }));
gitCommand.addHelpText(
  "after",
  "\nExamples:\n" +
    "  gmux git status\n" +
    "  gmux git diff\n" +
    "  gmux git log --graph --oneline\n" +
    "  gmux git blame src/index.ts\n" +
    "  gmux git stash list\n" +
    "  gmux git stash drop 0\n" +
    "  gmux git commit -m 'message'\n" +
    "  gmux git branch feature\n" +
    "  gmux git merge feature\n",
);

program
  .command("diff <session>")
  .description("Show what an agent has changed in its worktree vs the base branch")
  .option("--stat", "show file-level summary only")
  .option("--staged", "show only staged changes")
  .option("--base <branch>", "compare against this branch (default: auto-detect main/master)")
  .option("--path <path>", "restrict diff to a file or directory")
  .option("--no-pager", "print raw diff to stdout instead of opening less")
  .action(async (sessionName: string, opts: DiffOptions & { pager?: boolean }) => {
    const store = new SessionStore();
    const record = await store.getSession(sessionName);
    if (!record) {
      console.error(`  error    Session '${sessionName}' not found`);
      process.exit(1);
    }
    if (opts.pager === false) {
      const diff = await sessionDiff(record.worktreePath, opts);
      if (!diff) {
        console.log("  No changes found.");
      } else {
        process.stdout.write(diff);
      }
    } else {
      await showSessionDiffInPager(record.worktreePath, opts);
    }
  });

program
  .argument("<session-name>", "name of the agent session")
  .argument("<agent-prompt>", "prompt to send to the agent")
  .option("-A, --agent <name>", "agent command (overrides .gmuxrc)")
  .option("-a, --agents <number>", "number of agent instances", "1")
  .option("-p, --panes", "show all agents in split panes (one window)")
  .option("--auto-merge", "skip merge prompt and auto-merge branches")
  .action(
    async (
      sessionName: string,
      agentPrompt: string,
      options: { agent?: string; agents: string; panes?: boolean; autoMerge?: boolean },
    ) => {
      const executor = new AgentExecutor();
      const worktreeManager = new GitWorktreeManager();
      const provisioner = new ConfigProvisioner();
      const tmux = new TmuxManager();
      const store = new SessionStore();
      const teardown = new TeardownManager();
      const monitor = new ProcessMonitor();

      const agent = options.agent ?? (await resolveAgent());
      if (!agent) throw new Error("No agent configured. Set one via -A, .gmuxrc, or ~/.gmuxrc");
      const count = Math.max(1, parseInt(options.agents, 10) || 1);
      const createdWorktrees: string[] = [];
      const createdWindows: string[] = [];
      const createdSessionNames: string[] = [];

      let interrupted = false;
      const onSignal = async () => {
        if (interrupted) process.exit(1);
        interrupted = true;
        console.error("\n  interrupt  cleaning up...");
        for (const winId of createdWindows) {
          await $`tmux kill-window -t ${winId}`.nothrow();
        }
        for (const name of createdSessionNames) {
          await store.removeSession(name).catch(() => {});
        }
        for (const wt of createdWorktrees) {
          await $`git worktree remove --force ${wt}`.nothrow();
        }
        await $`git worktree prune`.nothrow();
        process.exit(1);
      };
      process.on("SIGINT", onSignal);

      try {
        const instances: Array<{
          name: string;
          branch: string;
          worktreePath: string;
        }> = [];

        for (let i = 1; i <= count; i++) {
          const hex = (await $`openssl rand -hex 4`.text()).trim();
          const instanceName = `${sessionName}-${hex}`;
          const branchName = `gmux-${instanceName}`;

          console.log(`  create   worktree ${branchName}`);
          const worktreePath = await worktreeManager.add(instanceName);
          createdWorktrees.push(worktreePath);

          console.log(`  provision ${worktreePath}`);
          await provisioner.provision(worktreePath);

          instances.push({ name: instanceName, branch: branchName, worktreePath });
        }

        if (options.panes && count > 1) {
          const paths = instances.map((i) => i.worktreePath);
          console.log(`  window   ${sessionName} (${count} panes)`);
          const { windowId, paneIds } = await tmux.createWindowWithPanes(sessionName, paths);

          for (let i = 0; i < count; i++) {
            const inst = instances[i]!;
            const paneId = paneIds[i]!;

            console.log(`  launch   #${i + 1} ${agent}`);
            await executor.execute(paneId, inst.worktreePath, agentPrompt, agent);

            await store.addSession({
              sessionName: inst.name,
              branchName: inst.branch,
              worktreePath: inst.worktreePath,
              tmuxWindowId: windowId,
              tmuxPaneId: paneId,
              agentCommand: agent,
              status: "running",
              startedAt: new Date().toISOString(),
            });
            createdWindows.push(windowId);
            createdSessionNames.push(inst.name);

            monitor.add(inst.name, paneId, agent);
          }
        } else {
          for (const inst of instances) {
            console.log(`  window   ${inst.name}`);
            const { windowId, paneId } = await tmux.createWindow(inst.name, inst.worktreePath);

            console.log(`  launch   ${agent}`);
            await executor.execute(paneId, inst.worktreePath, agentPrompt, agent);

            await store.addSession({
              sessionName: inst.name,
              branchName: inst.branch,
              worktreePath: inst.worktreePath,
              tmuxWindowId: windowId,
              tmuxPaneId: paneId,
              agentCommand: agent,
              status: "running",
              startedAt: new Date().toISOString(),
            });
            createdWindows.push(windowId);
            createdSessionNames.push(inst.name);

            monitor.add(inst.name, paneId, agent);
          }
        }

        monitor.onIdle = async (idleName, _paneId) => {
          const record = await store.getSession(idleName);
          if (!record) return;
          monitor.remove(idleName);
          await teardown.teardown({
            sessionName: idleName,
            worktreePath: record.worktreePath,
            windowId: record.tmuxWindowId,
            autoMerge: options.autoMerge,
          });
          await store.updateStatus(idleName, "complete");
        };

        monitor.start();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  error    ${msg}`);
        for (const wt of createdWorktrees) {
          await $`git worktree remove --force ${wt}`.nothrow();
        }
        await $`git worktree prune`.nothrow();
        process.exit(1);
      } finally {
        process.removeListener("SIGINT", onSignal);
      }
    },
  );

program.parse();
