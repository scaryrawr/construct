import type { Shell, SpawnOptions, SpawnSyncResult } from "../interfaces/shell";

/**
 * Shell adapter implementation using Bun.spawnSync
 */
export class BunShell implements Shell {
  /**
   * Spawns a command synchronously and waits for completion
   */
  spawnSync(cmd: string[], options?: SpawnOptions): SpawnSyncResult {
    // Map SpawnOptions to Bun spawn options
    const bunOptions: Parameters<typeof Bun.spawnSync>[1] = {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      stdout: options?.stdout === "pipe" ? "pipe" : options?.stdout,
      stderr: options?.stderr === "pipe" ? "pipe" : options?.stderr,
      stdin: options?.stdin === "pipe" ? "pipe" : options?.stdin,
    };

    // Execute the command
    const result = Bun.spawnSync(cmd, bunOptions);

    // Convert Bun result to SpawnSyncResult
    return {
      exitCode: result.exitCode,
      stdout: new Uint8Array(result.stdout?.buffer ?? new ArrayBuffer(0)),
      stderr: new Uint8Array(result.stderr?.buffer ?? new ArrayBuffer(0)),
    };
  }
}

/**
 * Singleton instance for convenient access
 */
export const bunShell = new BunShell();
