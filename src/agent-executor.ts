import { $ } from "bun";
import { readFile } from "node:fs/promises";
import Path from "node:path";
import { homedir } from "node:os";

async function tryReadAgent(...candidates: string[]): Promise<string | null> {
  for (const file of candidates) {
    const ok = (await $`test -f ${file}`.nothrow()).exitCode === 0;
    if (!ok) continue;
    try {
      const content = await readFile(file, "utf-8");
      const config = JSON.parse(content);
      if (typeof config.agent === "string" && config.agent.length > 0) {
        return config.agent;
      }
    } catch {}
  }
  return null;
}

export async function resolveAgent(): Promise<string | null> {
  const repoRoot = (await $`git rev-parse --show-toplevel`.nothrow()).text().trim();
  const candidates = [
    Path.join(process.cwd(), ".gmuxrc"),
    ...(repoRoot ? [Path.join(repoRoot, ".gmuxrc")] : []),
    Path.join(homedir(), ".gmuxrc"),
  ];
  return tryReadAgent(...candidates);
}

export function shellQuote(arg: string): string {
  if (!/[^\w/.\-_:@,=+~]/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export class AgentExecutor {
  async execute(
    paneId: string,
    worktreePath: string,
    prompt: string,
    agent?: string,
  ): Promise<void> {
    const resolved = agent ?? (await resolveAgent());
    if (!resolved) throw new Error("No agent configured. Set one via -A, .gmuxrc, or ~/.gmuxrc");
    const escapedPrompt = shellQuote(prompt);

    const agentCommand = resolved.includes("{prompt}")
      ? resolved.replace(/\{prompt\}/g, escapedPrompt)
      : `${resolved} ${escapedPrompt}`;

    const quotedPath = shellQuote(worktreePath);
    const command = `cd ${quotedPath} && ${agentCommand}`;

    const result = await $`tmux send-keys -t ${paneId} ${command} C-m`.nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(
        stderr.includes("no such pane")
          ? `Pane ${paneId} not found.`
          : stderr.includes("no current session")
            ? "No active tmux session. Start a session first."
            : `Failed to dispatch to tmux: ${stderr}`,
      );
    }
  }
}
