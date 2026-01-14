import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { expandEnvVariables, expandEnvInObject } from "./env-expansion";

describe("expandEnvVariables", () => {
  // Store original env values for cleanup
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Clear test env vars before each test
    const testVars = [
      "HOME",
      "UNSET_VAR_12345",
      "GREPTILE_API_KEY_TEST",
      "HOST_TEST",
      "PORT_TEST",
      "CLAUDE_PLUGIN_ROOT",
      "EMPTY_VAR_TEST",
    ];
    testVars.forEach((varName) => {
      originalEnv[varName] = process.env[varName];
      delete process.env[varName];
    });

    // Set HOME since it's typically always set
    process.env.HOME = "/home/testuser";
  });

  afterEach(() => {
    // Restore original env values
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  test("Test 1: Basic expansion with HOME variable", () => {
    process.env.HOME = "/home/testuser";
    const result = expandEnvVariables("HOME is ${HOME}");
    expect(result).toBe("HOME is /home/testuser");
  });

  test("Test 2: Default when variable is unset", () => {
    const result = expandEnvVariables("${UNSET_VAR_12345:-fallback}");
    expect(result).toBe("fallback");
  });

  test("Test 3: Default when variable is set (uses actual value)", () => {
    process.env.HOME = "/home/testuser";
    const result = expandEnvVariables("${HOME:-fallback}");
    expect(result).toBe("/home/testuser");
  });

  test("Test 4: Passthrough unset variable without default", () => {
    const result = expandEnvVariables("${GREPTILE_API_KEY_TEST}");
    expect(result).toBe("${GREPTILE_API_KEY_TEST}");
  });

  test("Test 5: Multiple variables with defaults", () => {
    process.env.HOST_TEST = "localhost";
    // PORT_TEST is left unset to test defaults
    const result = expandEnvVariables(
      "http://${HOST_TEST:-127.0.0.1}:${PORT_TEST:-8080}"
    );
    expect(result).toBe("http://localhost:8080");
  });

  test("Test 5b: Multiple variables all using defaults", () => {
    const result = expandEnvVariables(
      "http://${HOST_TEST:-127.0.0.1}:${PORT_TEST:-8080}"
    );
    expect(result).toBe("http://127.0.0.1:8080");
  });

  test("Test 6: LocalEnv override takes precedence", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/process/path";
    const localEnv = { CLAUDE_PLUGIN_ROOT: "/local/path" };
    const result = expandEnvVariables(
      "Plugin root is ${CLAUDE_PLUGIN_ROOT}",
      localEnv
    );
    expect(result).toBe("Plugin root is /local/path");
  });

  test("Test 6b: LocalEnv used when process.env is unset", () => {
    // Ensure CLAUDE_PLUGIN_ROOT is not in process.env
    const localEnv = { CLAUDE_PLUGIN_ROOT: "/local/path" };
    const result = expandEnvVariables(
      "Plugin root is ${CLAUDE_PLUGIN_ROOT}",
      localEnv
    );
    expect(result).toBe("Plugin root is /local/path");
  });

  test("Test 9: Empty default returns empty string", () => {
    const result = expandEnvVariables("${EMPTY_VAR_TEST:-}");
    expect(result).toBe("");
  });

  test("Test 10a: Invalid syntax - empty placeholder", () => {
    const result = expandEnvVariables("Value: ${}");
    expect(result).toBe("Value: ${}");
  });

  test("Test 10b: Invalid syntax - numeric variable name", () => {
    const result = expandEnvVariables("Value: ${123}");
    expect(result).toBe("Value: ${123}");
  });

  test("Test 10c: Invalid syntax - bare variable without braces", () => {
    process.env.BARE_VAR = "test";
    const result = expandEnvVariables("Value: $BARE_VAR");
    expect(result).toBe("Value: $BARE_VAR");
  });

  test("Test 11: Mixed valid and invalid syntax in same string", () => {
    process.env.VALID_VAR = "valid_value";
    const result = expandEnvVariables(
      "Start ${VALID_VAR} middle $INVALID end ${UNSET_12345:-default} finish"
    );
    expect(result).toBe(
      "Start valid_value middle $INVALID end default finish"
    );
  });

  test("Test: Variable with special characters in default", () => {
    const result = expandEnvVariables("${UNSET_SPECIAL:-/path/to/file}");
    expect(result).toBe("/path/to/file");
  });

  test("Test: Multiple occurrences of same variable", () => {
    process.env.REPEAT_VAR = "repeated";
    const result = expandEnvVariables("${REPEAT_VAR} and ${REPEAT_VAR}");
    expect(result).toBe("repeated and repeated");
  });

  test("Test: Nested braces in default value", () => {
    const result = expandEnvVariables('${UNSET_NESTED:-{"key":"value"}}');
    expect(result).toBe('{"key":"value"}');
  });

  test("Test: Empty string value from env var", () => {
    process.env.EMPTY_SET_VAR = "";
    const result = expandEnvVariables("Value: ${EMPTY_SET_VAR:-default}");
    expect(result).toBe("Value: ");
  });
});

