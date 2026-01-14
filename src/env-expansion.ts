/**
 * Core environment variable expansion logic
 * Handles ${VAR} and ${VAR:-default} syntax in strings and objects
 */

/**
 * Expands ${VAR} and ${VAR:-default} in a string.
 * @param value - String containing env var placeholders
 * @param localEnv - Optional local env map (e.g., CLAUDE_PLUGIN_ROOT)
 * @returns Expanded string (undefined vars without defaults left as-is)
 */
export function expandEnvVariables(
  value: string,
  localEnv?: Record<string, string>
): string {
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

  return value.replace(pattern, (match: string, varName: string, defaultValue?: string): string => {
    // Check localEnv first, then process.env
    const envValue: string | undefined = localEnv?.[varName] ?? process.env[varName];

    // If variable is set, use its value
    if (envValue !== undefined) {
      return envValue;
    }

    // If a default is provided (even if empty), use it
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // If variable is unset and no default, leave the placeholder as-is
    return match;
  });
}

/**
 * Recursively expands env vars in an object/array structure.
 * @param obj - Object or array to expand
 * @param localEnv - Optional local env map (e.g., CLAUDE_PLUGIN_ROOT)
 * @returns New object/array with expanded values
 */
export function expandEnvInObject<T>(
  obj: T,
  localEnv?: Record<string, string>
): T {
  // Handle null and primitives
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "string") {
      return expandEnvVariables(obj, localEnv) as T;
    }
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => expandEnvInObject(item, localEnv)) as T;
  }

  // Handle objects
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = expandEnvInObject(val, localEnv);
  }

  return result as T;
}
