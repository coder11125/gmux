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
import { doctorSessions, type DoctorOptions } from "./commands/doctor.ts";
import { runScript, listScripts } from "./scripts.ts";
import { getCompletion } from "./completion.ts";

const program = new Command();

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

      let interrupted = false;
      const onSignal = async () => {
        if (interrupted) process.exit(1);
        interrupted = true;
        console.error("\n  interrupt  cleaning up...");
        for (const wt of createdWorktrees) {
          await $`git worktree remove ${wt}`.nothrow();
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
