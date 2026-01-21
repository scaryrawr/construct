import type { Shell, SpawnOptions, SpawnSyncResult } from "../interfaces/shell";

/**
 * Handler function for mock shell
 * Receives command and options, returns the result
 */
export type ShellHandler = (
  cmd: string[],
  options?: SpawnOptions
) => SpawnSyncResult;

/**
 * Tracks a call to the mock shell
 */
interface CommandCall {
  cmd: string[];
  options?: SpawnOptions;
}

/**
 * Mock implementation of Shell for testing
 */
export class MockShell implements Shell {
  private handler: ShellHandler;
  private commandCalls: CommandCall[] = [];

  constructor(handler?: ShellHandler) {
    this.handler =
      handler ||
      (() => ({
        exitCode: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      }));
  }

  /**
   * Spawns a command synchronously
   * Tracks the call for assertions and delegates to the handler
   */
  spawnSync(cmd: string[], options?: SpawnOptions): SpawnSyncResult {
    this.commandCalls.push({ cmd, options });
    return this.handler(cmd, options);
  }

  /**
   * Get all commands that were called
   */
  get calls(): CommandCall[] {
    return this.commandCalls;
  }

  /**
   * Change the handler mid-test
   */
  setHandler(handler: ShellHandler): void {
    this.handler = handler;
  }

  /**
   * Reset the call history
   */
  reset(): void {
    this.commandCalls = [];
  }
}

/**
 * Factory function to create a MockShell instance
 */
export function createMockShell(handler?: ShellHandler): MockShell {
  return new MockShell(handler);
}
