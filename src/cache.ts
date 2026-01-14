import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { PluginInfo } from "./scanner";
import { expandEnvVariables, expandEnvInObject } from "./env-expansion";

let instanceId: string;
let cacheDir: string;

/**
 * Gets the cache root directory.
 * Prefers $XDG_CACHE_HOME, falls back to ~/.cache
 */
function getCacheRoot(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME;
  if (xdgCacheHome) {
    return join(xdgCacheHome, "construct", "plugins");
  }
  return join(homedir(), ".cache", "construct", "plugins");
}

/**
 * Initializes cache for this construct instance.
 * Generates unique instance ID and registers cleanup handlers.
 * @returns Instance cache directory path
 */
export function initCache(): string {
  // Generate unique instance ID: pid + timestamp
  instanceId = `${process.pid}-${Date.now()}`;

  // Create cache directory
  const cacheRoot = getCacheRoot();
  cacheDir = join(cacheRoot, instanceId);

  mkdirSync(cacheDir, { recursive: true });

  // Register cleanup handlers
  process.on("exit", cleanupCache);
  process.on("SIGINT", () => {
    cleanupCache();
    process.exit(130); // Standard exit code for SIGINT
  });
  process.on("SIGTERM", () => {
    cleanupCache();
    process.exit(143); // Standard exit code for SIGTERM
  });

  return cacheDir;
}

/**
 * Parses frontmatter from markdown content.
 * Returns { frontmatter, body, hasFrontmatter }
 */
function parseFrontmatter(content: string): {
  frontmatter: string | null;
  body: string;
  hasFrontmatter: boolean;
} {
  const lines = content.split("\n");

  // Check if content starts with ---
  if (lines[0] !== "---") {
    return { frontmatter: null, body: content, hasFrontmatter: false };
  }

  // Find the second ---
  let secondDashIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      secondDashIndex = i;
      break;
    }
  }

  if (secondDashIndex === -1) {
    // No closing ---, treat as body without frontmatter
    return { frontmatter: null, body: content, hasFrontmatter: false };
  }

  // Extract frontmatter and body
  const frontmatterLines = lines.slice(1, secondDashIndex);
  const bodyLines = lines.slice(secondDashIndex + 1);

  const frontmatter = frontmatterLines.join("\n");
  const body = bodyLines.join("\n");

  return { frontmatter, body, hasFrontmatter: true };
}

/**
 * Reconstructs markdown content with expanded frontmatter.
 */
function reconstructMarkdown(
  frontmatter: string,
  body: string,
  hasFrontmatter: boolean
): string {
  if (!hasFrontmatter) {
    return body;
  }
  return `---\n${frontmatter}\n---\n${body}`;
}

/**
 * Expands environment variables in .mcp.json file.
 */
async function expandMcpJson(filePath: string, localEnv: Record<string, string>): Promise<void> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return;
    }

    const content = await file.text();
    const parsed = JSON.parse(content);

    // Recursively expand all string values in the JSON object
    const expanded = expandEnvInObject(parsed, localEnv);

    await Bun.write(filePath, JSON.stringify(expanded, null, 2));
  } catch (error) {
    // Skip if file doesn't exist or can't be parsed
  }
}

/**
 * Expands environment variables in markdown frontmatter.
 */
function expandMarkdownFrontmatter(filePath: string, localEnv: Record<string, string>): void {
  try {
    if (!existsSync(filePath)) {
      return;
    }

    const content = readFileSync(filePath, "utf-8");
    const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

    if (!hasFrontmatter || frontmatter === null) {
      return;
    }

    // Expand each line of the frontmatter
    const expandedLines = frontmatter
      .split("\n")
      .map((line) => expandEnvVariables(line, localEnv));

    const expandedFrontmatter = expandedLines.join("\n");
    const newContent = reconstructMarkdown(expandedFrontmatter, body, true);

    writeFileSync(filePath, newContent, "utf-8");
  } catch (error) {
    // Skip if file can't be processed
  }
}

/**
 * Expands environment variables in cached plugin files.
 */
async function expandCachedPluginFiles(
  cachedPath: string,
  localEnv: Record<string, string>
): Promise<void> {
  // Expand .mcp.json
  const mcpJsonPath = join(cachedPath, ".mcp.json");
  await expandMcpJson(mcpJsonPath, localEnv);

  // Expand agents/*.md frontmatter
  const agentsDir = join(cachedPath, "agents");
  if (existsSync(agentsDir)) {
    try {
      const agents = readdirSync(agentsDir);
      for (const agent of agents) {
        if (agent.endsWith(".md")) {
          const agentPath = join(agentsDir, agent);
          expandMarkdownFrontmatter(agentPath, localEnv);
        }
      }
    } catch (error) {
      // Skip if agents directory can't be read
    }
  }

  // Expand skills/*/SKILL.md frontmatter
  const skillsDir = join(cachedPath, "skills");
  if (existsSync(skillsDir)) {
    try {
      const skillDirs = readdirSync(skillsDir);
      for (const skillDir of skillDirs) {
        const skillPath = join(skillsDir, skillDir, "SKILL.md");
        expandMarkdownFrontmatter(skillPath, localEnv);
      }
    } catch (error) {
      // Skip if skills directory can't be read
    }
  }
}

/**
 * Gets or creates a cached copy of a plugin with expanded env vars.
 * CLAUDE_PLUGIN_ROOT is set to the destination cache path during expansion.
 * @returns Path to cached plugin directory
 */
export async function getCachedPlugin(plugin: PluginInfo): Promise<string> {
  if (!cacheDir) {
    throw new Error("Cache not initialized. Call initCache() first.");
  }

  // Parse plugin name to get marketplace and plugin name
  // Format: "plugin-name@marketplace"
  const [pluginName, marketplace] = plugin.name.split("@");

  // Create cache structure: <cache-dir>/<marketplace>/<plugin-name>/
  const marketplaceDir = join(cacheDir, marketplace);
  const cachedPluginDir = join(marketplaceDir, pluginName);

  // Copy plugin from install path to cache
  mkdirSync(cachedPluginDir, { recursive: true });
  await cp(plugin.installPath, cachedPluginDir, { recursive: true, force: true });

  // Set CLAUDE_PLUGIN_ROOT to the cached path
  const localEnv = { CLAUDE_PLUGIN_ROOT: cachedPluginDir };

  // Expand environment variables in cached files
  await expandCachedPluginFiles(cachedPluginDir, localEnv);

  return cachedPluginDir;
}

/**
 * Cleans up the current instance's cache directory.
 * Called automatically on process exit.
 */
export function cleanupCache(): void {
  if (cacheDir && existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch (error) {
      // Silently ignore cleanup errors
    }
  }
}

/**
 * Clears ALL cached instances (for --clear-cache command).
 * Useful for cleaning up orphaned caches from crashed processes.
 */
export async function clearAllCaches(): Promise<void> {
  const cacheRoot = getCacheRoot();

  if (existsSync(cacheRoot)) {
    try {
      rmSync(cacheRoot, { recursive: true, force: true });
    } catch (error) {
      // Silently ignore errors
    }
  }
}
