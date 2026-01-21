import { describe, expect, test } from "bun:test";
import {
  createCache,
  clearAllCaches,
  type CacheDependencies,
  type CacheInstance,
} from "./cache";
import {
  createMemoryFileSystem,
  MemoryFileSystem,
} from "./adapters/memory-file-system";
import { createMockProcess, MockProcess } from "./adapters/mock-process";
import type { PluginInfo } from "./scanner";

/**
 * Helper to create test dependencies
 */
function createTestDeps(options?: {
  env?: Record<string, string>;
  pid?: number;
  homedir?: string;
}): { fs: MemoryFileSystem; process: MockProcess; deps: CacheDependencies } {
  const fs = createMemoryFileSystem().build();
  const mockProcess = createMockProcess({
    env: options?.env ?? {},
    pid: options?.pid ?? 1234,
    homedir: options?.homedir ?? "/home/testuser",
  });
  return { fs, process: mockProcess, deps: { fs, process: mockProcess } };
}

/**
 * Helper to create a mock plugin in the memory file system
 */
async function createMockPlugin(
  fs: MemoryFileSystem,
  installPath: string,
  options?: {
    mcpJson?: Record<string, unknown>;
    agents?: Array<{ name: string; content: string }>;
    skills?: Array<{ name: string; content: string }>;
  }
): Promise<PluginInfo> {
  await fs.mkdir(installPath, { recursive: true });

  // Create .mcp.json
  if (options?.mcpJson) {
    await fs.writeFile(
      `${installPath}/.mcp.json`,
      JSON.stringify(options.mcpJson, null, 2)
    );
  }

  // Create agents
  if (options?.agents) {
    const agentsDir = `${installPath}/agents`;
    await fs.mkdir(agentsDir, { recursive: true });
    for (const agent of options.agents) {
      await fs.writeFile(`${agentsDir}/${agent.name}`, agent.content);
    }
  }

  // Create skills
  if (options?.skills) {
    for (const skill of options.skills) {
      const skillDir = `${installPath}/skills/${skill.name}`;
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(`${skillDir}/SKILL.md`, skill.content);
    }
  }

  return {
    name: "test-plugin@test-marketplace",
    installPath,
    version: "1.0.0",
    components: [],
  };
}

describe("createCache", () => {
  test("creates instance directory with pid and timestamp", async () => {
    const { fs, deps } = createTestDeps({ pid: 5678 });

    const cache = createCache(deps);

    // cacheDir should contain the PID
    expect(cache.cacheDir).toContain("5678");

    // Wait for async mkdir to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Directory should exist
    expect(await fs.exists(cache.cacheDir)).toBe(true);
  });

  test("uses XDG_CACHE_HOME when set", async () => {
    const { fs, deps } = createTestDeps({
      env: { XDG_CACHE_HOME: "/custom/cache" },
      pid: 1111,
    });

    const cache = createCache(deps);

    expect(cache.cacheDir).toContain("/custom/cache/construct/plugins");
  });

  test("uses homedir/.cache when XDG_CACHE_HOME not set", async () => {
    const { fs, deps } = createTestDeps({
      homedir: "/home/alice",
      pid: 2222,
    });

    const cache = createCache(deps);

    expect(cache.cacheDir).toContain("/home/alice/.cache/construct/plugins");
  });
});

