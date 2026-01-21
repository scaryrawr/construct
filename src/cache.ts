import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import type { PluginInfo } from "./scanner";
import type { FileSystem } from "./interfaces/file-system";
import type { ProcessEnv } from "./interfaces/process";
import { bunFileSystem } from "./adapters/bun-file-system";
import { nodeProcess } from "./adapters/node-process";
import { expandEnvVariables, expandEnvInObject } from "./env-expansion";

/**
 * Dependencies for cache operations
 */
export interface CacheDependencies {
  fs?: FileSystem;
  process?: ProcessEnv;
}

/**
 * Cache instance interface with encapsulated state
 */
export interface CacheInstance {
  readonly cacheDir: string;
  getCachedPlugin(plugin: PluginInfo): Promise<string>;
  cleanup(): void;
}

/**
 * Gets the cache root directory.
 * Prefers $XDG_CACHE_HOME, falls back to ~/.cache
 */
function getCacheRoot(proc: ProcessEnv): string {
  const xdgCacheHome = proc.get("XDG_CACHE_HOME");
  if (xdgCacheHome) {
    return join(xdgCacheHome, "construct", "plugins");
  }
  return join(proc.homedir(), ".cache", "construct", "plugins");
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
async function expandMcpJson(
  fs: FileSystem,
  filePath: string,
  localEnv: Record<string, string>
): Promise<void> {
  try {
    if (!(await fs.exists(filePath))) {
      return;
    }

    const content = await fs.readFile(filePath);
    const parsed = JSON.parse(content);

    // Recursively expand all string values in the JSON object
    const expanded = expandEnvInObject(parsed, localEnv);

    await fs.writeFile(filePath, JSON.stringify(expanded, null, 2));
  } catch (error) {
    // Skip if file doesn't exist or can't be parsed
  }
}

/**
 * Expands environment variables in markdown frontmatter.
 */
async function expandMarkdownFrontmatter(
  fs: FileSystem,
  filePath: string,
  localEnv: Record<string, string>
): Promise<void> {
  try {
    if (!(await fs.exists(filePath))) {
      return;
    }

    const content = await fs.readFile(filePath);
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

    await fs.writeFile(filePath, newContent);
  } catch (error) {
    // Skip if file can't be processed
  }
}

/**
 * Expands environment variables in cached plugin files.
 */
async function expandCachedPluginFiles(
  fs: FileSystem,
  cachedPath: string,
  localEnv: Record<string, string>
): Promise<void> {
  // Expand .mcp.json
  const mcpJsonPath = join(cachedPath, ".mcp.json");
  await expandMcpJson(fs, mcpJsonPath, localEnv);

  // Expand agents/*.md frontmatter
  const agentsDir = join(cachedPath, "agents");
  if (await fs.exists(agentsDir)) {
    try {
      const agents = await fs.readdir(agentsDir);
      for (const agent of agents) {
        if (agent.endsWith(".md")) {
          const agentPath = join(agentsDir, agent);
          await expandMarkdownFrontmatter(fs, agentPath, localEnv);
        }
      }
    } catch (error) {
      // Skip if agents directory can't be read
    }
  }

  // Expand skills/*/SKILL.md frontmatter
  const skillsDir = join(cachedPath, "skills");
  if (await fs.exists(skillsDir)) {
    try {
      const skillDirs = await fs.readdir(skillsDir);
      for (const skillDir of skillDirs) {
        const skillPath = join(skillsDir, skillDir, "SKILL.md");
        await expandMarkdownFrontmatter(fs, skillPath, localEnv);
      }
    } catch (error) {
      // Skip if skills directory can't be read
    }
  }
}

/**
 * Creates a new cache instance with encapsulated state.
 * @param deps Optional dependencies for file system and process
 * @returns CacheInstance with methods to manage plugin caching
 */
export function createCache(deps?: CacheDependencies): CacheInstance {
  const fs = deps?.fs ?? bunFileSystem;
  const proc = deps?.process ?? nodeProcess;

  // Generate unique instance ID: pid + timestamp
  const instanceId = `${proc.pid()}-${Date.now()}`;

  // Create cache directory path
  const cacheRoot = getCacheRoot(proc);
  const cacheDir = join(cacheRoot, instanceId);

  // Create cache directory synchronously during initialization
  // We use a self-executing async function stored in a promise
  let initialized = false;
  const initPromise = fs.mkdir(cacheDir, { recursive: true }).then(() => {
    initialized = true;
  });

  async function ensureInitialized(): Promise<void> {
    if (!initialized) {
      await initPromise;
    }
  }

  return {
    get cacheDir(): string {
      return cacheDir;
    },

    async getCachedPlugin(plugin: PluginInfo): Promise<string> {
      await ensureInitialized();

      // Parse plugin name to get marketplace and plugin name
      // Format: "plugin-name@marketplace"
      const [pluginName, marketplace] = plugin.name.split("@");

      // Ensure we have valid parts
      if (!pluginName || !marketplace) {
        throw new Error(
          `Invalid plugin name format: ${plugin.name}. Expected "plugin-name@marketplace"`
        );
      }

      // Create cache structure: <cache-dir>/<marketplace>/<plugin-name>/
      const marketplaceDir = join(cacheDir, marketplace);
      const cachedPluginDir = join(marketplaceDir, pluginName);

      // Copy plugin from install path to cache
      await fs.mkdir(cachedPluginDir, { recursive: true });
      await fs.cp(plugin.installPath, cachedPluginDir, {
        recursive: true,
        force: true,
      });

      // Set CLAUDE_PLUGIN_ROOT to the cached path
      const localEnv = { CLAUDE_PLUGIN_ROOT: cachedPluginDir };

      // Expand environment variables in cached files
      await expandCachedPluginFiles(fs, cachedPluginDir, localEnv);

      return cachedPluginDir;
    },

    cleanup(): void {
      // Use fire-and-forget pattern for cleanup
      fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {
        // Silently ignore cleanup errors
      });
    },
  };
}

