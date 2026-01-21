import { join, dirname } from 'node:path';
import type {
  FileSystem,
  FileStat,
  MkdirOptions,
  RmOptions,
  CpOptions,
} from '../interfaces/file-system';

/**
 * File stat implementation for in-memory file system
 */
class MemoryStat implements FileStat {
  constructor(private type: 'file' | 'directory') {}

  isDirectory(): boolean {
    return this.type === 'directory';
  }

  isFile(): boolean {
    return this.type === 'file';
  }
}

/**
 * In-memory file system implementation for testing
 */
export class MemoryFileSystem implements FileSystem {
  private files: Map<string, string>;
  private directories: Set<string>;

  constructor() {
    this.files = new Map();
    this.directories = new Set();
    // Always have root directory
    this.directories.add('/');
  }

  /**
   * Normalizes paths to absolute paths with forward slashes
   */
  private normalizePath(path: string): string {
    // Ensure absolute path
    const absolute = path.startsWith('/') ? path : `/${path}`;
    // Normalize: remove duplicate slashes and trailing slashes (except root)
    let normalized = absolute.replace(/\/+/g, '/');
    if (normalized !== '/' && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  /**
   * Ensures all parent directories exist
   */
  private ensureParentDirectories(path: string): void {
    const normalized = this.normalizePath(path);
    let current = '';
    const parts = normalized.split('/').filter((p) => p.length > 0);

    for (const part of parts) {
      current = current ? join(current, part) : '/' + part;
      this.directories.add(current);
    }
  }

  async readFile(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    if (!this.files.has(normalized)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    const content = this.files.get(normalized);
    return content!;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const normalized = this.normalizePath(path);

    // Ensure parent directories exist
    this.ensureParentDirectories(normalized);

    this.files.set(normalized, content);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const normalized = this.normalizePath(path);

    if (this.directories.has(normalized)) {
      // Directory already exists - not an error in most mkdir implementations
      return;
    }

    if (this.files.has(normalized)) {
      throw new Error(
        `EEXIST: file already exists, mkdir '${path}'`
      );
    }

    if (options?.recursive) {
      // Create all parent directories
      this.ensureParentDirectories(normalized);
      this.directories.add(normalized);
    } else {
      // Check if parent exists
      const parent = dirname(normalized);
      if (parent !== '/' && !this.directories.has(parent)) {
        throw new Error(
          `ENOENT: no such file or directory, mkdir '${path}'`
        );
      }
      this.directories.add(normalized);
    }
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const normalized = this.normalizePath(path);

    if (!this.files.has(normalized) && !this.directories.has(normalized)) {
      if (options?.force) {
        return; // Force means don't error on missing paths
      }
      throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
    }

    if (this.directories.has(normalized)) {
      // It's a directory
      const contents = this.getDirectoryContents(normalized);

      if (contents.length > 0 && !options?.recursive) {
        throw new Error(
          `EISDIR: illegal operation on a directory, rm '${path}'`
        );
      }

      if (options?.recursive) {
        // Remove all children recursively
        this.removeDirectoryRecursive(normalized);
      }

      this.directories.delete(normalized);
    } else {
      // It's a file
      this.files.delete(normalized);
    }
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path);

    if (!this.directories.has(normalized)) {
      if (this.files.has(normalized)) {
        throw new Error(
          `ENOTDIR: not a directory, scandir '${path}'`
        );
      }
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    return this.getDirectoryContents(normalized);
  }

  async stat(path: string): Promise<FileStat> {
    const normalized = this.normalizePath(path);

    if (this.files.has(normalized)) {
      return new MemoryStat('file');
    }

    if (this.directories.has(normalized)) {
      return new MemoryStat('directory');
    }

    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);

    if (!this.files.has(srcNorm) && !this.directories.has(srcNorm)) {
      throw new Error(`ENOENT: no such file or directory, cp '${src}'`);
    }

    const destExists = await this.exists(destNorm);
    if (destExists && !options?.force) {
      throw new Error(`EEXIST: file already exists, cp '${dest}'`);
    }

    if (this.files.has(srcNorm)) {
      // Copy file
      const content = this.files.get(srcNorm)!;
      this.ensureParentDirectories(destNorm);
      this.files.set(destNorm, content);
    } else {
      // Copy directory
      if (!options?.recursive) {
        throw new Error(
          `EISDIR: illegal operation on a directory, cp '${src}'`
        );
      }

      // Create destination directory
      this.directories.add(destNorm);
      this.ensureParentDirectories(destNorm);

      // Copy all files recursively
      this.copyDirectoryRecursive(srcNorm, destNorm);
    }
  }

  /**
   * Gets the contents of a directory (immediate children only)
   */
  private getDirectoryContents(dirPath: string): string[] {
    const contents = new Set<string>();
    const dirNormalized = dirPath === '/' ? dirPath : dirPath;
    const prefix =
      dirNormalized === '/' ? '/' : dirNormalized + '/';

    // Find all files that start with this directory
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        // Only include immediate children (no nested paths)
        if (relative.includes('/')) {
          const firstPart = relative.split('/')[0];
          if (firstPart) contents.add(firstPart);
        } else {
          contents.add(relative);
        }
      }
    }

    // Find all directories that start with this directory
    for (const subDir of this.directories) {
      if (subDir === dirNormalized) continue; // Skip self

      if (subDir.startsWith(prefix)) {
        const relative = subDir.slice(prefix.length);
        // Only include immediate children
        if (relative.includes('/')) {
          const firstPart = relative.split('/')[0];
          if (firstPart) contents.add(firstPart);
        } else {
          contents.add(relative);
        }
      }
    }

    return Array.from(contents).sort();
  }

