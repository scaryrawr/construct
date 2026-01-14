# Construct

![the construct](./assets/the-construct.gif)

> ⚠️ **Vibe Coded** - This tool was built in a single AI-assisted session. Use at your own risk. It works on my machine™.

A wrapper for [GitHub Copilot CLI](https://github.com/github/copilot-cli/) that enables loading plugins, skills, and MCP servers from [Claude Code](https://claude.ai/code) marketplaces.

## Why?

Claude Code has a growing ecosystem of plugins with skills and MCP servers. Copilot CLI supports similar concepts but uses different configuration formats. Construct bridges the gap by translating Claude Code plugins into Copilot CLI's format.

## Installation

### Global Installation (Recommended)

Install directly from GitHub:

```bash
bun add -g github:scaryrawr/construct
```

This makes the `construct` command available globally in your PATH.

### Local Development

Clone and link locally:

```bash
git clone https://github.com/scaryrawr/construct.git
cd construct
bun install
bun link
```

## Usage

```bash
# List available plugins from installed Claude Code marketplaces
construct --list

# Load specific plugins for this session
construct --load tmux@scaryrawr-plugins

# Load multiple plugins
construct --load tmux@scaryrawr-plugins --load chrome-devtools@scaryrawr-plugins

# Pass arguments through to copilot (everything after -- goes to copilot)
construct --load tmux@scaryrawr-plugins -- --continue

# Run with saved config (uses .construct.json)
construct

# Pass a prompt directly
construct -- "fix the failing tests"

# Interactive operator mode (fzf selector)
construct operator
construct operator -- --continue

# Clear plugin caches (removes all cached instances, useful after crashes)
construct --clear-cache

# Type-check the codebase
bun run typecheck
```

`construct operator` launches an interactive `fzf` multi-select for plugins, saves your selection to `.construct.json`, and then runs Copilot with those plugins enabled.

## Environment Variables

Construct supports automatic environment variable expansion in plugin configurations:

### Supported Syntax

- `${VAR}` - Basic expansion (uses value if set, otherwise unchanged)
- `${VAR:-default}` - Expansion with default value (uses default if VAR is unset or empty)

### Examples

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": [
      "chrome-devtools-mcp@latest",
      "--browser-url=http://${DEVTOOLS_BASE_URL:-127.0.0.1}:${DEVTOOLS_PORT:-9222}"
    ]
  },
  "greptile": {
    "type": "http",
    "url": "https://api.greptile.com/mcp",
    "headers": {
      "Authorization": "Bearer ${GREPTILE_API_KEY}"
    }
  }
}
```

### Special Variables

**`${CLAUDE_PLUGIN_ROOT}`** - Automatically expands to the cached plugin directory path. Useful for referencing plugin-relative paths in configurations.

### Expansion Scope

Environment variable expansion applies to:
- MCP server configurations (`.mcp.json`)
- Agent file frontmatter (YAML headers in `agents/*.md`)
- Skill file frontmatter (YAML headers in `skills/*/SKILL.md`)

Note: Plugin file bodies (markdown content) are not expanded, only metadata/frontmatter.

## How It Works

1. **Scans** `~/.claude/plugins/known_marketplaces.json` for configured marketplaces and their plugin install locations
2. **Discovers** skills, MCP servers, and agents in each plugin
3. **Caches** plugins per construct instance for reliable environment variable expansion
4. **Translates** Claude Code formats to Copilot CLI equivalents:
   - Skills → `COPILOT_SKILLS_DIRS` environment variable
   - MCP configs → `--additional-mcp-config` JSON argument (supports both local and HTTP servers)
   - Agents → `.github/agents/<plugin>-<agent>.md` files with translated tool references
   - Environment variables → Automatically expanded in configurations
5. **Spawns** `copilot` with the translated configuration

### Agent Translation

Claude Code agents (markdown files with YAML frontmatter in `agents/*.md`) are translated to Copilot's agent format:

- Agents are written to `.github/agents/` in the current directory
- Tool references are translated from Claude format (`mcp__plugin_name_server__tool`) to Copilot format (`server/tool`)
- Frontmatter fields (name, description, model, tools) are preserved

## Configuration

Construct saves your last-used plugins to `.construct.json` in the current directory:

```json
{
  "enabledPlugins": ["tmux@scaryrawr-plugins"],
  "lastUsed": "2026-01-09T22:00:00.000Z"
}
```

## Limitations

- **Hooks** - Claude Code event handlers aren't supported by Copilot CLI
- **LSP Servers** - Language server configs aren't supported

## Requirements

- [Bun](https://bun.sh) runtime
- [GitHub Copilot CLI](https://github.com/github/copilot-cli/) installed and in PATH
- [fzf](https://github.com/junegunn/fzf) installed and in PATH (required for `construct operator`)
- Claude Code plugins installed via Claude Code's plugin system

## License

MIT
