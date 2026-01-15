# Plugin Management

## Overview

This document describes the implementation of plugin and marketplace management commands for Construct.

## Key Files and Directories

| Path | Description |
|------|-------------|
| `~/.claude/plugins/marketplaces/` | Default clone location for git-based marketplaces |
| `~/.claude/plugins/known_marketplaces.json` | Registry of all known marketplaces |
| `$PWD/.construct.json` | Project-local enabled plugins config |

### known_marketplaces.json Schema

```typescript
interface KnownMarketplacesFile {
  [marketplaceName: string]: {
    source: {
      source: "github" | "directory";
      repo?: string;   // For github: "owner/repo"
      path?: string;   // For directory: absolute path
    };
    installLocation: string;  // Absolute path to marketplace root
    lastUpdated: string;      // ISO 8601 timestamp
  };
}
```

Example:
```json
{
  "claude-plugins-official": {
    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
    "installLocation": "/Users/mike/.claude/plugins/marketplaces/claude-plugins-official",
    "lastUpdated": "2026-01-15T01:38:49.056Z"
  },
  "scaryrawr-plugins": {
    "source": { "source": "directory", "path": "/Users/mike/GitHub/claude-plugins" },
    "installLocation": "/Users/mike/GitHub/claude-plugins",
    "lastUpdated": "2026-01-14T16:02:05.636Z"
  }
}
```

## Implementation Requirements

### New Files to Create

| File | Purpose |
|------|---------|
| `src/plugin.ts` | Business logic for plugin enable/disable |
| `src/marketplace.ts` | Business logic for marketplace add/remove/update/list |
| `src/plugin.test.ts` | Unit tests for plugin operations |
| `src/marketplace.test.ts` | Unit tests for marketplace operations |

### CLI Changes (src/cli.ts)

Extend `parseCliArgs()` to support yargs subcommands:

```typescript
export interface CliArgs {
  command: "run" | "operator" | "plugin";
  // ... existing fields ...
  pluginSubcommand?: "enable" | "disable";
  listEnabled?: boolean;
  marketplaceSubcommand?: "list" | "add" | "remove" | "update";
  pluginName?: string;
  marketplaceTarget?: string;  // marketplace name or URL
  updateAll?: boolean;
}
```

Use yargs `.command()` for nested subcommands.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Plugin not found in any marketplace | `console.error("Error: Plugin \"<name>\" not found in any known marketplace")` + `process.exit(1)` |
| Marketplace already exists | Update the existing marketplace (git pull) and continue successfully |
| Network failure (clone/update) | `console.error("Error: Failed to clone/update marketplace: <details>")` + `process.exit(1)` |
| Invalid marketplace URL/name | `console.error("Error: Invalid marketplace: <input>")` + `process.exit(1)` |

---

## Commands

### plugin enable

**Usage:**
```sh
construct plugin enable <plugin-name>@<marketplace-name>
```

**Example:**
```sh
construct plugin enable tmux@scaryrawr-plugins
```

**Implementation (src/plugin.ts):**

```typescript
export async function enablePlugin(pluginName: string): Promise<void>
```

1. Call `scanAllPlugins()` from `scanner.ts` to get the plugin registry
2. Check if `pluginName` exists in `registry.plugins`
   - If not found: `console.error()` and `process.exit(1)`
3. Call `loadConfig()` from `config.ts`
4. If plugin already in `enabledPlugins`, print info message and return
5. Add plugin to `enabledPlugins` array
6. Call `saveConfig()` with updated config
7. Print success: `console.log("Enabled plugin: <name>")`

**Unit Tests (src/plugin.test.ts):**
- `enablePlugin() adds plugin to .construct.json when plugin exists`
- `enablePlugin() exits with error when plugin not found`
- `enablePlugin() is idempotent (no duplicate entries)`

---

### plugin disable

**Usage:**
```sh
construct plugin disable <plugin-name>@<marketplace-name>
```

**Example:**
```sh
construct plugin disable tmux@scaryrawr-plugins
```

**Implementation (src/plugin.ts):**

```typescript
export async function disablePlugin(pluginName: string): Promise<void>
```

1. Call `loadConfig()` from `config.ts`
2. If config is null or plugin not in `enabledPlugins`, print info and return
3. Filter out the plugin from `enabledPlugins`
4. Call `saveConfig()` with updated config
5. Print success: `console.log("Disabled plugin: <name>")`

**Unit Tests (src/plugin.test.ts):**
- `disablePlugin() removes plugin from .construct.json`
- `disablePlugin() handles missing .construct.json gracefully`
- `disablePlugin() handles plugin not in config gracefully`

---

### plugin --list-enabled

**Usage:**
```sh
construct plugin --list-enabled
construct plugin -e
```

**Implementation (src/plugin.ts):**

```typescript
export async function listEnabledPlugins(): Promise<void>
```

1. Call `loadConfig()` from `config.ts`
2. If config is null or `enabledPlugins` is empty, print "No plugins enabled." and return
3. Print header: `console.log("Enabled plugins:")`
4. For each plugin in `enabledPlugins`, print: `  <plugin-name>@<marketplace-name>`

**Output format:**
```
Enabled plugins:
  tmux@scaryrawr-plugins
  playwright@claude-plugins-official
```

**Unit Tests (src/plugin.test.ts):**
- `listEnabledPlugins() prints all enabled plugins from .construct.json`
- `listEnabledPlugins() handles missing .construct.json gracefully`
- `listEnabledPlugins() handles empty enabledPlugins array`

