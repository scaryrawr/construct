import { join } from "path";
import type { FileSystem } from "./interfaces/file-system";
import type { ProcessEnv } from "./interfaces/process";
import { bunFileSystem } from "./adapters/bun-file-system";
import { nodeProcess } from "./adapters/node-process";

const CONFIG_FILE = ".construct.json";

export interface ConstructConfig {
  enabledPlugins: string[];
  lastUsed: string;
}

/**
 * Dependencies for config operations, allowing injection for testing.
 */
export interface ConfigDependencies {
  fs?: FileSystem;
  process?: ProcessEnv;
}

const defaultDeps: Required<ConfigDependencies> = {
  fs: bunFileSystem,
  process: nodeProcess,
};

/**
 * Load configuration from .construct.json in the current directory.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function loadConfig(
  deps?: ConfigDependencies
): Promise<ConstructConfig | null> {
  const { fs, process } = { ...defaultDeps, ...deps };

  try {
    const configPath = join(process.cwd(), CONFIG_FILE);

    if (!(await fs.exists(configPath))) {
      return null;
    }

    const content = await fs.readFile(configPath);
    const config = JSON.parse(content);

    // Validate config structure
    if (
      typeof config === "object" &&
      config !== null &&
      Array.isArray(config.enabledPlugins) &&
      typeof config.lastUsed === "string"
    ) {
      return config as ConstructConfig;
    }

    return null;
  } catch (error) {
    // Handle parsing errors or file system errors gracefully
    return null;
  }
}

/**
 * Save configuration to .construct.json in the current directory.
 */
export async function saveConfig(
  config: ConstructConfig,
  deps?: ConfigDependencies
): Promise<void> {
  const { fs, process } = { ...defaultDeps, ...deps };
  const configPath = join(process.cwd(), CONFIG_FILE);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Merge CLI-provided plugins with saved configuration.
 * CLI plugins take precedence over saved config.
 * If no CLI plugins provided, falls back to saved config.
 */
export function mergeCliWithConfig(
  cliPlugins: string[],
  savedConfig: ConstructConfig | null
): string[] {
  if (cliPlugins.length > 0) {
    return cliPlugins;
  }
  
  return savedConfig?.enabledPlugins ?? [];
}
