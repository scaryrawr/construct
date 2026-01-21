import { describe, expect, test } from "bun:test";
import { createMemoryFileSystem } from "./adapters/memory-file-system";
import { MockProcess } from "./adapters/mock-process";
import {
  getKnownMarketplacesPath,
  scanAllPlugins,
  listAvailablePlugins,
} from "./scanner";
import type { ScannerDependencies } from "./scanner";

function createDeps(
  files: Record<string, string> = {},
  homedir = "/home/user"
): ScannerDependencies {
  const builder = createMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    builder.withFile(path, content);
  }
  return {
    fs: builder.build(),
    process: new MockProcess({ homedir }),
  };
}

describe("scanner", () => {
  describe("getKnownMarketplacesPath", () => {
    test("returns correct path using homedir from deps", () => {
      const deps = createDeps({}, "/Users/test");
      const path = getKnownMarketplacesPath(deps);
      expect(path).toBe("/Users/test/.claude/plugins/known_marketplaces.json");
    });

    test("returns correct path using HOME env var when set", () => {
      const proc = new MockProcess({ env: { HOME: "/custom/home" } });
      const deps: ScannerDependencies = {
        process: proc,
      };
      const path = getKnownMarketplacesPath(deps);
      expect(path).toBe("/custom/home/.claude/plugins/known_marketplaces.json");
    });

    test("falls back to homedir when HOME not set", () => {
      const proc = new MockProcess({ homedir: "/fallback/home" });
      const deps: ScannerDependencies = {
        process: proc,
      };
      const path = getKnownMarketplacesPath(deps);
      expect(path).toBe(
        "/fallback/home/.claude/plugins/known_marketplaces.json"
      );
    });
  });

  describe("scanAllPlugins", () => {
    test("returns empty registry when no marketplaces file exists", async () => {
      const deps = createDeps({});
      const registry = await scanAllPlugins(deps);
      expect(registry.plugins.size).toBe(0);
    });

    test("returns empty registry when marketplaces file is empty object", async () => {
      const deps = createDeps({
        "/home/user/.claude/plugins/known_marketplaces.json": "{}",
      });
      const registry = await scanAllPlugins(deps);
      expect(registry.plugins.size).toBe(0);
    });

    test("finds plugins from marketplace", async () => {
      const marketplaceDir = "/home/user/.claude/plugins/marketplaces/test-mp";
      const deps = createDeps({
        "/home/user/.claude/plugins/known_marketplaces.json": JSON.stringify({
          "test-mp": {
            source: { source: "github", repo: "owner/test-mp" },
            installLocation: marketplaceDir,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
        }),
        [`${marketplaceDir}/.claude-plugin/marketplace.json`]: JSON.stringify({
          name: "test-mp",
          plugins: [
            {
              name: "my-plugin",
              source: "plugins/my-plugin",
              version: "1.0.0",
              description: "A test plugin",
            },
          ],
        }),
      });

      const registry = await scanAllPlugins(deps);

      expect(registry.plugins.size).toBe(1);
      expect(registry.plugins.has("my-plugin@test-mp")).toBe(true);

      const plugin = registry.plugins.get("my-plugin@test-mp");
      expect(plugin?.name).toBe("my-plugin@test-mp");
      expect(plugin?.version).toBe("1.0.0");
      expect(plugin?.description).toBe("A test plugin");
      expect(plugin?.installPath).toBe(`${marketplaceDir}/plugins/my-plugin`);
    });

    test("finds multiple plugins from multiple marketplaces", async () => {
      const mp1Dir = "/home/user/.claude/plugins/marketplaces/marketplace-one";
      const mp2Dir = "/home/user/.claude/plugins/marketplaces/marketplace-two";
      const deps = createDeps({
        "/home/user/.claude/plugins/known_marketplaces.json": JSON.stringify({
          "marketplace-one": {
            source: { source: "github" },
            installLocation: mp1Dir,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
          "marketplace-two": {
            source: { source: "github" },
            installLocation: mp2Dir,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
        }),
        [`${mp1Dir}/.claude-plugin/marketplace.json`]: JSON.stringify({
          name: "marketplace-one",
          plugins: [{ name: "plugin-a", source: "plugin-a", version: "1.0.0" }],
        }),
        [`${mp2Dir}/.claude-plugin/marketplace.json`]: JSON.stringify({
          name: "marketplace-two",
          plugins: [{ name: "plugin-b", source: "plugin-b", version: "2.0.0" }],
        }),
      });

      const registry = await scanAllPlugins(deps);

      expect(registry.plugins.size).toBe(2);
      expect(registry.plugins.has("plugin-a@marketplace-one")).toBe(true);
      expect(registry.plugins.has("plugin-b@marketplace-two")).toBe(true);
    });

    test("skips plugins with non-string source", async () => {
      const marketplaceDir = "/home/user/.claude/plugins/marketplaces/test-mp";
      const deps = createDeps({
        "/home/user/.claude/plugins/known_marketplaces.json": JSON.stringify({
          "test-mp": {
            source: { source: "github" },
            installLocation: marketplaceDir,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
        }),
        [`${marketplaceDir}/.claude-plugin/marketplace.json`]: JSON.stringify({
          name: "test-mp",
          plugins: [
            { name: "local-plugin", source: "local-plugin", version: "1.0.0" },
            {
              name: "remote-plugin",
              source: { type: "git", url: "https://..." },
              version: "1.0.0",
            },
          ],
        }),
      });

      const registry = await scanAllPlugins(deps);

      expect(registry.plugins.size).toBe(1);
      expect(registry.plugins.has("local-plugin@test-mp")).toBe(true);
      expect(registry.plugins.has("remote-plugin@test-mp")).toBe(false);
    });

    test("sanitizes multiline descriptions", async () => {
      const marketplaceDir = "/home/user/.claude/plugins/marketplaces/test-mp";
      const deps = createDeps({
        "/home/user/.claude/plugins/known_marketplaces.json": JSON.stringify({
          "test-mp": {
            source: { source: "github" },
            installLocation: marketplaceDir,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
        }),
        [`${marketplaceDir}/.claude-plugin/marketplace.json`]: JSON.stringify({
          name: "test-mp",
          plugins: [
            {
              name: "my-plugin",
              source: "my-plugin",
              version: "1.0.0",
              description: "Line one\nLine two\tTabbed",
            },
          ],
        }),
      });

      const registry = await scanAllPlugins(deps);
      const plugin = registry.plugins.get("my-plugin@test-mp");

      expect(plugin?.description).toBe("Line one Line two Tabbed");
    });
  });

  describe("listAvailablePlugins", () => {
    test("returns empty array when no plugins exist", async () => {
      const deps = createDeps({});
      const plugins = await listAvailablePlugins(deps);
      expect(plugins).toEqual([]);
    });

    test("returns plugin names from registry", async () => {
      const marketplaceDir = "/home/user/.claude/plugins/marketplaces/test-mp";
      const deps = createDeps({
        "/home/user/.claude/plugins/known_marketplaces.json": JSON.stringify({
          "test-mp": {
            source: { source: "github" },
            installLocation: marketplaceDir,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
        }),
        [`${marketplaceDir}/.claude-plugin/marketplace.json`]: JSON.stringify({
          name: "test-mp",
          plugins: [
            { name: "alpha", source: "alpha" },
            { name: "beta", source: "beta" },
          ],
        }),
      });

      const plugins = await listAvailablePlugins(deps);

      expect(plugins).toContain("alpha@test-mp");
      expect(plugins).toContain("beta@test-mp");
      expect(plugins.length).toBe(2);
    });
  });
});
