import { $ } from "../shell.ts";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import Path from "node:path";

export interface DiffOptions {
  stat?: boolean;
  staged?: boolean;
  base?: string;
  path?: string;
  pager?: boolean;
}

async function findMergeBase(worktreePath: string, base?: string): Promise<string> {
  const candidates = base
    ? [base]
    : ["main", "master", "origin/main", "origin/master"];

  for (const branch of candidates) {
    const result = await $`git merge-base HEAD ${branch}`.cwd(worktreePath).nothrow();
    if (result.exitCode === 0) return result.text().trim();
  }
  return "";
}

export async function sessionDiff(worktreePath: string, options: DiffOptions = {}): Promise<string> {
  try {
    const args: string[] = ["git", "diff"];

    if (options.staged) {
      args.push("--cached");
    } else {
      const mergeBase = await findMergeBase(worktreePath, options.base);
      if (mergeBase) args.push(mergeBase);
    }

    if (options.stat) args.push("--stat");

    if (options.path) args.push("--", options.path);

    const result = await $`${args}`.cwd(worktreePath).nothrow();
    if (result.exitCode !== 0) return "";
    return result.text();
  } catch {
    return "";
  }
}

export async function showSessionDiffInPager(worktreePath: string, options: DiffOptions = {}): Promise<void> {
  const diff = await sessionDiff(worktreePath, options);
  if (!diff) {
    console.log("  No changes found.");
    return;
  }
  const tmp = Path.join(tmpdir(), `gmux-diff-${Date.now()}.txt`);
  await writeFile(tmp, diff);
  const proc = Bun.spawn(["less", "-R", tmp], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  await $`rm -f ${tmp}`.nothrow();
}