// ============================================================================
// Backward compatible functions using default cache instance
// ============================================================================

// Module-level state for backward compatibility
let defaultCacheDir: string | null = null;

/**
 * Initializes cache for this construct instance.
 * Generates unique instance ID and registers cleanup handlers.
 * @returns Instance cache directory path
 */
export function initCache(): string {
  // Generate unique instance ID: pid + timestamp
  const instanceId = `${process.pid}-${Date.now()}`;

  // Create cache directory path
  const cacheRoot = getCacheRoot(nodeProcess);
  defaultCacheDir = join(cacheRoot, instanceId);

  // Create directory synchronously for backward compatibility
  mkdirSync(defaultCacheDir, { recursive: true });

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

  return defaultCacheDir;
}

/**
 * Gets or creates a cached copy of a plugin with expanded env vars.
 * CLAUDE_PLUGIN_ROOT is set to the destination cache path during expansion.
 * @returns Path to cached plugin directory
 */
export async function getCachedPlugin(plugin: PluginInfo): Promise<string> {
  if (!defaultCacheDir) {
    throw new Error("Cache not initialized. Call initCache() first.");
  }

  // Parse plugin name to get marketplace and plugin name
  // Format: "plugin-name@marketplace"
  const [pluginName, marketplace] = plugin.name.split("@");

  // Ensure we have valid parts
  if (!pluginName || !marketplace) {
    throw new Error(
      `Invalid plugin name format: ${plugin.name}. Expected "plugin-name@marketplace"`
    );
  }

  // Create cache structure: <cache-dir>/<marketplace>/<plugin-name>/
  const marketplaceDir = join(defaultCacheDir, marketplace);
  const cachedPluginDir = join(marketplaceDir, pluginName);

  // Copy plugin from install path to cache
  await bunFileSystem.mkdir(cachedPluginDir, { recursive: true });
  await bunFileSystem.cp(plugin.installPath, cachedPluginDir, {
    recursive: true,
    force: true,
  });

  // Set CLAUDE_PLUGIN_ROOT to the cached path
  const localEnv = { CLAUDE_PLUGIN_ROOT: cachedPluginDir };

  // Expand environment variables in cached files
  await expandCachedPluginFiles(bunFileSystem, cachedPluginDir, localEnv);

  return cachedPluginDir;
}

/**
 * Cleans up the current instance's cache directory.
 * Called automatically on process exit.
 */
export function cleanupCache(): void {
  if (defaultCacheDir && existsSync(defaultCacheDir)) {
    try {
      rmSync(defaultCacheDir, { recursive: true, force: true });
    } catch (error) {
      // Silently ignore cleanup errors
    }
  }
}

/**
 * Clears ALL cached instances (for --clear-cache command).
 * Useful for cleaning up orphaned caches from crashed processes.
 */
export async function clearAllCaches(deps?: CacheDependencies): Promise<void> {
  const fs = deps?.fs ?? bunFileSystem;
  const proc = deps?.process ?? nodeProcess;
  const cacheRoot = getCacheRoot(proc);

  if (await fs.exists(cacheRoot)) {
    try {
      await fs.rm(cacheRoot, { recursive: true, force: true });
    } catch (error) {
      // Silently ignore errors
    }
  }
}
