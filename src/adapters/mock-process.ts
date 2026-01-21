import type { ProcessEnv } from '../interfaces/process';

/**
 * Options for configuring a MockProcess instance
 */
export interface MockProcessOptions {
  env?: Record<string, string>;
  cwd?: string;
  homedir?: string;
  pid?: number;
}

/**
 * Mock implementation of ProcessEnv for testing.
 * Stores environment variables in a Map without touching the real process.env
 */
export class MockProcess implements ProcessEnv {
  private envVars: Map<string, string>;
  private _cwd: string;
  private _homedir: string;
  private _pid: number;

  constructor(options: MockProcessOptions = {}) {
    this.envVars = new Map(Object.entries(options.env ?? {}));
    this._cwd = options.cwd ?? '/';
    this._homedir = options.homedir ?? '/home/user';
    this._pid = options.pid ?? 1000;
  }

  /**
   * Gets an environment variable value
   */
  get(key: string): string | undefined {
    return this.envVars.get(key);
  }

  /**
   * Sets an environment variable
   */
  set(key: string, value: string): void {
    this.envVars.set(key, value);
  }

  /**
   * Deletes an environment variable
   */
  delete(key: string): void {
    this.envVars.delete(key);
  }

  /**
   * Gets the current working directory
   */
  cwd(): string {
    return this._cwd;
  }

  /**
   * Gets the user's home directory
   */
  homedir(): string {
    return this._homedir;
  }

  /**
   * Gets the process ID
   */
  pid(): number {
    return this._pid;
  }
}

/**
 * Factory function to create a MockProcess instance
 */
export function createMockProcess(options?: MockProcessOptions): MockProcess {
  return new MockProcess(options);
}
