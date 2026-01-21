import { describe, expect, it } from "bun:test";
import { loadConfig, saveConfig, mergeCliWithConfig } from "./config";
import type { ConfigDependencies } from "./config";
import { createMemoryFileSystem } from "./adapters/memory-file-system";
import { createMockProcess } from "./adapters/mock-process";

function createTestDeps(
  files: Record<string, string> = {},
  cwd = "/project"
): ConfigDependencies {
  const builder = createMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) {
    builder.withFile(path, content);
  }
  return {
    fs: builder.build(),
    process: createMockProcess({ cwd }),
  };
}

describe("loadConfig", () => {
  it("returns null when file doesn't exist", async () => {
    const deps = createTestDeps({}, "/project");
    const result = await loadConfig(deps);
    expect(result).toBeNull();
  });

  it("returns parsed config when valid", async () => {
    const config = {
      enabledPlugins: ["plugin1@marketplace", "plugin2@marketplace"],
      lastUsed: "2024-01-15T10:30:00Z",
    };
    const deps = createTestDeps(
      { "/project/.construct.json": JSON.stringify(config) },
      "/project"
    );

    const result = await loadConfig(deps);

    expect(result).toEqual(config);
  });

  it("returns null when invalid JSON", async () => {
    const deps = createTestDeps(
      { "/project/.construct.json": "{ invalid json }" },
      "/project"
    );

    const result = await loadConfig(deps);

    expect(result).toBeNull();
  });

  it("returns null when config structure is invalid", async () => {
    const deps = createTestDeps(
      { "/project/.construct.json": JSON.stringify({ foo: "bar" }) },
      "/project"
    );

    const result = await loadConfig(deps);

    expect(result).toBeNull();
  });

  it("returns null when enabledPlugins is not an array", async () => {
    const deps = createTestDeps(
      {
        "/project/.construct.json": JSON.stringify({
          enabledPlugins: "not-an-array",
          lastUsed: "2024-01-15",
        }),
      },
      "/project"
    );

    const result = await loadConfig(deps);

    expect(result).toBeNull();
  });

  it("returns null when lastUsed is not a string", async () => {
    const deps = createTestDeps(
      {
        "/project/.construct.json": JSON.stringify({
          enabledPlugins: [],
          lastUsed: 12345,
        }),
      },
      "/project"
    );

    const result = await loadConfig(deps);

    expect(result).toBeNull();
  });
});

describe("saveConfig", () => {
  it("writes correct JSON to file", async () => {
    const fs = createMemoryFileSystem().withDirectory("/project").build();
    const process = createMockProcess({ cwd: "/project" });
    const deps: ConfigDependencies = { fs, process };

    const config = {
      enabledPlugins: ["plugin1@marketplace"],
      lastUsed: "2024-01-15T10:30:00Z",
    };

    await saveConfig(config, deps);

    const content = await fs.readFile("/project/.construct.json");
    expect(JSON.parse(content)).toEqual(config);
  });

  it("formats JSON with 2-space indentation", async () => {
    const fs = createMemoryFileSystem().withDirectory("/project").build();
    const process = createMockProcess({ cwd: "/project" });
    const deps: ConfigDependencies = { fs, process };

    const config = {
      enabledPlugins: ["plugin1@marketplace"],
      lastUsed: "2024-01-15T10:30:00Z",
    };

    await saveConfig(config, deps);

    const content = await fs.readFile("/project/.construct.json");
    expect(content).toBe(JSON.stringify(config, null, 2));
  });

  it("overwrites existing config", async () => {
    const fs = createMemoryFileSystem()
      .withFile(
        "/project/.construct.json",
        JSON.stringify({ enabledPlugins: ["old"], lastUsed: "old" })
      )
      .build();
    const process = createMockProcess({ cwd: "/project" });
    const deps: ConfigDependencies = { fs, process };

    const newConfig = {
      enabledPlugins: ["new@marketplace"],
      lastUsed: "2024-01-16T10:30:00Z",
    };

    await saveConfig(newConfig, deps);

    const content = await fs.readFile("/project/.construct.json");
    expect(JSON.parse(content)).toEqual(newConfig);
  });
});

describe("mergeCliWithConfig", () => {
  it("returns CLI plugins when provided", () => {
    const cliPlugins = ["cli-plugin@marketplace"];
    const savedConfig = {
      enabledPlugins: ["saved-plugin@marketplace"],
      lastUsed: "2024-01-15",
    };

    const result = mergeCliWithConfig(cliPlugins, savedConfig);

    expect(result).toEqual(cliPlugins);
  });

  it("returns saved config plugins when CLI plugins empty", () => {
    const cliPlugins: string[] = [];
    const savedConfig = {
      enabledPlugins: ["saved-plugin@marketplace"],
      lastUsed: "2024-01-15",
    };

    const result = mergeCliWithConfig(cliPlugins, savedConfig);

    expect(result).toEqual(savedConfig.enabledPlugins);
  });

  it("returns empty array when no CLI plugins and no saved config", () => {
    const result = mergeCliWithConfig([], null);

    expect(result).toEqual([]);
  });

  it("returns empty array when no CLI plugins and saved config has no plugins", () => {
    const savedConfig = {
      enabledPlugins: [],
      lastUsed: "2024-01-15",
    };

    const result = mergeCliWithConfig([], savedConfig);

    expect(result).toEqual([]);
  });

  it("CLI plugins take precedence over saved config", () => {
    const cliPlugins = ["a@m", "b@m"];
    const savedConfig = {
      enabledPlugins: ["c@m", "d@m"],
      lastUsed: "2024-01-15",
    };

    const result = mergeCliWithConfig(cliPlugins, savedConfig);

    expect(result).toEqual(["a@m", "b@m"]);
  });
});
