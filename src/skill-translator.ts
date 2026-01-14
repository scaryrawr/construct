import { expandEnvVariables } from "./env-expansion";

/**
 * Expands env vars in skill SKILL.md frontmatter.
 * @param content - Full content of SKILL.md file
 * @param localEnv - Env vars including CLAUDE_PLUGIN_ROOT
 * @returns Transformed content with expanded frontmatter (body unchanged)
 */
export function expandSkillFrontmatter(
  content: string,
  localEnv: Record<string, string>
): string {
  const lines = content.split("\n");

  // Check if content starts with ---
  if (lines[0] !== "---") {
    return content; // no frontmatter
  }

  // Find the second ---
  let secondDashIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      secondDashIndex = i;
      break;
    }
  }

  if (secondDashIndex === -1) {
    // No closing ---, treat as no frontmatter
    return content;
  }

  // Extract frontmatter lines and body
  const frontmatterLines = lines.slice(1, secondDashIndex);
  const bodyLines = lines.slice(secondDashIndex + 1);

  // Expand env vars in frontmatter lines
  const expandedFrontmatterLines = frontmatterLines.map((line) =>
    expandEnvVariables(line, localEnv)
  );

  // Reconstruct: --- + expanded frontmatter + --- + body
  const expandedFrontmatter = expandedFrontmatterLines.join("\n");
  const body = bodyLines.join("\n");

  return `---\n${expandedFrontmatter}\n---\n${body}`;
}
