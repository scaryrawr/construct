import type { TranslatedAgent } from './agent-translator';
import { acquireLock, releaseLock, cleanupStaleLocks, type ResourceLock } from './lock-manager';

export interface ExecutorOptions {
  env: Record<string, string>;
  additionalMcpConfig: string | null;
  passthroughArgs: string[];
  translatedAgents: TranslatedAgent[];
}

async function setupCleanup(translatedAgents: TranslatedAgent[]): Promise<ResourceLock | null> {
  // If no agents to track, skip lock setup
  if (translatedAgents.length === 0) {
    return null;
  }

  // Clean up stale locks from previous crashed processes
  await cleanupStaleLocks();

  // Acquire lock for translated agent files
  const resourcePaths = translatedAgents.map(agent => agent.outputPath);
  const lock = await acquireLock(resourcePaths);

  let cleanedUp = false;
  
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    
    const wasLastLock = await releaseLock(lock);
    if (wasLastLock) {
      console.log('Cleaned up agent files (last instance)');
    }
  };

  process.on('exit', () => {
    // Synchronous cleanup on exit
    releaseLock(lock).catch(() => {
      // Ignore async errors during exit
    });
  });
  
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });
  
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143);
  });

  return lock;
}

export async function executeCopilot(options: ExecutorOptions): Promise<number> {
  await setupCleanup(options.translatedAgents);
  const { env, additionalMcpConfig, passthroughArgs } = options;

  // Build args array
  const args: string[] = [];
  if (additionalMcpConfig) {
    args.push('--additional-mcp-config', additionalMcpConfig);
  }
  args.push(...passthroughArgs);

  // Merge env with current process env
  const mergedEnv = {
    ...Bun.env,
    ...env,
  };

  // Spawn copilot subprocess
  const result = Bun.spawnSync(['copilot', ...args], {
    env: mergedEnv,
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  return result.exitCode ?? 1;
}
