# Coding Agent Guide for Construct

## Build/Lint/Test Commands
### Core Commands```bash
bun run index.ts --list-available-plugins  bun run build                        # Build current platform
bun run build:all                    # Build all platforms (linux-x64, arm-64, macos-..., windows)bun run build:macos-arm64         # Build specific platform
```### Running Single Test (Manual)```bash
# Manual verification steps:1 bun run index.ts --list-available-plugins2 Verify output contains "Available plugins:"3 Test with plugin: bun run index --enable-plugin playwright@claude-plugins-original
```### Typechecking```bash
# Bun infers tsconfig.json automaticallybun run index.ts --help          # Triggers typechecking
```

## Code Style Guidelines

### TypeScript Configuration (tsconfig.json)Target: ESNext, Module resolution: bundler with verbatim syntax, Strict mode enabled (strict, noUncheckedIndexedAccess), NoEmit: true### Imports Order & Style1 Node built-ins use explicit `node:` prefix: `import { join } from "node:path";`
2 External libraries import directly: `import yargs from "yargs";`3 Type imports use explicit `type` keyword### Interface Naming (PascalCase)CliArgs, PluginInfo, ConstructConfig, TranslationResult

### Variable/Constant Naming (camelCase/SCREAMING_SCAL_Constants: CONFIG_FILE = ".construct.json", Variables: cliPlugins, enabledPluginNames

### Function Naming (camelCase)parseCliArgs, scanAllPlugins, loadConfig, saveConfig, mergeCliWithConfig### File Organization (src/)cli.ts: CLI argument parsing (yargs)scanner.ts: Plugin discovery/indexing (scanAllPlugins, scanInstalledPlugins)config.ts: Configuration management (.construct.json)translator.ts: Format translation (translatePlugins, expandPluginRootInObject)executor.ts: Copilot subprocess spawningcompletions.ts: Shell completion script generation

### Error Handling Patterns1 Console.warn for non-critical errors (missing files, scanning issues)2 Console.error for critical failures (file I/O, parsing errors)
3 Try/catch wrap file system operations and JSON parsing4 Functions return null on graceful failure (loadConfig, readMcpConfig)

### Async/await Style- Top-level async function: `async function main(): Promise<void>`- Try/catch in async context, Concurrent via Promise.all

### JSDoc Comments (TSDoc on exported symbols)```typescript
/**
 * Represents a single component within a plugin (skill, MCP server, or agent) */export interface PluginComponent {}

/** Scans all installed plugins and builds a registry */
}```### Custom Types (avoid "any")Explicit interfaces: PluginInfo, PluginComponent, Generic type parameters: <T>, Return types on all functions

### Structure (all source files)1 Imports section2 Type/interface definitions3 Constant/module-level declarations4 Function implementations (exported and private)

### Naming Convention: PluginsFormat: `<plugin-name>@<marketplace-name>`, Example: `tmux@scaryrawr-plugins`

### File Paths (Absolute, no relative)Use `join` for path construction: `const configPath = join(process.cwd(), CONFIG_FILE)`

### Project Structure```src/├── cli.ts              CLI argument parsing├── scanner.ts          Plugin discovery and indexing├── config.ts           Configuration management├── translator.ts       Format translation logic└── executor.ts         Copilot subprocess execution
```

### Environment Variables- `COPILOT_SKILLS_DIRS`: Comma-separated list of skill directories
- `CLAUDE_PLUGIN_ROOT`: Placeholder for plugin root path (expanded during translation)

### Testing Manual```bash
# Test plugin scanning: bun run index --list-available-plugins# Verify configuration persistence: cat .construct.json
```

### Common Issues1 No Plugins Found: installed_plugins.json missing or empty - Install plugins via Claude Code first2 Plugin Not Found: Name mismatch (case-sensitive) - Use exact format from installed_plugins.json3 MCP Servers Not Working: Invalid .mcp.0json - Validate JSON and required fields4 Skills Not Loading: COPILOT_SKILLS_DIRS not set - Check environment variable construction