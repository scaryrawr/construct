# Environment Variable Expansion

**Status: Implemented** ✓

## Overview

Environment variables can be contained in MCP configs, agent frontmatter, and skill frontmatter. This document describes the implementation plan for unified environment variable expansion at translation time.

## Syntax Support

Two syntaxes are supported:
- `${VAR}` - Basic expansion (if VAR is set, use its value; otherwise leave as-is)
- `${VAR:-default}` - Default value (if VAR is unset or empty, use default)

Variable names are **case-sensitive** and must match pattern `[A-Za-z_][A-Za-z0-9_]*`.

## Expansion Behavior

1. Check local environment map (e.g., `CLAUDE_PLUGIN_ROOT` per-plugin)
2. Check `process.env`
3. If found → use value
4. If not found + has default → use default
5. If not found + no default → **leave as-is** for runtime expansion

## Scope of Expansion

| Component | What Gets Expanded |
|-----------|-------------------|
| MCP configs (`.mcp.json`) | All fields (command, args, env, cwd, url, headers) |
| Agent files (`agents/*.md`) | YAML frontmatter only (not body) |
| Skill files (`skills/*/SKILL.md`) | YAML frontmatter only (not body) |

## Special Variables

### CLAUDE_PLUGIN_ROOT

`${CLAUDE_PLUGIN_ROOT}` expands to the absolute path of the **cached** plugin directory (not the original install location). This ensures that:
- Relative paths in the plugin resolve correctly to the cached copy
- All expanded files and the `CLAUDE_PLUGIN_ROOT` reference the same location
- Skills and agents can reference sibling files using `${CLAUDE_PLUGIN_ROOT}/path/to/file`

The cache path follows the pattern: `~/.cache/construct/plugins/<instance-id>/<marketplace>/<plugin>/`

## Examples

### MCP Config Example

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": [
      "chrome-devtools-mcp@latest",
      "--browser-url=http://${DEVTOOLS_BASE_URL:-127.0.0.1}:${DEVTOOLS_PORT:-9222}"
    ]
  }
}
```

- If `DEVTOOLS_BASE_URL` is set → use its value; otherwise use `127.0.0.1`
- If `DEVTOOLS_PORT` is set → use its value; otherwise use `9222`

### HTTP MCP with API Key

```json
{
  "greptile": {
    "type": "http",
    "url": "https://api.greptile.com/mcp",
    "headers": {
      "Authorization": "Bearer ${GREPTILE_API_KEY}"
    }
  }
}
```

- If `GREPTILE_API_KEY` is not set and has no default → left as `${GREPTILE_API_KEY}` for runtime expansion

---

# Implementation Plan

## Plugin Cache System

To support frontmatter expansion in skills/agents without modifying originals, plugins are cached with expanded copies per construct instance.

### Cache Location

```
~/.cache/construct/plugins/<instance-id>/<marketplace>/<plugin>/
```

- `<instance-id>` is a unique identifier per construct run (e.g., UUID or PID + timestamp)
- Cache is created on startup and **deleted on exit** (normal or signal-based)
- Each construct instance has isolated cache, enabling parallel runs with different env configs

### Cache Lifecycle

1. **Startup:** Generate unique instance ID, create cache directory
2. **Plugin load:** Copy plugin to instance cache, expand env vars
3. **Exit:** Delete entire instance cache directory (register cleanup handlers for SIGINT, SIGTERM, normal exit)

### Why Instance-Based (Not Hash-Based)

- Environment variables may change between runs even if plugin files don't
- Multiple construct instances may run simultaneously with different env configs
- Simpler implementation with no hash computation needed
- No stale cache concerns

---

## Task Breakdown

### Task 1: Create `src/env-expansion.ts`

**Purpose:** Core environment variable expansion logic

**Exports:**
```typescript
/**
 * Expands ${VAR} and ${VAR:-default} in a string.
 * @param value - String containing env var placeholders
 * @param localEnv - Optional local env map (e.g., CLAUDE_PLUGIN_ROOT)
 * @returns Expanded string (undefined vars without defaults left as-is)
 */
export function expandEnvVariables(
  value: string,
  localEnv?: Record<string, string>
): string;

/**
 * Recursively expands env vars in an object/array structure.
 */
