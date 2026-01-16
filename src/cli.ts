import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliArgs {
  command: "run" | "operator" | "plugin";
  listAvailablePlugins: boolean;
  listEnabledPlugins: boolean;
  enabledPlugins: string[];
  passthroughArgs: string[];
  clearCache: boolean;
  pluginSubcommand?: "enable" | "disable";
  marketplaceSubcommand?: "list" | "add" | "remove" | "update";
  pluginName?: string;
  marketplaceTarget?: string;
  updateAll?: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  // Find the -- separator to split construct args from copilot args
  const separatorIndex = argv.indexOf("--");
  const constructArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const passthroughArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];

  const constructArgv = hideBin(constructArgs);
  let command: CliArgs["command"] | undefined;
  let pluginSubcommand: CliArgs["pluginSubcommand"];
  let marketplaceSubcommand: CliArgs["marketplaceSubcommand"];
  let pluginName: string | undefined;
  let marketplaceTarget: string | undefined;
  let updateAll = false;

  const parsed = yargs(constructArgv)
    .scriptName("construct")
    .usage("$0 [command] [options] [-- copilot-args...]")
    .completion("completion", "Generate shell completion script")
    .command(
      ["run", "$0"],
      "Run copilot with plugins",
      (runYargs) =>
        runYargs
          .option("list", {
            type: "boolean",
            description: "List all discoverable plugins from installed marketplaces",
            default: false,
          })
          .option("load", {
            type: "array",
            description: "Load plugin(s) for this run (format: <plugin>@<marketplace>)",
            string: true,
            default: [],
          })
          .option("clear-cache", {
            type: "boolean",
            description: "Clear all cached plugin instances (useful after crashes)",
            default: false,
          }),
      () => {
        command = "run";
      },
    )
    .command(
      "operator",
      "Launch interactive plugin selector (requires fzf)",
      () => {},
      () => {
        command = "operator";
      },
    )
    .command(
      "plugin",
      "Manage plugins and marketplaces",
      (pluginYargs) =>
        pluginYargs
          .option("list-enabled", {
            type: "boolean",
            alias: "e",
            description: "List enabled plugins",
            default: false,
            conflicts: ["enable", "disable"],
          })
          .command(
            "enable <pluginName>",
            "Enable a plugin",
            (enableYargs) =>
              enableYargs.positional("pluginName", {
                type: "string",
                demandOption: true,
                conflicts: "list-enabled",
              }),
            (args) => {
              command = "plugin";
              pluginSubcommand = "enable";
              pluginName = args.pluginName as string;
            },
          )
          .command(
            "disable <pluginName>",
            "Disable a plugin",
            (disableYargs) =>
              disableYargs.positional("pluginName", {
                type: "string",
                demandOption: true,
                conflicts: "list-enabled",
              }),
            (args) => {
              command = "plugin";
              pluginSubcommand = "disable";
              pluginName = args.pluginName as string;
            },
          )
          .command(
            "marketplace",
            "Manage marketplaces",
            (marketplaceYargs) =>
              marketplaceYargs
                .option("list", {
                  type: "boolean",
                  alias: "l",
                  description: "List known marketplaces",
                  default: false,
                })
                .command(
                  "add <target>",
                  "Add a marketplace",
                  (addYargs) =>
                    addYargs.positional("target", {
                      type: "string",
                      demandOption: true,
                    }),
                  (args) => {
                    command = "plugin";
                    marketplaceSubcommand = "add";
                    marketplaceTarget = args.target as string;
                  },
                )
                .command(
                  "remove <name>",
                  "Remove a marketplace",
                  (removeYargs) =>
                    removeYargs.positional("name", {
                      type: "string",
                      demandOption: true,
                    }),
                  (args) => {
                    command = "plugin";
                    marketplaceSubcommand = "remove";
                    marketplaceTarget = args.name as string;
                  },
                )
                .command(
                  "update [name]",
                  "Update marketplaces",
                  (updateYargs) =>
                    updateYargs
                      .positional("name", {
                        type: "string",
                        conflicts: "all",
                      })
                      .option("all", {
                        type: "boolean",
                        alias: "a",
                        description: "Update all git-based marketplaces",
                        default: false,
                      }),
                  (args) => {
                    command = "plugin";
                    marketplaceSubcommand = "update";
                    marketplaceTarget = args.name as string | undefined;
                    updateAll = args.all as boolean;
                  },
                ),
            (args) => {
              command = "plugin";
              if (args.list) {
                marketplaceSubcommand = "list";
              }
            },
          ),
      () => {
        command = "plugin";
      },
    )
    .example("$0 --list", "List all available plugins")
    .example("$0 --load tmux@scaryrawr-plugins", "Load a specific plugin")
    .example(
      "$0 --load plugin1@marketplace --load plugin2@marketplace",
      "Load multiple plugins"
    )
    .example(
      "$0 --load tmux@scaryrawr-plugins -- --continue",
      "Load plugin and pass args to copilot"
    )
    .example(
      "$0 -- 'fix the failing tests'",
      "Pass a prompt directly to copilot"
    )
    .example("$0 operator", "Launch interactive plugin selector (requires fzf)")
    .example(
      "$0 operator -- --continue",
      "Launch selector then pass args through to copilot"
    )
    .example("$0 plugin enable tmux@scaryrawr-plugins", "Enable a plugin")
    .example("$0 plugin disable tmux@scaryrawr-plugins", "Disable a plugin")
    .example("$0 plugin --list-enabled", "List enabled plugins")
    .example("$0 plugin marketplace --list", "List known marketplaces")
    .example(
      "$0 plugin marketplace add scaryrawr/scaryrawr-plugins",
      "Add a marketplace from GitHub"
    )
    .example(
      "$0 plugin marketplace update --all",
      "Update all git-based marketplaces"
    )
    .help()
    .alias("h", "help")
    .version()
    .alias("v", "version")
    .parseSync();

  const resolvedCommand: CliArgs["command"] = command ?? "run";
  const isRunCommand = resolvedCommand === "run";
  const isPluginCommand = resolvedCommand === "plugin";

  return {
    command: resolvedCommand,
    listAvailablePlugins: isRunCommand ? (parsed["list"] as boolean) : false,
    listEnabledPlugins:
      isPluginCommand ? (parsed["list-enabled"] as boolean) : false,
    enabledPlugins: isRunCommand ? ((parsed["load"] as string[]) || []) : [],
    passthroughArgs,
    clearCache: isRunCommand ? (parsed["clear-cache"] as boolean) : false,
    pluginSubcommand,
    marketplaceSubcommand,
    pluginName,
    marketplaceTarget,
    updateAll,
  };
}
