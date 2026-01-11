import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { PluginInfo } from "./scanner";

/**
 * Represents a translated agent file for cleanup tracking
 */
export interface TranslatedAgent {
  /** Plugin identifier (e.g., "chrome-devtools@scaryrawr-plugins") */
  pluginId: string;
  /** Agent name from frontmatter */
  agentName: string;
  /** Full path to the output file */
  outputPath: string;
}

/**
 * YAML frontmatter structure for agent files
 */
export interface AgentFrontmatter {
  /** Agent name */
  name: string;
  /** Agent description */
  description?: string;
  /** Model to use (e.g., "inherit") */
  model?: string;
  /** Tools available to the agent (string or array format) */
  tools?: string | string[];
  /** Additional custom fields */
  [key: string]: unknown;
}

/**
 * Translates an MCP tool from Claude Code format to Copilot format
 *
 * @param tool - Tool name (e.g., "mcp__plugin_chrome-devtools_chrome-devtools__click")
 * @param pluginName - Plugin name (e.g., "chrome-devtools@scaryrawr-plugins")
 * @returns Translated tool name (e.g., "chrome-devtools/click") or null if not an MCP tool
 */
export function translateMcpTool(tool: string, pluginName: string): string | null {
  // Extract base plugin name (before @)
  const basePluginName = pluginName.split('@')[0]!;
  const prefix = `mcp__plugin_${basePluginName}_`;
  
  if (!tool.startsWith(prefix)) {
    return null; // Not an MCP tool for this plugin
  }
  
  // Extract server-name__tool-name
  const remainder = tool.slice(prefix.length);
  const parts = remainder.split('__');
  
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `${parts[0]}/${parts[1]}`;
  }
  
  return null; // Invalid format
}

/**
 * Translates a list of tools, converting MCP tools to Copilot format
 *
 * @param tools - Tools in string or array format
 * @param pluginName - Plugin name for MCP tool translation
 * @param mcpServers - List of available MCP server names
 * @returns Array of translated tool names
 */
export function translateTools(
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

/**
 * Parses YAML frontmatter from a markdown file
 *
 * @param content - Full markdown file content
 * @returns Parsed frontmatter and remaining content, or null if parsing fails
 */
export function parseAgentFrontmatter(
  content: string
): { frontmatter: AgentFrontmatter; body: string } | null {
  try {
    // Check for frontmatter delimiters
    const lines = content.split('\n');
    if (lines[0] !== '---') {
      return null;
    }

    // Find closing delimiter
    const endIndex = lines.findIndex((line, i) => i > 0 && line === '---');
    if (endIndex === -1) {
      return null;
    }

    // Extract frontmatter YAML
    const yamlContent = lines.slice(1, endIndex).join('\n');
    
    // Parse YAML using a simple parser (avoiding dependencies)
    // This handles basic YAML structures common in agent files
    const frontmatter: AgentFrontmatter = { name: '' };
    
    for (const line of yamlContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Handle key: value pairs
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Parse arrays (e.g., [item1, item2])
      if (value.startsWith('[') && value.endsWith(']')) {
        const arrayContent = value.slice(1, -1);
        frontmatter[key] = arrayContent
          .split(',')
          .map(item => item.trim().replace(/^['"]|['"]$/g, ''));
      } else {
        frontmatter[key] = value;
      }
    }
    
    // Extract body (everything after frontmatter)
    const body = lines.slice(endIndex + 1).join('\n');
    
    return { frontmatter, body };
  } catch (error) {
    console.warn('Failed to parse agent frontmatter:', error);
    return null;
  }
}

/**
 * Writes an agent file to disk, creating directories if needed
 *
 * @param outputPath - Full path to output file
 * @param content - File content to write
 */
export async function writeAgentFile(
  outputPath: string,
  content: string
): Promise<void> {
  try {
    // Create .github/agents directory if it doesn't exist
    const agentsDir = join(process.cwd(), '.github', 'agents');
    await mkdir(agentsDir, { recursive: true });
    
    // Write the file
    await Bun.write(outputPath, content);
  } catch (error) {
    console.warn(`Failed to write agent file ${outputPath}:`, error);
    throw error;
  }
}

/**
 * Translates a single agent component from Claude Code to Copilot format
 *
 * @param component - Agent component to translate
 * @param pluginInfo - Plugin information
 * @param mcpServers - List of available MCP server names
 * @returns TranslatedAgent or null if translation fails
 */
export async function translateSingleAgent(
  component: { type: string; path: string; name: string },
  pluginInfo: PluginInfo,
  mcpServers: string[]
): Promise<TranslatedAgent | null> {
  try {
    // Read agent file
    const file = Bun.file(component.path);
    const content = await file.text();
    
    // Parse frontmatter
    const parsed = parseAgentFrontmatter(content);
    if (!parsed) {
      console.warn(`Skipping agent ${component.name}: invalid frontmatter`);
      return null;
    }
    
    const { frontmatter, body } = parsed;
    
    // Validate required fields
    if (!frontmatter.name) {
      console.warn(`Skipping agent ${component.name}: missing name field`);
      return null;
    }
    
    // Translate tools if present
    if (frontmatter.tools) {
      const translatedTools = translateTools(
        frontmatter.tools,
        pluginInfo.name,
        mcpServers
      );
      frontmatter.tools = translatedTools;
    }
    
    // Build output content with translated frontmatter
    const outputLines = ['---'];
    
    // Write frontmatter fields
    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === 'tools' && Array.isArray(value)) {
        // Format tools as array syntax
        const toolsArray = value.map(t => `'${t}'`).join(', ');
        outputLines.push(`${key}: [${toolsArray}]`);
      } else if (typeof value === 'string') {
        outputLines.push(`${key}: '${value}'`);
      } else if (Array.isArray(value)) {
        const arrayStr = value.map(v => `'${v}'`).join(', ');
        outputLines.push(`${key}: [${arrayStr}]`);
      } else {
        outputLines.push(`${key}: ${value}`);
      }
    }
    
    outputLines.push('---');
    outputLines.push(body);
    
    const outputContent = outputLines.join('\n');
    
    // Determine output path
    const agentFileName = `${pluginInfo.name}-${frontmatter.name}.md`;
    const outputPath = join(process.cwd(), '.github', 'agents', agentFileName);
    
    // Write file
    await writeAgentFile(outputPath, outputContent);
    
    return {
      pluginId: pluginInfo.name,
      agentName: frontmatter.name,
      outputPath,
    };
  } catch (error) {
    console.warn(`Failed to translate agent ${component.name}:`, error);
    return null;
  }
}

/**
 * Translates all agents from enabled plugins
 *
 * @param plugins - Array of enabled plugins
 * @param mcpServers - List of available MCP server names
 * @returns Array of translated agents for cleanup tracking
 */
export async function translateAgents(
  plugins: PluginInfo[],
  mcpServers: string[]
): Promise<TranslatedAgent[]> {
  const translatedAgents: TranslatedAgent[] = [];
  
  for (const plugin of plugins) {
    // Find agent components
    const agentComponents = plugin.components.filter(c => c.type === 'agent');
    
    for (const component of agentComponents) {
      const translated = await translateSingleAgent(
        component,
        plugin,
        mcpServers
      );
      
      if (translated) {
        translatedAgents.push(translated);
      }
    }
  }
  
  return translatedAgents;
}