export function expandEnvInObject<T>(
  obj: T,
  localEnv?: Record<string, string>
): T;
```

**Implementation details:**
- Regex: `/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g`
- Check `localEnv` first, then `process.env`
- Empty default (`${VAR:-}`) → empty string

**File:** `src/env-expansion.ts`

---

### Task 2: Create `src/env-expansion.test.ts`

**Test cases:**
1. Basic expansion: `${HOME}` → actual home directory
2. Default when unset: `${UNSET_VAR:-fallback}` → `fallback`
3. Default when set: `${HOME:-fallback}` → home directory (not fallback)
4. Passthrough unset no-default: `${GREPTILE_API_KEY}` → `${GREPTILE_API_KEY}`
5. Multiple vars: `http://${HOST:-127.0.0.1}:${PORT:-8080}`
6. LocalEnv override: `${CLAUDE_PLUGIN_ROOT}/bin` with localEnv
7. Nested object expansion
8. Array expansion
9. Empty default: `${VAR:-}` → ``
10. Invalid syntax preserved: `${}`, `${123}`, `${lowercase}`
11. Mixed valid/invalid in same string

**File:** `src/env-expansion.test.ts`

---

### Task 3: Create `src/cache.ts`

**Purpose:** Plugin cache management with instance-based lifecycle

**Exports:**
```typescript
/**
 * Initializes cache for this construct instance.
 * Generates unique instance ID and registers cleanup handlers.
 * @returns Instance cache directory path
 */
export function initCache(): string;

/**
 * Gets or creates a cached copy of a plugin with expanded env vars.
 * CLAUDE_PLUGIN_ROOT is set to the destination cache path during expansion.
 * @returns Path to cached plugin directory
 */
export async function getCachedPlugin(
  plugin: PluginInfo
): Promise<string>;

/**
 * Cleans up the current instance's cache directory.
 * Called automatically on process exit.
 */
export async function cleanupCache(): Promise<void>;

/**
 * Clears ALL cached instances (for --clear-cache command).
 * Useful for cleaning up orphaned caches from crashed processes.
 */
export async function clearAllCaches(): Promise<void>;
```

**Implementation details:**
- Cache dir: `$XDG_CACHE_HOME/construct/plugins/<instance-id>/` or `~/.cache/construct/plugins/<instance-id>/`
- Instance ID: `process.pid + '-' + Date.now()` or UUID
- Register cleanup on: `process.on('exit')`, `process.on('SIGINT')`, `process.on('SIGTERM')`

**Cache creation flow:**
1. `initCache()` called at startup → creates instance directory, registers cleanup
2. For each plugin: copy source to `<instance-dir>/<marketplace>/<plugin>/`
3. Compute destination path, set `localEnv = { CLAUDE_PLUGIN_ROOT: destinationPath }`
4. Expand env vars in cached files using `localEnv`
5. Return destination path
6. On exit → `cleanupCache()` removes entire instance directory

**Expand in cached copies:**
- `.mcp.json` → full expansion
- `agents/*.md` → frontmatter only  
- `skills/*/SKILL.md` → frontmatter only

**File:** `src/cache.ts`

---

### Task 4: Create `src/cache.test.ts`

**Test cases:**
1. `initCache()` creates instance directory and returns path
2. `initCache()` registers cleanup handlers
3. `getCachedPlugin()` copies plugin to instance cache
4. `getCachedPlugin()` returns consistent path for same plugin in same instance
5. Env vars expanded in cached `.mcp.json`
6. Env vars expanded in cached agent frontmatter (body unchanged)
7. Env vars expanded in cached skill frontmatter (body unchanged)
8. `CLAUDE_PLUGIN_ROOT` expands to cached path (not source path)
9. `cleanupCache()` removes instance directory
10. `clearAllCaches()` removes all instance directories

**File:** `src/cache.test.ts`

---

### Task 5: Update `src/translator.ts`

**Changes:**
1. Import `expandEnvInObject` from `./env-expansion`
2. Import `getCachedPlugin` from `./cache`
3. Remove local `expandPluginRoot` and `expandPluginRootInObject` functions
4. Update `translatePlugins()` to:
   - Get cached plugin path for each plugin
   - Use cached paths for skill directories
   - Read `.mcp.json` from cache (already expanded)
5. Update `transformMcpServer()` to use unified expansion

**Key change in flow:**
```typescript
// Before: Read from original, expand inline
const claudeConfig = await readMcpConfig(mcpConfigPath);
const expandedServer = expandPluginRootInObject(server, pluginPath);

// After: Get cached path first, then read pre-expanded files
const cachedPath = await getCachedPlugin(plugin);
// CLAUDE_PLUGIN_ROOT was set to cachedPath during cache creation
const claudeConfig = await readMcpConfig(join(cachedPath, '.mcp.json'));
// No inline expansion needed - cache files already have CLAUDE_PLUGIN_ROOT
// expanded to the cached path
```

