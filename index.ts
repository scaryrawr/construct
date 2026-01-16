#!/usr/bin/env bun
import { parseCliArgs } from "./src/cli";
import { scanAllPlugins, listAvailablePlugins } from "./src/scanner";
import { loadConfig, saveConfig, mergeCliWithConfig } from "./src/config";
import { translatePlugins } from "./src/translator";
import { executeCopilot } from "./src/executor";
import { runOperator } from "./src/operator";
import { clearAllCaches } from "./src/cache";
import { enablePlugin, disablePlugin, listEnabledPlugins } from "./src/plugin";
import {
  addMarketplace,
  listMarketplaces,
  removeMarketplace,
  updateMarketplace,
  updateAllMarketplaces,
} from "./src/marketplace";

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);

  if (args.command === "operator") {
    const exitCode = await runOperator({ passthroughArgs: args.passthroughArgs });
    process.exit(exitCode);
  }

  if (args.command === "plugin") {
    if (args.pluginSubcommand === "enable" && args.pluginName) {
      await enablePlugin(args.pluginName);
      process.exit(0);
    }

    if (args.pluginSubcommand === "disable" && args.pluginName) {
      await disablePlugin(args.pluginName);
      process.exit(0);
    }

    if (
      args.listEnabledPlugins &&
      !args.pluginSubcommand &&
      !args.marketplaceSubcommand
    ) {
      await listEnabledPlugins();
      process.exit(0);
    }

    if (args.marketplaceSubcommand === "list") {
      await listMarketplaces();
      process.exit(0);
    }

    if (args.marketplaceSubcommand === "add" && args.marketplaceTarget) {
      await addMarketplace(args.marketplaceTarget);
      process.exit(0);
    }

    if (args.marketplaceSubcommand === "remove" && args.marketplaceTarget) {
      await removeMarketplace(args.marketplaceTarget);
      process.exit(0);
    }

    if (args.marketplaceSubcommand === "update") {
      if (args.updateAll) {
        await updateAllMarketplaces();
        process.exit(0);
      }
      if (args.marketplaceTarget) {
        try {
          await updateMarketplace(args.marketplaceTarget);
          process.exit(0);
        } catch (error) {
          console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        }
      }
      console.error(
        'Error: Marketplace name is required for "update" command. Use "--all" to update all marketplaces or provide a marketplace name.'
      );
      process.exit(1);
    }

    // If we get here with a plugin command but no valid subcommand,
    // show help for the plugin command
    console.error("Error: plugin command requires a subcommand");
    console.error("Run 'construct plugin --help' for usage information");
    process.exit(1);
  }

  // Handle --clear-cache
  if (args.clearCache) {
    await clearAllCaches();
    console.log("Cache cleared.");
    process.exit(0);
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
