import { $ } from "bun";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import Path from "node:path";
import { homedir } from "node:os";
import { DEFAULT_CONFIG, type GmuxConfig } from "./types.ts";

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

const CONFIG_DIR = Path.join(homedir(), ".gmux");
const DEFAULT_CONFIG_PATH = Path.join(CONFIG_DIR, "config.json");

export class ConfigManager {
  getDefaultConfig(): GmuxConfig {
    return structuredClone(DEFAULT_CONFIG);
  }

  async load(configPath?: string): Promise<GmuxConfig> {
    const filePath = configPath ?? DEFAULT_CONFIG_PATH;
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const validation = this.validate(parsed);
      if (!validation.valid) {
        return this.getDefaultConfig();
      }
      return this.mergeWithDefaults(parsed as Partial<GmuxConfig>);
    } catch {
      return this.getDefaultConfig();
    }
  }

  async save(config: GmuxConfig, configPath?: string): Promise<void> {
    const filePath = configPath ?? DEFAULT_CONFIG_PATH;
    await mkdir(Path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
  }

  async updateConfig(
    updates: Partial<GmuxConfig>,
    configPath?: string,
  ): Promise<GmuxConfig> {
    const current = await this.load(configPath);
    const merged = this.deepMerge(current, updates);
    await this.save(merged, configPath);
    return merged;
  }

  validate(config: unknown): ConfigValidationResult {
    const errors: string[] = [];

    if (!config || typeof config !== "object") {
      return { valid: false, errors: ["Config must be a non-null object"] };
    }

    const c = config as Record<string, unknown>;

    if (c.prefixKey !== undefined && typeof c.prefixKey !== "string") {
      errors.push("prefixKey must be a string");
    }

    if (c.mouseEnabled !== undefined && typeof c.mouseEnabled !== "boolean") {
      errors.push("mouseEnabled must be a boolean");
    }

    if (c.status_bar !== undefined) {
      if (typeof c.status_bar !== "object" || c.status_bar === null) {
        errors.push("status_bar must be an object");
      } else {
        const sb = c.status_bar as Record<string, unknown>;
        if (
          sb.refreshInterval !== undefined &&
          typeof sb.refreshInterval !== "number"
        ) {
          errors.push("status_bar.refreshInterval must be a number");
        }
        if (sb.format !== undefined && typeof sb.format !== "string") {
          errors.push("status_bar.format must be a string");
        }
      }
    }

    if (c.keyBindings !== undefined && !Array.isArray(c.keyBindings)) {
      errors.push("keyBindings must be an array");
    }

    if (c.hooks !== undefined && !Array.isArray(c.hooks)) {
      errors.push("hooks must be an array");
    }

    if (c.gitOverlay !== undefined) {
      if (typeof c.gitOverlay !== "object" || c.gitOverlay === null) {
        errors.push("gitOverlay must be an object");
      } else {
        const go = c.gitOverlay as Record<string, unknown>;
        if (go.enabled !== undefined && typeof go.enabled !== "boolean") {
          errors.push("gitOverlay.enabled must be a boolean");
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async applyTmuxOptions(config: GmuxConfig): Promise<void> {
    if (config.mouseEnabled) {
      await $`tmux set-option -g mouse on`.nothrow();
    } else {
      await $`tmux set-option -g mouse off`.nothrow();
    }

    if (config.prefixKey) {
      await $`tmux set-option -g prefix ${config.prefixKey}`.nothrow();
    }

    const interval = Math.floor(
      (config.status_bar?.refreshInterval ?? 5000) / 1000,
    );
    await $`tmux set-option -g status-interval ${String(interval)}`.nothrow();
  }

  private mergeWithDefaults(partial: Partial<GmuxConfig>): GmuxConfig {
    return this.deepMerge(this.getDefaultConfig(), partial);
  }

  private deepMerge<T>(target: T, source: Partial<T>): T {
    const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
    for (const key of Object.keys(source as Record<string, unknown>)) {
      const sourceVal = (source as Record<string, unknown>)[key];
      const targetVal = (target as Record<string, unknown>)[key];
      if (
        sourceVal !== null &&
        sourceVal !== undefined &&
        typeof sourceVal === "object" &&
        !Array.isArray(sourceVal) &&
        typeof targetVal === "object" &&
        targetVal !== null &&
        !Array.isArray(targetVal)
      ) {
        result[key] = this.deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>,
        );
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
    return result as T;
  }
}
