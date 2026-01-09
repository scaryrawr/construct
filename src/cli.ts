import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliArgs {
  listAvailablePlugins: boolean;
  enabledPlugins: string[];
  passthroughArgs: string[];
}

export function parseCliArgs(argv: string[]): CliArgs {
  // Find the -- separator to split construct args from copilot args
  const separatorIndex = argv.indexOf("--");
  const constructArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const passthroughArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];

  const parsed = yargs(hideBin(constructArgs))
    .scriptName("construct")
    .usage("$0 [options] [-- copilot-args...]")
    .option("list-available-plugins", {
      type: "boolean",
      description: "List all discoverable plugins from installed marketplaces",
      default: false,
    })
    .option("enable-plugin", {
      type: "array",
      description: "Enable plugin(s) for this run (format: <plugin>@<marketplace>)",
      string: true,
      default: [],
    })
    .example("$0 --list-available-plugins", "List all available plugins")
    .example(
      "$0 --enable-plugin tmux@scaryrawr-plugins",
      "Enable a specific plugin"
    )
    .example(
      "$0 --enable-plugin tmux@scaryrawr-plugins -- --continue",
      "Enable plugin and pass args to copilot"
    )
    .example(
      "$0 -- 'fix the failing tests'",
      "Pass a prompt directly to copilot"
    )
    .help()
    .alias("h", "help")
    .version()
    .alias("v", "version")
    .completion("completion", "Generate shell completion script")
    .parseSync();

  return {
    listAvailablePlugins: parsed["list-available-plugins"] as boolean,
    enabledPlugins: (parsed["enable-plugin"] as string[]) || [],
    passthroughArgs,
  };
}
