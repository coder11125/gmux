import { SessionStore, type SessionRecord } from "../session-store.ts";

const DOT = { running: "\u25cf", complete: "\u25cb", error: "\u2717" };

function pad(value: string, width: number): string {
  const ansi = value.replace(/\u001b\[\d+m/g, "");
  return value + " ".repeat(Math.max(0, width - ansi.length));
}

export interface ListOptions {
  json?: boolean;
  verbose?: boolean;
}

export async function listSessions(store: SessionStore, opts: ListOptions = {}): Promise<void> {
  const sessions = await store.listSessions();
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (opts.verbose) {
    const rows: string[] = [];
    for (const s of sessions) {
      rows.push(
        [
          s.sessionName,
          `${DOT[s.status] ?? "?"} ${s.status}`,
          s.branchName,
          s.worktreePath,
          s.agentCommand,
          s.tmuxPaneId,
          s.startedAt,
        ].join("\t"),
      );
    }
    console.log(["Name\tStatus\tBranch\tWorktree\tAgent\tPane\tStarted", ...rows].join("\n"));
    return;
  }

  const cols = { name: 0, status: 0, branch: 0, worktree: 0 };

  function measure(rec: SessionRecord) {
    cols.name = Math.max(cols.name, rec.sessionName.length);
    cols.status = Math.max(cols.status, 8);
    cols.branch = Math.max(cols.branch, rec.branchName.length);
    cols.worktree = Math.max(cols.worktree, rec.worktreePath.length);
  }

  const HDR = { name: "Name", status: "Status", branch: "Branch", worktree: "Worktree" };
  measure(HDR as unknown as SessionRecord);
  sessions.forEach(measure);

  const thin = "\u2502";
  const sep = (c: keyof typeof cols) => "\u2500".repeat(cols[c] + 2);

  console.log(` ${pad(HDR.name, cols.name)} ${thin} ${pad(HDR.status, cols.status)} ${thin} ${pad(HDR.branch, cols.branch)} ${thin} ${pad(HDR.worktree, cols.worktree)} `);
  console.log(` ${sep("name")}${thin}${sep("status")}${thin}${sep("branch")}${thin}${sep("worktree")}`);

  for (const s of sessions) {
    const dot = DOT[s.status] ?? "?";
    const status = `${dot} ${s.status}`;
    console.log(` ${pad(s.sessionName, cols.name)} ${thin} ${pad(status, cols.status)} ${thin} ${pad(s.branchName, cols.branch)} ${thin} ${pad(s.worktreePath, cols.worktree)} `);
  }
}
