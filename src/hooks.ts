import { $ } from "bun";
import type { HookConfig } from "./types.ts";
import type { ConfigManager } from "./config.ts";

/**
 * Valid hook event names that gmux subsystems can fire.
 */
type HookEvent = HookConfig["event"];

/** Template variable regex – matches ${VAR_NAME} or $VAR_NAME patterns. */
const CONTEXT_VAR_RE = /\$\{(\w+)\}|\$(\w+)/g;

/**
 * Manages lifecycle hooks that execute shell commands in response to gmux
 * events such as session creation, pane kills, and git operations.
 */
export class HookManager {
  private hooks: Map<string, HookConfig[]>;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.hooks = new Map();
    this.configManager = configManager;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Register a new hook for the given event.
   */
  register(event: HookEvent, command: string): void {
    const list = this.hooks.get(event) ?? [];
    // Avoid exact-duplicate commands
    if (!list.some((h) => h.command === command)) {
      list.push({ event, command });
      this.hooks.set(event, list);
    }
  }

  /**
   * Remove a previously registered hook.
   * Returns `true` if a hook was removed, `false` otherwise.
   */
  unregister(event: HookEvent, command: string): boolean {
    const list = this.hooks.get(event);
    if (!list) return false;

    const idx = list.findIndex((h) => h.command === command);
    if (idx === -1) return false;

    list.splice(idx, 1);

    if (list.length === 0) {
      this.hooks.delete(event);
    }

    return true;
  }

  /**
   * Execute every hook registered for the given event. Context variables
   * (`${SESSION_NAME}`, `${WORKTREE_PATH}`, …) inside each command are
   * replaced with the values supplied in `context`.
   *
   * Hooks run sequentially so that ordering is deterministic.
   * A failing hook does **not** abort the remaining hooks.
   */
  async execute(
    event: HookEvent,
    context: Record<string, string> = {},
  ): Promise<void> {
    const list = this.hooks.get(event);
    if (!list || list.length === 0) return;

    for (const hook of list) {
      const cmd = substituteVars(hook.command, context);
      try {
        const result = await $`${["sh", "-c", cmd]}`.nothrow();
        if (result.exitCode !== 0) {
          console.error(
            `[gmux] Hook failed (${event}): ${cmd}\n${result.stderr.toString().trim()}`,
          );
        }
      } catch (err) {
        console.error(`[gmux] Hook error (${event}): ${cmd}`, err);
      }
    }
  }

  /**
   * Return all hooks registered for a specific event.
   */
  getHooks(event: HookEvent): HookConfig[] {
    return [...(this.hooks.get(event) ?? [])];
  }

  /**
   * Remove all registered hooks from memory.
   */
  clear(): void {
    this.hooks.clear();
  }

  /**
   * Load hooks from the persisted gmux config and populate the internal map.
   */
  async loadFromConfig(): Promise<void> {
    const cfg = this.configManager.getConfig();
    this.hooks.clear();

    for (const hook of cfg.hooks) {
      const list = this.hooks.get(hook.event) ?? [];
      list.push(hook);
      this.hooks.set(hook.event, list);
    }
  }

  /**
   * Convenience helper – fire all hooks for a given event, loading from
   * config first if the internal map is empty.
   */
  async fire(event: HookEvent, context?: Record<string, string>): Promise<void> {
    if (this.hooks.size === 0) {
      await this.loadFromConfig();
    }
    await this.execute(event, context);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace `${VAR}` or `$VAR` placeholders in `template` with values from
 * `vars`. Unknown variables are replaced with an empty string.
 */
function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(CONTEXT_VAR_RE, (match, named, positional) => {
    const key = named ?? positional;
    return vars[key] ?? "";
  });
}
