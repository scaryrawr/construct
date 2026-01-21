import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getKnownMarketplacesPath } from "./scanner";
import type { FileSystem } from "./interfaces/file-system";
import type { Shell } from "./interfaces/shell";
import { bunFileSystem } from "./adapters/bun-file-system";
import { bunShell } from "./adapters/bun-shell";

interface MarketplaceSource {
  source: "github" | "directory";
  repo?: string;
  path?: string;
}

export interface MarketplaceDependencies {
  knownMarketplacesPath?: string;
  marketplacesRoot?: string;
  fs?: FileSystem;
  shell?: Shell;
}

/** @deprecated Use MarketplaceDependencies instead */
export type MarketplacePaths = MarketplaceDependencies;

interface KnownMarketplacesFile {
  [marketplaceName: string]: {
    source: MarketplaceSource;
    installLocation: string;
    lastUpdated: string;
  };
}

const defaultDeps = {
  fs: bunFileSystem,
  shell: bunShell,
};

function getMarketplacesRoot(deps?: MarketplaceDependencies): string {
  if (deps?.marketplacesRoot) {
    return deps.marketplacesRoot;
  }
  const homeDir = process.env.HOME ?? homedir();
  return join(homeDir, ".claude", "plugins", "marketplaces");
}

function decodeOutput(output: Uint8Array | null | undefined): string {
  if (!output || output.length === 0) {
    return "";
  }
  return new TextDecoder().decode(output).trim();
}

