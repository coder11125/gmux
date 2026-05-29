import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import Path from "node:path";

// ---------------------------------------------------------------------------
// Import ConfigManager — no mocking of "bun" needed for most tests
// ---------------------------------------------------------------------------

const { ConfigManager } = await import("../config-manager.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;
let configPath: string;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfigManager", () => {
  let manager: InstanceType<typeof ConfigManager>;

  beforeEach(async () => {
    manager = new ConfigManager();
    testDir = await mkdtemp(Path.join(tmpdir(), "gmux-config-test-"));
    configPath = Path.join(testDir, "config.json");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // getDefaultConfig
  // -----------------------------------------------------------------------

  describe("getDefaultConfig", () => {
    it("should return a valid default configuration object", () => {
      const config = manager.getDefaultConfig();

      expect(config).toBeDefined();
      expect(typeof config).toBe("object");
      expect(config.prefixKey).toBe("C-b");
      expect(config.mouseEnabled).toBe(true);
    });

    it("should return a deep clone (mutations do not affect defaults)", () => {
      const config1 = manager.getDefaultConfig();
      const config2 = manager.getDefaultConfig();

      config1.prefixKey = "C-a";
      expect(config2.prefixKey).toBe("C-b");
    });

    it("should include status_bar defaults", () => {
      const config = manager.getDefaultConfig();

      expect(config.status_bar).toBeDefined();
      expect(config.status_bar.showGitOverlay).toBe(true);
      expect(config.status_bar.showSessionInfo).toBe(true);
      expect(config.status_bar.refreshInterval).toBe(5000);
      expect(typeof config.status_bar.format).toBe("string");
    });

    it("should include gitOverlay defaults", () => {
      const config = manager.getDefaultConfig();

      expect(config.gitOverlay).toBeDefined();
      expect(config.gitOverlay.enabled).toBe(true);
      expect(config.gitOverlay.showBranchInStatusBar).toBe(true);
      expect(config.gitOverlay.autoRefreshInterval).toBe(10000);
      expect(config.gitOverlay.diffViewerCommand).toBe("delta");
      expect(config.gitOverlay.logViewerCommand).toBe("tig");
    });

    it("should include empty keyBindings and hooks", () => {
      const config = manager.getDefaultConfig();

      expect(Array.isArray(config.keyBindings)).toBe(true);
      expect(config.keyBindings).toHaveLength(0);
      expect(Array.isArray(config.hooks)).toBe(true);
      expect(config.hooks).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // load
  // -----------------------------------------------------------------------

  describe("load", () => {
    it("should return defaults when config file does not exist", async () => {
      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-b");
      expect(result.mouseEnabled).toBe(true);
    });

    it("should load a valid config from file", async () => {
      const customConfig = {
        prefixKey: "C-a",
        mouseEnabled: false,
        status_bar: {
          showGitOverlay: false,
          showSessionInfo: true,
          showPaneInfo: false,
          showClock: false,
          refreshInterval: 1000,
          format: "{{session}}",
        },
        keyBindings: [],
        hooks: [],
        gitOverlay: {
          enabled: false,
          showBranchInStatusBar: false,
          showDiffStat: false,
          autoRefreshInterval: 5000,
          diffViewerCommand: "less",
          logViewerCommand: "less",
        },
      };

      await writeFile(configPath, JSON.stringify(customConfig), "utf-8");

      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-a");
      expect(result.mouseEnabled).toBe(false);
      expect(result.status_bar.showGitOverlay).toBe(false);
      expect(result.status_bar.refreshInterval).toBe(1000);
    });

    it("should return defaults for invalid JSON in config file", async () => {
      await writeFile(configPath, "not valid json {{{", "utf-8");

      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-b");
    });

    it("should return defaults when config fails validation", async () => {
      const invalidConfig = {
        prefixKey: 12345,
        mouseEnabled: "yes",
      };

      await writeFile(configPath, JSON.stringify(invalidConfig), "utf-8");

      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-b");
      expect(result.mouseEnabled).toBe(true);
    });

    it("should merge partial config with defaults", async () => {
      const partialConfig = { prefixKey: "C-x" };
      await writeFile(configPath, JSON.stringify(partialConfig), "utf-8");

      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-x");
      // Defaults should still be present
      expect(result.mouseEnabled).toBe(true);
      expect(result.status_bar.refreshInterval).toBe(5000);
    });

    it("should handle null config value", async () => {
      await writeFile(configPath, "null", "utf-8");

      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-b");
    });

    it("should handle array config value", async () => {
      await writeFile(configPath, "[1, 2, 3]", "utf-8");

      const result = await manager.load(configPath);
      expect(result.prefixKey).toBe("C-b");
    });
  });

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------

  describe("save", () => {
    it("should persist a valid config to disk", async () => {
      const config = manager.getDefaultConfig();
      config.prefixKey = "C-z";

      await manager.save(config, configPath);

      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.prefixKey).toBe("C-z");
    });

    it("should create parent directories if they do not exist", async () => {
      const nestedPath = Path.join(testDir, "deep", "nested", "config.json");
      const config = manager.getDefaultConfig();

      await manager.save(config, nestedPath);

      const raw = await readFile(nestedPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.prefixKey).toBe("C-b");
    });

    it("should overwrite an existing config file", async () => {
      const config1 = manager.getDefaultConfig();
      config1.prefixKey = "C-a";
      await manager.save(config1, configPath);

      const config2 = manager.getDefaultConfig();
      config2.prefixKey = "C-z";
      await manager.save(config2, configPath);

      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.prefixKey).toBe("C-z");
    });

    it("should write valid JSON", async () => {
      const config = manager.getDefaultConfig();
      await manager.save(config, configPath);

      const raw = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // updateConfig
  // -----------------------------------------------------------------------

  describe("updateConfig", () => {
    it("should merge updates with existing config", async () => {
      const result = await manager.updateConfig(
        { prefixKey: "C-a" },
        configPath,
      );
      expect(result.prefixKey).toBe("C-a");
      expect(result.mouseEnabled).toBe(true);
    });

    it("should persist the merged result", async () => {
      await manager.updateConfig({ mouseEnabled: false }, configPath);

      const loaded = await manager.load(configPath);
      expect(loaded.mouseEnabled).toBe(false);
    });

    it("should handle nested updates", async () => {
      const result = await manager.updateConfig(
        { status_bar: { refreshInterval: 2000 } as any },
        configPath,
      );
      expect(result.status_bar.refreshInterval).toBe(2000);
      // Other status_bar fields should remain default
      expect(result.status_bar.showGitOverlay).toBe(true);
    });

    it("should handle multiple sequential updates", async () => {
      await manager.updateConfig({ prefixKey: "C-a" }, configPath);
      await manager.updateConfig({ mouseEnabled: false }, configPath);

      const result = await manager.updateConfig(
        { prefixKey: "C-z" },
        configPath,
      );
      expect(result.prefixKey).toBe("C-z");
      expect(result.mouseEnabled).toBe(false);
    });

    it("should not affect other config sections", async () => {
      await manager.updateConfig(
        { gitOverlay: { enabled: false } as any },
        configPath,
      );

      const result = await manager.load(configPath);
      expect(result.gitOverlay.enabled).toBe(false);
      expect(result.prefixKey).toBe("C-b");
      expect(result.mouseEnabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // validate
  // -----------------------------------------------------------------------

  describe("validate", () => {
    it("should accept a valid default config", () => {
      const result = manager.validate(manager.getDefaultConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject non-object values", () => {
      expect(manager.validate(null).valid).toBe(false);
      expect(manager.validate(undefined).valid).toBe(false);
      expect(manager.validate("string").valid).toBe(false);
      expect(manager.validate(42).valid).toBe(false);
      expect(manager.validate(true).valid).toBe(false);
    });

    it("should reject non-string prefixKey", () => {
      const result = manager.validate({ prefixKey: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("prefixKey must be a string");
    });

    it("should reject non-boolean mouseEnabled", () => {
      const result = manager.validate({ mouseEnabled: "yes" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("mouseEnabled must be a boolean");
    });

    it("should reject non-object status_bar", () => {
      const result = manager.validate({ status_bar: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("status_bar must be an object");
    });

    it("should reject non-number refreshInterval", () => {
      const result = manager.validate({
        status_bar: { refreshInterval: "5000" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "status_bar.refreshInterval must be a number",
      );
    });

    it("should reject non-string format", () => {
      const result = manager.validate({ status_bar: { format: 123 } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("status_bar.format must be a string");
    });

    it("should reject non-array keyBindings", () => {
      const result = manager.validate({ keyBindings: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("keyBindings must be an array");
    });

    it("should reject non-array hooks", () => {
      const result = manager.validate({ hooks: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("hooks must be an array");
    });

    it("should reject non-object gitOverlay", () => {
      const result = manager.validate({ gitOverlay: "invalid" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("gitOverlay must be an object");
    });

    it("should reject non-boolean gitOverlay.enabled", () => {
      const result = manager.validate({
        gitOverlay: { enabled: "yes" },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("gitOverlay.enabled must be a boolean");
    });

    it("should collect multiple validation errors", () => {
      const result = manager.validate({
        prefixKey: 123,
        mouseEnabled: "yes",
        keyBindings: "invalid",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it("should accept a minimal valid config (empty object)", () => {
      const result = manager.validate({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept config with all valid fields", () => {
      const result = manager.validate({
        prefixKey: "C-a",
        mouseEnabled: true,
        status_bar: {
          refreshInterval: 5000,
          format: "{{session}}",
        },
        keyBindings: [],
        hooks: [],
        gitOverlay: {
          enabled: true,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // applyTmuxOptions
  // -----------------------------------------------------------------------

  describe("applyTmuxOptions", () => {
    it("should not throw when called with valid config", async () => {
      const config = manager.getDefaultConfig();
      // tmux commands will fail (no server) but .nothrow() prevents throws
      await manager.applyTmuxOptions(config);
    });

    it("should not throw with mouse disabled", async () => {
      const config = manager.getDefaultConfig();
      config.mouseEnabled = false;
      await manager.applyTmuxOptions(config);
    });

    it("should not throw with custom prefix", async () => {
      const config = manager.getDefaultConfig();
      config.prefixKey = "C-a";
      await manager.applyTmuxOptions(config);
    });

    it("should handle zero refreshInterval gracefully", async () => {
      const config = manager.getDefaultConfig();
      config.status_bar.refreshInterval = 0;
      await manager.applyTmuxOptions(config);
    });
  });
});
