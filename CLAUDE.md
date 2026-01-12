# Coding Agent Guide for Construct

This document provides specific guidance for coding agents working with the Construct project.

## Quick Start

### Essential Commands
```bash
# Install dependencies
bun install

# List available plugins
bun run index.ts --list

# Enable a plugin
bun run index.ts --load tmux@scaryrawr-plugins -- --continue

# Run with saved config
bun run index.ts
```

### Project Structure
```
/
├── AGENTS.md          # This guide for coding agents
├── CLAUDE.md          # Claude-specific instructions (this file)
├── construct.md        # Architecture documentation
├── README.md          # User-facing documentation
├── index.ts           # Main application entry point
├── package.json       # Project dependencies
├── tsconfig.json      # TypeScript configuration
└── src/               # Source code
    ├── cli.ts         # CLI argument parsing
    ├── scanner.ts     # Plugin discovery
    ├── config.ts      # Configuration management
    ├── translator.ts  # Format translation
    └── executor.ts    # Copilot execution
```

## Development Guidelines

### Default Tools & Commands
- **Runtime**: Use Bun instead of Node.js
- **Testing**: `bun test` (Bun's built-in test runner)
- **Building**: `bun build <file>`
- **Installation**: `bun install`
- **Execution**: `bun run index.ts` or `bun --hot index.ts`

### File Operations
```bash
# List files
Bun.$`ls -la src/`

# Read file contents
bun read:file --path=src/scanner.ts

# Search for patterns
grep -r "installed_plugins" src/

# Check git status
Bun.$`git status`
```

### Common Tasks

#### 1. Adding a New Feature
```bash
# Create new file in src/
bun write:file --path=src/newfeature.ts --content="// New feature implementation"

# Edit existing file
bun edit:file --path=src/cli.ts --oldText="// Old code" --newText="// New implementation"

# Test the changes
bun run index.ts --list
```

#### 2. Debugging Plugins
```bash
# Check installed plugins
cat ~/.claude/plugins/installed_plugins.json | bun $text

# Inspect a specific plugin
ls -la ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/

# Verify MCP config
cat ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.mcp.json | bun $text
```

#### 3. Testing Translation Logic
```bash
# Test MCP translation
bun run index.ts --load <plugin>@<marketplace> -- --help

# Check environment variables
env | grep COPILOT_SKILLS_DIRS
```

## Key Implementation Details

### Plugin Discovery
The scanner looks for:
1. **Skills**: `skills/*/SKILL.md` files
2. **MCP Servers**: `.mcp.json` at plugin root
3. **Agents**: `agents/*.md` files

### Format Translation
- **Skills** → `COPILOT_SKILLS_DIRS` environment variable (comma-separated paths)
- **MCP Servers** → `--additional-mcp-config` JSON argument
- Placeholder expansion: `${CLAUDE_PLUGIN_ROOT}` → actual plugin path

### Configuration Management
- Saved in `.construct.json`
- Format:
  ```json
  {
    "enabledPlugins": ["plugin@marketplace"],
    "lastUsed": "2026-01-09T21:32:00.000Z"
  }
  ```

## Common Patterns

### Error Handling
```typescript
// Graceful error handling pattern used throughout the codebase
export async function scanPluginComponents(installPath: string): Promise<PluginComponent[]> {
  try {
    // Implementation
  } catch (error) {
    console.warn(`Warning: Error scanning components in ${installPath}:`, error);
  }
  return components;
}
```

### Path Handling
```typescript
// Use node:path for cross-platform paths
import { join } from "node:path";
const mcpPath = join(installPath, '.mcp.json');
```

### JSON Configuration
```typescript
// Read and parse JSON files
const file = Bun.file(mcpConfigPath);
const text = await file.text();
return JSON.parse(text) as ClaudeMcpConfig;
```

### Environment Variables
```typescript
// Merge with existing environment
const mergedEnv = {
  ...Bun.env,
  ...env,
};
```

## Testing Strategies

### Unit Testing
Focus on:
- `src/translator.ts` - Format translation logic
- `src/scanner.ts` - Plugin discovery algorithms
- `src/config.ts` - Configuration management

### Integration Testing
Test:
- Full workflow: CLI → Scan → Translate → Execute
- Configuration persistence
- Error handling paths

### End-to-End Testing
```bash
# Test complete workflow
bun run index.ts --load tmux@scaryrawr-plugins -- --help

# Verify configuration saved
cat .construct.json | bun $text
```

## Debugging Tips

### 1. Plugin Not Found
**Check**:
- Exact plugin name matches `installed_plugins.json`
- Case sensitivity
- Marketplace name is correct

**Commands**:
```bash
bun run index.ts --list
cat ~/.claude/plugins/installed_plugins.json | bun $text
```

### 2. MCP Servers Not Working
**Check**:
- Valid JSON in `.mcp.json`
- Required fields present
- Command exists and is executable

**Commands**:
```bash
cat ~/.claude/plugins/cache/<marketplace>/<plugin>/.mcp.json | bun $text
which <command-from-mcp>
```

### 3. Skills Not Loading
**Check**:
- `COPILOT_SKILLS_DIRS` environment variable
- Skill directories exist and are readable
- `SKILL.md` files have proper YAML frontmatter

**Commands**:
```bash
env | grep COPILOT_SKILLS_DIRS
ls -la ~/.claude/plugins/cache/<marketplace>/<plugin>/skills/
```

## Best Practices

### 1. Error Handling
- Use try-catch blocks for file operations
- Log warnings, not errors, for optional components
- Gracefully handle missing files or directories

### 2. Path Handling
- Use `node:path` module for cross-platform compatibility
- Always use absolute paths when possible
- Handle path expansions (e.g., `${CLAUDE_PLUGIN_ROOT}`)

### 3. JSON Processing
- Validate JSON structure before processing
- Handle parsing errors gracefully
- Use TypeScript interfaces for type safety

### 4. Environment Variables
- Merge with existing environment, don't replace
- Use `Bun.env` to access current environment
- Preserve all existing variables

### 5. Subprocess Execution
- Use `Bun.spawnSync` for synchronous execution
- Set `stdio: ['inherit', 'inherit', 'inherit']` for interactive mode
- Forward exit codes properly

## Resources

### Documentation
- [Bun API Docs](https://bun.sh/docs/bun-api)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [yargs Documentation](https://yargs.js.org/)

### Tools
```bash
# Type checking
bunx tsc --noEmit

# Format code
bunx prettier --write src/

# Check dependencies
bun audit
```

### Examples
- [Bun.serve() examples](https://bun.sh/docs/bun-api/serve)
- [Bun.file() usage](https://bun.sh/docs/bun-api/file)

## Support

For issues or questions:
1. Check existing documentation
2. Review the code structure
3. Test with simple cases first
4. Verify file paths and permissions
5. Check environment variables

If still stuck, open an issue with:
- Exact command used
- Error message (if any)
- Expected vs actual behavior
- Relevant file contents