---

### plugin marketplace --list

**Usage:**
```sh
construct plugin marketplace --list
construct plugin marketplace -l
```

**Implementation (src/marketplace.ts):**

```typescript
export async function listMarketplaces(): Promise<void>
```

1. Read `~/.claude/plugins/known_marketplaces.json`
   - If file doesn't exist, print "No marketplaces configured." and return
2. For each marketplace, print: `<name> (<source.source>)`

**Output format:**
```
Known marketplaces:
  claude-plugins-official (github)
  scaryrawr-plugins (directory)
```

**Unit Tests (src/marketplace.test.ts):**
- `listMarketplaces() prints all known marketplaces`
- `listMarketplaces() handles missing known_marketplaces.json`

---

### plugin marketplace add

**Usage:**
```sh
# Full GitHub URL
construct plugin marketplace add https://github.com/owner/repo-name

# GitHub shorthand (owner/repo)
construct plugin marketplace add scaryrawr/scaryrawr-plugins
```

**Implementation (src/marketplace.ts):**

```typescript
export async function addMarketplace(target: string): Promise<void>
```

1. Parse `target` to determine source type:
   - If starts with `https://github.com/`: extract `owner/repo`, type = "github"
   - If matches `owner/repo` pattern: type = "github"
   - Otherwise: `console.error("Invalid marketplace: ...")` + `process.exit(1)`
2. Derive marketplace name from repo (last segment, e.g., "scaryrawr-plugins")
3. Check if marketplace already exists in known_marketplaces.json:
   - If exists with same source: run `git pull` to update, print success, return
   - If exists with different source: `console.error()` + `process.exit(1)`
4. Clone repo to `~/.claude/plugins/marketplaces/<name>/`
   - Use: `git clone https://github.com/<owner>/<repo>.git <path>`
   - On failure: `console.error("Failed to clone: <error>")` + `process.exit(1)`
5. Validate marketplace has `.claude-plugin/marketplace.json`
   - If missing: remove cloned dir, `console.error()` + `process.exit(1)`
6. Add entry to known_marketplaces.json
7. Print success: `console.log("Added marketplace: <name>")`

**Unit Tests (src/marketplace.test.ts):**
- `addMarketplace() parses full GitHub URL correctly`
- `addMarketplace() parses owner/repo shorthand correctly`
- `addMarketplace() rejects invalid input`
- `addMarketplace() updates existing marketplace instead of erroring`

---

### plugin marketplace remove

**Usage:**
```sh
construct plugin marketplace remove <marketplace-name>
```

**Example:**
```sh
construct plugin marketplace remove scaryrawr-plugins
```

**Implementation (src/marketplace.ts):**

```typescript
export async function removeMarketplace(name: string): Promise<void>
```

1. Read known_marketplaces.json
2. If marketplace not found: `console.error()` + `process.exit(1)`
3. Get marketplace info
4. If `source.source === "github"`:
   - Delete the `installLocation` directory recursively
5. If `source.source === "directory"`:
   - Do NOT delete the directory (it's a user path)
   - Just remove the registry entry
6. Remove entry from known_marketplaces.json and save
7. Print success: `console.log("Removed marketplace: <name>")`

**Unit Tests (src/marketplace.test.ts):**
- `removeMarketplace() deletes git-cloned marketplace from disk`
- `removeMarketplace() preserves directory-based marketplace on disk`
- `removeMarketplace() removes entry from known_marketplaces.json`
- `removeMarketplace() errors when marketplace not found`

---

### plugin marketplace update

**Usage:**
```sh
# Update all git-based marketplaces
construct plugin marketplace update --all
construct plugin marketplace update -a

# Update specific marketplace
construct plugin marketplace update <marketplace-name>
```

**Examples:**
```sh
construct plugin marketplace update --all
construct plugin marketplace update scaryrawr-plugins
```

**Implementation (src/marketplace.ts):**

```typescript
export async function updateMarketplace(name: string): Promise<void>
export async function updateAllMarketplaces(): Promise<void>
```

**updateMarketplace(name):**
1. Read known_marketplaces.json
2. If marketplace not found: `console.error()` + `process.exit(1)`
3. If `source.source !== "github"`: print info "Skipping directory-based marketplace" and return
4. Run `git -C <installLocation> pull`
   - On failure: `console.error()` + `process.exit(1)`
5. Update `lastUpdated` timestamp in known_marketplaces.json
6. Print success: `console.log("Updated marketplace: <name>")`

**updateAllMarketplaces():**
1. Read known_marketplaces.json
2. For each marketplace where `source.source === "github"`:
   - Call `updateMarketplace(name)`
3. Print summary: `console.log("Updated <n> marketplace(s)")`

**Unit Tests (src/marketplace.test.ts):**
- `updateMarketplace() runs git pull on github marketplace`
- `updateMarketplace() skips directory-based marketplace`
- `updateMarketplace() updates lastUpdated timestamp`
- `updateAllMarketplaces() updates all git-based marketplaces`

---

## Testing Strategy

Run tests with:
```sh
bun test src/plugin.test.ts
bun test src/marketplace.test.ts
```

Use temp directories and mock files (see `src/cache.test.ts` for patterns):
- Create temp known_marketplaces.json files
- Create temp .construct.json files
- Use `beforeEach`/`afterEach` for setup/cleanup

For git operations in tests, consider:
- Mocking `Bun.spawn()` or using a test git repo
- Using `--dry-run` flags where available
