import { $ } from "bun";
import type { KeyBinding } from "./types.ts";
import type { ConfigManager } from "./config.ts";

/**
 * Manages custom tmux key bindings — reading them from config, applying
 * them to a running tmux server, and exporting them in `tmux.conf` syntax.
 */
export class KeyBindingManager {
  private bindings: Map<string, KeyBinding>;
  private prefixKey: string;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.bindings = new Map();
    this.configManager = configManager;
    this.prefixKey = configManager.getConfig().prefixKey;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Load key bindings from the persisted gmux config, replacing any
   * in-memory bindings.
   */
  async load(): Promise<void> {
    const cfg = this.configManager.getConfig();
    this.prefixKey = cfg.prefixKey;
    this.bindings.clear();

    for (const binding of cfg.keyBindings) {
      this.bindings.set(binding.key, { ...binding });
    }

    // Always include built-in defaults when not overridden by user config
    for (const def of DEFAULT_BINDINGS) {
      if (!this.bindings.has(def.key)) {
        this.bindings.set(def.key, { ...def });
      }
    }
  }

  /**
   * Bind (or rebind) a single key to a tmux command.
   */
  bind(key: string, command: string, description?: string): void {
    this.bindings.set(key, {
      key,
      command,
      description: description ?? command,
    });
  }

  /**
   * Remove a binding by key.
   * Returns `true` if a binding was removed, `false` if it didn't exist.
   */
  unbind(key: string): boolean {
    return this.bindings.delete(key);
  }

  /**
   * Return all current bindings as an ordered array.
   */
  list(): KeyBinding[] {
    return [...this.bindings.values()];
  }

  /**
   * Apply all current bindings to the running tmux server.
   *
   * Each binding is applied with:
   *   `tmux bind-key -T prefix <key> <command>`
   *
   * If the binding's command starts with `send-keys`, it's forwarded as-is;
   * otherwise the command is wrapped so tmux executes it as a shell command.
   */
  async applyToTmux(): Promise<void> {
    for (const binding of this.bindings.values()) {
      const tmuxCmd = buildTmuxBindCommand(binding);
      const result = await $`${tmuxCmd}`.nothrow();
      if (result.exitCode !== 0) {
        console.error(
          `[gmux] Failed to bind key '${binding.key}': ${result.stderr.toString().trim()}`,
        );
      }
    }
  }

  /**
   * Remove all custom bindings from the tmux server (`unbind-key -a`).
   *
   * **Warning**: this clears *every* binding in the prefix table. Use
   * `applyToTmux()` afterwards to re-apply the desired set.
   */
  async clearTmuxBindings(): Promise<void> {
    await $`tmux unbind-key -a`.nothrow();
  }

  /**
   * Return the binding for a specific key, or `undefined` if none exists.
   */
  getBinding(key: string): KeyBinding | undefined {
    return this.bindings.get(key);
  }

  /**
   * Export all bindings as a `tmux.conf` compatible string.
   *
   * Example output:
   * ```
   * # Refresh tmux client
   * bind-key -T prefix r refresh-client
   *
   * # Open git status popup
   * bind-key -T prefix g display-popup -E "git status"
   * ```
   */
  exportAsTmuxConf(): string {
    const lines: string[] = [];

    for (const binding of this.bindings.values()) {
      if (binding.description) {
        lines.push(`# ${binding.description}`);
      }
      const escapedCmd = escapeTmuxConfValue(binding.command);
      lines.push(`bind-key -T prefix ${binding.key} ${escapedCmd}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Synchronise the internal bindings map back to the persisted config
   * (excluding the built-in defaults that aren't user-defined).
   */
  async saveToConfig(): Promise<void> {
    const userBindings: KeyBinding[] = [];

    for (const binding of this.bindings.values()) {
      const isDefault = DEFAULT_BINDINGS.some(
        (d) => d.key === binding.key && d.command === binding.command,
      );
      if (!isDefault) {
        userBindings.push(binding);
      }
    }

    await this.configManager.updateConfig({ keyBindings: userBindings });
  }
}

// ---------------------------------------------------------------------------
// Default / built-in bindings
// ---------------------------------------------------------------------------

const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  { key: "r", command: "refresh-client", description: "Refresh tmux client" },
  { key: "g", command: 'display-popup -E "git status"', description: "Open git status popup" },
  { key: "d", command: "detach-client", description: "Detach from session" },
  { key: "s", command: "choose-tree -s", description: "Session list" },
  { key: "w", command: "choose-window", description: "Window list" },
  { key: "p", command: 'display-message -p "#{pane_id}"', description: "Show pane ID" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the full `tmux bind-key` command array for a single binding.
 *
 * Commands that are tmux-native (not shell) are mapped directly. Shell
 * commands are wrapped with `run-shell`.
 */
function buildTmuxBindCommand(binding: KeyBinding): string[] {
  const isTmuxNative = TMUX_NATIVE_CMDS.some((prefix) =>
    binding.command.startsWith(prefix),
  );

  if (isTmuxNative) {
    // Split the command string into individual tokens so each argument is
    // passed separately — interpolating the whole string as one element would
    // cause Bun's $ to quote it as a single tmux argument.
    return ["tmux", "bind-key", "-T", "prefix", binding.key, ...tokenizeCommand(binding.command)];
  }

  // Wrap shell commands with run-shell so tmux executes them in the background
  return ["tmux", "bind-key", "-T", "prefix", binding.key, "run-shell", binding.command];
}

/**
 * Split a command string into tokens, respecting single- and double-quoted
 * sections so quoted arguments are kept as a single token.
 *
 * e.g. `display-popup -E "git status"` → `["display-popup", "-E", "git status"]`
 */
function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * tmux command prefixes that are native tmux commands (don't need `run-shell`).
 */
const TMUX_NATIVE_CMDS: readonly string[] = [
  "refresh-client",
  "detach-client",
  "choose-tree",
  "choose-window",
  "choose-session",
  "display-popup",
  "display-message",
  "split-window",
  "new-window",
  "kill-window",
  "kill-pane",
  "resize-pane",
  "select-pane",
  "select-window",
  "next-window",
  "previous-window",
  "last-window",
  "swap-pane",
  "move-pane",
  "rename-window",
  "set-option",
  "set-window-option",
  "source-file",
  "source",
  "send-keys",
  "copy-mode",
  "paste-buffer",
  "save-buffer",
  "load-buffer",
  "capture-pane",
];

/**
 * Escape special characters for `tmux.conf` value strings.
 * Double-quotes and backslashes must be escaped.
 */
function escapeTmuxConfValue(value: string): string {
  // If the value already contains spaces or special chars, wrap in quotes
  if (/[ "#\\]/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}
