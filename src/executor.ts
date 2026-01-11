import type { TranslatedAgent } from './agent-translator';
import { unlinkSync } from 'node:fs';

export interface ExecutorOptions {
  env: Record<string, string>;
  additionalMcpConfig: string | null;
  passthroughArgs: string[];
  translatedAgents: TranslatedAgent[];
}

function setupCleanup(translatedAgents: TranslatedAgent[]) {
  let cleanedUp = false;
  
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    
    for (const agent of translatedAgents) {
      try {
        unlinkSync(agent.outputPath);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

export function executeCopilot(options: ExecutorOptions): number {
  setupCleanup(options.translatedAgents);
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
