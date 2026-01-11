# Agent Support Implementation Plan

## Overview
Add support for translating Claude Code plugin agents to GitHub Copilot custom agents format, with automatic cleanup on exit.

## Key Requirements

### 1. Tool Translation
- **Standard Tools**: Copilot supports both `Read` and `read` (has aliases), so no translation needed
- Tools can be passed through as-is from Claude Code format
- Unknown tools passed through unchanged (forward compatibility)

### 2. MCP Tool Translation
- **Claude Code format**: `mcp__plugin_{plugin-name}_{mcp-server-name}__{tool_name}`
- **Copilot format**: `mcp-server-name/tool_name`
- **Example**: `mcp__plugin_chrome-devtools_chrome-devtools__click` → `chrome-devtools/click`

### 3. Tool Syntax Format
- Convert from list to array syntax for consistency
- **Input**: `tools: Read, Grep, Bash, mcp__plugin_X_Y__tool`
- **Output**: `tools: ['Read', 'Grep', 'Bash', 'Y/tool']`
- Copilot supports both YAML list and array, we'll use array for clarity

### 4. Agent File Management
- **Location**: `.github/agents/` directory in current working directory
- **Naming**: `{plugin-id}-{agent-name}.md` (e.g., `chrome-devtools@scaryrawr-plugins-performance.md`)
- **Cleanup**: Remove translated agents when construct exits (normal or interrupt)
- **Preservation**: Don't touch non-construct agents in `.github/agents/`

## Architecture

### New Files
1. **`src/agent-translator.ts`**
   - `translateAgents(plugins, mcpServers)` - Main entry point
   - `translateSingleAgent(component, pluginInfo, mcpServers)` - Translates one agent
   - `translateTools(tools, pluginInfo, mcpServers)` - Translates tool list
   - `parseAgentFrontmatter(content)` - Parses YAML frontmatter
   - `writeAgentFile(outputPath, content)` - Writes translated agent
   - Types: `TranslatedAgent`, `AgentFrontmatter`

### Modified Files
1. **`src/translator.ts`**
   - Update `TranslationResult` interface to include `translatedAgents: TranslatedAgent[]`
   - Update `translatePlugins()` to call agent translation
   - Return list of translated agent paths for cleanup

2. **`src/executor.ts`**
   - Update `ExecutorOptions` to include `translatedAgents: TranslatedAgent[]`
   - Register cleanup handlers for process exit
   - Add `cleanupAgents(agentPaths)` function
   - Handle SIGINT, SIGTERM, and normal exit

3. **`index.ts`**
   - Pass translated agent info to executor
   - Ensure cleanup happens on all exit paths

## MCP Tool Translation Logic

```typescript
// Pattern: mcp__plugin_{plugin-name}_{server-name}__{tool-name}
// Example: mcp__plugin_chrome-devtools_chrome-devtools__click
// Output: chrome-devtools/click

function translateMcpTool(tool: string, pluginName: string): string | null {
  // Extract base plugin name (before @)
  const basePluginName = pluginName.split('@')[0]!;
  const prefix = `mcp__plugin_${basePluginName}_`;
  
  if (!tool.startsWith(prefix)) {
    return null; // Not an MCP tool for this plugin
  }
  
  // Extract server-name__tool-name
  const remainder = tool.slice(prefix.length);
  const parts = remainder.split('__');
  
  if (parts.length === 2) {
    const [serverName, toolName] = parts;
    return `${serverName}/${toolName}`;
  }
  
  return null; // Invalid format
}

function translateTools(
  tools: string | string[],
  pluginName: string,
  mcpServers: string[]
): string[] {
  // Parse tools (could be comma-separated string or array)
  const toolList = typeof tools === 'string' 
    ? tools.split(',').map(t => t.trim())
    : tools;
  
  return toolList.map(tool => {
    // Try MCP translation first
    const mcpTranslated = translateMcpTool(tool, pluginName);
    if (mcpTranslated) {
      return mcpTranslated;
    }
    
    // Pass through standard tools as-is (Copilot has aliases)
    return tool;
  });
}
```

## Agent File Structure

### Input (Claude Code Agent)
```markdown
---
name: performance
description: Web performance expert using Chrome DevTools
model: 'inherit'
tools: Read, Grep, Bash, mcp__plugin_chrome-devtools_chrome-devtools__click
---

Agent instructions here...
```

