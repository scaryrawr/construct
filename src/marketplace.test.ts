import { describe, expect, test, beforeEach } from "bun:test";
import { join } from "node:path";
import {
  addMarketplace,
  listMarketplaces,
  removeMarketplace,
  updateMarketplace,
  updateAllMarketplaces,
  type MarketplaceDependencies,
} from "./marketplace";
import { createMemoryFileSystem, MemoryFileSystem } from "./adapters/memory-file-system";
import { MockShell, createMockShell } from "./adapters/mock-shell";

interface KnownMarketplaceEntry {
  source: { source: "github" | "directory"; repo?: string; path?: string };
  installLocation: string;
  lastUpdated: string;
}

let deps: MarketplaceDependencies;
let memFs: MemoryFileSystem;
let mockShell: MockShell;
const knownMarketplacesPath = "/test/known_marketplaces.json";
const marketplacesRoot = "/test/marketplaces";

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

async function writeKnownMarketplaces(entries: Record<string, KnownMarketplaceEntry>): Promise<void> {
  await memFs.writeFile(knownMarketplacesPath, JSON.stringify(entries, null, 2));
}

async function readKnownMarketplaces(): Promise<Record<string, KnownMarketplaceEntry>> {
  const content = await memFs.readFile(knownMarketplacesPath);
  return JSON.parse(content);
}

async function createMarketplaceDir(name: string): Promise<string> {
  const installLocation = join(marketplacesRoot, name);
  await memFs.mkdir(join(installLocation, ".claude-plugin"), { recursive: true });
  await memFs.writeFile(
    join(installLocation, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name, plugins: [] }, null, 2),
  );
  return installLocation;
}

beforeEach(() => {
  memFs = createMemoryFileSystem().build();
  mockShell = createMockShell();
  deps = {
    knownMarketplacesPath,
    marketplacesRoot,
    fs: memFs,
    shell: mockShell,
  };
});