  /**
   * Removes a directory and all its contents recursively
   */
  private removeDirectoryRecursive(dirPath: string): void {
    const prefix =
      dirPath === '/' ? '/' : dirPath + '/';

    // Remove all files under this directory
    const filesToRemove: string[] = [];
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        filesToRemove.push(filePath);
      }
    }
    for (const filePath of filesToRemove) {
      this.files.delete(filePath);
    }

    // Remove all subdirectories
    const dirsToRemove: string[] = [];
    for (const subDir of this.directories) {
      if (subDir !== dirPath && subDir.startsWith(prefix)) {
        dirsToRemove.push(subDir);
      }
    }
    for (const subDir of dirsToRemove) {
      this.directories.delete(subDir);
    }
  }

  /**
   * Copies a directory and all its contents recursively
   */
  private copyDirectoryRecursive(
    srcDir: string,
    destDir: string
  ): void {
    const srcPrefix = srcDir === '/' ? '/' : srcDir + '/';
    const destPrefix = destDir === '/' ? '/' : destDir + '/';

    // Copy all files
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(srcPrefix)) {
        const relative = filePath.slice(srcPrefix.length);
        const newPath = destPrefix + relative;
        const content = this.files.get(filePath)!;
        this.ensureParentDirectories(newPath);
        this.files.set(newPath, content);
      }
    }

    // Copy all subdirectories
    for (const subDir of this.directories) {
      if (subDir !== srcDir && subDir.startsWith(srcPrefix)) {
        const relative = subDir.slice(srcPrefix.length);
        const newDir = destPrefix + relative;
        this.directories.add(newDir);
      }
    }
  }

  /**
   * Synchronous write file for use in mock handlers
   * The async version just wraps this - no actual async work is done
   */
  writeFileSync(path: string, content: string): void {
    const normalized = this.normalizePath(path);
    this.ensureParentDirectories(normalized);
    this.files.set(normalized, content);
  }

  /**
   * Synchronous mkdir for use in mock handlers
   * The async version just wraps this - no actual async work is done
   */
  mkdirSync(path: string, options?: MkdirOptions): void {
    const normalized = this.normalizePath(path);

    if (this.directories.has(normalized)) {
      return;
    }

    if (this.files.has(normalized)) {
      throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    }

    if (options?.recursive) {
      this.ensureParentDirectories(normalized);
      this.directories.add(normalized);
    } else {
      const parent = normalized.substring(0, normalized.lastIndexOf("/")) || "/";
      if (!this.directories.has(parent)) {
        throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
      }
      this.directories.add(normalized);
    }
  }
}

/**
 * Builder class for fluent API
 */
class MemoryFileSystemBuilder {
  private fs: MemoryFileSystem;

  constructor() {
    this.fs = new MemoryFileSystem();
  }

  /**
   * Adds a file to the file system
   */
  withFile(path: string, content: string): this {
    // Use non-async version directly since we're in the builder
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const cleanPath = normalized.replace(/\/+/g, '/');

    // Ensure parent directories
    const parts = cleanPath.split('/').filter((p) => p.length > 0);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current = current ? `${current}/${part}` : `/${part}`;
      this.fs['directories'].add(current);
    }

    this.fs['files'].set(cleanPath, content);
    return this;
  }

  /**
   * Adds a directory to the file system
   */
  withDirectory(path: string): this {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    let cleanPath = normalized.replace(/\/+/g, '/');
    if (cleanPath !== '/' && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }

    // Ensure parent directories
    const parts = cleanPath.split('/').filter((p) => p.length > 0);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : `/${part}`;
      this.fs['directories'].add(current);
    }

    return this;
  }

  /**
   * Builds and returns the MemoryFileSystem instance
   */
  build(): MemoryFileSystem {
    return this.fs;
  }
}

/**
 * Factory function to create a MemoryFileSystem with fluent builder API
 *
 * @example
 * ```typescript
 * const fs = createMemoryFileSystem()
 *   .withFile('/path/to/file.txt', 'content')
 *   .withDirectory('/path/to/dir')
 *   .build();
 * ```
 */
export function createMemoryFileSystem(): MemoryFileSystemBuilder {
  return new MemoryFileSystemBuilder();
}
