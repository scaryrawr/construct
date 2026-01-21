import { describe, expect, test } from "bun:test";
import { MemoryFileSystem, createMemoryFileSystem } from "./memory-file-system";

describe("MemoryFileSystem", () => {
  describe("writeFileSync", () => {
    test("writes file content synchronously", async () => {
      const fs = new MemoryFileSystem();

      fs.writeFileSync("/test/file.txt", "hello world");

      expect(await fs.readFile("/test/file.txt")).toBe("hello world");
    });

    test("creates parent directories automatically", async () => {
      const fs = new MemoryFileSystem();

      fs.writeFileSync("/deep/nested/path/file.txt", "content");

      expect(await fs.exists("/deep")).toBe(true);
      expect(await fs.exists("/deep/nested")).toBe(true);
      expect(await fs.exists("/deep/nested/path")).toBe(true);
      expect(await fs.readFile("/deep/nested/path/file.txt")).toBe("content");
    });

    test("overwrites existing file", async () => {
      const fs = new MemoryFileSystem();

      fs.writeFileSync("/file.txt", "original");
      fs.writeFileSync("/file.txt", "updated");

      expect(await fs.readFile("/file.txt")).toBe("updated");
    });
  });

  describe("mkdirSync", () => {
    test("creates directory synchronously", async () => {
      const fs = new MemoryFileSystem();

      fs.mkdirSync("/newdir");

      expect(await fs.exists("/newdir")).toBe(true);
    });

    test("creates nested directories with recursive option", async () => {
      const fs = new MemoryFileSystem();

      fs.mkdirSync("/a/b/c/d", { recursive: true });

      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a/b/c")).toBe(true);
      expect(await fs.exists("/a/b/c/d")).toBe(true);
    });

    test("throws error without recursive when parent doesn't exist", () => {
      const fs = new MemoryFileSystem();

      expect(() => fs.mkdirSync("/parent/child")).toThrow("ENOENT");
    });

    test("silently succeeds when directory already exists", async () => {
      const fs = new MemoryFileSystem();

      fs.mkdirSync("/existing", { recursive: true });
      fs.mkdirSync("/existing", { recursive: true }); // Should not throw

      expect(await fs.exists("/existing")).toBe(true);
    });
  });

  describe("sync methods work together in mock handlers", () => {
    test("simulates git clone behavior", async () => {
      const fs = new MemoryFileSystem();

      // Simulate what a shell mock handler would do
      const installLocation = "/test/marketplaces/my-repo";
      fs.mkdirSync(`${installLocation}/.claude-plugin`, { recursive: true });
      fs.writeFileSync(
        `${installLocation}/.claude-plugin/marketplace.json`,
        JSON.stringify({ name: "my-repo", plugins: [] }),
      );

      // Verify the structure was created correctly
      expect(await fs.exists(installLocation)).toBe(true);
      expect(await fs.exists(`${installLocation}/.claude-plugin`)).toBe(true);
      const content = await fs.readFile(
        `${installLocation}/.claude-plugin/marketplace.json`,
      );
      expect(JSON.parse(content)).toEqual({ name: "my-repo", plugins: [] });
    });
  });
});
