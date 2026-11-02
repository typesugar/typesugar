/**
 * Config-file loading, env mapping and condition evaluation
 * (deep review 2026-10, findings core #16 #19 #20 #34 #35 #36 #37 #51 #52 #53).
 *
 * Every test here loads REAL config files from a temp directory through the
 * real cosmiconfig + loader path; nothing is mocked except where noted
 * (#53, which needs an old-Node runtime shape).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { config } from "../src/config.js";
import { evaluateConfigCondition, ConfigConditionError } from "../src/config-condition.js";

let tmpRoot: string;
let originalCwd: string;
let savedEnv: Record<string, string | undefined>;

function write(rel: string, content: string): string {
  const p = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

beforeEach(() => {
  // realpath: macOS's os.tmpdir() is a /var → /private/var symlink.
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-config-")));
  // A `.git` marker bounds the upward search, so a stray config file in
  // a parent of os.tmpdir() can't leak into these tests.
  fs.mkdirSync(path.join(tmpRoot, ".git"));
  originalCwd = process.cwd();
  savedEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("TYPESUGAR_")) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
  config.reset();
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("TYPESUGAR_")) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  config.reset();
  vi.restoreAllMocks();
  try {
    fs.chmodSync(tmpRoot, 0o755);
  } catch {
    /* already removed */
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const TS_CONFIG = `const cfg: { security: { allowedMacroPackages: string[] } } = {
  security: { allowedMacroPackages: ["foo-macros"] },
};
export default cfg;
`;

describe("#16/#51 condition evaluation", () => {
  const lookup = (values: Record<string, unknown>) => (p: string) =>
    p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], values);

  it("accepts === and !== (the documented cfg form)", () => {
    const l = lookup({ platform: "node", env: "prod" });
    expect(evaluateConfigCondition("platform === 'node'", l)).toBe(true);
    expect(evaluateConfigCondition("env !== 'dev'", l)).toBe(true);
    expect(evaluateConfigCondition("platform === 'web' || platform === 'node'", l)).toBe(true);
    expect(evaluateConfigCondition("platform == 'node'", l)).toBe(true);
  });

  it("config.evaluate accepts ===, unquoted literals, and keeps legacy forms", () => {
    config.set({ contracts: { mode: "full" }, debug: true, level: 2 } as never);
    expect(config.evaluate(`contracts.mode === "full"`)).toBe(true);
    expect(config.evaluate("debug == true")).toBe(true);
    expect(config.evaluate("level == 2")).toBe(true);
    expect(config.evaluate("contracts.mode != 'none' && !features.x")).toBe(true);
    expect(config.when("contracts.mode === 'full'", "A", "B")).toBe("A");
  });

  it("a missing key is not equal to the string 'undefined'", () => {
    expect(config.evaluate("nonexistent == 'undefined'")).toBe(false);
    expect(config.evaluate("nonexistent == undefined")).toBe(true);
  });

  it("does not split || / && inside quoted strings", () => {
    const l = lookup({ sep: "a||b" });
    expect(evaluateConfigCondition("sep == 'a||b'", l)).toBe(true);
  });

  it("throws on an unparseable condition instead of silently returning false", () => {
    expect(() => config.evaluate("contracts.mode > 'full'")).toThrow(ConfigConditionError);
    expect(() => config.evaluate("debug &&")).toThrow(ConfigConditionError);
    expect(() => config.evaluate("platform = 'node'")).toThrow(ConfigConditionError);
  });
});

describe("#19 cosmiconfig is a real dependency of @typesugar/core", () => {
  it("is declared in dependencies (not only in the private workspace root)", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.cosmiconfig).toMatch(/^\^9\./);
  });
});

