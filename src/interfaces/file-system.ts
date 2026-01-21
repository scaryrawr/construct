/**
 * File statistics interface
 */
export interface FileStat {
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Options for mkdir operation
 */
export interface MkdirOptions {
  recursive?: boolean;
}

/**
 * Options for rm operation
 */
export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

/**
 * Options for cp operation
 */
export interface CpOptions {
  recursive?: boolean;
  force?: boolean;
}

/**
 * Abstraction over file system operations.
 * Enables dependency injection for testing without real file I/O.
 */
export interface FileSystem {
  /**
   * Reads file content as UTF-8 string
   */
  readFile(path: string): Promise<string>;

  /**
   * Writes content to file, creating parent directories if needed
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Checks if path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Creates directory, optionally with parents
   */
  mkdir(path: string, options?: MkdirOptions): Promise<void>;

  /**
   * Removes file or directory
   */
  rm(path: string, options?: RmOptions): Promise<void>;

  /**
   * Lists directory contents
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Gets file/directory stats
   */
  stat(path: string): Promise<FileStat>;

  /**
   * Copies file or directory
   */
  cp(src: string, dest: string, options?: CpOptions): Promise<void>;
}
