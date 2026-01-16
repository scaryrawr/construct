import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { getKnownMarketplacesPath } from "./scanner";

interface MarketplaceSource {
  source: "github" | "directory";
  repo?: string;
  path?: string;
}

export interface MarketplacePaths {
  knownMarketplacesPath?: string;
  marketplacesRoot?: string;
}

interface KnownMarketplacesFile {
  [marketplaceName: string]: {
    source: MarketplaceSource;
    installLocation: string;
    lastUpdated: string;
  };
}

function getMarketplacesRoot(paths?: MarketplacePaths): string {
  if (paths?.marketplacesRoot) {
    return paths.marketplacesRoot;
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
  paths?: MarketplacePaths,
): Promise<KnownMarketplacesFile> {
  const path = paths?.knownMarketplacesPath ?? getKnownMarketplacesPath();
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return {};
  }

  try {
    const data = await file.json();
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
  paths?: MarketplacePaths,
): Promise<void> {
  const path = paths?.knownMarketplacesPath ?? getKnownMarketplacesPath();
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(data, null, 2));
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

function runGitCommand(args: string[]): void {
  let result;
  try {
    result = Bun.spawnSync(["git", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    console.error(
      `Error: Failed to clone/update marketplace: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  if (result.exitCode !== 0) {
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
): Promise<void> {
  const marketplaceJsonPath = join(
    installLocation,
    ".claude-plugin",
    "marketplace.json",
  );
  const marketplaceJsonFile = Bun.file(marketplaceJsonPath);
  if (!(await marketplaceJsonFile.exists())) {
    rmSync(installLocation, { recursive: true, force: true });
    console.error(`Error: Invalid marketplace: ${target}`);
    process.exit(1);
  }
}

export async function listMarketplaces(paths?: MarketplacePaths): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(paths);
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
  paths?: MarketplacePaths,
): Promise<void> {
  const parsed = parseMarketplaceTarget(target);
  if (!parsed) {
    console.error(`Error: Invalid marketplace: ${target}`);
    process.exit(1);
  }

  const knownMarketplaces = await readKnownMarketplaces(paths);
  const existing = knownMarketplaces[parsed.name];
  if (existing) {
    if (existing.source.source === "github" && existing.source.repo === parsed.repo) {
      runGitCommand(["-C", existing.installLocation, "pull"]);
      knownMarketplaces[parsed.name] = {
        ...existing,
        lastUpdated: new Date().toISOString(),
      };
      await writeKnownMarketplaces(knownMarketplaces, paths);
      console.log(`Updated marketplace: ${parsed.name}`);
      return;
    }
    console.error(
      `Error: Marketplace "${parsed.name}" already exists with a different source`,
    );
    process.exit(1);
  }

  const marketplacesRoot = getMarketplacesRoot(paths);
  mkdirSync(marketplacesRoot, { recursive: true });
  const installLocation = join(marketplacesRoot, parsed.name);
  const repoUrl = `https://github.com/${parsed.repo}.git`;

  runGitCommand(["clone", repoUrl, installLocation]);
  await validateMarketplace(installLocation, target);

  knownMarketplaces[parsed.name] = {
    source: { source: "github", repo: parsed.repo },
    installLocation,
    lastUpdated: new Date().toISOString(),
  };

  await writeKnownMarketplaces(knownMarketplaces, paths);
  console.log(`Added marketplace: ${parsed.name}`);
}

export async function removeMarketplace(
  name: string,
  paths?: MarketplacePaths,
): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(paths);
  const marketplace = knownMarketplaces[name];
  if (!marketplace) {
    console.error(`Error: Marketplace "${name}" not found`);
    process.exit(1);
  }

  if (marketplace.source.source === "github") {
    rmSync(marketplace.installLocation, { recursive: true, force: true });
  }

  delete knownMarketplaces[name];
  await writeKnownMarketplaces(knownMarketplaces, paths);
  console.log(`Removed marketplace: ${name}`);
}

export async function updateMarketplace(
  name: string,
  paths?: MarketplacePaths,
): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(paths);
  const marketplace = knownMarketplaces[name];
  if (!marketplace) {
    console.error(`Error: Marketplace "${name}" not found`);
    process.exit(1);
  }

  if (marketplace.source.source !== "github") {
    console.log(`Skipping directory-based marketplace: ${name}`);
    return;
  }

  runGitCommand(["-C", marketplace.installLocation, "pull"]);
  knownMarketplaces[name] = {
    ...marketplace,
    lastUpdated: new Date().toISOString(),
  };
  await writeKnownMarketplaces(knownMarketplaces, paths);
  console.log(`Updated marketplace: ${name}`);
}

export async function updateAllMarketplaces(
  paths?: MarketplacePaths,
): Promise<void> {
  const knownMarketplaces = await readKnownMarketplaces(paths);
  const githubMarketplaces = Object.entries(knownMarketplaces).filter(
    ([, info]) => info.source.source === "github",
  );

  if (githubMarketplaces.length === 0) {
    console.log("No marketplaces to update.");
    return;
  }

  for (const [name] of githubMarketplaces) {
    await updateMarketplace(name, paths);
  }

  console.log(`Updated ${githubMarketplaces.length} marketplace(s)`);
}