### Output (Copilot Agent)
```markdown
---
name: performance
description: Web performance expert using Chrome DevTools
model: 'inherit'
tools: ['Read', 'Grep', 'Bash', 'chrome-devtools/click']
---

Agent instructions here...
```

## Implementation Steps

### Phase 1: Agent Translator Module (src/agent-translator.ts)
```typescript
export interface TranslatedAgent {
  pluginId: string;
  agentName: string;
  outputPath: string;
}

export interface AgentFrontmatter {
  name: string;
  description?: string;
  model?: string;
  tools?: string | string[];
  [key: string]: any;
}

// 1. Parse YAML frontmatter from agent markdown
// 2. Translate MCP tools only (pass through standard tools)
// 3. Convert tools to array syntax
// 4. Write to .github/agents/{plugin-id}-{agent-name}.md
// 5. Return TranslatedAgent[] for cleanup tracking
```

### Phase 2: Integration with translator.ts
```typescript
// Update TranslationResult interface
export interface TranslationResult {
  env: Record<string, string>;
  additionalMcpConfig: string | null;
  translatedAgents: TranslatedAgent[]; // NEW
}

// Update translatePlugins()
export async function translatePlugins(
  plugins: PluginInfo[]
): Promise<TranslationResult> {
  // ... existing env and MCP logic ...
  
  // Translate agents
  const translatedAgents = await translateAgents(plugins, allMcpServers);
  
  return {
    env,
    additionalMcpConfig,
    translatedAgents,
  };
}
```

### Phase 3: Cleanup in executor.ts
```typescript
export interface ExecutorOptions {
  env: Record<string, string>;
  additionalMcpConfig: string | null;
  passthroughArgs: string[];
  translatedAgents: TranslatedAgent[]; // NEW
}

// Register cleanup on all exit paths
function setupCleanup(translatedAgents: TranslatedAgent[]) {
  const cleanup = () => {
    for (const agent of translatedAgents) {
      try {
        Bun.file(agent.outputPath).unlink();
      } catch {
        // Ignore errors during cleanup
      }
    }
  };
  
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}
```

## Edge Cases to Handle

1. **Plugin name formats**: Handle both `plugin@marketplace` and `plugin` formats
2. **Invalid frontmatter**: Gracefully skip agents with parsing errors
3. **Missing tools field**: Handle agents without tools (just copy as-is)
4. **Mixed tool formats**: Handle both string and array in frontmatter
5. **Directory creation**: Create `.github/` and `.github/agents/` if missing
6. **File permissions**: Handle write errors gracefully with warnings
7. **Cleanup safety**: Only remove files we created (track by path)
8. **Empty tools**: Handle empty or null tools field

## Success Criteria

- [ ] Agent files successfully translated from enabled plugins
- [ ] MCP tools correctly translated to `server-name/tool-name` format
- [ ] Standard tools passed through unchanged
- [ ] Tools converted to array syntax: `['Read', 'chrome-devtools/click']`
- [ ] Agents written to `.github/agents/{plugin-id}-{agent-name}.md`
- [ ] Agents cleaned up on normal exit
- [ ] Agents cleaned up on interrupt (Ctrl+C)
- [ ] Error handling for invalid agents (warnings, not failures)
- [ ] Works with chrome-devtools performance agent

## Testing Commands

```bash
# 1. List available plugins
bun run index.ts --list-available-plugins

# 2. Enable plugin with agents and start copilot
bun run index.ts --enable-plugin chrome-devtools@scaryrawr-plugins

# 3. In another terminal, verify agent files created
ls -la .github/agents/
cat .github/agents/chrome-devtools@scaryrawr-plugins-performance.md

# 4. Exit copilot normally and verify cleanup
# (Agents should be removed)

# 5. Test interrupt cleanup
bun run index.ts --enable-plugin chrome-devtools@scaryrawr-plugins
# Press Ctrl+C
# Verify agents removed
```

## Implementation Checklist

- [ ] Create `src/agent-translator.ts` with types and functions
- [ ] Implement YAML frontmatter parsing (using Bun or js-yaml)
- [ ] Implement MCP tool translation logic
- [ ] Implement agent file writing with directory creation
- [ ] Update `TranslationResult` in `src/translator.ts`
- [ ] Call agent translator from `translatePlugins()`
- [ ] Update `ExecutorOptions` in `src/executor.ts`
- [ ] Implement cleanup logic with exit handlers
- [ ] Update `index.ts` to pass agents to executor
- [ ] Test with chrome-devtools plugin
- [ ] Test cleanup on various exit scenarios
