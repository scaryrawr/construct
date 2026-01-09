# Construct - GitHub Copilot CLI Plugin Manager

## Overview
Construct is a wrapper for `copilot` CLI (https://github.com/github/copilot-cli/) that enables loading plugins, skills, MCPs, and custom agents from Claude Code marketplaces.

## Architecture

### Command Structure
- `construct [options] [-- copilot-args...]` - Run with enabled plugins, passing remaining args to copilot
- `construct --list-available-plugins` - List all discoverable plugins
- `construct --enable-plugin <plugin>@<marketplace>` - Enable plugin(s) for this run (repeatable)
- `construct` (no args) - Use `.construct.json` config from current directory

**Passthrough args**: Everything after `--` is passed directly to `copilot`. Example:
```bash
construct --enable-plugin tmux@scaryrawr-plugins -- --continue --allow-all-tools
```

**Behavior**: Construct translates enabled plugins into appropriate environment variables and CLI args, then spawns `copilot` as a subprocess with `spawnSync`.

### Configuration Persistence
- **Local config**: `.construct.json` in current directory stores last-used loadout
- **Format**: 
  ```json
  {
    "enabledPlugins": ["plugin1@marketplace1", "plugin2@marketplace2"],
    "lastUsed": "2026-01-09T21:32:00.000Z"
  }
  ```

### Plugin Discovery

#### Data Sources
1. **Known Marketplaces**: `~/.claude/plugins/known_marketplaces.json`
   ```json
   {
     "marketplace-name": {
       "source": { "source": "github", "repo": "owner/repo" },
       "installLocation": "/Users/.../.claude/plugins/marketplaces/marketplace-name",
       "lastUpdated": "2026-01-09T20:45:55.842Z"
     }
   }
   ```

2. **Installed Plugins**: `~/.claude/plugins/installed_plugins.json`
   ```json
   {
     "version": 2,
     "plugins": {
       "plugin-name@marketplace-name": [
         {
           "scope": "user",
           "installPath": "/Users/.../.claude/plugins/cache/marketplace/plugin/version",
           "version": "1.0.0",
           "installedAt": "2026-01-09T20:45:49.614Z",
           "lastUpdated": "2026-01-09T20:45:49.614Z"
         }
       ]
     }
   }
   ```

3. **Marketplace Registry**: `~/.claude/plugins/marketplaces/<name>/.claude-plugin/marketplace.json`
   - Contains full plugin definitions with metadata, versions, and component configurations

#### Directory Structure
```
~/.claude/plugins/
├── installed_plugins.json      # Tracks installed plugins
├── known_marketplaces.json     # Registered marketplaces
├── cache/                      # Installed plugin files
│   └── <marketplace>/
│       └── <plugin>/
│           └── <version>/
│               ├── .claude-plugin/plugin.json
│               ├── .mcp.json        # MCP servers (if any)
│               ├── skills/          # Skills (if any)
│               │   └── <skill-name>/
│               │       └── SKILL.md
│               └── agents/          # Custom agents (if any)
│                   └── <agent>.md
└── marketplaces/               # Cloned marketplace repos
    └── <marketplace-name>/
        ├── .claude-plugin/marketplace.json
        └── plugins/
            └── <plugin-name>/
```

#### Plugin Component Types
- **Skills**: Directories containing `SKILL.md` files with YAML frontmatter
- **MCPs**: Defined in `.mcp.json` at plugin root
- **Agents**: Markdown files in `agents/` directory with YAML frontmatter
- **Hooks**: Defined in `hooks/hooks.json` (not supported by Copilot CLI)
- **LSP Servers**: Defined in `plugin.json` (not supported by Copilot CLI)

**Naming Convention**: `<plugin>@<marketplace>` (e.g., `tmux@scaryrawr-plugins`)

### Translation Layer

#### Skills
- **Source**: `<plugin-path>/skills/<skill-name>/SKILL.md`
- **Target**: Environment variable `COPILOT_SKILLS_DIRS`
- **Format**: Comma-separated list of skill directory paths
- **Example**: `COPILOT_SKILLS_DIRS=/path/to/skill1,/path/to/skill2`

#### MCP Translation (Claude Code → Copilot CLI)

**Claude Code Format** (`.mcp.json`):
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

**GitHub Copilot Format** (`--additional-mcp-config`):
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

**Transformation Rules**:
1. Wrap in `mcpServers` object
2. Add `"type": "local"` to each server config
3. Add `"tools": ["*"]` to enable all tools (or allow user to specify)
4. Keep `command`, `args`, `env`, `cwd` as-is
5. Expand `${CLAUDE_PLUGIN_ROOT}` → actual plugin install path

**Copilot CLI Flag**: `--additional-mcp-config '{"mcpServers":...}'`

#### Unsupported Components (Silently Skipped)
- **Hooks**: Claude Code event handlers - not applicable to Copilot CLI
- **LSP Servers**: Language server configs - Copilot CLI doesn't support these
- **Custom Agents**: Different format/purpose than Copilot's `--agent` flag

### Shell Completions
- **Tool**: Use `yargs` for automatic completion generation
- **Shells**: bash, zsh, fish, powershell
- **Scope**: Complete `construct` commands and plugin names from marketplace scan

## Implementation Tasks

1. **CLI Setup** (yargs)
   - Parse `--list-available-plugins`, `--enable-plugin`, passthrough args
   - Generate shell completions

2. **Plugin Scanner**
   - Read `~/.claude/plugins/installed_plugins.json` for installed plugins
   - For each plugin, locate install path and scan for:
     - `skills/*/SKILL.md` → skill directories
     - `.mcp.json` → MCP server configs
     - `agents/*.md` → custom agent definitions
   - Build plugin registry with component types

3. **Config Manager**
   - Read/write `.construct.json`
   - Merge CLI flags with saved config

4. **Translation Engine**
   - Build `COPILOT_SKILLS_DIRS` from enabled plugins' skill paths
   - Transform MCP configs:
     - Parse Claude `.mcp.json` format
     - Add `type: "local"` and `tools: ["*"]`
     - Wrap in `mcpServers` object
     - Replace `${CLAUDE_PLUGIN_ROOT}` with actual paths
   - Generate `--additional-mcp-config` JSON string

5. **Subprocess Executor**
   - `spawnSync` `copilot` with:
     - Modified environment (COPILOT_SKILLS_DIRS, etc.)
     - Additional CLI args (--additional-mcp-config)
     - Passthrough remaining args
   - Forward stdout/stderr/exit code
   - Use `inherit` for stdio to allow interactive mode

## Cross-Platform Considerations
- Path handling (use `node:path` or Bun equivalents)
- Home directory resolution (`Bun.env.HOME` or `os.homedir()`)
- Shell completion installation per platform
- JSON path escaping for Windows command line

## Dependencies
- `yargs` - CLI argument parsing and shell completions
- Built-in Bun APIs for file system and subprocess

## Example Usage
```bash
# List available plugins from installed Claude Code marketplaces
construct --list-available-plugins

# Enable specific plugins for this session
construct --enable-plugin tmux@scaryrawr-plugins --enable-plugin chrome-devtools@scaryrawr-plugins

# Run with saved config
construct

# Pass through args to copilot (everything after -- goes to copilot)
construct -- --continue

# Combine construct flags with copilot passthrough
construct --enable-plugin tmux@scaryrawr-plugins -- --allow-all-tools --continue

# Pass a prompt directly to copilot
construct -- "fix the failing tests"
```
