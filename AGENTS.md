# Coding Agent Guide for Construct

## Build/Lint/Test Commands

### Core Commands
```bash
bun run build                        # Build current platform
bun run build:all                    # Build all platforms (linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64)
bun run build:macos-arm64            # Build specific platform
bun run typecheck                    # Type checking with TypeScript
```

### Running Tests
```bash
# Run all tests
bun test

# Run specific test file
bun test src/plugin.test.ts
bun test src/marketplace.test.ts
bun test src/cache.test.ts
bun test src/env-expansion.test.ts

# Run tests with coverage
bun test --coverage
```

### Manual Verification
```bash
# List available plugins
bun run index.ts --list

# Verify output contains "Available plugins:"
bun run index.ts --list | grep "Available plugins"

# Test with specific plugin
bun run index.ts --load playwright@claude-plugins-original

# Test plugin scanning
bun run index.ts --list

# Verify configuration persistence
cat .construct.json
```

## Code Style Guidelines

### TypeScript Configuration (tsconfig.json)
- Target: ESNext
- Module resolution: bundler with verbatim syntax
- Strict mode enabled (strict, noUncheckedIndexedAccess, noFallthroughCasesInSwitch, noImplicitOverride)
- NoEmit: true
- Module: Preserve
- Module detection: force

### Imports Order & Style
1. Node built-ins use explicit `node:` prefix: `import { join } from "node:path";`
2. External libraries import directly: `import yargs from "yargs";`
3. Type imports use explicit `type` keyword: `import type { PluginInfo } from "./scanner";`

### Naming Conventions
- **Interfaces**: PascalCase (CliArgs, PluginInfo, ConstructConfig, TranslationResult, PluginComponent)
- **Variables**: camelCase (cliPlugins, enabledPluginNames, pluginCachePaths)
- **Constants**: SCREAMING_SNAKE_CASE (CONFIG_FILE = ".construct.json")
- **Functions**: camelCase (parseCliArgs, scanAllPlugins, loadConfig, saveConfig, mergeCliWithConfig)

### File Organization (src/)
- `cli.ts`: CLI argument parsing (yargs)
- `scanner.ts`: Plugin discovery and indexing (scanAllPlugins, scanInstalledPlugins, scanMarketplacePlugins)
- `config.ts`: Configuration management (.construct.json)
- `translator.ts`: Format translation (translatePlugins, expandPluginRootInObject)
- `executor.ts`: Copilot subprocess spawning
- `completions.ts`: Shell completion script generation
- `plugin.ts`: Plugin management
- `marketplace.ts`: Marketplace operations
- `cache.ts`: Plugin caching
- `agent-translator.ts`: Agent format translation
- `skill-translator.ts`: Skill format translation
- `operator.ts`: Interactive plugin selector
- `env-expansion.ts`: Environment variable expansion

### Error Handling Patterns
1. `console.warn` for non-critical errors (missing files, scanning issues, failed agent translation)
2. `console.error` for critical failures (file I/O, parsing errors, MCP config reading)
3. Try/catch wrap file system operations and JSON parsing
4. Functions return `null` on graceful failure (loadConfig, readMcpConfig)
5. Catch blocks should log errors but not crash the application

### Async/await Style
- Top-level async function: `async function main(): Promise<void>`
- Try/catch in async context
- Concurrent operations via `Promise.all()`
- Use `await` for file operations and async function calls

### JSDoc Comments (TSDoc on exported symbols)
```typescript
/**
 * Represents a single component within a plugin (skill, MCP server, or agent)
 */
export interface PluginComponent {}

/**
 * Scans all installed plugins and builds a registry
 */
export async function scanAllPlugins(): Promise<PluginRegistry>
```

### Custom Types
- Avoid "any" types - use explicit interfaces
- Use generic type parameters: `<T>`, `<T extends PluginInfo>`
- Define return types on all functions
- Use union types for multiple possibilities: `'skill' | 'mcp' | 'agent'`

### Structure (all source files)
1. Imports section
2. Type/interface definitions
3. Constant/module-level declarations
4. Function implementations (exported and private)

### Naming Convention: Plugins
Format: `<plugin-name>@<marketplace-name>`
Example: `tmux@scaryrawr-plugins`

### File Paths
- Use absolute paths with `join()` from `node:path`
- Example: `const configPath = join(process.cwd(), CONFIG_FILE)`

### Environment Variables
- `COPILOT_SKILLS_DIRS`: Comma-separated list of skill directories
- `CLAUDE_PLUGIN_ROOT`: Placeholder for plugin root path (expanded during translation)

### Common Issues
1. **No Plugins Found**: `installed_plugins.json` missing or empty - Install plugins via Claude Code first
2. **Plugin Not Found**: Name mismatch (case-sensitive) - Use exact format from `installed_plugins.json`
3. **MCP Servers Not Working**: Invalid `.mcp.json` - Validate JSON and required fields
4. **Skills Not Loading**: `COPILOT_SKILLS_DIRS` not set - Check environment variable construction
5. **Type Errors**: Run `bun run typecheck` to verify TypeScript configuration

## Testing Patterns

### Dependency Injection
All core modules use optional dependency injection for testability:
- `config.ts` - `ConfigDependencies` with `fs`, `process`
- `scanner.ts` - `ScannerDependencies` with `fs`, `process`  
- `marketplace.ts` - `MarketplaceDependencies` with `fs`, `shell`, paths
- `cache.ts` - `CacheDependencies` with `fs`, `process`; returns `CacheInstance`
- `plugin.ts` - `PluginDependencies` with scanner, config, output functions
- `translator.ts` - `TranslatorDependencies` with `cache`, `fs`
- `executor.ts` - `ExecutorDependencies` with `shell`, `env`

### Test Utilities
Import from `./test-utils`:
```typescript
import { createMemoryFileSystem, createMockProcess, createMockShell } from './test-utils';
```

### Unit vs Integration Tests
- **Unit tests** (*.test.ts): Use mocks, no I/O, fast
- **Integration tests** (*.integration.test.ts): Use real file system in temp dirs

### Example Unit Test
```typescript
import { describe, expect, test } from 'bun:test';
import { createMemoryFileSystem, createMockProcess } from './test-utils';

test('example with mocks', async () => {
  const fs = createMemoryFileSystem()
    .withFile('/home/.construct.json', '{"enabledPlugins":[]}')
    .build();
  const proc = createMockProcess({ cwd: '/work', homedir: '/home' });
  
  // Call function with injected deps
  const result = await someFunction({ fs, process: proc });
  expect(result).toBeDefined();
});
```