describe("expandEnvInObject", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    const testVars = [
      "TEST_VAR",
      "NESTED_VAR",
      "ARRAY_VAR",
      "DEEP_VAR",
      "UNSET_OBJ_VAR",
    ];
    testVars.forEach((varName) => {
      originalEnv[varName] = process.env[varName];
      delete process.env[varName];
    });

    process.env.TEST_VAR = "test_value";
    process.env.NESTED_VAR = "nested_value";
    process.env.ARRAY_VAR = "array_value";
    process.env.DEEP_VAR = "deep_value";
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  test("Test 7: Nested object expansion with single variable", () => {
    const input = {
      name: "App",
      config: {
        path: "${TEST_VAR}",
      },
    };
    const result = expandEnvInObject(input);
    expect(result.config.path).toBe("test_value");
  });

  test("Test 7b: Deeply nested object expansion", () => {
    const input = {
      level1: {
        level2: {
          level3: {
            value: "${DEEP_VAR}",
          },
        },
      },
    };
    const result = expandEnvInObject(input);
    expect(result.level1.level2.level3.value).toBe("deep_value");
  });

  test("Test 7c: Multiple variables in nested object", () => {
    const input = {
      database: {
        host: "${NESTED_VAR:-localhost}",
        port: "${UNSET_OBJ_VAR:-5432}",
      },
    };
    const result = expandEnvInObject(input);
    expect(result.database.host).toBe("nested_value");
    expect(result.database.port).toBe("5432");
  });

  test("Test 8: Array expansion with variables", () => {
    const input = ["${TEST_VAR}", "${NESTED_VAR}", "${UNSET_OBJ_VAR:-default}"];
    const result = expandEnvInObject(input);
    expect(result[0]).toBe("test_value");
    expect(result[1]).toBe("nested_value");
    expect(result[2]).toBe("default");
  });

  test("Test 8b: Array of objects with variables", () => {
    const input = [
      { value: "${TEST_VAR}" },
      { value: "${NESTED_VAR}" },
      { value: "${UNSET_OBJ_VAR:-fallback}" },
    ];
    const result = expandEnvInObject(input);
    expect(result[0].value).toBe("test_value");
    expect(result[1].value).toBe("nested_value");
    expect(result[2].value).toBe("fallback");
  });

  test("Test: Mixed array and object structure", () => {
    const input = {
      items: [
        {
          name: "${TEST_VAR}",
          config: {
            value: "${NESTED_VAR}",
          },
        },
      ],
    };
    const result = expandEnvInObject(input);
    expect(result.items[0].name).toBe("test_value");
    expect(result.items[0].config.value).toBe("nested_value");
  });

  test("Test: LocalEnv override in object expansion", () => {
    process.env.TEST_VAR = "process_value";
    const localEnv = { TEST_VAR: "local_value" };
    const input = {
      value: "${TEST_VAR}",
    };
    const result = expandEnvInObject(input, localEnv);
    expect(result.value).toBe("local_value");
  });

  test("Test: Primitives are passed through unchanged", () => {
    expect(expandEnvInObject(42)).toBe(42);
    expect(expandEnvInObject(true)).toBe(true);
    expect(expandEnvInObject(false)).toBe(false);
    expect(expandEnvInObject(null)).toBe(null);
  });

  test("Test: Non-string values in object are preserved", () => {
    const input = {
      stringValue: "${TEST_VAR}",
      numberValue: 42,
      booleanValue: true,
      nullValue: null,
      undefinedValue: undefined,
    };
    const result = expandEnvInObject(input);
    expect(result.stringValue).toBe("test_value");
    expect(result.numberValue).toBe(42);
    expect(result.booleanValue).toBe(true);
    expect(result.nullValue).toBe(null);
    expect(result.undefinedValue).toBe(undefined);
  });

  test("Test: Empty object expansion", () => {
    const input = {};
    const result = expandEnvInObject(input);
    expect(result).toEqual({});
  });

  test("Test: Empty array expansion", () => {
    const input: string[] = [];
    const result = expandEnvInObject(input);
    expect(result).toEqual([]);
  });

  test("Test: Complex real-world config structure", () => {
    process.env.DB_HOST = "db.example.com";
    process.env.DB_PORT = "5432";
    process.env.API_KEY = "secret123";

    const input = {
      database: {
        host: "${DB_HOST}",
        port: "${DB_PORT}",
        username: "${DB_USER:-postgres}",
      },
      api: {
        endpoints: ["${API_KEY}", "${UNSET_ENDPOINT:-https://api.local}"],
      },
    };

    const result = expandEnvInObject(input);
    expect(result.database.host).toBe("db.example.com");
    expect(result.database.port).toBe("5432");
    expect(result.database.username).toBe("postgres");
    expect(result.api.endpoints[0]).toBe("secret123");
    expect(result.api.endpoints[1]).toBe("https://api.local");

    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.API_KEY;
  });
});