async function readKnownMarketplaces(
  deps?: MarketplaceDependencies,
): Promise<KnownMarketplacesFile> {
  const { fs } = { ...defaultDeps, ...deps };
  const filePath = deps?.knownMarketplacesPath ?? getKnownMarketplacesPath();

  if (!(await fs.exists(filePath))) {
    return {};
  }

  try {
    const content = await fs.readFile(filePath);
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null) {
      return data as KnownMarketplacesFile;
    }
  } catch (error) {
    console.error(
      `Error: Failed to read known marketplaces: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  return {};
}

async function writeKnownMarketplaces(
  data: KnownMarketplacesFile,
  deps?: MarketplaceDependencies,
): Promise<void> {
  const { fs } = { ...defaultDeps, ...deps };
  const filePath = deps?.knownMarketplacesPath ?? getKnownMarketplacesPath();
  try {
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(
      `Error: Failed to write known marketplaces file at "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

function parseMarketplaceTarget(
  target: string,
): { repo: string; name: string } | null {
  const githubUrlMatch = target.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (githubUrlMatch) {
    const owner = githubUrlMatch[1];
    const repoName = githubUrlMatch[2];
    if (!owner || !repoName) {
      return null;
    }
    const repo = `${owner}/${repoName}`;
    return { repo, name: repoName };
  }

  const shorthandMatch = target.match(/^([^/]+)\/([^/]+)$/);
  if (shorthandMatch) {
    const owner = shorthandMatch[1];
    const repoName = shorthandMatch[2];
    if (!owner || !repoName) {
      return null;
    }
    return { repo: `${owner}/${repoName}`, name: repoName };
  }

  return null;
}

function runGitCommand(args: string[], deps?: MarketplaceDependencies): void {
  const { shell } = { ...defaultDeps, ...deps };
  let result;
  try {
    result = shell.spawnSync(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    console.error(
      `Error: Failed to clone/update marketplace: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  if (result.exitCode !== 0 || result.exitCode === null) {
    const details =
      decodeOutput(result.stderr) ||
      decodeOutput(result.stdout) ||
      `exit code ${result.exitCode ?? "unknown"}`;
    console.error(`Error: Failed to clone/update marketplace: ${details}`);
    process.exit(1);
  }
}

async function validateMarketplace(
  installLocation: string,
  target: string,
  deps?: MarketplaceDependencies,
): Promise<void> {
  const { fs } = { ...defaultDeps, ...deps };
  const marketplaceJsonPath = join(
    installLocation,
    ".claude-plugin",
    "marketplace.json",
  );
  if (!(await fs.exists(marketplaceJsonPath))) {
    await fs.rm(installLocation, { recursive: true, force: true });
    throw new Error(`Invalid marketplace: ${target}`);
  }
}

export async function listMarketplaces(deps?: MarketplaceDependencies): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(deps);
  const entries = Object.entries(knownMarketplaces);

  if (entries.length === 0) {
    console.log("No marketplaces configured.");
    return;
  }

  console.log("Known marketplaces:");
  for (const [name, info] of entries) {
    console.log(`  ${name} (${info.source.source})`);
  }
}

export async function addMarketplace(
  target: string,
  deps?: MarketplaceDependencies,
): Promise<void> {
  const { fs } = { ...defaultDeps, ...deps };
  const parsed = parseMarketplaceTarget(target);
  if (!parsed) {
    console.error(`Error: Invalid marketplace: ${target}`);
    process.exit(1);
  }

  const knownMarketplaces = await readKnownMarketplaces(deps);
  const existing = knownMarketplaces[parsed.name];
  if (existing) {
    if (existing.source.source === "github" && existing.source.repo === parsed.repo) {
      runGitCommand(["-C", existing.installLocation, "pull"], deps);
      knownMarketplaces[parsed.name] = {
        ...existing,
        lastUpdated: new Date().toISOString(),
      };
      await writeKnownMarketplaces(knownMarketplaces, deps);
      console.log(`Updated marketplace: ${parsed.name}`);
      return;
    }
    let conflictMessage = `Error: Marketplace "${parsed.name}" already exists with a different source.`;
    if (existing.source.source === "github") {
      const existingRepo = existing.source.repo ?? "<unknown>";
      conflictMessage +=
        ` It is currently registered as a GitHub marketplace pointing to "${existingRepo}",` +
        ` but you attempted to add it as "${parsed.repo}".`;
    } else if (existing.source.source === "directory") {
      const existingPath = existing.source.path ?? "<unknown path>";
      conflictMessage +=
        ` It is currently registered as a directory-based marketplace at "${existingPath}",` +
        ` so you must remove or rename it before adding a GitHub-based marketplace with the same name.`;
    }
    console.error(conflictMessage);
    process.exit(1);
  }

  // Sanitize marketplace name to prevent directory traversal
  if (
    parsed.name.includes("..") ||
    parsed.name.includes("/") ||
    parsed.name.includes("\\")
  ) {
    console.error(`Error: Invalid marketplace name: ${parsed.name}`);
    process.exit(1);
  }

  const marketplacesRoot = getMarketplacesRoot(deps);
  await fs.mkdir(marketplacesRoot, { recursive: true });
  const installLocation = join(marketplacesRoot, parsed.name);
  const repoUrl = `https://github.com/${parsed.repo}.git`;

  runGitCommand(["clone", repoUrl, installLocation], deps);
  await validateMarketplace(installLocation, target, deps);

  knownMarketplaces[parsed.name] = {
    source: { source: "github", repo: parsed.repo },
    installLocation,
    lastUpdated: new Date().toISOString(),
  };

  await writeKnownMarketplaces(knownMarketplaces, deps);
  console.log(`Added marketplace: ${parsed.name}`);
}

export async function removeMarketplace(
  name: string,
  deps?: MarketplaceDependencies,
): Promise<void> {
  const { fs } = { ...defaultDeps, ...deps };
  const knownMarketplaces = await readKnownMarketplaces(deps);
  const marketplace = knownMarketplaces[name];
  if (!marketplace) {
    console.error(`Error: Marketplace "${name}" not found`);
    process.exit(1);
  }

  if (marketplace.source.source === "github") {
    await fs.rm(marketplace.installLocation, { recursive: true, force: true });
  }

  delete knownMarketplaces[name];
  await writeKnownMarketplaces(knownMarketplaces, deps);
  console.log(`Removed marketplace: ${name}`);
}

export async function updateMarketplace(
  name: string,
  deps?: MarketplaceDependencies,
): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(deps);
  const marketplace = knownMarketplaces[name];
  if (!marketplace) {
    console.error(`Error: Marketplace "${name}" not found`);
    process.exit(1);
  }

  if (marketplace.source.source !== "github") {
    console.log(`Skipping directory-based marketplace: ${name}`);
    return;
  }

  runGitCommand(["-C", marketplace.installLocation, "pull"], deps);
  knownMarketplaces[name] = {
    ...marketplace,
    lastUpdated: new Date().toISOString(),
  };
  await writeKnownMarketplaces(knownMarketplaces, deps);
  console.log(`Updated marketplace: ${name}`);
}

export async function updateAllMarketplaces(
  deps?: MarketplaceDependencies,
): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(deps);
  const githubMarketplaces = Object.entries(knownMarketplaces).filter(
    ([, info]) => info.source.source === "github",
  );

  for (const [name] of githubMarketplaces) {
    await updateMarketplace(name, deps);
  }

  console.log(`Updated ${githubMarketplaces.length} marketplace(s)`);
}
