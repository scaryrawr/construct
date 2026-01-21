import { describe, expect, test } from "bun:test";
import {
  enablePlugin,
  disablePlugin,
  listEnabledPlugins,
  type PluginDependencies,
} from "./plugin";
import type { PluginRegistry } from "./scanner";
import type { ConstructConfig } from "./config";

interface MockState {
  savedConfig: ConstructConfig | null;
  exitCode: number | null;
  logs: string[];
  errors: string[];
}

function createMockDeps(
  overrides: Partial<{
    plugins: Map<string, unknown>;
    config: ConstructConfig | null;
  }> = {},
): PluginDependencies & MockState {
  const result: PluginDependencies & MockState = {
    savedConfig: null,
    exitCode: null,
    logs: [],
    errors: [],
    scanAllPlugins: async (): Promise<PluginRegistry> => ({
      plugins: overrides.plugins ?? new Map(),
    }),
    loadConfig: async () => overrides.config ?? null,
    saveConfig: async (config: ConstructConfig) => {
      result.savedConfig = config;
    },
    exit: ((code: number) => {
      result.exitCode = code;
      throw new Error(`exit:${code}`);
    }) as (code: number) => never,
    log: (msg: string) => {
      result.logs.push(msg);
    },
    error: (msg: string) => {
      result.errors.push(msg);
    },
  };

  return result;
}

describe("plugin", () => {
  test("enablePlugin() adds plugin to config when plugin exists", async () => {
    const deps = createMockDeps({
      plugins: new Map([["tmux@test-marketplace", { name: "tmux" }]]),
      config: null,
    });

    await enablePlugin("tmux@test-marketplace", deps);

    expect(deps.savedConfig?.enabledPlugins).toEqual(["tmux@test-marketplace"]);
    expect(deps.logs).toContain("Enabled plugin: tmux@test-marketplace");
  });

  test("enablePlugin() exits with error when plugin not found", async () => {
    const deps = createMockDeps({
      plugins: new Map(),
    });

    await expect(
      enablePlugin("missing@test-marketplace", deps),
    ).rejects.toThrow("exit:1");

    expect(deps.exitCode).toBe(1);
    expect(deps.errors[0]).toBe(
      'Error: Plugin "missing@test-marketplace" not found in any known marketplace',
    );
  });

  test("enablePlugin() is idempotent (no duplicate entries)", async () => {
    const deps = createMockDeps({
      plugins: new Map([["tmux@test-marketplace", { name: "tmux" }]]),
      config: {
        enabledPlugins: ["tmux@test-marketplace"],
        lastUsed: "2024-01-01T00:00:00.000Z",
      },
    });

    await enablePlugin("tmux@test-marketplace", deps);

    expect(deps.savedConfig).toBeNull();
    expect(deps.logs).toContain(
      "Plugin already enabled: tmux@test-marketplace",
    );
  });

  test("disablePlugin() removes plugin from config", async () => {
    const deps = createMockDeps({
      config: {
        enabledPlugins: ["tmux@test-marketplace"],
        lastUsed: "2024-01-01T00:00:00.000Z",
      },
    });

    await disablePlugin("tmux@test-marketplace", deps);

    expect(deps.savedConfig?.enabledPlugins).toEqual([]);
    expect(deps.logs).toContain("Disabled plugin: tmux@test-marketplace");
  });

  test("disablePlugin() handles missing config gracefully", async () => {
    const deps = createMockDeps({
      config: null,
    });

    await disablePlugin("tmux@test-marketplace", deps);

    expect(deps.savedConfig).toBeNull();
    expect(deps.logs).toContain("Plugin not enabled: tmux@test-marketplace");
  });

  test("disablePlugin() handles plugin not in config gracefully", async () => {
    const deps = createMockDeps({
      config: {
        enabledPlugins: ["other@test-marketplace"],
        lastUsed: "2024-01-01T00:00:00.000Z",
      },
    });

    await disablePlugin("tmux@test-marketplace", deps);

    expect(deps.savedConfig).toBeNull();
    expect(deps.logs).toContain("Plugin not enabled: tmux@test-marketplace");
  });

  test("listEnabledPlugins() prints all enabled plugins", async () => {
    const deps = createMockDeps({
      config: {
        enabledPlugins: [
          "tmux@test-marketplace",
          "playwright@test-marketplace",
        ],
        lastUsed: "2024-01-01T00:00:00.000Z",
      },
    });

    await listEnabledPlugins(deps);

    expect(deps.logs).toEqual([
      "Enabled plugins:",
      "  tmux@test-marketplace",
      "  playwright@test-marketplace",
    ]);
  });

  test("listEnabledPlugins() handles missing config gracefully", async () => {
    const deps = createMockDeps({
      config: null,
    });

    await listEnabledPlugins(deps);

    expect(deps.logs).toEqual(["No plugins enabled."]);
  });

  test("listEnabledPlugins() handles empty enabledPlugins array", async () => {
    const deps = createMockDeps({
      config: {
        enabledPlugins: [],
        lastUsed: "2024-01-01T00:00:00.000Z",
      },
    });

    await listEnabledPlugins(deps);

    expect(deps.logs).toEqual(["No plugins enabled."]);
  });
});
