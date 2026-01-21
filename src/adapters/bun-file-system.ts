import type { FileSystem, FileStat, MkdirOptions, RmOptions, CpOptions } from '../interfaces/file-system';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

/**
 * File stat wrapper for Node.js fs.Stats
 */
class BunFileStat implements FileStat {
  constructor(private stats: fs.Stats) {}

  isDirectory(): boolean {
    return this.stats.isDirectory();
  }

  isFile(): boolean {
    return this.stats.isFile();
  }
}

/**
 * FileSystem implementation using Bun APIs with Node.js fallbacks
 */
class BunFileSystem implements FileSystem {
  /**
   * Reads file content as UTF-8 string using Bun.file()
   */
  async readFile(filePath: string): Promise<string> {
    try {
      const file = Bun.file(filePath);
      return await file.text();
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Writes content to file using Bun.write(), creating parent directories if needed
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // Ensure parent directory exists
      const dir = path.dirname(filePath);
      await this.mkdir(dir, { recursive: true });

      // Write file using Bun.write()
      await Bun.write(filePath, content);
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Checks if path exists (file or directory)
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      // First try as file
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return true;
      }
      // Fall back to stat for directories
      await fsPromises.stat(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Creates directory using Node.js fs.mkdir (with promises)
   */
  async mkdir(dirPath: string, options?: MkdirOptions): Promise<void> {
    try {
      await fsPromises.mkdir(dirPath, {
        recursive: options?.recursive ?? false,
      });
    } catch (error) {
      // EEXIST is not an error if recursive is true
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST' && options?.recursive) {
        return;
      }
      throw new Error(`Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Removes file or directory using Node.js fs.rm (with promises)
   */
  async rm(filePath: string, options?: RmOptions): Promise<void> {
    try {
      await fsPromises.rm(filePath, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      });
    } catch (error) {
      // ENOENT is not an error if force is true
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' && options?.force) {
        return;
      }
      throw new Error(`Failed to remove ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Lists directory contents using Node.js fs.readdir (with promises)
   */
  async readdir(dirPath: string): Promise<string[]> {
    try {
      const entries = await fsPromises.readdir(dirPath);
      return entries;
    } catch (error) {
      throw new Error(`Failed to read directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Gets file/directory stats using Node.js fs.stat (with promises)
   */
  async stat(filePath: string): Promise<FileStat> {
    try {
      const stats = await fsPromises.stat(filePath);
      return new BunFileStat(stats);
    } catch (error) {
      throw new Error(`Failed to stat ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Copies file or directory using Node.js fs/promises cp
   */
  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    try {
      await fsPromises.cp(src, dest, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      });
    } catch (error) {
      throw new Error(`Failed to copy ${src} to ${dest}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Singleton instance for convenient access
 */
export const bunFileSystem = new BunFileSystem();

export { BunFileSystem };
