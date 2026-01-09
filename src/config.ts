import { join } from "path";

const CONFIG_FILE = ".construct.json";

export interface ConstructConfig {
  enabledPlugins: string[];
  lastUsed: string;
}

/**
 * Load configuration from .construct.json in the current directory.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function loadConfig(): Promise<ConstructConfig | null> {
  try {
    const configPath = join(process.cwd(), CONFIG_FILE);
    const file = Bun.file(configPath);
    
    if (!(await file.exists())) {
      return null;
    }
    
    const config = await file.json();
    
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
export async function saveConfig(config: ConstructConfig): Promise<void> {
  const configPath = join(process.cwd(), CONFIG_FILE);
  await Bun.write(configPath, JSON.stringify(config, null, 2));
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
