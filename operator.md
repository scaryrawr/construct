# `construct operator` plan

## Goal / user story
Provide an interactive UI to select one or more plugins, then immediately launch `copilot` with that selection (equivalent to passing multiple `--load ...` flags).

This is a convenience workflow on top of the existing pipeline:
`scanAllPlugins()` → resolve `PluginInfo[]` → `translatePlugins()` → `executeCopilot()`.

## Proposed CLI

```bash
construct operator [-- copilot-args...]

# examples
construct operator
construct operator -- --continue
construct operator -- "fix the failing tests"
```

### Flags
No operator-specific flags for v1.

- Selection is **always** persisted to `.construct.json` (matching existing behavior when using `--load`).
- `fzf` is a **hard dependency** for this subcommand (`construct operator`).

## UX behavior

1. Collect all available plugins using the existing scanner.
2. Show an interactive multi-select picker (`fzf --multi`).
3. User selects 0..N plugins.
   - 0 selected (or user cancels): exit 0 and do not modify config.
4. If selection is non-empty:
   - Persist selection to `.construct.json` as `enabledPlugins` + `lastUsed`.
   - Run the normal translation + `copilot` spawn with the selected plugins.

### fzf invocation details (with description preview)
Use `fzf` via `Bun.spawnSync` so it can control the terminal.

- Input to `fzf`: one plugin per line, formatted as:
  - `<pluginId>\t<description>`
  - Example: `tmux@scaryrawr-plugins\tTerminal multiplexer helpers`
- In the list UI, show only the pluginId (hide the description column).
- In the preview pane, show the plugin description.

Suggested `fzf` args (POSIX shell):
- `--multi`
- `--prompt "Plugins> "`
- `--header "Select plugins to enable (TAB to mark, ENTER to run)"`
- `--delimiter "\t"`
- `--with-nth 1`
- `--preview "echo {2}"`
- (optional) `--preview-window "wrap"`

Notes:
- Sanitize descriptions to be single-line (replace newlines/tabs with spaces) so the TSV format stays intact.

Interpretation of `fzf` result:
- exit code 0: selection is stdout, newline-separated lines (including both columns if not configured to print only field 1).
  - Parse selection by splitting lines and taking field 1 (pluginId) before the first tab.
- non-zero exit code (typically 130 on ESC/Ctrl-C): treat as “cancel” and exit 0.

### Enhanced preview: showing plugin components

The fzf preview should display not just the description, but also the list of skills, MCP servers, and agents that will be added when a plugin is selected.

#### Implementation approach

Since fzf's `--preview` runs an external shell command, we need to encode the component information in the fzf input so it can be extracted and formatted by the preview command.

**Option chosen: JSON-encoded components in a hidden field**

Encode the full preview data as a base64-encoded JSON string in a third TSV column. The preview command decodes and formats it.

**fzf input format (3 columns, tab-separated):**
```
<pluginId>\t<description>\t<base64-encoded-preview-json>
```

**Preview JSON structure:**
```json
{
  "description": "Terminal multiplexer helpers",
  "skills": ["tmux-session", "tmux-window"],
  "mcpServers": ["tmux-server"],
  "agents": ["tmux-agent"]
}
```

**fzf args update:**
- `--with-nth 1` (unchanged - only show pluginId in list)
- `--preview "echo {3} | base64 -d | jq -r '\"Description:\\n  \" + .description + \"\\n\\nSkills:\\n  \" + (if (.skills | length) > 0 then (.skills | join(\"\\n  \")) else \"(none)\" end) + \"\\n\\nMCP Servers:\\n  \" + (if (.mcpServers | length) > 0 then (.mcpServers | join(\"\\n  \")) else \"(none)\" end) + \"\\n\\nAgents:\\n  \" + (if (.agents | length) > 0 then (.agents | join(\"\\n  \")) else \"(none)\" end)'"`

