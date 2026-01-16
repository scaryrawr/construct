import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  addMarketplace,
  listMarketplaces,
  removeMarketplace,
  updateMarketplace,
  updateAllMarketplaces,
  type MarketplacePaths,
} from "./marketplace";

interface KnownMarketplaceEntry {
  source: { source: "github" | "directory"; repo?: string; path?: string };
  installLocation: string;
  lastUpdated: string;
}

let tempRoot: string;
let paths: MarketplacePaths;

function mockProcessExit(): () => void {
  const originalExit = process.exit;
  (process as { exit: typeof process.exit }).exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;
  return () => {
    (process as { exit: typeof process.exit }).exit = originalExit;
  };
}

function captureConsole(method: "log" | "error"): {
  messages: string[];
  restore: () => void;
} {
  const messages: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  return {
    messages,
    restore: () => {
      console[method] = original;
    },
  };
}

function mockSpawnSync(
  handler: (cmd: string[]) => { exitCode: number; stdout?: Uint8Array; stderr?: Uint8Array },
): () => void {
  const original = Bun.spawnSync;
  (Bun as { spawnSync: typeof Bun.spawnSync }).spawnSync = ((cmd: string[]) =>
    handler(cmd)) as typeof Bun.spawnSync;
  return () => {
    (Bun as { spawnSync: typeof Bun.spawnSync }).spawnSync = original;
  };
}

function getKnownMarketplacesPath(): string {
  if (!paths.knownMarketplacesPath) {
    throw new Error("Missing known marketplaces path");
  }
  return paths.knownMarketplacesPath;
}

function writeKnownMarketplaces(entries: Record<string, KnownMarketplaceEntry>): void {
  const path = getKnownMarketplacesPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(entries, null, 2));
}

function readKnownMarketplaces(): Record<string, KnownMarketplaceEntry> {
  const content = readFileSync(getKnownMarketplacesPath(), "utf-8");
  return JSON.parse(content);
}

function createMarketplaceDir(name: string): string {
  if (!paths.marketplacesRoot) {
    throw new Error("Missing marketplaces root");
  }
  const installLocation = join(paths.marketplacesRoot, name);
  mkdirSync(join(installLocation, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(installLocation, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name, plugins: [] }, null, 2),
  );
  return installLocation;
}

