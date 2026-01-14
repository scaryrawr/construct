import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  initCache,
  getCachedPlugin,
  cleanupCache,
  clearAllCaches,
} from "./cache";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginInfo } from "./scanner";

let tempPluginDir: string;
let mockPlugin: PluginInfo;

beforeEach(() => {
  // Create temporary plugin directory
  tempPluginDir = join(tmpdir(), `test-plugin-${Date.now()}`);
  mkdirSync(tempPluginDir, { recursive: true });

  // Create .mcp.json with placeholders
  const mcpConfig = {
    cwd: "${CLAUDE_PLUGIN_ROOT}",
    endpoint: "file://${CLAUDE_PLUGIN_ROOT}/mcp-server.js",
    testVar: "${TEST_VAR:-default}",
  };
  writeFileSync(
    join(tempPluginDir, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2)
  );

  // Create agents directory and test agent
  const agentsDir = join(tempPluginDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const agentContent = `---
name: Test Agent
path: \${CLAUDE_PLUGIN_ROOT}/test-agent.js
---

This is the agent body that should not be modified.
It contains the actual agent logic.`;
  writeFileSync(join(agentsDir, "test-agent.md"), agentContent);

  // Create skills directory and test skill
  const skillsDir = join(tempPluginDir, "skills", "test-skill");
  mkdirSync(skillsDir, { recursive: true });
  const skillContent = `---
name: Test Skill
root: \${CLAUDE_PLUGIN_ROOT}/skills/test-skill
---

This is the skill body that should not be modified.
It contains the actual skill implementation.`;
  writeFileSync(join(skillsDir, "SKILL.md"), skillContent);

  // Create mock plugin info
  mockPlugin = {
    name: "test-plugin@test-marketplace",
    installPath: tempPluginDir,
    version: "1.0.0",
    components: [],
  };
});

afterEach(async () => {
  // Clean up temporary directories
  if (existsSync(tempPluginDir)) {
    rmSync(tempPluginDir, { recursive: true, force: true });
  }
  // Clean up any cache directories created during tests
  try {
    await clearAllCaches();
  } catch {
    // Ignore errors during cleanup
  }
});

describe("cache", () => {
  test("initCache() creates instance directory and returns path", () => {
    const cachePath = initCache();

    expect(cachePath).toBeDefined();
    expect(existsSync(cachePath)).toBe(true);

    // Clean up
    if (existsSync(cachePath)) {
      rmSync(join(cachePath, ".."), { recursive: true, force: true });
    }
  });

  test("initCache() returns path containing pid in instance ID", () => {
    const cachePath = initCache();
    const pid = process.pid.toString();

    expect(cachePath).toContain(pid);

    // Clean up
    if (existsSync(cachePath)) {
      rmSync(join(cachePath, ".."), { recursive: true, force: true });
    }
  });

  test("getCachedPlugin() copies plugin to instance cache", async () => {
    const cachePath = initCache();
    const pluginCachePath = await getCachedPlugin(mockPlugin);

    expect(existsSync(pluginCachePath)).toBe(true);
    expect(existsSync(join(pluginCachePath, ".mcp.json"))).toBe(true);
    expect(existsSync(join(pluginCachePath, "agents", "test-agent.md"))).toBe(
      true
    );
    expect(
      existsSync(join(pluginCachePath, "skills", "test-skill", "SKILL.md"))
    ).toBe(true);

    // Clean up
    if (existsSync(cachePath)) {
      rmSync(join(cachePath, ".."), { recursive: true, force: true });
    }
  });

  test("getCachedPlugin() returns path within instance cache", async () => {
    const cachePath = initCache();
    const pluginCachePath = await getCachedPlugin(mockPlugin);

    expect(pluginCachePath).toContain(cachePath);

    // Clean up
    if (existsSync(cachePath)) {
      rmSync(join(cachePath, ".."), { recursive: true, force: true });
    }
  });

  test("Env vars expanded in cached .mcp.json", async () => {
    initCache();
    const pluginCachePath = await getCachedPlugin(mockPlugin);
    const mcpPath = join(pluginCachePath, ".mcp.json");

    const mcpContent = readFileSync(mcpPath, "utf-8");
    const mcpData = JSON.parse(mcpContent);

    // CLAUDE_PLUGIN_ROOT should be expanded
    expect(mcpData.cwd).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(mcpData.cwd).toBe(pluginCachePath);

    // TEST_VAR should be expanded to default
    expect(mcpData.testVar).toBe("default");
    expect(mcpData.testVar).not.toContain("${TEST_VAR");

    // endpoint should have CLAUDE_PLUGIN_ROOT expanded
    expect(mcpData.endpoint).toContain("file://");
    expect(mcpData.endpoint).not.toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(mcpData.endpoint).toBe(
      `file://${pluginCachePath}/mcp-server.js`
    );
  });

  test("Env vars expanded in cached agent frontmatter (body unchanged)", async () => {
    initCache();
    const pluginCachePath = await getCachedPlugin(mockPlugin);
    const agentPath = join(pluginCachePath, "agents", "test-agent.md");

    const agentContent = readFileSync(agentPath, "utf-8");

    // Body should be unchanged
    expect(agentContent).toContain(
      "This is the agent body that should not be modified."
    );
    expect(agentContent).toContain(
      "It contains the actual agent logic."
    );

    // Path in frontmatter should be expanded
    expect(agentContent).toContain(`path: ${pluginCachePath}/test-agent.js`);
    expect(agentContent).not.toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  test("Env vars expanded in cached skill frontmatter (body unchanged)", async () => {
    initCache();
    const pluginCachePath = await getCachedPlugin(mockPlugin);
    const skillPath = join(pluginCachePath, "skills", "test-skill", "SKILL.md");

    const skillContent = readFileSync(skillPath, "utf-8");

    // Body should be unchanged
    expect(skillContent).toContain(
      "This is the skill body that should not be modified."
    );
    expect(skillContent).toContain(
      "It contains the actual skill implementation."
    );

    // root in frontmatter should be expanded
    expect(skillContent).toContain(
      `root: ${pluginCachePath}/skills/test-skill`
    );
    expect(skillContent).not.toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  test("CLAUDE_PLUGIN_ROOT expands to cached path (not source path)", async () => {
    initCache();
    const pluginCachePath = await getCachedPlugin(mockPlugin);
    const mcpPath = join(pluginCachePath, ".mcp.json");

    const mcpContent = readFileSync(mcpPath, "utf-8");
    const mcpData = JSON.parse(mcpContent);

    // CLAUDE_PLUGIN_ROOT should expand to cached path, not source path
    expect(mcpData.cwd).toBe(pluginCachePath);
    expect(mcpData.cwd).not.toBe(mockPlugin.installPath);
    expect(mcpData.endpoint).toContain(pluginCachePath);
    expect(mcpData.endpoint).not.toContain(mockPlugin.installPath);
  });

  test("cleanupCache() removes instance directory", () => {
    const cachePath = initCache();
    const cacheParentDir = join(cachePath, "..");

    expect(existsSync(cachePath)).toBe(true);

    cleanupCache();

    expect(existsSync(cachePath)).toBe(false);

    // Clean up parent if it still exists
    if (existsSync(cacheParentDir)) {
      rmSync(cacheParentDir, { recursive: true, force: true });
    }
  });

  test("clearAllCaches() removes all instance directories", async () => {
    // Create multiple cache instances
    const cachePath1 = initCache();
    const cachePath2 = initCache();
    const cacheRootDir = join(cachePath1, "..", "..");

    expect(existsSync(cachePath1)).toBe(true);
    expect(existsSync(cachePath2)).toBe(true);

    await clearAllCaches();

    // Both caches should be removed
    expect(existsSync(cachePath1)).toBe(false);
    expect(existsSync(cachePath2)).toBe(false);

    // Clean up root cache directory if it still exists
    if (existsSync(cacheRootDir)) {
      rmSync(cacheRootDir, { recursive: true, force: true });
    }
  });
});
