/**
 * Node module-hooks loader (`typesugar/register`): hook plumbing and the
 * compile step.
 *
 * The hook layer (`createNodeLoaderHooks`) is tested with a fake compiler so
 * the pass-through rules are exact: a file typesugar does not change must
 * reach Node (or tsx) as if typesugar were not there. The compile step
 * (`createLoaderCompiler`) is tested on throwaway projects with real macros.
 * The process-level behaviour (`node --import .../register.js`, alone and
 * with tsx in either order) is in node-register-e2e.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  createNodeLoaderHooks,
  isLoaderCandidate,
  type LoaderCompiler,
} from "../src/node-loader.js";
import { createLoaderCompiler } from "../src/node-loader-compile.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");

function fakeCompiler(
  impl: LoaderCompiler["compile"] = () => ({ changed: false })
): LoaderCompiler & { compile: ReturnType<typeof vi.fn> } {
  return { compile: vi.fn(impl) };
}

const fileUrl = (p: string): string => pathToFileURL(p).href;

describe("isLoaderCandidate", () => {
  it("accepts TypeScript sources and rejects everything else", () => {
    expect(isLoaderCandidate("/p/src/a.ts")).toBe(true);
    expect(isLoaderCandidate("/p/src/a.mts")).toBe(true);
    expect(isLoaderCandidate("/p/src/a.cts")).toBe(true);
    expect(isLoaderCandidate("/p/src/a.tsx")).toBe(true);
    expect(isLoaderCandidate("/p/src/a.js")).toBe(false);
    expect(isLoaderCandidate("/p/src/a.d.ts")).toBe(false);
    expect(isLoaderCandidate("/p/src/a.d.mts")).toBe(false);
    expect(isLoaderCandidate("/p/node_modules/x/index.ts")).toBe(false);
    expect(isLoaderCandidate("C:\\p\\node_modules\\x\\index.ts")).toBe(false);
  });
});

describe("createNodeLoaderHooks: load", () => {
  it("passes non-TypeScript modules through without creating the compiler", () => {
    const createCompiler = vi.fn(() => fakeCompiler());
    const hooks = createNodeLoaderHooks({ createCompiler });
    const loaded = { format: "module", source: "export {}" };
    const next = vi.fn(() => loaded);
    for (const url of ["node:fs", "file:///p/a.js", "file:///p/node_modules/x/a.ts", "data:,x"]) {
      expect(hooks.load(url, { format: undefined }, next)).toBe(loaded);
    }
    expect(createCompiler).not.toHaveBeenCalled();
  });

  it("returns the next loader's result untouched when typesugar changes nothing", () => {
    const compiler = fakeCompiler();
    const hooks = createNodeLoaderHooks({ createCompiler: () => compiler });
    const loaded = { format: "module-typescript", source: "export const a: number = 1;" };
    const next = vi.fn(() => loaded);
    const url = fileUrl("/p/src/a.ts");
    expect(hooks.load(url, { format: "module-typescript" }, next)).toBe(loaded);
    expect(compiler.compile).toHaveBeenCalledWith("/p/src/a.ts".replace(/\//g, path.sep), "module");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("short-circuits with the compiled JavaScript when typesugar changes the file", () => {
    const compiler = fakeCompiler(() => ({
      changed: true,
      source: "export const a = 42;",
      format: "module",
    }));
    const hooks = createNodeLoaderHooks({ createCompiler: () => compiler });
    const next = vi.fn();
    const result = hooks.load(fileUrl("/p/src/a.ts"), { format: "module" }, next);
    expect(result).toEqual({
      format: "module",
      source: "export const a = 42;",
      shortCircuit: true,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("ignores a query string on the URL (tsx namespaces, cache busting)", () => {
    const compiler = fakeCompiler();
    const hooks = createNodeLoaderHooks({ createCompiler: () => compiler });
    hooks.load(fileUrl("/p/src/a.ts") + "?tsx-namespace=1", { format: "module" }, () => ({
      format: "module",
      source: "",
    }));
    expect(compiler.compile.mock.calls[0][0]).toBe(path.normalize("/p/src/a.ts"));
  });

  describe("module format", () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-loader-format-"));
      fs.mkdirSync(path.join(dir, "esm"));
      fs.mkdirSync(path.join(dir, "cjs"));
      fs.mkdirSync(path.join(dir, "untyped"));
      fs.writeFileSync(path.join(dir, "esm", "package.json"), '{"type":"module"}');
      fs.writeFileSync(path.join(dir, "cjs", "package.json"), '{"type":"commonjs"}');
      fs.writeFileSync(path.join(dir, "untyped", "package.json"), '{"name":"untyped"}');
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    const formatFor = (file: string, contextFormat?: string): unknown => {
      const compiler = fakeCompiler();
      const hooks = createNodeLoaderHooks({ createCompiler: () => compiler });
      hooks.load(fileUrl(file), { format: contextFormat }, () => ({
        format: "module",
        source: "",
      }));
      return compiler.compile.mock.calls[0][1];
    };

    it("uses the format the resolver chose", () => {
      expect(formatFor(path.join(dir, "esm", "a.ts"), "commonjs-typescript")).toBe("commonjs");
      expect(formatFor(path.join(dir, "cjs", "a.ts"), "module-typescript")).toBe("module");
      expect(formatFor(path.join(dir, "cjs", "a.ts"), "module")).toBe("module");
      expect(formatFor(path.join(dir, "esm", "a.ts"), "commonjs")).toBe("commonjs");
    });

    it("falls back to the extension, then the nearest package.json type", () => {
      expect(formatFor(path.join(dir, "cjs", "a.mts"))).toBe("module");
      expect(formatFor(path.join(dir, "esm", "a.cts"))).toBe("commonjs");
      expect(formatFor(path.join(dir, "esm", "a.ts"))).toBe("module");
      expect(formatFor(path.join(dir, "cjs", "a.ts"), "typescript")).toBe("commonjs");
      // No "type": Node decides from the syntax, so the compiler does too.
      expect(formatFor(path.join(dir, "untyped", "a.ts"))).toBeUndefined();
    });
  });

  it("async variant: same rules, awaiting the next loader", async () => {
    const compiler = fakeCompiler();
    const hooks = createNodeLoaderHooks({ createCompiler: () => compiler });
    const loaded = { format: "module", source: "export {}" };
    const result = await hooks.loadAsync(
      fileUrl("/p/src/a.ts"),
      { format: "module" },
      async () => loaded
    );
    expect(result).toBe(loaded);
  });
});

describe("createNodeLoaderHooks: resolve", () => {
  const notFound = (): never => {
    const err = new Error("Cannot find module") as Error & { code: string };
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  };

  it("maps a missing ./x.js imported from TypeScript to ./x.ts (TypeScript's own rule)", () => {
    const hooks = createNodeLoaderHooks({ createCompiler: () => fakeCompiler() });
    const next = vi.fn((specifier: string) =>
      specifier === "./lib.ts" ? { url: fileUrl("/p/src/lib.ts") } : notFound()
    );
    const result = hooks.resolve("./lib.js", { parentURL: fileUrl("/p/src/main.ts") }, next);
    expect(result).toEqual({ url: fileUrl("/p/src/lib.ts") });
  });

  it("maps .mjs to .mts and .cjs to .cts", () => {
    const hooks = createNodeLoaderHooks({ createCompiler: () => fakeCompiler() });
    const tried: string[] = [];
    const next = (specifier: string): { url: string } => {
      tried.push(specifier);
      return specifier.endsWith("ts") ? { url: "file:///ok" } : notFound();
    };
    hooks.resolve("./a.mjs", { parentURL: fileUrl("/p/main.ts") }, next);
    hooks.resolve("../b.cjs", { parentURL: fileUrl("/p/x/main.ts") }, next);
    expect(tried).toEqual(["./a.mjs", "./a.mts", "../b.cjs", "../b.cts"]);
  });

  it("leaves bare specifiers, JS parents and other errors alone", () => {
    const hooks = createNodeLoaderHooks({ createCompiler: () => fakeCompiler() });
    expect(() => hooks.resolve("pkg/x.js", { parentURL: fileUrl("/p/a.ts") }, notFound)).toThrow(
      "Cannot find module"
    );
    expect(() => hooks.resolve("./x.js", { parentURL: fileUrl("/p/a.js") }, notFound)).toThrow(
      "Cannot find module"
    );
    const other = (): never => {
      throw new Error("boom");
    };
    expect(() => hooks.resolve("./x.js", { parentURL: fileUrl("/p/a.ts") }, other)).toThrow("boom");
  });

  it("does not try alternatives when the .js file exists", () => {
    const hooks = createNodeLoaderHooks({ createCompiler: () => fakeCompiler() });
    const next = vi.fn(() => ({ url: "file:///p/x.js" }));
    hooks.resolve("./x.js", { parentURL: fileUrl("/p/a.ts") }, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("async variant", async () => {
    const hooks = createNodeLoaderHooks({ createCompiler: () => fakeCompiler() });
    const result = await hooks.resolveAsync(
      "./lib.js",
      { parentURL: fileUrl("/p/src/main.ts") },
      async (specifier: string) =>
        specifier === "./lib.ts" ? { url: fileUrl("/p/src/lib.ts") } : notFound()
    );
    expect(result).toEqual({ url: fileUrl("/p/src/lib.ts") });
  });
});

// ---------------------------------------------------------------------------
// The compile step, on real projects
// ---------------------------------------------------------------------------

const TSCONFIG = {
  compilerOptions: {
    target: "ES2017",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    skipLibCheck: true,
  },
};

function makeProject(files: Record<string, string>, pkg: object = { type: "module" }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-loader-compile-"));
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(TSCONFIG));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fx", ...pkg }));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

describe("createLoaderCompiler", () => {
  let project: string;
  beforeAll(() => {
    project = makeProject({
      "macro.ts": `import { comptime } from "typesugar";\nexport const answer: number = comptime(() => 6 * 7);\nexport class C { x = 1; }\n`,
      "plain.ts": `export const plain: number = 1;\n`,
      "bad.ts": `import { comptime } from "typesugar";\nexport const x = comptime(() => { throw new Error("boom-in-comptime"); });\n`,
    });
  });
  afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

  it("expands macros and emits ES module JavaScript with an inline source map", () => {
    const compiler = createLoaderCompiler();
    const file = path.join(project, "macro.ts");
    const out = compiler.compile(file, "module");
    expect(out.changed).toBe(true);
    if (!out.changed) return;
    expect(out.format).toBe("module");
    expect(out.source).not.toContain("comptime(");
    expect(out.source).toMatch(/export const answer = 42/);
    // Types are gone; no module-system rewrite for ESM.
    expect(out.source).not.toContain(": number");
    expect(out.source).not.toContain("require(");
    const m = out.source.match(/\/\/# sourceMappingURL=data:application\/json;base64,(\S+)\s*$/);
    expect(m).not.toBeNull();
    const map = JSON.parse(Buffer.from(m![1], "base64").toString("utf8"));
    expect(map.sources).toEqual([pathToFileURL(file).href]);
    expect(map.sourcesContent[0]).toContain("comptime(() => 6 * 7)");
  });

  it("keeps the tsconfig target's class-field semantics but does not downlevel", () => {
    const out = createLoaderCompiler().compile(path.join(project, "macro.ts"), "module");
    if (!out.changed) throw new Error("expected a change");
    // ES2017 target: useDefineForClassFields is false, so the field is
    // assigned in the constructor exactly as tsc would emit it.
    expect(out.source).toMatch(/constructor\(\) \{\s*this\.x = 1;/);
  });

  it("emits CommonJS when the module is CommonJS", () => {
    const out = createLoaderCompiler().compile(path.join(project, "macro.ts"), "commonjs");
    if (!out.changed) throw new Error("expected a change");
    expect(out.format).toBe("commonjs");
    expect(out.source).toMatch(/exports\.answer = 42/);
    expect(out.source).not.toMatch(/^export /m);
  });

  it("reports an unchanged file as unchanged (the caller defers to Node or tsx)", () => {
    expect(createLoaderCompiler().compile(path.join(project, "plain.ts"), "module")).toEqual({
      changed: false,
    });
  });

  it("throws on a macro error, naming the file and the message", () => {
    const file = path.join(project, "bad.ts");
    expect(() => createLoaderCompiler().compile(file, "module")).toThrow(
      /bad\.ts:2:\d+.*boom-in-comptime/s
    );
  });

  it("detects the format from the syntax when the package has no type", () => {
    const dir = makeProject(
      {
        "m.ts": `import { comptime } from "typesugar";\nexport const v = comptime(() => 1 + 1);\n`,
      },
      {}
    );
    try {
      const out = createLoaderCompiler().compile(path.join(dir, "m.ts"), undefined);
      if (!out.changed) throw new Error("expected a change");
      expect(out.format).toBe("module");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not write an expansion cache into the project", () => {
    createLoaderCompiler().compile(path.join(project, "macro.ts"), "module");
    expect(fs.existsSync(path.join(project, ".typesugar-cache"))).toBe(false);
  });
});