beforeEach(() => {
  tempRoot = join(tmpdir(), `construct-marketplace-test-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });
  paths = {
    knownMarketplacesPath: join(tempRoot, "known_marketplaces.json"),
    marketplacesRoot: join(tempRoot, "marketplaces"),
  };
});

afterEach(() => {
  if (existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("marketplace", () => {
  test("listMarketplaces() prints all known marketplaces", async () => {
    const alphaLocation = createMarketplaceDir("alpha");
    const betaLocation = createMarketplaceDir("beta");
    writeKnownMarketplaces({
      alpha: {
        source: { source: "github", repo: "owner/alpha" },
        installLocation: alphaLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
      beta: {
        source: { source: "directory", path: "/tmp/beta" },
        installLocation: betaLocation,
        lastUpdated: "2025-01-02T00:00:00.000Z",
      },
    });

    const { messages, restore } = captureConsole("log");
    try {
      await listMarketplaces(paths);
    } finally {
      restore();
    }

    expect(messages[0]).toBe("Known marketplaces:");
    expect(messages).toContain("  alpha (github)");
    expect(messages).toContain("  beta (directory)");
  });

  test("listMarketplaces() handles missing known_marketplaces.json", async () => {
    const { messages, restore } = captureConsole("log");
    try {
      await listMarketplaces(paths);
    } finally {
      restore();
    }

    expect(messages[0]).toBe("No marketplaces configured.");
  });

  test("addMarketplace() parses full GitHub URL correctly", async () => {
    const restoreSpawn = mockSpawnSync((cmd) => {
      if (cmd[1] === "clone") {
        const installLocation = cmd[3];
        if (!installLocation) {
          throw new Error("Missing install location");
        }
        mkdirSync(join(installLocation, ".claude-plugin"), { recursive: true });
        writeFileSync(
          join(installLocation, ".claude-plugin", "marketplace.json"),
          JSON.stringify({ name: "repo-name", plugins: [] }, null, 2),
        );
      }
      return { exitCode: 0 };
    });

    try {
      await addMarketplace("https://github.com/owner/repo-name", paths);
    } finally {
      restoreSpawn();
    }

    const known = readKnownMarketplaces();
    const entry = known["repo-name"];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.source.repo).toBe("owner/repo-name");
  });

  test("addMarketplace() parses owner/repo shorthand correctly", async () => {
    const restoreSpawn = mockSpawnSync((cmd) => {
      if (cmd[1] === "clone") {
        const installLocation = cmd[3];
        if (!installLocation) {
          throw new Error("Missing install location");
        }
        mkdirSync(join(installLocation, ".claude-plugin"), { recursive: true });
        writeFileSync(
          join(installLocation, ".claude-plugin", "marketplace.json"),
          JSON.stringify({ name: "repo-name", plugins: [] }, null, 2),
        );
      }
      return { exitCode: 0 };
    });

    try {
      await addMarketplace("owner/repo-name", paths);
    } finally {
      restoreSpawn();
    }

    const known = readKnownMarketplaces();
    const entry = known["repo-name"];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.source.repo).toBe("owner/repo-name");
  });

  test("addMarketplace() rejects invalid input", async () => {
    const restoreExit = mockProcessExit();
    const { messages, restore } = captureConsole("error");
    try {
      await expect(addMarketplace("invalid-input", paths)).rejects.toThrow(
        "process.exit:1",
      );
      expect(messages[0]).toBe("Error: Invalid marketplace: invalid-input");
    } finally {
      restoreExit();
      restore();
    }
  });

  test("addMarketplace() updates existing marketplace instead of erroring", async () => {
    const installLocation = createMarketplaceDir("repo-name");
    writeKnownMarketplaces({
      "repo-name": {
        source: { source: "github", repo: "owner/repo-name" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    const calls: string[][] = [];
    const restoreSpawn = mockSpawnSync((cmd) => {
      calls.push(cmd);
      return { exitCode: 0 };
    });

    try {
      await addMarketplace("owner/repo-name", paths);
    } finally {
      restoreSpawn();
    }

    expect(calls[0]).toEqual(["git", "-C", installLocation, "pull"]);
    const updated = readKnownMarketplaces();
    const entry = updated["repo-name"];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.lastUpdated).not.toBe("2025-01-01T00:00:00.000Z");
  });

  test("removeMarketplace() deletes git-cloned marketplace from disk", async () => {
    const installLocation = createMarketplaceDir("to-remove");
    writeKnownMarketplaces({
      "to-remove": {
        source: { source: "github", repo: "owner/to-remove" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await removeMarketplace("to-remove", paths);
    expect(existsSync(installLocation)).toBe(false);
  });

  test("removeMarketplace() preserves directory-based marketplace on disk", async () => {
    const installLocation = createMarketplaceDir("local");
    writeKnownMarketplaces({
      local: {
        source: { source: "directory", path: installLocation },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await removeMarketplace("local", paths);
    expect(existsSync(installLocation)).toBe(true);
  });

  test("removeMarketplace() removes entry from known_marketplaces.json", async () => {
    const installLocation = createMarketplaceDir("remove-entry");
    writeKnownMarketplaces({
      "remove-entry": {
        source: { source: "github", repo: "owner/remove-entry" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await removeMarketplace("remove-entry", paths);
    const known = readKnownMarketplaces();
    expect(known["remove-entry"]).toBeUndefined();
  });

  test("removeMarketplace() errors when marketplace not found", async () => {
    const restoreExit = mockProcessExit();
    const { messages, restore } = captureConsole("error");
    try {
      await expect(removeMarketplace("missing", paths)).rejects.toThrow(
        "process.exit:1",
      );
      expect(messages[0]).toBe('Error: Marketplace "missing" not found');
    } finally {
      restoreExit();
      restore();
    }
  });

  test("updateMarketplace() runs git pull on github marketplace", async () => {
    const installLocation = createMarketplaceDir("update-me");
    writeKnownMarketplaces({
      "update-me": {
        source: { source: "github", repo: "owner/update-me" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    const calls: string[][] = [];
    const restoreSpawn = mockSpawnSync((cmd) => {
      calls.push(cmd);
      return { exitCode: 0 };
    });

    try {
      await updateMarketplace("update-me", paths);
    } finally {
      restoreSpawn();
    }

    expect(calls[0]).toEqual(["git", "-C", installLocation, "pull"]);
  });

  test("updateMarketplace() skips directory-based marketplace", async () => {
    const installLocation = createMarketplaceDir("skip-me");
    writeKnownMarketplaces({
      "skip-me": {
        source: { source: "directory", path: installLocation },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    const { messages, restore } = captureConsole("log");
    try {
      await updateMarketplace("skip-me", paths);
    } finally {
      restore();
    }

    expect(messages[0]).toBe("Skipping directory-based marketplace: skip-me");
  });

  test("updateMarketplace() updates lastUpdated timestamp", async () => {
    const installLocation = createMarketplaceDir("timestamp");
    writeKnownMarketplaces({
      timestamp: {
        source: { source: "github", repo: "owner/timestamp" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    const restoreSpawn = mockSpawnSync(() => ({ exitCode: 0 }));
    try {
      await updateMarketplace("timestamp", paths);
    } finally {
      restoreSpawn();
    }

    const known = readKnownMarketplaces();
    const entry = known.timestamp;
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.lastUpdated).not.toBe("2025-01-01T00:00:00.000Z");
  });

  test("updateAllMarketplaces() updates all git-based marketplaces", async () => {
    const alphaLocation = createMarketplaceDir("alpha");
    const betaLocation = createMarketplaceDir("beta");
    writeKnownMarketplaces({
      alpha: {
        source: { source: "github", repo: "owner/alpha" },
        installLocation: alphaLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
      beta: {
        source: { source: "directory", path: betaLocation },
        installLocation: betaLocation,
        lastUpdated: "2025-01-02T00:00:00.000Z",
      },
    });

    const calls: string[][] = [];
    const restoreSpawn = mockSpawnSync((cmd) => {
      calls.push(cmd);
      return { exitCode: 0 };
    });

    const { messages, restore } = captureConsole("log");
    try {
      await updateAllMarketplaces(paths);
    } finally {
      restoreSpawn();
      restore();
    }

    expect(calls).toEqual([["git", "-C", alphaLocation, "pull"]]);
    expect(messages).toContain("Updated 1 marketplace(s)");
  });

  test("updateAllMarketplaces() prints message when no GitHub marketplaces found", async () => {
    writeKnownMarketplaces({
      local: {
        source: { source: "directory", path: "/some/path" },
        installLocation: "/some/path",
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    const { messages, restore } = captureConsole("log");
    try {
      await updateAllMarketplaces(paths);
    } finally {
      restore();
    }

    expect(messages).toContain("No marketplaces to update.");
  });
});
