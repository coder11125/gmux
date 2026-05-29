import { $ } from "bun";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import Path from "node:path";
import { homedir } from "node:os";
import type { GmuxConfig, StatusBarConfig, GitOverlayConfig, HookConfig, KeyBinding } from "./types.ts";

const CONFIG_DIR = Path.join(homedir(), ".gmux");
const CONFIG_FILE = Path.join(CONFIG_DIR, "config.json");

/**
 * Manages gmux configuration — loading, saving, validating, and applying
 * tmux options derived from the user's preferences.
 */
export class ConfigManager {
  private config: GmuxConfig;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? CONFIG_FILE;
    this.config = ConfigManager.getDefaultConfig();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Load the config from disk (or fall back to defaults).
   * Merges any missing fields from the default config so that every key is
   * always present after loading.
   */
  async load(): Promise<GmuxConfig> {
    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      this.config = mergeDeep(ConfigManager.getDefaultConfig(), parsed);
      return this.config;
    } catch {
      // File missing or unparseable → use defaults
      this.config = ConfigManager.getDefaultConfig();
      return this.config;
    }
  }

  /**
   * Persist the current in-memory config to disk as pretty-printed JSON.
   */
  async save(): Promise<void> {
    await mkdir(Path.dirname(this.configPath), { recursive: true });
    const json = JSON.stringify(this.config, null, 2) + "\n";
    await writeFile(this.configPath, json, "utf-8");
  }

  /**
   * Return the current in-memory config snapshot.
   */
  getConfig(): GmuxConfig {
    return this.config;
  }

  /**
   * Merge a partial update into the current config and persist.
   */
  async updateConfig(updates: Partial<GmuxConfig>): Promise<void> {
    this.config = mergeDeep(this.config, updates);
    await this.save();
  }

  /**
   * Factory for the full default configuration.
   */
  static getDefaultConfig(): GmuxConfig {
    return {
      prefixKey: "C-b",
      mouseEnabled: true,
      status_bar: {
        showGitOverlay: true,
        showSessionInfo: true,
        showPaneInfo: true,
        showClock: true,
        refreshInterval: 5_000,
        format: "#[fg=white,bg=blue] #S #[fg=white,bg=green] #{git_branch} #{git_status} ",
      },
      keyBindings: [],
      hooks: [],
      gitOverlay: {
        enabled: true,
        showBranchInStatusBar: true,
        showDiffStat: true,
        autoRefreshInterval: 10_000,
        diffViewerCommand: "less -R",
        logViewerCommand: "less -R",
      },
    };
  }

  /**
   * Validate the on-disk config file and return a list of human-readable
   * errors (empty array means valid).
   */
  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (typeof parsed !== "object" || parsed === null) {
        errors.push("Config root must be a JSON object.");
        return { valid: false, errors };
      }

      const obj = parsed as Record<string, unknown>;

      // prefixKey
      if (obj.prefixKey !== undefined && typeof obj.prefixKey !== "string") {
        errors.push("'prefixKey' must be a string.");
      }

      // mouseEnabled
      if (obj.mouseEnabled !== undefined && typeof obj.mouseEnabled !== "boolean") {
        errors.push("'mouseEnabled' must be a boolean.");
      }

      // status_bar
      if (obj.status_bar !== undefined) {
        if (typeof obj.status_bar !== "object" || obj.status_bar === null) {
          errors.push("'status_bar' must be an object.");
        } else {
          const sb = obj.status_bar as Record<string, unknown>;
          if (sb.showGitOverlay !== undefined && typeof sb.showGitOverlay !== "boolean")
            errors.push("'status_bar.showGitOverlay' must be a boolean.");
          if (sb.showSessionInfo !== undefined && typeof sb.showSessionInfo !== "boolean")
            errors.push("'status_bar.showSessionInfo' must be a boolean.");
          if (sb.showPaneInfo !== undefined && typeof sb.showPaneInfo !== "boolean")
            errors.push("'status_bar.showPaneInfo' must be a boolean.");
          if (sb.showClock !== undefined && typeof sb.showClock !== "boolean")
            errors.push("'status_bar.showClock' must be a boolean.");
          if (sb.refreshInterval !== undefined && typeof sb.refreshInterval !== "number")
            errors.push("'status_bar.refreshInterval' must be a number.");
          if (sb.format !== undefined && typeof sb.format !== "string")
            errors.push("'status_bar.format' must be a string.");
        }
      }

      // keyBindings
      if (obj.keyBindings !== undefined) {
        if (!Array.isArray(obj.keyBindings)) {
          errors.push("'keyBindings' must be an array.");
        } else {
          obj.keyBindings.forEach((binding, i) => {
            if (typeof binding !== "object" || binding === null) {
              errors.push(`'keyBindings[${i}]' must be an object.`);
              return;
            }
            const b = binding as Record<string, unknown>;
            if (typeof b.key !== "string") errors.push(`'keyBindings[${i}].key' must be a string.`);
            if (typeof b.command !== "string") errors.push(`'keyBindings[${i}].command' must be a string.`);
            if (typeof b.description !== "string")
              errors.push(`'keyBindings[${i}].description' must be a string.`);
            if (typeof b.key === "string" && !isValidKeyFormat(b.key)) {
              errors.push(`'keyBindings[${i}].key' has invalid format: '${b.key}'.`);
            }
          });
        }
      }

      // hooks
      if (obj.hooks !== undefined) {
        if (!Array.isArray(obj.hooks)) {
          errors.push("'hooks' must be an array.");
        } else {
          const validEvents = new Set<string>([
            "session-start",
            "session-end",
            "pane-create",
            "pane-kill",
            "window-create",
            "window-kill",
            "git-commit",
            "git-merge",
          ]);
          obj.hooks.forEach((hook, i) => {
            if (typeof hook !== "object" || hook === null) {
              errors.push(`'hooks[${i}]' must be an object.`);
              return;
            }
            const h = hook as Record<string, unknown>;
            if (typeof h.event !== "string") {
              errors.push(`'hooks[${i}].event' must be a string.`);
            } else if (!validEvents.has(h.event)) {
              errors.push(`'hooks[${i}].event' is not a valid event: '${h.event}'.`);
            }
            if (typeof h.command !== "string")
              errors.push(`'hooks[${i}].command' must be a string.`);
          });
        }
      }

      // gitOverlay
      if (obj.gitOverlay !== undefined) {
        if (typeof obj.gitOverlay !== "object" || obj.gitOverlay === null) {
          errors.push("'gitOverlay' must be an object.");
        } else {
          const go = obj.gitOverlay as Record<string, unknown>;
          if (go.enabled !== undefined && typeof go.enabled !== "boolean")
            errors.push("'gitOverlay.enabled' must be a boolean.");
          if (go.showBranchInStatusBar !== undefined && typeof go.showBranchInStatusBar !== "boolean")
            errors.push("'gitOverlay.showBranchInStatusBar' must be a boolean.");
          if (go.showDiffStat !== undefined && typeof go.showDiffStat !== "boolean")
            errors.push("'gitOverlay.showDiffStat' must be a boolean.");
          if (go.autoRefreshInterval !== undefined && typeof go.autoRefreshInterval !== "number")
            errors.push("'gitOverlay.autoRefreshInterval' must be a number.");
          if (go.diffViewerCommand !== undefined && typeof go.diffViewerCommand !== "string")
            errors.push("'gitOverlay.diffViewerCommand' must be a string.");
          if (go.logViewerCommand !== undefined && typeof go.logViewerCommand !== "string")
            errors.push("'gitOverlay.logViewerCommand' must be a string.");
        }
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        errors.push(`Invalid JSON: ${e.message}`);
      } else {
        errors.push(`Failed to read config file: ${(e as Error).message}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Create an example config file at the config path with well-commented
   * defaults so the user can customise it.
   */
  async createExampleConfig(): Promise<void> {
    const example: GmuxConfig = ConfigManager.getDefaultConfig();
    example.keyBindings = [
      { key: "r", command: "refresh-client", description: "Refresh tmux client" },
      { key: "g", command: 'display-popup -E "git status"', description: "Open git status popup" },
      { key: "d", command: "detach-client", description: "Detach from session" },
      { key: "s", command: "choose-tree -s", description: "Session list" },
      { key: "w", command: "choose-window", description: "Window list" },
      { key: "p", command: 'display-message -p "#{pane_id}"', description: "Show pane ID" },
    ];
    example.hooks = [
      { event: "session-start", command: "echo 'Session started: ${SESSION_NAME}'" },
      { event: "session-end", command: "echo 'Session ended: ${SESSION_NAME}'" },
    ];

    await mkdir(Path.dirname(this.configPath), { recursive: true });
    const json = JSON.stringify(example, null, 2) + "\n";
    await writeFile(this.configPath, json, "utf-8");
  }

  /**
   * Apply tmux server-level options that mirror the current config:
   *   - `mouse` on/off
   */
  async applyTmuxOptions(): Promise<void> {
    const mouseVal = this.config.mouseEnabled ? "on" : "off";
    await $`tmux set-option -g mouse ${mouseVal}`.nothrow();
  }

  /**
   * Return the resolved path to the config file.
   */
  getConfigPath(): string {
    return this.configPath;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a key binding string follows a recognised format.
 * Accepted patterns: bare key ("a", "C-a", "M-1", "F1", etc.)
 */
function isValidKeyFormat(key: string): boolean {
  // Allow bare single char, C-*, M-*, S-*, F* combos, or multi-char tokens
  return /^[A-Za-z0-9-]+([+-][A-Za-z0-9]+)*$/.test(key);
}

/**
 * Deep-merge `source` into `target`. Arrays and primitives from `source`
 * overwrite the corresponding values in `target`. Objects are merged recursively.
 */
function mergeDeep<T>(target: T, source: unknown): T {
  if (source === null || source === undefined) return target;
  if (typeof target !== "object" || target === null) return source as T;
  if (typeof source !== "object" || source === null) return source as T;
  if (Array.isArray(target) || Array.isArray(source)) return source as T;

  const result = { ...target } as Record<string, unknown>;
  const src = source as Record<string, unknown>;

  for (const key of Object.keys(src)) {
    const tVal = (target as Record<string, unknown>)[key];
    const sVal = src[key];

    if (
      typeof sVal === "object" &&
      sVal !== null &&
      !Array.isArray(sVal) &&
      typeof tVal === "object" &&
      tVal !== null &&
      !Array.isArray(tVal)
    ) {
      result[key] = mergeDeep(tVal as unknown, sVal);
    } else if (sVal !== undefined) {
      result[key] = sVal;
    }
  }

  return result as T;
}