describe("#20 config-load failures are visible", () => {
  it("records and warns about a config file that throws", () => {
    const file = write("typesugar.config.ts", `throw new Error("boom");\nexport default {};\n`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    config.load({ searchFrom: tmpRoot });
    const err = config.getLoadError();
    expect(err?.kind).toBe("failed");
    expect(err?.filepath).toBe(file);
    expect(err?.message).toContain("boom");
    expect(warn.mock.calls.some(([m]) => String(m).includes(file))).toBe(true);
  });

  it("has no load error for a good config", () => {
    write("typesugar.config.ts", TS_CONFIG);
    config.load({ searchFrom: tmpRoot });
    expect(config.getLoadError()).toBeUndefined();
    expect(config.get("security.allowedMacroPackages")).toEqual(["foo-macros"]);
  });
});

describe("#34 .ts config is evaluated in memory", () => {
  it("loads from a read-only directory and leaves no temp files behind", () => {
    const dir = path.join(tmpRoot, "ro");
    write("ro/typesugar.config.ts", TS_CONFIG);
    fs.chmodSync(dir, 0o555);
    try {
      config.load({ searchFrom: dir });
      expect(config.getLoadError()).toBeUndefined();
      expect(config.getConfigFilePath()).toBe(path.join(dir, "typesugar.config.ts"));
      expect(config.get("security.allowedMacroPackages")).toEqual(["foo-macros"]);
      expect(fs.readdirSync(dir)).toEqual(["typesugar.config.ts"]);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it("re-reads an edited file on reload (no module cache)", () => {
    write("typesugar.config.ts", TS_CONFIG);
    config.load({ searchFrom: tmpRoot });
    write("typesugar.config.ts", TS_CONFIG.replace("foo-macros", "bar-macros"));
    config.load({ searchFrom: tmpRoot });
    expect(config.get("security.allowedMacroPackages")).toEqual(["bar-macros"]);
  });
});

describe("#35 config is found by walking up from the search directory", () => {
  it("finds a config in a parent directory", () => {
    const file = write("typesugar.config.ts", TS_CONFIG);
    fs.mkdirSync(path.join(tmpRoot, "packages", "app"), { recursive: true });
    config.load({ searchFrom: path.join(tmpRoot, "packages", "app") });
    expect(config.getConfigFilePath()).toBe(file);
  });

  it("the default (no load() call) searches upward from process.cwd()", () => {
    const file = write("typesugar.config.ts", TS_CONFIG);
    fs.mkdirSync(path.join(tmpRoot, "sub"));
    process.chdir(path.join(tmpRoot, "sub"));
    expect(config.getConfigFilePath()).toBe(file);
  });

  it("load() switches projects; the nearest config wins", () => {
    write("typesugar.config.ts", TS_CONFIG);
    const inner = write(
      "packages/b/typesugar.config.ts",
      `export default { security: { allowedMacroPackages: ["b-macros"] } };\n`
    );
    config.load({ searchFrom: path.join(tmpRoot, "packages", "b") });
    expect(config.getConfigFilePath()).toBe(inner);
    expect(config.get("security.allowedMacroPackages")).toEqual(["b-macros"]);
    config.load({ searchFrom: tmpRoot });
    expect(config.get("security.allowedMacroPackages")).toEqual(["foo-macros"]);
  });
});

describe("#36 ESM .js config in a type:module project", () => {
  it("uses the default export, not the module namespace", () => {
    write("package.json", JSON.stringify({ type: "module" }));
    write(
      "typesugar.config.js",
      `export default { security: { allowedMacroPackages: ["foo-macros"] } };\n`
    );
    config.load({ searchFrom: tmpRoot });
    expect(config.getLoadError()).toBeUndefined();
    expect(config.get("security.allowedMacroPackages")).toEqual(["foo-macros"]);
    expect(config.get("default")).toBeUndefined();
    expect(config.get("__esModule")).toBeUndefined();
  });

  it("still loads a CommonJS .cjs config", () => {
    write(
      "typesugar.config.cjs",
      `module.exports = { security: { allowedMacroPackages: ["cjs-macros"] } };\n`
    );
    config.load({ searchFrom: tmpRoot });
    expect(config.get("security.allowedMacroPackages")).toEqual(["cjs-macros"]);
  });
});

describe("#37 package.json macros manifest does not shadow typesugar.config.*", () => {
  it("prefers typesugar.config.ts over package.json's typesugar field", () => {
    write(
      "package.json",
      JSON.stringify({ name: "my-macro-lib", typesugar: { macros: "./dist/macros.js" } })
    );
    const file = write("typesugar.config.ts", TS_CONFIG);
    config.load({ searchFrom: tmpRoot });
    expect(config.getConfigFilePath()).toBe(file);
    expect(config.get("security.allowedMacroPackages")).toEqual(["foo-macros"]);
  });

  it("a manifest-only package.json is not treated as project config", () => {
    write(
      "package.json",
      JSON.stringify({ name: "my-macro-lib", typesugar: { macros: "./dist/macros.js" } })
    );
    config.load({ searchFrom: tmpRoot });
    expect(config.getConfigFilePath()).toBeUndefined();
    expect(config.get("macros")).toBeUndefined();
  });

  it("package.json typesugar config is still honoured when it is real config", () => {
    const file = write(
      "package.json",
      JSON.stringify({ name: "app", typesugar: { contracts: { mode: "none" } } })
    );
    config.load({ searchFrom: tmpRoot });
    expect(config.getConfigFilePath()).toBe(file);
    expect(config.get("contracts.mode")).toBe("none");
  });
});

describe("#52 env-var mapping", () => {
  it("maps single underscores after the top-level key to camelCase", () => {
    process.env.TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME = "1";
    config.reset();
    expect(config.get("contracts.proveAtCompileTime")).toBe(true);
  });

  it("keeps the documented forms working", () => {
    process.env.TYPESUGAR_CONTRACTS_MODE = "none";
    process.env.TYPESUGAR_CONTRACTS__STRIP__PRECONDITIONS = "1";
    process.env.TYPESUGAR_DEBUG = "1";
    config.reset();
    expect(config.get("contracts.mode")).toBe("none");
    expect(config.get("contracts.strip.preconditions")).toBe(true);
    expect(config.get("debug")).toBe(true);
  });

  it("deeper keys are not wiped by a shallower one regardless of env order", () => {
    process.env.TYPESUGAR_CONTRACTS_MODE = "none";
    process.env.TYPESUGAR_CONTRACTS = "0";
    config.reset();
    expect(config.get("contracts.mode")).toBe("none");
  });
});

describe("#53 no silent no-op when file config cannot be loaded at all", () => {
  it("warns and reports 'unavailable' when process.getBuiltinModule is missing under Node", () => {
    write("typesugar.config.ts", TS_CONFIG);
    const proc = process as unknown as { getBuiltinModule?: unknown };
    const original = proc.getBuiltinModule;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    proc.getBuiltinModule = undefined;
    try {
      config.load({ searchFrom: tmpRoot });
    } finally {
      proc.getBuiltinModule = original;
    }
    expect(config.getLoadError()?.kind).toBe("unavailable");
    expect(warn).toHaveBeenCalled();
  });
});
