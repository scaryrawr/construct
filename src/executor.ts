import type { TranslatedAgent } from './agent-translator';
import type { Shell } from './interfaces/shell';
import { bunShell } from './adapters/bun-shell';
import { unlinkSync } from 'node:fs';

export interface ExecutorOptions {
  env: Record<string, string>;
  additionalMcpConfig: string | null;
  passthroughArgs: string[];
  translatedAgents: TranslatedAgent[];
}

export interface ExecutorDependencies {
  shell?: Shell;
  env?: Record<string, string | undefined>;
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

export function executeCopilot(options: ExecutorOptions, deps?: ExecutorDependencies): number {
  setupCleanup(options.translatedAgents);
  const { env, additionalMcpConfig, passthroughArgs } = options;

  // Use injected dependencies or defaults
  const shell = deps?.shell ?? bunShell;
  const baseEnv = deps?.env ?? Bun.env;

  // Build args array
  const args: string[] = [];
  if (additionalMcpConfig) {
    args.push('--additional-mcp-config', additionalMcpConfig);
  }
  args.push(...passthroughArgs);

  // Merge env with base env
  const mergedEnv = {
    ...baseEnv,
    ...env,
  };

  // Spawn copilot subprocess
  const result = shell.spawnSync(['copilot', ...args], {
    env: mergedEnv,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  return result.exitCode ?? 1;
}
