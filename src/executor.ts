export interface ExecutorOptions {
  env: Record<string, string>;
  additionalMcpConfig: string | null;
  passthroughArgs: string[];
}

export function executeCopilot(options: ExecutorOptions): number {
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

  return result.exitCode;
}
