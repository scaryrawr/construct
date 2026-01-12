#!/usr/bin/env bun
import { parseCliArgs } from "./src/cli";
import { scanAllPlugins, listAvailablePlugins } from "./src/scanner";
import { loadConfig, saveConfig, mergeCliWithConfig } from "./src/config";
import { translatePlugins } from "./src/translator";
import { executeCopilot } from "./src/executor";
import { runOperator } from "./src/operator";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);

  if (args.command === "operator") {
    const exitCode = await runOperator({ passthroughArgs: args.passthroughArgs });
    process.exit(exitCode);
  }

  // Handle --list
  if (args.listAvailablePlugins) {
    const plugins = await listAvailablePlugins();
    if (plugins.length === 0) {
      console.log("No plugins installed. Install plugins via Claude Code first.");
    } else {
      console.log("Available plugins:");
      for (const plugin of plugins) {
        console.log(`  ${plugin}`);
      }
    }
    process.exit(0);
  }

  // Load saved config and merge with CLI args
  const savedConfig = await loadConfig();
  const enabledPluginNames = mergeCliWithConfig(args.enabledPlugins, savedConfig);

  // Scan all available plugins (installed and marketplace)
  const registry = await scanAllPlugins();

  // Resolve enabled plugins to PluginInfo objects
  const enabledPlugins = [];
  for (const pluginName of enabledPluginNames) {
    const plugin = registry.plugins.get(pluginName);
    if (plugin) {
      enabledPlugins.push(plugin);
    } else {
      console.warn(`Warning: Plugin "${pluginName}" not found. Skipping.`);
    }
  }

  // Save config if plugins were enabled via CLI
  if (args.enabledPlugins.length > 0) {
    await saveConfig({
      enabledPlugins: args.enabledPlugins,
      lastUsed: new Date().toISOString(),
    });
  }

  // Translate plugins to copilot format
  const translation = await translatePlugins(enabledPlugins);

  // Execute copilot
  const exitCode = executeCopilot({
    env: translation.env,
    additionalMcpConfig: translation.additionalMcpConfig,
    passthroughArgs: args.passthroughArgs,
    translatedAgents: translation.translatedAgents,
  });

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