**Alternative (simpler, if jq is not guaranteed):**
Use a shell script that decodes and formats with basic tools:
```bash
--preview "echo {3} | base64 -d"
```
And pre-format the JSON as plain text before encoding.

**Recommended: Pre-formatted plain text encoding**

Simpler approach - encode pre-formatted plain text (not JSON) so no jq dependency:

```
<pluginId>\t<description>\t<base64-encoded-preview-text>
```

**Preview text format (before base64 encoding):**
```
Description:
  Terminal multiplexer helpers

Skills:
  tmux-session
  tmux-window

MCP Servers:
  tmux-server

Agents:
  tmux-agent
```

**fzf preview command:**
```bash
--preview "echo {3} | base64 -d"
```

#### Changes to operator.ts

1. **Add `buildPreviewText` function:**
```typescript
function buildPreviewText(plugin: PluginInfo): string {
  const lines: string[] = [];
  
  lines.push("Description:");
  lines.push(`  ${plugin.description || "(no description)"}`);
  lines.push("");
  
  const skills = plugin.components
    .filter(c => c.type === 'skill')
    .flatMap(c => {
      // For skills, scan the actual skill subdirectories
      // The component.name is 'skills' but we want individual skill names
      return getSkillNames(c.path);
    });
  lines.push("Skills:");
  lines.push(skills.length > 0 ? skills.map(s => `  ${s}`).join("\n") : "  (none)");
  lines.push("");
  
  const mcpServers = plugin.components
    .filter(c => c.type === 'mcp')
    .map(c => getMcpServerNames(c.path))
    .flat();
  lines.push("MCP Servers:");
  lines.push(mcpServers.length > 0 ? mcpServers.map(s => `  ${s}`).join("\n") : "  (none)");
  lines.push("");
  
  const agents = plugin.components
    .filter(c => c.type === 'agent')
    .map(c => c.name);
  lines.push("Agents:");
  lines.push(agents.length > 0 ? agents.map(a => `  ${a}`).join("\n") : "  (none)");
  
  return lines.join("\n");
}
```

2. **Update `buildFzfInput` to include preview data:**
```typescript
function buildFzfInput(plugins: PluginInfo[]): string {
  return plugins
    .map((plugin) => {
      const previewText = buildPreviewText(plugin);
      const previewBase64 = Buffer.from(previewText).toString('base64');
      return `${plugin.name}\t${sanitizeForTsv(plugin.description)}\t${previewBase64}`;
    })
    .join("\n");
}
```

3. **Update fzf args:**
```typescript
const fzfArgs = [
  "--multi",
  "--prompt", "Plugins> ",
  "--header", "Select plugins to enable (TAB to mark, ENTER to run)",
  "--delimiter", "\t",
  "--with-nth", "1",
  "--preview", "echo {3} | base64 -d",
  "--preview-window", "wrap",
];
```

4. **Add helper functions for extracting names from components:**

```typescript
import { Glob } from "bun";
import { basename } from "node:path";

function getSkillNamesSync(skillsDir: string): string[] {
  try {
    const glob = new Glob("*/SKILL.md");
    const files = Array.from(glob.scanSync({ cwd: skillsDir, absolute: false }));
    return files.map(f => f.split('/')[0]!);
  } catch {
    return [];
  }
}

function getMcpServerNamesSync(mcpJsonPath: string): string[] {
  try {
    const content = require('fs').readFileSync(mcpJsonPath, 'utf-8');
    const mcpConfig = JSON.parse(content);
    if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
      return Object.keys(mcpConfig.mcpServers);
    }
    return [];
  } catch {
    return [];
  }
}
```

#### Example fzf preview output

When a user hovers over `tmux@scaryrawr-plugins`:

```
Description:
  Terminal multiplexer session management

Skills:
  tmux-session
  tmux-window

MCP Servers:
  tmux-mcp

Agents:
  tmux-helper
```

When a plugin has no components of a type:

```
Description:
  Simple utility plugin

Skills:
  (none)

MCP Servers:
  utility-server

Agents:
  (none)
```

