import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { translatePlugins } from "./translator";
import { scanAllPlugins, type PluginInfo } from "./scanner";
import { saveConfig } from "./config";
import { executeCopilot } from "./executor";

export interface OperatorOptions {
  passthroughArgs: string[];
}

function sanitizeForTsv(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

function getSkillNamesSync(skillsDir: string): string[] {
  try {
    const glob = new Glob("*/SKILL.md");
    const files = Array.from(glob.scanSync({ cwd: skillsDir, absolute: false }));
    return files.map((f) => f.split("/")[0]!);
  } catch {
    return [];
  }
}

function getMcpServerNamesSync(mcpJsonPath: string): string[] {
  try {
    const content = readFileSync(mcpJsonPath, "utf-8");
    const mcpConfig = JSON.parse(content);
    if (typeof mcpConfig === "object" && mcpConfig !== null) {
      return Object.keys(mcpConfig);
    }
    return [];
  } catch {
    return [];
  }
}

function buildPreviewText(plugin: PluginInfo): string {
  const lines: string[] = [];

  lines.push("Description:");
  lines.push(`  ${plugin.description || "(no description)"}`);
  lines.push("");

  const skills = plugin.components
    .filter((c) => c.type === "skill")
    .flatMap((c) => getSkillNamesSync(c.path));
  lines.push("Skills:");
  lines.push(skills.length > 0 ? skills.map((s) => `  ${s}`).join("\n") : "  (none)");
  lines.push("");

  const mcpServers = plugin.components
    .filter((c) => c.type === "mcp")
    .flatMap((c) => getMcpServerNamesSync(c.path));
  lines.push("MCP Servers:");
  lines.push(mcpServers.length > 0 ? mcpServers.map((s) => `  ${s}`).join("\n") : "  (none)");
  lines.push("");

  const agents = plugin.components
    .filter((c) => c.type === "agent")
    .map((c) => c.name);
  lines.push("Agents:");
  lines.push(agents.length > 0 ? agents.map((a) => `  ${a}`).join("\n") : "  (none)");

  return lines.join("\n");
}

function buildFzfInput(plugins: PluginInfo[]): string {
  return plugins
    .map((plugin) => {
      const previewText = buildPreviewText(plugin);
      const previewBase64 = Buffer.from(previewText).toString("base64");
      return `${plugin.name}\t${sanitizeForTsv(plugin.description)}\t${previewBase64}`;
    })
    .join("\n");
}

function parseFzfSelection(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.split("\t")[0]?.trim())
    .filter((id): id is string => Boolean(id));
}

export async function runOperator(options: OperatorOptions): Promise<number> {
  const registry = await scanAllPlugins();
  const plugins = Array.from(registry.plugins.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (plugins.length === 0) {
    console.log("No plugins installed. Install plugins via Claude Code first.");
    return 0;
  }

  const fzfInput = buildFzfInput(plugins);

  let fzfProcess;

  try {
    fzfProcess = Bun.spawn({
      cmd: [
        "fzf",
        "--multi",
        "--prompt",
        "Plugins> ",
        "--header",
        "Select plugins to enable (TAB to mark, ENTER to run)",
        "--delimiter",
        "\t",
        "--with-nth",
        "1",
        "--preview",
        "echo {3} | base64 -d",
        "--preview-window",
        "wrap",
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
  } catch (error) {
    console.error(
      "Error: fzf is required for this command. Please install fzf and try again.",
    );
    return 1;
  }

  if (fzfProcess.stdin) {
    fzfProcess.stdin.write(fzfInput);
    fzfProcess.stdin.end();
  }

  const exitCode = await fzfProcess.exited;

  if (exitCode === 130) {
    return 0;
  }

  if (exitCode !== 0) {
    console.error(`Error: fzf exited with code ${exitCode}.`);
    return exitCode;
  }

  const stdout = fzfProcess.stdout
    ? await new Response(fzfProcess.stdout).text()
    : "";
  const selection = stdout.trim();

  if (!selection) {
    return 0;
  }

  const selectedIds = parseFzfSelection(selection);
  const selectedPlugins: PluginInfo[] = [];

  for (const id of selectedIds) {
    const plugin = registry.plugins.get(id);
    if (plugin) {
      selectedPlugins.push(plugin);
    } else {
      console.warn(`Warning: Selected plugin "${id}" not found. Skipping.`);
    }
  }

  if (selectedPlugins.length === 0) {
    return 0;
  }

  const resolvedPluginIds = selectedPlugins.map((plugin) => plugin.name);

  await saveConfig({
    enabledPlugins: resolvedPluginIds,
    lastUsed: new Date().toISOString(),
  });

  const translation = await translatePlugins(selectedPlugins);
  return executeCopilot({
    env: translation.env,
    additionalMcpConfig: translation.additionalMcpConfig,
    passthroughArgs: options.passthroughArgs,
    translatedAgents: translation.translatedAgents,
  });
}
