import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enablePlugin, disablePlugin, listEnabledPlugins } from "./plugin";

let tempRoot: string;
let originalCwd: string;
let originalHome: string | undefined;

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

beforeEach(() => {
  tempRoot = join(tmpdir(), `construct-plugin-test-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });

  originalCwd = process.cwd();
  originalHome = process.env.HOME;

  const homeDir = join(tempRoot, "home");
  const workDir = join(tempRoot, "work");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  process.env.HOME = homeDir;
  process.chdir(workDir);

  const marketplaceDir = join(
    homeDir,
    ".claude",
    "plugins",
    "marketplaces",
    "test-marketplace",
  );
  mkdirSync(join(marketplaceDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(marketplaceDir, "tmux"), { recursive: true });
  writeFileSync(
    join(marketplaceDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      {
        name: "test-marketplace",
        plugins: [{ name: "tmux", source: "tmux", version: "1.0.0" }],
      },
      null,
      2,
    ),
  );

  const knownMarketplacesPath = join(
    homeDir,
    ".claude",
    "plugins",
    "known_marketplaces.json",
  );
  mkdirSync(join(homeDir, ".claude", "plugins"), { recursive: true });
  writeFileSync(
    knownMarketplacesPath,
    JSON.stringify(
      {
        "test-marketplace": {
          source: { source: "github", repo: "owner/test-marketplace" },
          installLocation: marketplaceDir,
          lastUpdated: new Date().toISOString(),
        },
      },
      null,
      2,
    ),
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("plugin", () => {
  test("enablePlugin() adds plugin to .construct.json when plugin exists", async () => {
    await enablePlugin("tmux@test-marketplace");

    const configPath = join(process.cwd(), ".construct.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    expect(config.enabledPlugins).toEqual(["tmux@test-marketplace"]);
  });

  test("enablePlugin() exits with error when plugin not found", async () => {
    const restoreExit = mockProcessExit();
    const { messages, restore } = captureConsole("error");
    try {
      await expect(enablePlugin("missing@test-marketplace")).rejects.toThrow(
        "process.exit:1",
      );
      expect(messages[0]).toBe(
        'Error: Plugin "missing@test-marketplace" not found in any known marketplace',
      );
    } finally {
      restoreExit();
      restore();
    }
  });

  test("enablePlugin() is idempotent (no duplicate entries)", async () => {
    await enablePlugin("tmux@test-marketplace");
    await enablePlugin("tmux@test-marketplace");

    const configPath = join(process.cwd(), ".construct.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    expect(config.enabledPlugins).toEqual(["tmux@test-marketplace"]);
  });

  test("disablePlugin() removes plugin from .construct.json", async () => {
    const configPath = join(process.cwd(), ".construct.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          enabledPlugins: ["tmux@test-marketplace"],
          lastUsed: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    await disablePlugin("tmux@test-marketplace");

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.enabledPlugins).toEqual([]);
  });

  test("disablePlugin() handles missing .construct.json gracefully", async () => {
    await disablePlugin("tmux@test-marketplace");
    expect(existsSync(join(process.cwd(), ".construct.json"))).toBe(false);
  });

  test("disablePlugin() handles plugin not in config gracefully", async () => {
    const configPath = join(process.cwd(), ".construct.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          enabledPlugins: ["other@test-marketplace"],
          lastUsed: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    await disablePlugin("tmux@test-marketplace");

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.enabledPlugins).toEqual(["other@test-marketplace"]);
  });

  test("listEnabledPlugins() prints all enabled plugins from .construct.json", async () => {
    const configPath = join(process.cwd(), ".construct.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          enabledPlugins: [
            "tmux@test-marketplace",
            "playwright@test-marketplace",
          ],
          lastUsed: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    const { messages, restore } = captureConsole("log");
    try {
      await listEnabledPlugins();
    } finally {
      restore();
    }

    expect(messages).toEqual([
      "Enabled plugins:",
      "  tmux@test-marketplace",
      "  playwright@test-marketplace",
    ]);
  });

  test("listEnabledPlugins() handles missing .construct.json gracefully", async () => {
    const { messages, restore } = captureConsole("log");
    try {
      await listEnabledPlugins();
    } finally {
      restore();
    }

    expect(messages).toEqual(["No plugins enabled."]);
  });

  test("listEnabledPlugins() handles empty enabledPlugins array", async () => {
    const configPath = join(process.cwd(), ".construct.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          enabledPlugins: [],
          lastUsed: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    const { messages, restore } = captureConsole("log");
    try {
      await listEnabledPlugins();
    } finally {
      restore();
    }

    expect(messages).toEqual(["No plugins enabled."]);
  });
});
