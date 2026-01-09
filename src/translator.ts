import { join } from "path";
import type { PluginInfo, PluginComponent } from "./scanner";

/**
 * Claude Code MCP server configuration format
 */
interface ClaudeMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Claude Code .mcp.json format
 */
interface ClaudeMcpConfig {
  [serverName: string]: ClaudeMcpServer;
}

/**
 * GitHub Copilot MCP server configuration format
 */
interface CopilotMcpServer {
  type: "local";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  tools: string[];
}

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
}

/**
 * Expands ${CLAUDE_PLUGIN_ROOT} placeholders in a string
 */
function expandPluginRoot(value: string, pluginPath: string): string {
  return value.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginPath);
}

/**
 * Recursively expands ${CLAUDE_PLUGIN_ROOT} in an object
 */
function expandPluginRootInObject<T>(obj: T, pluginPath: string): T {
  if (typeof obj === "string") {
    return expandPluginRoot(obj, pluginPath) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandPluginRootInObject(item, pluginPath)) as T;
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandPluginRootInObject(value, pluginPath);
    }
    return result as T;
  }
  return obj;
}

/**
 * Transforms a Claude Code MCP server config to GitHub Copilot format
 */
function transformMcpServer(
  server: ClaudeMcpServer,
  pluginPath: string
): CopilotMcpServer {
  // Expand ${CLAUDE_PLUGIN_ROOT} in all string values
  const expandedServer = expandPluginRootInObject(server, pluginPath);

  return {
    type: "local",
    command: expandedServer.command,
    args: expandedServer.args,
    env: expandedServer.env,
    cwd: expandedServer.cwd,
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
 * Extracts skill paths from plugin components
 */
function getSkillPaths(plugin: PluginInfo): string[] {
  return plugin.components
    .filter(c => c.type === 'skill')
    .map(c => c.path);
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

  // 1. Build COPILOT_SKILLS_DIRS from all skill paths
  const allSkillPaths: string[] = [];
  for (const plugin of plugins) {
    allSkillPaths.push(...getSkillPaths(plugin));
  }

  if (allSkillPaths.length > 0) {
    env.COPILOT_SKILLS_DIRS = allSkillPaths.join(",");
  }

  // 2. Transform and merge MCP configurations
  for (const plugin of plugins) {
    const mcpConfigPath = getMcpConfigPath(plugin);
    if (mcpConfigPath) {
      const claudeConfig = await readMcpConfig(mcpConfigPath);
      if (claudeConfig) {
        // Transform each server in the config
        for (const [serverName, serverConfig] of Object.entries(claudeConfig)) {
          // Prefix server name with plugin name to avoid conflicts
          const prefixedName = `${plugin.name}/${serverName}`;
          allMcpServers[prefixedName] = transformMcpServer(
            serverConfig,
            plugin.installPath
          );
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

  return {
    env,
    additionalMcpConfig,
  };
}
