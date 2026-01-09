import { join } from "node:path";
import { homedir } from "node:os";
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
    
    for (const skillFile of skillFiles) {
      // Extract skill name from path: skills/<skill-name>/SKILL.md
      const parts = skillFile.split('/');
      if (parts.length >= 3 && parts[1]) {
        const skillName = parts[1];
        const skillDir = join(installPath, 'skills', skillName);
        components.push({
          type: 'skill',
          path: skillDir,
          name: skillName
        });
      }
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

      registry.plugins.set(pluginName, {
        name: pluginName,
        installPath,
        version,
        components
      });
    }
  } catch (error) {
    console.warn('Warning: Error reading installed plugins:', error);
  }

  return registry;
}

/**
 * Returns a list of all installed plugin names
 */
export async function listAvailablePlugins(): Promise<string[]> {
  const registry = await scanInstalledPlugins();
  return Array.from(registry.plugins.keys());
}
