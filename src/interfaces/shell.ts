/**
 * Options for spawn operations
 */
export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: "pipe" | "inherit" | "ignore";
  stderr?: "pipe" | "inherit" | "ignore";
  stdin?: "pipe" | "inherit" | "ignore";
}

/**
 * Result of a synchronous spawn operation
 */
export interface SpawnSyncResult {
  exitCode: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/**
 * Abstraction over shell/process spawning.
 * Enables dependency injection for testing without running real commands.
 */
export interface Shell {
  /**
   * Spawns a command synchronously and waits for completion
   */
  spawnSync(cmd: string[], options?: SpawnOptions): SpawnSyncResult;
}
