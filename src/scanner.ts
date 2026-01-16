import { join } from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import { Glob } from "bun";

/**
 * Represents a single component within a plugin (skill, MCP server, or agent)
 */
export interface PluginComponent {
  type: 'skill' | 'mcp' | 'agent';
  path: string;
  name: string;
}

/**
 * Information about an installed plugin
 */
export interface PluginInfo {
  name: string;  // plugin-name@marketplace
  installPath: string;
  version: string;
  description?: string;
  components: PluginComponent[];
}

/**
 * Registry of all installed plugins and their components
 */
export interface PluginRegistry {
  plugins: Map<string, PluginInfo>;
}

/**
 * Structure of known_marketplaces.json
 */
interface KnownMarketplacesFile {
  [marketplaceName: string]: {
    source: {
      source: string;
      repo?: string;
      path?: string;
    };
    installLocation: string;
    lastUpdated: string;
  };
}

/**
 * Structure of marketplace.json
 */
interface MarketplaceFile {
  name: string;
  plugins: Array<{
    name: string;
    source: string;
    version?: string;
    description?: string;
    [key: string]: any;
  }>;
}

function sanitizeDescription(description?: string): string | undefined {
  if (!description) {
    return undefined;
  }
  const singleLine = description.replace(/[\t\r\n]+/g, " ").trim();
  return singleLine.length > 0 ? singleLine : undefined;
}

/**
 * Gets the path to the known marketplaces configuration file
 */
export function getKnownMarketplacesPath(): string {
  const homeDir = process.env.HOME ?? homedir();
  return join(homeDir, '.claude', 'plugins', 'known_marketplaces.json');
}

/**
 * Scans a plugin directory for components (skills, MCPs, agents)
 */
async function scanPluginComponents(installPath: string): Promise<PluginComponent[]> {
  const components: PluginComponent[] = [];

  try {
    // Scan for skills: skills/*/SKILL.md
    const skillGlob = new Glob("skills/*/SKILL.md");
    const skillFiles = Array.from(skillGlob.scanSync({ cwd: installPath, absolute: false }));
    
    // If any skills exist, add the skills root directory (not individual skill dirs)
    // COPILOT_SKILLS_DIRS expects the parent "skills" directory
    if (skillFiles.length > 0) {
      const skillsDir = join(installPath, 'skills');
      components.push({
        type: 'skill',
        path: skillsDir,
        name: 'skills'
      });
    }

    // Check for MCP server config: .mcp.json
    const mcpPath = join(installPath, '.mcp.json');
    const mcpFile = Bun.file(mcpPath);
    if (await mcpFile.exists()) {
      components.push({
        type: 'mcp',
        path: mcpPath,
        name: '.mcp.json'
      });
    }

    // Scan for custom agents: agents/*.md
    const agentGlob = new Glob("agents/*.md");
    const agentFiles = Array.from(agentGlob.scanSync({ cwd: installPath, absolute: false }));
    
    for (const agentFile of agentFiles) {
      const agentName = agentFile.split('/').pop()?.replace('.md', '') || agentFile;
      const agentPath = join(installPath, agentFile);
      components.push({
        type: 'agent',
        path: agentPath,
        name: agentName
      });
    }
  } catch (error) {
    // Gracefully handle errors during component scanning
    console.warn(`Warning: Error scanning components in ${installPath}:`, error);
  }

  return components;
}

/**
 * Scans marketplace directories for available plugins using known_marketplaces.json
 */
export async function scanMarketplacePlugins(): Promise<PluginRegistry> {
  const registry: PluginRegistry = {
    plugins: new Map()
  };

  const knownMarketplacesPath = getKnownMarketplacesPath();
  const knownMarketplacesFile = Bun.file(knownMarketplacesPath);

  // Handle missing known_marketplaces.json gracefully
  if (!await knownMarketplacesFile.exists()) {
    return registry;
  }

  try {
    const knownMarketplacesData: KnownMarketplacesFile = await knownMarketplacesFile.json();

    // Process each known marketplace
    for (const [marketplaceName, marketplaceInfo] of Object.entries(knownMarketplacesData)) {
      const { installLocation } = marketplaceInfo;

      try {
        // Check if the marketplace directory exists
        const marketplaceStat = await stat(installLocation);
        if (!marketplaceStat.isDirectory()) {
          continue;
        }

        // Read the marketplace.json file
        const marketplaceJsonPath = join(installLocation, '.claude-plugin', 'marketplace.json');
        const marketplaceJsonFile = Bun.file(marketplaceJsonPath);

        if (!await marketplaceJsonFile.exists()) {
          continue;
        }

        const marketplaceData: MarketplaceFile = await marketplaceJsonFile.json();

        // Process each plugin in the marketplace
        for (const plugin of marketplaceData.plugins) {
          try {
            // Skip plugins with remote/object source (not locally available)
            if (typeof plugin.source !== 'string') {
              continue;
            }

            // Resolve the plugin path using the source field
            const pluginPath = join(installLocation, plugin.source);

            // Scan for components in the plugin directory
            const components = await scanPluginComponents(pluginPath);
            const description = sanitizeDescription(plugin.description);

            // Use the format plugin-name@marketplace-name
            const pluginKey = `${plugin.name}@${marketplaceName}`;

            registry.plugins.set(pluginKey, {
              name: pluginKey,
              installPath: pluginPath,
              version: plugin.version || 'unknown',
              description,
              components
            });
          } catch (error) {
            console.warn(`Warning: Error processing plugin ${plugin.name} in marketplace ${marketplaceName}:`, error);
          }
        }
      } catch (error) {
        console.warn(`Warning: Error reading marketplace ${marketplaceName}:`, error);
      }
    }
  } catch (error) {
    console.warn('Warning: Error reading known marketplaces:', error);
  }

  return registry;
}

/**
 * Scans all available plugins from known marketplaces
 */
export async function scanAllPlugins(): Promise<PluginRegistry> {
  return scanMarketplacePlugins();
}

/**
 * Returns a list of all available plugin names (installed and marketplace)
 */
export async function listAvailablePlugins(): Promise<string[]> {
  const registry = await scanAllPlugins();
  return Array.from(registry.plugins.keys());
}
