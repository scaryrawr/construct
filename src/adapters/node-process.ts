import * as os from "os";
import type { ProcessEnv } from "../interfaces/process";

/**
 * Node.js/Bun implementation of the ProcessEnv interface.
 * Provides access to environment variables and system information
 * using Node.js built-in APIs.
 */
export class NodeProcess implements ProcessEnv {
  /**
   * Gets an environment variable value
   */
  get(key: string): string | undefined {
    return process.env[key];
  }

  /**
   * Sets an environment variable
   */
  set(key: string, value: string): void {
    process.env[key] = value;
  }

  /**
   * Deletes an environment variable
   */
  delete(key: string): void {
    delete process.env[key];
  }

  /**
   * Gets the current working directory
   */
  cwd(): string {
    return process.cwd();
  }

  /**
   * Gets the user's home directory
   */
  homedir(): string {
    return os.homedir();
  }

  /**
   * Gets the process ID
   */
  pid(): number {
    return process.pid;
  }
}

/**
 * Singleton instance of NodeProcess for convenience.
 * Use this as the default implementation when you need a ProcessEnv instance.
 */
export const nodeProcess = new NodeProcess();