### Optional UX enhancements (defer until core works)
- Pre-select last used plugins from `.construct.json` (fzf supports various bindings, but preselecting is non-trivial; treat as future work).

## Implementation plan (actionable)

### 0) Baseline: understand current flow
- Entry point: `index.ts`
- CLI parsing: `src/cli.ts` (currently option-based, no subcommands except yargs completion)
- Plugin discovery: `src/scanner.ts`
- Config: `src/config.ts`
- Translation/execution: `src/translator.ts`, `src/executor.ts`

### 1) Add a "mode" to CLI parsing
Update `src/cli.ts` to support the `operator` subcommand while keeping existing flags working.

Recommended approach:
- Add `command: 'run' | 'operator'` to `CliArgs`.
- Detect `operator` as the first positional arg in `constructArgs`.
- Continue using the existing `--` passthrough split logic so `construct operator -- --continue` works.

### 2) Implement the operator runner
Create a small module, e.g. `src/operator.ts`, to keep `index.ts` clean.

Proposed API:

```ts
export interface OperatorOptions {
  passthroughArgs: string[];
}

export async function runOperator(options: OperatorOptions): Promise<number>;
```

Responsibilities inside `runOperator`:

1) Gather plugins
- Call `scanAllPlugins()` once.
- Build a stable list of entries for fzf:
  - For each plugin, compute a single-line description.
  - Feed `fzf` lines as TSV: `<pluginId>\t<description>`.

**Where to get the description** (make this reliable so preview is useful):
- Extend `PluginInfo` to include `description?: string`.
- For marketplace plugins: read `description` (or equivalent) from `marketplace.json` plugin entries when scanning (`scanMarketplacePlugins`).
- For installed plugins: attempt to read `${installPath}/.claude-plugin/plugin.json` and use its `description` field if present; otherwise leave description empty.

2) Guardrails
- If no plugins are found: print a helpful message and return 0.

3) Select plugins via `fzf`
- Spawn `fzf` with `stdio: ['pipe','inherit','inherit']` (or Bun equivalent).
- Provide TSV input as above.
- Capture stdout.
- Parse selected plugin IDs by taking field 1 (before the first tab) from each selected line.

4) Resolve selection to `PluginInfo[]`
- For each selected ID, look up `registry.plugins.get(id)`.
- If missing (shouldn’t happen), warn and skip.

5) Persist config (always)
- If selection non-empty:
  - `saveConfig({ enabledPlugins: selectedIds, lastUsed: new Date().toISOString() })`

6) Execute
- `const translation = await translatePlugins(enabledPlugins)`
- `return executeCopilot({ env: translation.env, additionalMcpConfig: translation.additionalMcpConfig, passthroughArgs: options.passthroughArgs, translatedAgents: translation.translatedAgents })`

### 3) Wire it into `index.ts`
In `main()`:
- If `args.command === 'operator'`:
  - call `runOperator(...)`
  - `process.exit(exitCode)`
- Otherwise run the existing flow unchanged.

### 4) Update help text + docs
- Add usage + examples to `README.md` (minimal: one short section showing `construct operator`).
- Ensure `construct --help` shows the new subcommand and its flags.

## Edge cases / decisions

- Cancel behavior: if the user cancels fzf selection, do not save config and exit 0.
- `fzf` is a hard dependency: if it’s not available, print a clear error and exit 1.
- Missing descriptions are acceptable: preview can show an empty string or “(no description)”.

## Success criteria (definition of done)

- `construct operator` launches an interactive selector and then runs copilot with selected plugins.
- `construct operator -- --continue` passes args through to copilot.
- Selecting none or cancelling exits cleanly without saving.
- Selection is written to `.construct.json` in the current directory.
- The `fzf` preview shows the selected plugin’s description.

## Manual verification steps

```bash
# typecheck baseline
bun run typecheck

# run selector
bun run index.ts operator

# pass through args to copilot
bun run index.ts operator -- --help

# confirm config behavior
cat .construct.json
```
