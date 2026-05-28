import { $ } from "bun";
import { cp, readFile, readdir, stat } from "node:fs/promises";
import Path from "node:path";

const ALWAYS_COPY = new Set([".env", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export class ConfigProvisioner {
  async provision(worktreePath: string): Promise<void> {
    const source =
      (await $`git rev-parse --show-toplevel`.nothrow()).text().trim() ||
      process.cwd();

    const ignorePatterns = await this.loadIgnorePatterns(source);

    const entries = await readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;

      if (name === ".git" || name === "node_modules") continue;
      if (name.startsWith(".gmux")) continue;

      const shouldIgnore = ignorePatterns.some((p) => this.matchPattern(p, name));

      if (shouldIgnore && !ALWAYS_COPY.has(name)) continue;

      const srcPath = Path.join(source, name);
      const destPath = Path.join(worktreePath, name);

      await cp(srcPath, destPath, { recursive: true, force: true });

      const entryStat = await stat(srcPath);
      const label = entryStat.isDirectory() ? "dir " : "file";
      console.log(`  copied ${label}  ${name}`);
    }

    const packageJsonExists =
      (await $`test -f ${Path.join(worktreePath, "package.json")}`.nothrow()).exitCode === 0;

    if (packageJsonExists) {
      console.log("  hook    bun install");
      const install = await $`bun install`.cwd(worktreePath).nothrow();
      if (install.exitCode !== 0) {
        console.error(`  error   bun install failed:\n${install.stderr.toString().trim()}`);
      }
    }

    const hookPath = Path.join(source, ".gmux", "provision.sh");
    const hookExists =
      (await $`test -f ${hookPath}`.nothrow()).exitCode === 0;

    if (hookExists) {
      console.log(`  hook    .gmux/provision.sh`);
      const hook = await $`bash ${hookPath} ${worktreePath}`.cwd(worktreePath).nothrow();
      if (hook.exitCode !== 0) {
        console.error(`  error   .gmux/provision.sh exited with code ${hook.exitCode}`);
      }
    }
  }

  private async loadIgnorePatterns(source: string): Promise<string[]> {
    const ignorePath = Path.join(source, ".gmuxignore");
    const exists =
      (await $`test -f ${ignorePath}`.nothrow()).exitCode === 0;
    if (!exists) return [];

    const content = await readFile(ignorePath, "utf-8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
  }

  private matchPattern(pattern: string, name: string): boolean {
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")}$`,
    );
    return regex.test(name);
  }
}
