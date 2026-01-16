import { scanAllPlugins } from "./scanner";
import { loadConfig, saveConfig } from "./config";

/**
 * Enables a plugin by adding it to the project config.
 */
export async function enablePlugin(pluginName: string): Promise<void> {
  const registry = await scanAllPlugins();

  if (!registry.plugins.has(pluginName)) {
    console.error(
      `Error: Plugin "${pluginName}" not found in any known marketplace`,
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const enabledPlugins = config?.enabledPlugins ?? [];

  if (enabledPlugins.includes(pluginName)) {
    console.log(`Plugin already enabled: ${pluginName}`);
    return;
  }

  await saveConfig({
    ...(config ?? {}),
    enabledPlugins: [...enabledPlugins, pluginName],
    lastUsed: new Date().toISOString(),
  });

  console.log(`Enabled plugin: ${pluginName}`);
}

/**
 * Disables a plugin by removing it from the project config.
 */
export async function disablePlugin(pluginName: string): Promise<void> {
  const config = await loadConfig();

  if (!config || !config.enabledPlugins.includes(pluginName)) {
    console.log(`Plugin not enabled: ${pluginName}`);
    return;
  }

  await saveConfig({
    ...config,
    enabledPlugins: config.enabledPlugins.filter((name) => name !== pluginName),
    lastUsed: new Date().toISOString(),
  });

  console.log(`Disabled plugin: ${pluginName}`);
}

/**
 * Lists enabled plugins from the project config.
 */
export async function listEnabledPlugins(): Promise<void> {
  const config = await loadConfig();
  const enabledPlugins = config?.enabledPlugins ?? [];

  if (enabledPlugins.length === 0) {
    console.log("No plugins enabled.");
    return;
  }

  console.log("Enabled plugins:");
  for (const pluginName of enabledPlugins) {
    console.log(`  ${pluginName}`);
  }
}