**Important:** The cache is created with `CLAUDE_PLUGIN_ROOT` set to the **destination** cache path, not the source path. This ensures all expanded paths point to the cached copy.

**File:** `src/translator.ts`

---

### Task 6: Update `src/agent-translator.ts`

**Changes:**
1. Import `expandEnvInObject` from `./env-expansion`
2. Update `translateSingleAgent()` to read from cached plugin path
3. Frontmatter is already expanded in cache, body is untouched

**Note:** Agent files are read from the cached plugin directory, which has pre-expanded frontmatter.

**File:** `src/agent-translator.ts`

---

### Task 7: Create `src/skill-translator.ts`

**Purpose:** Handle skill frontmatter expansion during cache creation

**Exports:**
```typescript
/**
 * Expands env vars in skill SKILL.md frontmatter.
 * @param skillPath - Path to SKILL.md
 * @param localEnv - Env vars including CLAUDE_PLUGIN_ROOT
 * @returns Transformed content with expanded frontmatter
 */
export function expandSkillFrontmatter(
  content: string,
  localEnv: Record<string, string>
): string;
```

**Implementation:**
1. Parse YAML frontmatter (same pattern as agent-translator)
2. Expand env vars in frontmatter values
3. Reconstruct file with expanded frontmatter + original body

**File:** `src/skill-translator.ts`

---

### Task 8: Add `--clear-cache` CLI command

**Purpose:** Clean up orphaned cache directories from crashed/killed processes

**Changes to `src/cli.ts`:**
1. Add `--clear-cache` option
2. Update `CliArgs` interface

**Changes to `index.ts`:**
1. Handle `--clear-cache` command
2. Call `clearAllCaches()` and exit

**Usage:**
```bash
construct --clear-cache  # Removes all cached instances (useful after crashes)
```

**Files:** `src/cli.ts`, `index.ts`

---

### Task 9: Add HTTP MCP server support

**Purpose:** Properly translate HTTP-type MCP servers (like greptile)

**Changes to `src/translator.ts`:**
1. Add `CopilotHttpMcpServer` interface:
   ```typescript
   interface CopilotHttpMcpServer {
     type: "http";
     url: string;
     headers?: Record<string, string>;
     tools: string[];
   }
   ```
2. Update `ClaudeMcpServer` to include HTTP fields:
   ```typescript
   interface ClaudeMcpServer {
     // Local server fields
     command?: string;
     args?: string[];
     env?: Record<string, string>;
     cwd?: string;
     // HTTP server fields
     type?: "http";
     url?: string;
     headers?: Record<string, string>;
   }
   ```
3. Update `transformMcpServer()` to detect and handle HTTP vs local types
4. Union type for `CopilotMcpServer`: `CopilotLocalMcpServer | CopilotHttpMcpServer`

**File:** `src/translator.ts`

---

### Task 10: Update documentation

**Files to update:**
1. `variable-expansion.md` - Mark implementation complete, add usage examples
2. `CLAUDE.md` - Update to reflect:
   - Unified env expansion
   - Plugin cache system
   - `--clear-cache` command
   - HTTP MCP support
3. `construct.md` - Update architecture section
4. `README.md` - Add user-facing documentation for env vars

---

## Task Dependencies

```
Task 1 (env-expansion.ts) ─────┬──► Task 2 (tests)
                               │
Task 3 (cache.ts) ─────────────┼──► Task 4 (tests)
                               │
                               ▼
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
            Task 5 (translator)    Task 6 (agent-translator)
                    │                     │
                    │                     │
                    ▼                     │
            Task 7 (skill-translator) ◄───┘
                    │
                    ▼
            Task 8 (--clear-cache)
                    │
                    ▼
            Task 9 (HTTP MCP)
                    │
                    ▼
            Task 10 (docs)
```

**Parallel work streams:**
- **Stream A:** Tasks 1 → 2 (env expansion core + tests)
- **Stream B:** Tasks 3 → 4 (cache core + tests)
- After A+B complete: Tasks 5, 6, 7 can be done in parallel
- Tasks 8, 9 can be done after 5
- Task 10 last

---

## Testing Strategy

Run tests with Bun's built-in test runner:
```bash
bun test                           # Run all tests
bun test src/env-expansion.test.ts # Run specific test file
```

Tests live next to source files with `.test.ts` extension.
