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

# Type-check the codebase
bun run typecheck
```

`construct operator` launches an interactive `fzf` multi-select for plugins, saves your selection to `.construct.json`, and then runs Copilot with those plugins enabled.

## How It Works

1. **Scans** `~/.claude/plugins/installed_plugins.json` for installed Claude Code plugins
2. **Discovers** skills, MCP servers, and agents in each plugin
3. **Translates** Claude Code formats to Copilot CLI equivalents:
   - Skills → `COPILOT_SKILLS_DIRS` environment variable
   - MCP configs → `--additional-mcp-config` JSON argument
   - Agents → `.github/agents/<plugin>-<agent>.md` files with translated tool references
4. **Spawns** `copilot` with the translated configuration

### Agent Translation

Claude Code agents (markdown files with YAML frontmatter in `agents/*.md`) are translated to Copilot's agent format:

- Agents are written to `.github/agents/` in the current directory
- Tool references are translated from Claude format (`mcp__plugin_name_server__tool`) to Copilot format (`server/tool`)
- Frontmatter fields (name, description, model, tools) are preserved
- **Concurrent instances**: Multiple `construct` processes can run safely in the same directory
  - Reference counting ensures agent files are only deleted when the last instance exits
  - Lock files in `.construct-locks/` track active instances
  - Automatic cleanup of stale locks from crashed processes

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
