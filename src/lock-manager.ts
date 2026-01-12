import { join } from "node:path";
import { mkdir, readdir, unlink, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * Directory for storing lock files
 */
const LOCKS_DIR = ".construct-locks";

/**
 * Represents a lock for tracking resource usage across multiple processes
 */
export interface ResourceLock {
  /** Unique lock ID for this process instance */
  lockId: string;
  /** Paths to resources being tracked */
  resourcePaths: string[];
}

/**
 * Creates a unique lock ID for this process instance
 */
function createLockId(): string {
  return `${process.pid}-${randomUUID()}`;
}

/**
 * Gets the lock directory path relative to current working directory
 */
function getLocksDir(): string {
  return join(process.cwd(), LOCKS_DIR);
}

/**
 * Gets the path for a specific lock file
 */
function getLockFilePath(lockId: string): string {
  return join(getLocksDir(), `${lockId}.lock`);
}

/**
 * Ensures the locks directory exists
 */
async function ensureLocksDir(): Promise<void> {
  const locksDir = getLocksDir();
  try {
    await mkdir(locksDir, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
  }
}

/**
 * Counts the number of active lock files
 */
async function countActiveLocks(): Promise<number> {
  const locksDir = getLocksDir();
  
  if (!existsSync(locksDir)) {
    return 0;
  }

  try {
    const files = await readdir(locksDir);
    return files.filter(f => f.endsWith('.lock')).length;
  } catch (error) {
    console.warn('Failed to count active locks:', error);
    return 0;
  }
}

/**
 * Acquires a lock for the given resources
 * 
 * @param resourcePaths - Array of file paths to track
 * @returns ResourceLock object with lock ID and resource paths
 */
export async function acquireLock(resourcePaths: string[]): Promise<ResourceLock> {
  await ensureLocksDir();
  
  const lockId = createLockId();
  const lockFilePath = getLockFilePath(lockId);
  
  // Write lock file with resource information
  const lockData = {
    lockId,
    pid: process.pid,
    resourcePaths,
    timestamp: new Date().toISOString(),
  };
  
  try {
    await writeFile(lockFilePath, JSON.stringify(lockData, null, 2));
  } catch (error) {
    console.warn(`Failed to create lock file ${lockFilePath}:`, error);
    throw error;
  }
  
  return {
    lockId,
    resourcePaths,
  };
}

/**
 * Releases a lock and performs cleanup if no other locks exist
 * 
 * @param lock - The ResourceLock to release
 * @returns true if resources were cleaned up (last lock), false otherwise
 */
export async function releaseLock(lock: ResourceLock): Promise<boolean> {
  const lockFilePath = getLockFilePath(lock.lockId);
  
  // Remove this lock file
  try {
    await unlink(lockFilePath);
  } catch (error) {
    // Ignore if file doesn't exist (already cleaned up)
  }
  
  // Check if any other locks exist
  const activeLocks = await countActiveLocks();
  
  if (activeLocks === 0) {
    // This was the last lock, clean up resources
    await cleanupResources(lock.resourcePaths);
    
    // Clean up the locks directory itself
    const locksDir = getLocksDir();
    try {
      await rm(locksDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    
    return true;
  }
  
  return false;
}

/**
 * Cleans up resources (deletes files)
 */
async function cleanupResources(resourcePaths: string[]): Promise<void> {
  for (const path of resourcePaths) {
    try {
      await unlink(path);
    } catch (error) {
      // Ignore errors (file may not exist or already deleted)
    }
  }
}

/**
 * Cleans up stale lock files from processes that no longer exist
 * This is a best-effort cleanup that runs before acquiring a new lock
 */
export async function cleanupStaleLocks(): Promise<void> {
  const locksDir = getLocksDir();
  
  if (!existsSync(locksDir)) {
    return;
  }
  
  try {
    const files = await readdir(locksDir);
    
    for (const file of files) {
      if (!file.endsWith('.lock')) continue;
      
      const lockFilePath = join(locksDir, file);
      
      try {
        // Read lock file using Node.js API for compatibility
        const content = await readFile(lockFilePath, 'utf-8');
        const lockData = JSON.parse(content);
        
        // Check if process still exists
        const pid = lockData.pid;
        if (typeof pid === 'number') {
          try {
            // Sending signal 0 checks if process exists without killing it
            process.kill(pid, 0);
            // Process exists, keep the lock
          } catch {
            // Process doesn't exist, remove stale lock
            await unlink(lockFilePath);
          }
        }
      } catch (error) {
        // Ignore errors reading individual lock files
      }
    }
  } catch (error) {
    console.warn('Failed to cleanup stale locks:', error);
  }
}