describe("getCachedPlugin", () => {
  test("copies plugin files to cache directory", async () => {
    const { fs, deps } = createTestDeps({ pid: 3333 });

    // Create source plugin
    const plugin = await createMockPlugin(fs, "/plugins/source", {
      mcpJson: { name: "test" },
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    // Verify cached files exist
    expect(await fs.exists(cachedPath)).toBe(true);
    expect(await fs.exists(`${cachedPath}/.mcp.json`)).toBe(true);

    // Verify it's in the cache directory structure
    expect(cachedPath).toContain(cache.cacheDir);
    expect(cachedPath).toContain("test-marketplace");
    expect(cachedPath).toContain("test-plugin");
  });

  test("copies agents and skills correctly", async () => {
    const { fs, deps } = createTestDeps({ pid: 4444 });

    const plugin = await createMockPlugin(fs, "/plugins/full", {
      agents: [
        {
          name: "agent1.md",
          content: "---\nname: Agent 1\n---\nBody",
        },
      ],
      skills: [
        {
          name: "skill1",
          content: "---\nname: Skill 1\n---\nBody",
        },
      ],
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    expect(await fs.exists(`${cachedPath}/agents/agent1.md`)).toBe(true);
    expect(await fs.exists(`${cachedPath}/skills/skill1/SKILL.md`)).toBe(true);
  });

  test("expands CLAUDE_PLUGIN_ROOT in .mcp.json", async () => {
    const { fs, deps } = createTestDeps({ pid: 5555 });

    const plugin = await createMockPlugin(fs, "/plugins/expand-test", {
      mcpJson: {
        cwd: "${CLAUDE_PLUGIN_ROOT}",
        endpoint: "file://${CLAUDE_PLUGIN_ROOT}/server.js",
      },
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    const mcpContent = await fs.readFile(`${cachedPath}/.mcp.json`);
    const mcpData = JSON.parse(mcpContent);

    // CLAUDE_PLUGIN_ROOT should be expanded to cached path
    expect(mcpData.cwd).toBe(cachedPath);
    expect(mcpData.endpoint).toBe(`file://${cachedPath}/server.js`);
    expect(mcpData.cwd).not.toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  test("expands environment variables in agent frontmatter", async () => {
    const { fs, deps } = createTestDeps({ pid: 6666 });

    const plugin = await createMockPlugin(fs, "/plugins/agent-expand", {
      agents: [
        {
          name: "test-agent.md",
          content: `---
name: Test Agent
path: \${CLAUDE_PLUGIN_ROOT}/bin/agent
---

This body should remain unchanged.`,
        },
      ],
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    const agentContent = await fs.readFile(`${cachedPath}/agents/test-agent.md`);

    // Frontmatter should have expanded path
    expect(agentContent).toContain(`path: ${cachedPath}/bin/agent`);
    expect(agentContent).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    // Body should be unchanged
    expect(agentContent).toContain("This body should remain unchanged.");
  });

  test("expands environment variables in skill frontmatter", async () => {
    const { fs, deps } = createTestDeps({ pid: 7777 });

    const plugin = await createMockPlugin(fs, "/plugins/skill-expand", {
      skills: [
        {
          name: "my-skill",
          content: `---
name: My Skill
root: \${CLAUDE_PLUGIN_ROOT}/skills/my-skill
---

Skill body here.`,
        },
      ],
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    const skillContent = await fs.readFile(
      `${cachedPath}/skills/my-skill/SKILL.md`
    );

    expect(skillContent).toContain(`root: ${cachedPath}/skills/my-skill`);
    expect(skillContent).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(skillContent).toContain("Skill body here.");
  });

  test("throws error for invalid plugin name format", async () => {
    const { fs, deps } = createTestDeps({ pid: 8888 });

    await fs.mkdir("/plugins/invalid", { recursive: true });
    const invalidPlugin: PluginInfo = {
      name: "invalid-name-no-at-symbol",
      installPath: "/plugins/invalid",
      version: "1.0.0",
      components: [],
    };

    const cache = createCache(deps);

    expect(cache.getCachedPlugin(invalidPlugin)).rejects.toThrow(
      'Invalid plugin name format'
    );
  });
});

describe("cleanup", () => {
  test("removes instance cache directory", async () => {
    const { fs, deps } = createTestDeps({ pid: 9999 });

    const cache = createCache(deps);

    // Wait for directory to be created
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await fs.exists(cache.cacheDir)).toBe(true);

    cache.cleanup();

    // Wait for async rm to complete
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await fs.exists(cache.cacheDir)).toBe(false);
  });

  test("cleanup is idempotent (no error when called multiple times)", async () => {
    const { fs, deps } = createTestDeps({ pid: 1010 });

    const cache = createCache(deps);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should not throw
    cache.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 10));
    cache.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});

describe("clearAllCaches", () => {
  test("removes all cache directories", async () => {
    const { fs, deps } = createTestDeps({
      pid: 1111,
      homedir: "/home/clear-test",
    });

    // Create multiple cache instances
    const cache1 = createCache(deps);
    const cache2 = createCache(deps);

    // Wait for directories to be created
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cacheRoot = "/home/clear-test/.cache/construct/plugins";
    expect(await fs.exists(cache1.cacheDir)).toBe(true);
    expect(await fs.exists(cache2.cacheDir)).toBe(true);

    await clearAllCaches(deps);

    // Root cache directory should be removed
    expect(await fs.exists(cacheRoot)).toBe(false);
  });

  test("handles non-existent cache directory gracefully", async () => {
    const { fs, deps } = createTestDeps({ homedir: "/home/empty" });

    // Should not throw even if cache doesn't exist
    await clearAllCaches(deps);
  });

  test("uses XDG_CACHE_HOME when clearing", async () => {
    const { fs, deps } = createTestDeps({
      env: { XDG_CACHE_HOME: "/xdg/cache" },
      pid: 1212,
    });

    const cache = createCache(deps);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(cache.cacheDir).toContain("/xdg/cache");

    await clearAllCaches(deps);

    expect(await fs.exists("/xdg/cache/construct/plugins")).toBe(false);
  });
});

describe("environment variable expansion", () => {
  test("expands default values in .mcp.json", async () => {
    const { fs, deps } = createTestDeps({ pid: 1313 });

    const plugin = await createMockPlugin(fs, "/plugins/defaults", {
      mcpJson: {
        port: "${PORT:-3000}",
        host: "${HOST:-localhost}",
      },
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    const mcpContent = await fs.readFile(`${cachedPath}/.mcp.json`);
    const mcpData = JSON.parse(mcpContent);

    expect(mcpData.port).toBe("3000");
    expect(mcpData.host).toBe("localhost");
  });

  test("handles nested objects in .mcp.json", async () => {
    const { fs, deps } = createTestDeps({ pid: 1414 });

    const plugin = await createMockPlugin(fs, "/plugins/nested", {
      mcpJson: {
        server: {
          path: "${CLAUDE_PLUGIN_ROOT}/bin/server",
          config: {
            dir: "${CLAUDE_PLUGIN_ROOT}/config",
          },
        },
      },
    });

    const cache = createCache(deps);
    const cachedPath = await cache.getCachedPlugin(plugin);

    const mcpContent = await fs.readFile(`${cachedPath}/.mcp.json`);
    const mcpData = JSON.parse(mcpContent);

    expect(mcpData.server.path).toBe(`${cachedPath}/bin/server`);
    expect(mcpData.server.config.dir).toBe(`${cachedPath}/config`);
  });
});
