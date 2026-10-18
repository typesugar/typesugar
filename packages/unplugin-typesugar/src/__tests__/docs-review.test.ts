/**
 * Regression tests for the 2026-10 docs review against the unplugin
 * integration (peps/reviews/2026-10-docs-arch-review/: docs-guides-c.md #13,
 * docs-start.md #6 and #7, docs-guides-a.md #4). Each test drives the real
 * plugin hooks against a real on-disk project, using the option values the
 * docs show.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { unpluginFactory } from "../unplugin.js";

// Inside the repo so `@typesugar/macros` resolves from the root node_modules.
let dir: string;

function project(files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
        strict: true,
      },
      include: ["src"],
    })
  );
}

function makePlugin(opts: Record<string, unknown> = {}) {
  const plugin = unpluginFactory({ tsconfig: path.join(dir, "tsconfig.json"), ...opts }, {
    framework: "vite",
  } as never) as Record<string, any>;
  const ctx = {
    error: vi.fn((m: unknown) => {
      throw new Error(typeof m === "string" ? m : (m as { message: string }).message);
    }),
    warn: vi.fn(),
    addWatchFile: vi.fn(),
  };
  return { plugin, ctx };
}

/** Evaluate a transformed module's exports (ESM -> CJS via transpileModule). */
function evalModule(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(__dirname, "__fixture_docs_"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("C#13: strict: true fails the build on type errors in expanded output", () => {
  it("buildEnd reports through this.error and throws", () => {
    project({ "src/a.ts": `export const x: number = "not a number";\n` });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { plugin, ctx } = makePlugin({ strict: true });
    plugin.buildStart.call(ctx);
    const file = path.join(dir, "src/a.ts");
    plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file);
    expect(() => plugin.buildEnd.call(ctx)).toThrow(/not assignable/);
    expect(ctx.error).toHaveBeenCalledTimes(1);
  });

  it("buildEnd still passes when there are no type errors", () => {
    project({ "src/a.ts": `export const x: number = 1;\n` });
    const { plugin, ctx } = makePlugin({ strict: true });
    plugin.buildStart.call(ctx);
    expect(() => plugin.buildEnd.call(ctx)).not.toThrow();
    expect(ctx.error).not.toHaveBeenCalled();
  });
});

describe("S#6: include/exclude take globs", () => {
  const src = () => path.join(dir, "src/a.ts");
  const gen = () => path.join(dir, "src/generated/b.ts");
  const nm = () => path.join(dir, "node_modules/pkg/index.ts");

  function includes(opts: Record<string, unknown>, id: string): boolean {
    project({ "src/a.ts": `export const x = 1;\n` });
    const { plugin } = makePlugin(opts);
    // Relative globs resolve against Vite's root (else process.cwd()).
    plugin.vite.configResolved({ root: dir });
    return !!plugin.transformInclude(id);
  }

  it('include: ["**/*.ts"] matches project files (documented value)', () => {
    expect(includes({ include: ["**/*.ts"] }, src())).toBe(true);
  });

  it('include: ["src/**/*.ts"] resolves against the project root', () => {
    expect(includes({ include: ["src/**/*.ts"] }, src())).toBe(true);
    expect(includes({ include: ["src/**/*.ts"] }, path.join(dir, "other/c.ts"))).toBe(false);
  });

  it("an exclude array keeps node_modules excluded", () => {
    expect(includes({ exclude: ["**/generated/**"] }, gen())).toBe(false);
    expect(includes({ exclude: ["**/generated/**"] }, src())).toBe(true);
    expect(includes({ exclude: ["**/generated/**"] }, nm())).toBe(false);
  });

  it('documented exclude ["node_modules/**"] still excludes dependencies', () => {
    expect(includes({ include: ["**/*.ts"], exclude: ["node_modules/**"] }, nm())).toBe(false);
  });

  it("node_modules can be included explicitly", () => {
    expect(includes({ include: ["**/node_modules/pkg/**"] }, nm())).toBe(true);
  });

  it("RegExp values still work", () => {
    expect(includes({ include: /src\/.*\.ts$/ }, src())).toBe(true);
    expect(includes({ exclude: /generated/ }, gen())).toBe(false);
  });

  it("defaults: TS/JS files outside node_modules", () => {
    expect(includes({}, src())).toBe(true);
    expect(includes({}, nm())).toBe(false);
    expect(includes({}, path.join(dir, "src/a.css"))).toBe(false);
  });
});

describe("S#7 / A#4: cfgConfig sets cfg() conditions", () => {
  it("cfgConfig: { debug: true } selects the debug branch", () => {
    project({
      "src/a.ts":
        `import { cfg } from "@typesugar/macros";\n` +
        `export const mode = cfg("debug", () => "debug", () => "release");\n`,
    });
    const { plugin, ctx } = makePlugin({ cfgConfig: { debug: true } });
    plugin.buildStart.call(ctx);
    const file = path.join(dir, "src/a.ts");
    const out = plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file);
    expect(evalModule(out.code).mode).toBe("debug");
  });
});
