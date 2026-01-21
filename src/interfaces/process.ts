/**
 * Abstraction over process environment and system info.
 * Enables dependency injection for testing without modifying real process state.
 */
export interface ProcessEnv {
  /**
   * Gets an environment variable value
   */
  get(key: string): string | undefined;

  /**
   * Sets an environment variable
   */
  set(key: string, value: string): void;

  /**
   * Deletes an environment variable
   */
  delete(key: string): void;

  /**
   * Gets the current working directory
   */
  cwd(): string;

  /**
   * Gets the user's home directory
   */
  homedir(): string;

  /**
   * Gets the process ID
   */
  pid(): number;
}
