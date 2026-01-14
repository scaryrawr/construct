import { join } from "node:path";
import type { PluginInfo, PluginComponent } from "./scanner";
import { translateAgents, type TranslatedAgent } from "./agent-translator";
import { initCache, getCachedPlugin } from "./cache";

/**
 * Claude Code MCP server configuration format (local)
 */
interface ClaudeLocalMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Claude Code MCP server configuration format (HTTP)
 */
interface ClaudeHttpMcpServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

/**
 * Claude Code MCP server configuration format
 */
type ClaudeMcpServer = ClaudeLocalMcpServer | ClaudeHttpMcpServer;

/**
 * Claude Code .mcp.json format
 */
interface ClaudeMcpConfig {
  [serverName: string]: ClaudeMcpServer;
}

/**
 * GitHub Copilot MCP server configuration format (local)
 */
interface CopilotLocalMcpServer {
  type: "local";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  tools: string[];
}

/**
 * GitHub Copilot MCP server configuration format (HTTP)
 */
interface CopilotHttpMcpServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  tools: string[];
}

/**
 * GitHub Copilot MCP server configuration format
 */
type CopilotMcpServer = CopilotLocalMcpServer | CopilotHttpMcpServer;

/**
 * GitHub Copilot MCP configuration format
 */
interface CopilotMcpConfig {
  mcpServers: {
    [serverName: string]: CopilotMcpServer;
  };
}

/**
 * Result of plugin translation
 */
export interface TranslationResult {
  /** Environment variables to set (includes COPILOT_SKILLS_DIRS) */
  env: Record<string, string>;
  /** JSON string for --additional-mcp-config flag, or null if no MCP servers */
  additionalMcpConfig: string | null;
  /** Translated agent definitions */
  translatedAgents: TranslatedAgent[];
}



/**
 * Transforms a Claude Code MCP server config to GitHub Copilot format.
 * Server config is already expanded by the cache layer.
 */
function transformMcpServer(
  server: ClaudeMcpServer
): CopilotMcpServer {
  // Check if it's an HTTP server
  if ('type' in server && server.type === 'http') {
    return {
      type: "http",
      url: server.url,
      headers: server.headers,
      tools: ["*"],
    };
  }
  
  // Local server
  return {
    type: "local",
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    tools: ["*"],
  };
}

/**
 * Reads and parses a .mcp.json file
 */
async function readMcpConfig(
  mcpConfigPath: string
): Promise<ClaudeMcpConfig | null> {
  try {
    const file = Bun.file(mcpConfigPath);
    const text = await file.text();
    return JSON.parse(text) as ClaudeMcpConfig;
  } catch (error) {
    console.error(`Failed to read MCP config at ${mcpConfigPath}:`, error);
    return null;
  }
}

/**
 * Extracts skill paths from plugin components using cached plugin path
 */
function getSkillPaths(plugin: PluginInfo, cachedPath: string): string[] {
  return plugin.components
    .filter(c => c.type === 'skill')
    .map(c => {
      // Replace original installPath with cachedPath in the component path
      if (c.path.startsWith(plugin.installPath)) {
        return c.path.replace(plugin.installPath, cachedPath);
      }
      return c.path;
    });
}

/**
 * Gets MCP config path from plugin components if it exists
 */
function getMcpConfigPath(plugin: PluginInfo): string | undefined {
  const mcpComponent = plugin.components.find(c => c.type === 'mcp');
  return mcpComponent?.path;
}

/**
 * Translates enabled plugins into environment variables and MCP configuration
 * for GitHub Copilot CLI.
 *
 * @param plugins - Array of enabled plugins with their component information
 * @returns Translation result with environment variables and MCP config JSON
 */
export async function translatePlugins(
  plugins: PluginInfo[]
): Promise<TranslationResult> {
  const env: Record<string, string> = {};
  const allMcpServers: Record<string, CopilotMcpServer> = {};

  // Initialize cache
  initCache();

  // Map plugin to cached path for reuse
  const pluginCachePaths = new Map<PluginInfo, string>();

  // 1. Build COPILOT_SKILLS_DIRS from all skill paths (using cached paths)
  const allSkillPaths: string[] = [];
  for (const plugin of plugins) {
    const cachedPath = await getCachedPlugin(plugin);
    pluginCachePaths.set(plugin, cachedPath);
    allSkillPaths.push(...getSkillPaths(plugin, cachedPath));
  }

  if (allSkillPaths.length > 0) {
    env.COPILOT_SKILLS_DIRS = allSkillPaths.join(",");
  }

  // 2. Transform and merge MCP configurations
  for (const plugin of plugins) {
    const mcpConfigPath = getMcpConfigPath(plugin);
    if (mcpConfigPath) {
      // Read .mcp.json from cached path (already has vars expanded)
      const cachedPath = pluginCachePaths.get(plugin);
      if (cachedPath) {
        const cachedMcpConfigPath = join(cachedPath, ".mcp.json");
        const claudeConfig = await readMcpConfig(cachedMcpConfigPath);
        if (claudeConfig) {
          // Transform each server in the config
          // No inline expansion needed - cache files already have vars expanded
          for (const [serverName, serverConfig] of Object.entries(claudeConfig)) {
            // Use original server name as per spec
            allMcpServers[serverName] = transformMcpServer(serverConfig);
          }
        }
      }
    }
  }

  // 3. Generate --additional-mcp-config JSON string
  let additionalMcpConfig: string | null = null;
  if (Object.keys(allMcpServers).length > 0) {
    const copilotConfig: CopilotMcpConfig = {
      mcpServers: allMcpServers,
    };
    additionalMcpConfig = JSON.stringify(copilotConfig);
  }

  // 4. Translate agents
  const mcpServerNames = Object.keys(allMcpServers);
  let translatedAgents: TranslatedAgent[] = [];
  try {
    // Create a map of plugin names to cached paths
    const cachedPathsMap = new Map(
      plugins.map(plugin => [plugin.name, pluginCachePaths.get(plugin) || plugin.installPath])
    );
    translatedAgents = await translateAgents(plugins, mcpServerNames, cachedPathsMap);
  } catch (error) {
    console.warn('Warning: Failed to translate agents:', error);
  }

  return {
    env,
    additionalMcpConfig,
    translatedAgents,
  };
}
