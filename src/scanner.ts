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
 * Structure of installed_plugins.json
 */
interface InstalledPluginsFile {
  version: number;
  plugins: {
    [key: string]: Array<{
      scope: string;
      installPath: string;
      version: string;
      installedAt: string;
      lastUpdated: string;
    }>;
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

async function readPluginDescription(installPath: string): Promise<string | undefined> {
  try {
    const pluginJsonPath = join(installPath, '.claude-plugin', 'plugin.json');
    const pluginJsonFile = Bun.file(pluginJsonPath);
    if (!await pluginJsonFile.exists()) {
      return undefined;
    }
    const pluginData = await pluginJsonFile.json() as { description?: string };
    return sanitizeDescription(pluginData.description);
  } catch (error) {
    console.warn(`Warning: Error reading plugin metadata in ${installPath}:`, error);
    return undefined;
  }
}

/**
 * Gets the path to the installed plugins configuration file
 */
function getInstalledPluginsPath(): string {
  return join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
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
 * Scans all installed plugins and builds a registry
 */
export async function scanInstalledPlugins(): Promise<PluginRegistry> {
  const registry: PluginRegistry = {
    plugins: new Map()
  };

  const installedPluginsPath = getInstalledPluginsPath();
  const installedPluginsFile = Bun.file(installedPluginsPath);

  // Handle missing installed_plugins.json gracefully
  if (!await installedPluginsFile.exists()) {
    return registry;
  }

  try {
    const installedPluginsData: InstalledPluginsFile = await installedPluginsFile.json();

    // Process each installed plugin
    for (const [pluginName, installations] of Object.entries(installedPluginsData.plugins)) {
      // Use the first installation (should typically only be one per scope)
      if (installations.length === 0) continue;
      
      const installation = installations[0]!;
      const { installPath, version } = installation;

      // Scan for components in the plugin directory
      const components = await scanPluginComponents(installPath);
      const description = await readPluginDescription(installPath);

      registry.plugins.set(pluginName, {
        name: pluginName,
        installPath,
        version,
        description,
        components
      });
    }
  } catch (error) {
    console.warn('Warning: Error reading installed plugins:', error);
  }

  return registry;
}

/**
 * Scans marketplace directories for available plugins
 */
export async function scanMarketplacePlugins(): Promise<PluginRegistry> {
  const registry: PluginRegistry = {
    plugins: new Map()
  };

  const marketplacesDir = join(homedir(), '.claude', 'plugins', 'marketplaces');
  let marketplacesDirExists = false;
  try {
    const marketplacesStat = await stat(marketplacesDir);
    marketplacesDirExists = marketplacesStat.isDirectory();
  } catch {
    marketplacesDirExists = false;
  }
  if (!marketplacesDirExists) {
    return registry;
  }

  try {
    // Scan for marketplace directories (dot: true needed for .claude-plugin)
    const marketplaceGlob = new Glob("*/.claude-plugin/marketplace.json");
    const marketplaceFiles = Array.from(marketplaceGlob.scanSync({ cwd: marketplacesDir, absolute: false, dot: true }));

    for (const marketplaceFile of marketplaceFiles) {
      try {
        const marketplacePath = join(marketplacesDir, marketplaceFile);
        const marketplaceJsonFile = Bun.file(marketplacePath);

        if (!await marketplaceJsonFile.exists()) {
          continue;
        }

        const marketplaceData: MarketplaceFile = await marketplaceJsonFile.json();
        const marketplaceName = marketplaceData.name;

        // Get the marketplace base directory (parent of .claude-plugin)
        const marketplaceBaseDir = join(marketplacesDir, marketplaceFile.split('/')[0]!);

        // Process each plugin in the marketplace
        for (const plugin of marketplaceData.plugins) {
          try {
            // Skip plugins with remote/object source (not locally available)
            if (typeof plugin.source !== 'string') {
              continue;
            }

            // Resolve the plugin path using the source field
            const pluginPath = join(marketplaceBaseDir, plugin.source);

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
        console.warn(`Warning: Error reading marketplace file ${marketplaceFile}:`, error);
      }
    }
  } catch (error) {
    // Gracefully handle case where marketplaces directory doesn't exist
    console.warn('Warning: Error scanning marketplace directories:', error);
  }

  return registry;
}

/**
 * Scans all available plugins (installed and marketplace) and returns merged registry
 */
export async function scanAllPlugins(): Promise<PluginRegistry> {
  // Scan both installed and marketplace plugins
  const [installedRegistry, marketplaceRegistry] = await Promise.all([
    scanInstalledPlugins(),
    scanMarketplacePlugins()
  ]);

  // Merge results, with installed plugins taking precedence
  const mergedPlugins = new Map<string, PluginInfo>([
    ...marketplaceRegistry.plugins,
    ...installedRegistry.plugins
  ]);

  return { plugins: mergedPlugins };
}

/**
 * Returns a list of all available plugin names (installed and marketplace)
 */
export async function listAvailablePlugins(): Promise<string[]> {
  const registry = await scanAllPlugins();
  return Array.from(registry.plugins.keys());
}
