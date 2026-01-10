# Coding Agent Onboarding Guide

This document provides comprehensive guidance for coding agents working with the Construct project.

## Project Overview

Construct is a wrapper for GitHub Copilot CLI that enables loading plugins, skills, MCPs (Model Context Protocol), and custom agents from Claude Code marketplaces.

### Key Features
- **Plugin Discovery**: Automatically scans `~/.claude/plugins/` for installed plugins
- **Format Translation**: Converts Claude Code plugin formats to GitHub Copilot CLI equivalents
- **Configuration Management**: Persists enabled plugins in `.construct.json`
- **MCP Server Support**: Translates MCP configurations between formats

## Architecture

### Core Components
1. **CLI Parser** (`src/cli.ts`): Handles command-line arguments using yargs
2. **Plugin Scanner** (`src/scanner.ts`): Discovers and indexes installed plugins
3. **Config Manager** (`src/config.ts`): Manages `.construct.json` configuration
4. **Translator** (`src/translator.ts`): Converts Claude Code formats to Copilot CLI
5. **Executor** (`src/executor.ts`): Spawns the copilot subprocess with translated config

### Data Flow
```
CLI Arguments → Plugin Discovery → Format Translation → Copilot Execution
```

## Working with Plugins

### Plugin Structure
Installed plugins are located in:
```
~/.claude/plugins/
├── installed_plugins.json      # Registry of all plugins
├── known_marketplaces.json     # Registered marketplaces
├── cache/                      # Installed plugin files
└── marketplaces/               # Cloned marketplace repositories
```

### Component Types
Each plugin can contain:
- **Skills**: Directories with `SKILL.md` files (YAML frontmatter)
- **MCP Servers**: Defined in `.mcp.json` at plugin root
- **Agents**: Markdown files in `agents/` directory with YAML frontmatter
- **Hooks** (unsupported): Event handlers defined in `hooks/hooks.json`

### Plugin Naming Convention
Plugins are referenced as `<plugin-name>@<marketplace-name>`
Example: `tmux@scaryrawr-plugins`

## Development Workflow

### Setting Up the Environment
```bash
# Install dependencies
bun install

# Run the application
bun run index.ts --list-available-plugins

# Enable a plugin for testing
bun run index.ts --enable-plugin tmux@scaryrawr-plugins -- --continue
```

### Testing Commands
```bash
# List available plugins
bun run index.ts --list-available-plugins

# Enable specific plugins
bun run index.ts --enable-plugin plugin1@marketplace --enable-plugin plugin2@marketplace

# Pass arguments to copilot
bun run index.ts --enable-plugin tmux@scaryrawr-plugins -- --allow-all-tools

# Use saved configuration
bun run index.ts
```

### Debugging Tips
1. **Check installed plugins**: Verify `~/.claude/plugins/installed_plugins.json` exists
2. **Inspect plugin structure**: Navigate to plugin install paths to see components
3. **Validate MCP configs**: Ensure `.mcp.json` files are valid JSON
4. **Environment variables**: Check `COPILOT_SKILLS_DIRS` is set correctly

## Format Translation Guide

### Skills Translation
**Source**: `<plugin-path>/skills/<skill-name>/SKILL.md`
**Target**: `COPILOT_SKILLS_DIRS` environment variable

Example:
```bash
COPILOT_SKILLS_DIRS=/path/to/skill1,/path/to/skill2
```

### MCP Server Translation

#### Claude Code Format (`.mcp.json`)
```json
{
  "server-name": {
    "command": "npx",
    "args": ["package@latest", "--option=value"],
    "env": {
      "VAR_NAME": "value"
    }
  }
}
```

#### GitHub Copilot Format (`--additional-mcp-config`)
```json
{
  "mcpServers": {
    "server-name": {
      "type": "local",
      "command": "npx",
      "args": ["package@latest", "--option=value"],
      "env": {
        "VAR_NAME": "value"
      },
      "tools": ["*"]
    }
  }
}
```

### Translation Rules
1. Wrap servers in `mcpServers` object
2. Add `"type": "local"` to each server
3. Add `"tools": ["*"]` (or specify allowed tools)
4. Expand `${CLAUDE_PLUGIN_ROOT}` → actual plugin install path
5. Preserve `command`, `args`, `env`, and `cwd` fields

## Common Issues & Solutions

### Issue: No Plugins Found
**Cause**: `installed_plugins.json` doesn't exist or is empty
**Solution**: Install plugins via Claude Code first, then verify the file exists at `~/.claude/plugins/installed_plugins.json`

### Issue: Plugin Not Found Error
**Cause**: Plugin name doesn't match exactly (case-sensitive)
**Solution**: Use exact format from `installed_plugins.json` (e.g., `plugin@marketplace`)

### Issue: MCP Servers Not Working
**Cause**: Invalid JSON in `.mcp.json` or missing required fields
**Solution**: Validate the MCP config file and ensure all required fields are present

### Issue: Skills Not Loading
**Cause**: `COPILOT_SKILLS_DIRS` not set or incorrect paths
**Solution**: Check the environment variable is properly constructed with valid skill directory paths

## File Structure Reference

```
src/
├── cli.ts              # CLI argument parsing
├── scanner.ts          # Plugin discovery and scanning
├── config.ts           # Configuration management
├── translator.ts       # Format translation logic
└── executor.ts         # Copilot subprocess execution
```

## Environment Variables
- `COPILOT_SKILLS_DIRS`: Comma-separated list of skill directories
- `CLAUDE_PLUGIN_ROOT`: Placeholder for plugin root path (expanded during translation)

## Testing the Application

### Manual Testing
```bash
# Test plugin scanning
bun run index.ts --list-available-plugins

# Test with specific plugins
bun run index.ts --enable-plugin tmux@scaryrawr-plugins -- --help

# Test configuration persistence
bun run index.ts --enable-plugin plugin@marketplace
echo "Saved config:"
cat .construct.json
```

### Automated Testing
The project uses Bun's built-in test runner:
```bash
bun test
```

## Resources
- [Bun Documentation](https://bun.sh/docs)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli/)
- [Claude Code Plugins](https://claude.ai/code)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)

## Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Submit a pull request

## Support
For issues or questions, please open an issue in the GitHub repository.
