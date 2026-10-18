/**
 * Regression tests for the 2026-10 deep review (findings-transformer.md #6,
 * #7, #20) against the unplugin integration. Each test drives the real
 * plugin hooks against a real on-disk project.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
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

const MACROS = `import { comptime } from "@typesugar/macros";\n`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(__dirname, "__fixture_"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("finding #6: macro errors fail the build", () => {
  it("reports a macro error through this.error with a location", () => {
    project({
      "src/a.ts": `${MACROS}export const x = comptime(() => { throw new Error("boom"); });\n`,
    });
    const { plugin, ctx } = makePlugin();
    plugin.buildStart.call(ctx);
    const file = path.join(dir, "src/a.ts");
    expect(() => plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file)).toThrow(/boom/);
    expect(ctx.error).toHaveBeenCalledTimes(1);
    const arg = ctx.error.mock.calls[0][0] as { loc?: { line: number } };
    expect(arg.loc?.line).toBe(2);
  });

  it("fails buildStart when the pipeline cannot be created", () => {
    project({ "src/a.ts": `export const x = 1;\n` });
    const { plugin, ctx } = makePlugin({ tsconfig: path.join(dir, "missing.json") });
    expect(() => plugin.buildStart.call(ctx)).toThrow();
  });
});

describe("finding #20: transform uses the code it is given", () => {
  it("expands the bundler-provided code, not the file on disk", () => {
    project({ "src/a.ts": `${MACROS}export const x = comptime(() => 1);\n` });
    const { plugin, ctx } = makePlugin();
    plugin.buildStart.call(ctx);
    const file = path.join(dir, "src/a.ts");
    const out = plugin.transform.call(
      ctx,
      `${MACROS}export const x = comptime(() => 40 + 2);\n`,
      file + "?v=1"
    );
    expect(out.code).toContain("42");
  });

  it("verbose mode does not write .transformed files into the source tree", () => {
    project({ "src/a.ts": `${MACROS}export const x = comptime(() => 1);\n` });
    const { plugin, ctx } = makePlugin({ verbose: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      plugin.buildStart.call(ctx);
      const file = path.join(dir, "src/a.ts");
      plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file);
    } finally {
      log.mockRestore();
    }
    expect(fs.readdirSync(path.join(dir, "src"))).toEqual(["a.ts"]);
  });
});

describe("finding #7: dependencies are registered with the bundler", () => {
  it("calls addWatchFile for the file's imports (NodeNext .js specifiers too)", () => {
    project({
      "src/dep.ts": `export const d = 1;\n`,
      "src/a.ts": `${MACROS}import { d } from "./dep.js";\nexport const x = comptime(() => 1) + d;\n`,
    });
    const { plugin, ctx } = makePlugin();
    plugin.buildStart.call(ctx);
    const file = path.join(dir, "src/a.ts");
    plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file);
    expect(ctx.addWatchFile).toHaveBeenCalledWith(path.join(dir, "src/dep.ts"));
  });
});

describe("built dist/*.js of workspace packages are left alone", () => {
  it("does not transform (or crash on) a JS file outside the TypeScript program", () => {
    project({
      "src/a.ts": `export const x = 1;\n`,
      "dist/index.js": `import * as ts from "typescript";\nexport function f(a) { return ts.factory.createIdentifier(a).flags; }\n`,
    });
    const { plugin, ctx } = makePlugin();
    plugin.buildStart.call(ctx);
    const file = path.join(dir, "dist/index.js");
    expect(plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file)).toBeNull();
    expect(ctx.error).not.toHaveBeenCalled();
  });

  it("the workspace @typesugar/macros dist passes through untouched", () => {
    project({ "src/a.ts": `export const x = 1;\n` });
    const { plugin, ctx } = makePlugin();
    plugin.buildStart.call(ctx);
    const file = path.resolve(__dirname, "../../../macros/dist/index.js");
    expect(plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file)).toBeNull();
    expect(ctx.error).not.toHaveBeenCalled();
  });
});