describe("marketplace", () => {
  test("listMarketplaces() prints all known marketplaces", async () => {
    const alphaLocation = await createMarketplaceDir("alpha");
    const betaLocation = await createMarketplaceDir("beta");
    await writeKnownMarketplaces({
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
      await listMarketplaces(deps);
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
      await listMarketplaces(deps);
    } finally {
      restore();
    }

    expect(messages[0]).toBe("No marketplaces configured.");
  });

  test("addMarketplace() parses full GitHub URL correctly", async () => {
    mockShell.setHandler((cmd) => {
      if (cmd[1] === "clone") {
        const installLocation = cmd[3];
        if (!installLocation) {
          throw new Error("Missing install location");
        }
        // Simulate git clone by creating the marketplace structure
        memFs.mkdirSync(join(installLocation, ".claude-plugin"), { recursive: true });
        memFs.writeFileSync(
          join(installLocation, ".claude-plugin", "marketplace.json"),
          JSON.stringify({ name: "repo-name", plugins: [] }, null, 2),
        );
      }
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    });

    await addMarketplace("https://github.com/owner/repo-name", deps);

    const known = await readKnownMarketplaces();
    const entry = known["repo-name"];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.source.repo).toBe("owner/repo-name");
  });

  test("addMarketplace() parses GitHub URL with .git suffix correctly", async () => {
    mockShell.setHandler((cmd) => {
      if (cmd[1] === "clone") {
        const installLocation = cmd[3];
        if (!installLocation) {
          throw new Error("Missing install location");
        }
        memFs.mkdirSync(join(installLocation, ".claude-plugin"), { recursive: true });
        memFs.writeFileSync(
          join(installLocation, ".claude-plugin", "marketplace.json"),
          JSON.stringify({ name: "repo-name", plugins: [] }, null, 2),
        );
      }
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    });

    await addMarketplace("https://github.com/owner/repo-name.git", deps);

    const known = await readKnownMarketplaces();
    const entry = known["repo-name"];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.source.repo).toBe("owner/repo-name");
  });

  test("addMarketplace() parses owner/repo shorthand correctly", async () => {
    mockShell.setHandler((cmd) => {
      if (cmd[1] === "clone") {
        const installLocation = cmd[3];
        if (!installLocation) {
          throw new Error("Missing install location");
        }
        memFs.mkdirSync(join(installLocation, ".claude-plugin"), { recursive: true });
        memFs.writeFileSync(
          join(installLocation, ".claude-plugin", "marketplace.json"),
          JSON.stringify({ name: "repo-name", plugins: [] }, null, 2),
        );
      }
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    });

    await addMarketplace("owner/repo-name", deps);

    const known = await readKnownMarketplaces();
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
      await expect(addMarketplace("invalid-input", deps)).rejects.toThrow(
        "process.exit:1",
      );
      expect(messages[0]).toBe("Error: Invalid marketplace: invalid-input");
    } finally {
      restoreExit();
      restore();
    }
  });

  test("addMarketplace() throws error when cloned repo has no marketplace.json", async () => {
    mockShell.setHandler((cmd) => {
      if (cmd[1] === "clone") {
        const installLocation = cmd[3];
        if (!installLocation) {
          throw new Error("Missing install location");
        }
        // Simulate git clone that creates directory but NO marketplace.json
        memFs.mkdirSync(installLocation, { recursive: true });
      }
      return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() };
    });

    await expect(addMarketplace("owner/invalid-repo", deps)).rejects.toThrow(
      "Invalid marketplace: owner/invalid-repo",
    );

    // Verify the invalid directory was cleaned up
    expect(await memFs.exists(join(marketplacesRoot, "invalid-repo"))).toBe(false);
  });

  test("addMarketplace() updates existing marketplace instead of erroring", async () => {
    const installLocation = await createMarketplaceDir("repo-name");
    await writeKnownMarketplaces({
      "repo-name": {
        source: { source: "github", repo: "owner/repo-name" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await addMarketplace("owner/repo-name", deps);

    expect(mockShell.calls[0]?.cmd).toEqual(["git", "-C", installLocation, "pull"]);
    const updated = await readKnownMarketplaces();
    const entry = updated["repo-name"];
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
  });

  test("removeMarketplace() deletes git-cloned marketplace from disk", async () => {
    const installLocation = await createMarketplaceDir("to-remove");
    await writeKnownMarketplaces({
      "to-remove": {
        source: { source: "github", repo: "owner/to-remove" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await removeMarketplace("to-remove", deps);
    expect(await memFs.exists(installLocation)).toBe(false);
  });

  test("removeMarketplace() preserves directory-based marketplace on disk", async () => {
    const installLocation = await createMarketplaceDir("local");
    await writeKnownMarketplaces({
      local: {
        source: { source: "directory", path: installLocation },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await removeMarketplace("local", deps);
    expect(await memFs.exists(installLocation)).toBe(true);
  });

  test("removeMarketplace() removes entry from known_marketplaces.json", async () => {
    const installLocation = await createMarketplaceDir("remove-entry");
    await writeKnownMarketplaces({
      "remove-entry": {
        source: { source: "github", repo: "owner/remove-entry" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await removeMarketplace("remove-entry", deps);
    const known = await readKnownMarketplaces();
    expect(known["remove-entry"]).toBeUndefined();
  });

  test("removeMarketplace() errors when marketplace not found", async () => {
    const restoreExit = mockProcessExit();
    const { messages, restore } = captureConsole("error");
    try {
      await expect(removeMarketplace("missing", deps)).rejects.toThrow(
        "process.exit:1",
      );
      expect(messages[0]).toBe('Error: Marketplace "missing" not found');
    } finally {
      restoreExit();
      restore();
    }
  });

  test("updateMarketplace() runs git pull on github marketplace", async () => {
    const installLocation = await createMarketplaceDir("update-me");
    await writeKnownMarketplaces({
      "update-me": {
        source: { source: "github", repo: "owner/update-me" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await updateMarketplace("update-me", deps);

    expect(mockShell.calls[0]?.cmd).toEqual(["git", "-C", installLocation, "pull"]);
  });

  test("updateMarketplace() skips directory-based marketplace", async () => {
    const installLocation = await createMarketplaceDir("skip-me");
    await writeKnownMarketplaces({
      "skip-me": {
        source: { source: "directory", path: installLocation },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    const { messages, restore } = captureConsole("log");
    try {
      await updateMarketplace("skip-me", deps);
    } finally {
      restore();
    }

    expect(messages[0]).toBe("Skipping directory-based marketplace: skip-me");
  });

  test("updateMarketplace() updates lastUpdated timestamp", async () => {
    const installLocation = await createMarketplaceDir("timestamp");
    await writeKnownMarketplaces({
      timestamp: {
        source: { source: "github", repo: "owner/timestamp" },
        installLocation,
        lastUpdated: "2025-01-01T00:00:00.000Z",
      },
    });

    await updateMarketplace("timestamp", deps);

    const known = await readKnownMarketplaces();
    const entry = known.timestamp;
    expect(entry).toBeDefined();
    if (!entry) {
      throw new Error("Missing marketplace entry");
    }
    expect(entry.lastUpdated).not.toBe("2025-01-01T00:00:00.000Z");
  });

  test("updateAllMarketplaces() updates all git-based marketplaces", async () => {
    const alphaLocation = await createMarketplaceDir("alpha");
    const betaLocation = await createMarketplaceDir("beta");
    await writeKnownMarketplaces({
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

    const { messages, restore } = captureConsole("log");
    try {
      await updateAllMarketplaces(deps);
    } finally {
      restore();
    }

    expect(mockShell.calls.map((c) => c.cmd)).toEqual([["git", "-C", alphaLocation, "pull"]]);
    expect(messages).toContain("Updated 1 marketplace(s)");
  });
});
