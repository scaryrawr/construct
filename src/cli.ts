import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliArgs {
  command: "run" | "operator";
  listAvailablePlugins: boolean;
  enabledPlugins: string[];
  passthroughArgs: string[];
  clearCache: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  // Find the -- separator to split construct args from copilot args
  const separatorIndex = argv.indexOf("--");
  const constructArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const passthroughArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];

  const constructArgv = hideBin(constructArgs);
  const command: "run" | "operator" = constructArgv[0] === "operator" ? "operator" : "run";
  const yargsArgv = command === "operator" ? constructArgv.slice(1) : constructArgv;

  const parsed = yargs(yargsArgv)
    .scriptName("construct")
    .usage("$0 [operator] [options] [-- copilot-args...]")
    .completion("completion", "Generate shell completion script")
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
    })
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
    .help()
    .alias("h", "help")
    .version()
    .alias("v", "version")
    .parseSync();

  return {
    command,
    listAvailablePlugins: parsed["list"] as boolean,
    enabledPlugins: (parsed["load"] as string[]) || [],
    passthroughArgs,
    clearCache: parsed["clear-cache"] as boolean,
  };
}
