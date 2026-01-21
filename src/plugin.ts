import {
  scanAllPlugins as defaultScanAllPlugins,
  type PluginRegistry,
} from "./scanner";
import {
  loadConfig as defaultLoadConfig,
  saveConfig as defaultSaveConfig,
  type ConstructConfig,
} from "./config";

/**
 * Dependencies for plugin operations, allowing injection for testing.
 */
export interface PluginDependencies {
  scanAllPlugins?: () => Promise<PluginRegistry>;
  loadConfig?: () => Promise<ConstructConfig | null>;
  saveConfig?: (config: ConstructConfig) => Promise<void>;
  exit?: (code: number) => never;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

const defaultDeps: Required<PluginDependencies> = {
  scanAllPlugins: defaultScanAllPlugins,
  loadConfig: defaultLoadConfig,
  saveConfig: defaultSaveConfig,
  exit: (code: number) => process.exit(code),
  log: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
};

/**
 * Enables a plugin by adding it to the project config.
 */
export async function enablePlugin(
  pluginName: string,
  deps?: PluginDependencies,
): Promise<void> {
  const { scanAllPlugins, loadConfig, saveConfig, exit, log, error } = {
    ...defaultDeps,
    ...deps,
  };

  const registry = await scanAllPlugins();

  if (!registry.plugins.has(pluginName)) {
    error(`Error: Plugin "${pluginName}" not found in any known marketplace`);
    exit(1);
  }

  const config = await loadConfig();
  const enabledPlugins = config?.enabledPlugins ?? [];

  if (enabledPlugins.includes(pluginName)) {
    log(`Plugin already enabled: ${pluginName}`);
    return;
  }

  await saveConfig({
    enabledPlugins: [...enabledPlugins, pluginName],
    lastUsed: new Date().toISOString(),
  });

  log(`Enabled plugin: ${pluginName}`);
}

/**
 * Disables a plugin by removing it from the project config.
 */
export async function disablePlugin(
  pluginName: string,
  deps?: PluginDependencies,
): Promise<void> {
  const { loadConfig, saveConfig, log } = { ...defaultDeps, ...deps };

  const config = await loadConfig();

  if (!config || !config.enabledPlugins.includes(pluginName)) {
    log(`Plugin not enabled: ${pluginName}`);
    return;
  }

  await saveConfig({
    enabledPlugins: config.enabledPlugins.filter((name) => name !== pluginName),
    lastUsed: new Date().toISOString(),
  });

  log(`Disabled plugin: ${pluginName}`);
}

/**
 * Lists enabled plugins from the project config.
 */
export async function listEnabledPlugins(
  deps?: PluginDependencies,
): Promise<void> {
  const { loadConfig, log } = { ...defaultDeps, ...deps };

  const config = await loadConfig();
  const enabledPlugins = config?.enabledPlugins ?? [];

  if (enabledPlugins.length === 0) {
    log("No plugins enabled.");
    return;
  }

  log("Enabled plugins:");
  for (const pluginName of enabledPlugins) {
    log(`  ${pluginName}`);
  }
}
