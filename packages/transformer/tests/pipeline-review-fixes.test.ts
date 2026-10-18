/**
 * Regression tests for the 2026-10 deep-review findings against the
 * transformation pipeline (findings-transformer.md).
 *
 * Every test here was written to FAIL against the pre-fix pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import {
  TransformationPipeline,
  transformCode,
  createPipeline,
  getExpansionCacheStats,
  transpileExpanded,
} from "../src/pipeline.js";
import "@typesugar/macros";

const MACROS_IMPORT = `import { comptime } from "@typesugar/macros";\n`;

/** Virtual files live next to this test so `@typesugar/macros` resolves. */
const VDIR = path.resolve(__dirname, "__virtual_review__");

function virtualPipeline(files: Map<string, string>, options: Record<string, unknown> = {}) {
  return new TransformationPipeline(
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
    Array.from(files.keys()),
    {
      readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
      fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
      transformerConfig: { cacheDir: false },
      ...options,
    }
  );
}

/** Evaluate a transformed module's exports (ESM → CJS via transpileModule). */
function evalModule(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

describe("finding #4: invalidate() must serve the edited file, not the old Program's", () => {
  it("re-expands macros against the new content after invalidate()", () => {
    const a = path.join(VDIR, "stale-a.ts");
    const files = new Map([[a, `${MACROS_IMPORT}export const a = comptime(() => 1 + 1);\n`]]);
    const p = virtualPipeline(files);

    expect(p.transform(a).code).toContain("a = 2");

    files.set(a, `${MACROS_IMPORT}export const a = comptime(() => 2 + 2);\nexport const b = 7;\n`);
    p.invalidate(a);
    const r = p.transform(a);
    expect(r.original).toContain("2 + 2");
    expect(r.code).toContain("a = 4");
    expect(r.code).toContain("b = 7");
  });

  it("type information follows the edit (dependency changed, dependent re-transformed)", () => {
    const lib = path.join(VDIR, "stale-lib.ts");
    const main = path.join(VDIR, "stale-main.ts");
    const files = new Map([
      [lib, `export const n = 1;\n`],
      [
        main,
        `${MACROS_IMPORT}import { n } from "./stale-lib";\nexport const m = comptime(() => 1);\nexport const k = n;\n`,
      ],
    ]);
    const p = virtualPipeline(files);
    p.transform(main);
    files.set(lib, `export const n = 1;\nexport const extra = 2;\n`);
    files.set(
      main,
      `${MACROS_IMPORT}import { n, extra } from "./stale-lib";\nexport const m = comptime(() => 3);\nexport const k = n + extra;\n`
    );
    p.invalidate(lib);
    p.invalidate(main);
    const r = p.transform(main);
    expect(r.code).toContain("m = 3");
    expect(r.code).toContain("n + extra");
  });
});

describe("finding #5: no line-regex rewriting of printed output", () => {
  it("leaves string and template literals that look like comments intact", () => {
    const code = `${MACROS_IMPORT}export const v = comptime(() => 40 + 2);
export const help = \`Usage:

- run it
<div>

<p>hi</p>
\`;
export const sep = "a = // b";
export const y = 1;
`;
    const r = transformCode(code, {
      fileName: path.join(VDIR, "strip.ts"),
      transformerConfig: { cacheDir: false },
    });
    expect(r.changed).toBe(true);
    const mod = evalModule(r.code);
    expect(mod.v).toBe(42);
    expect(mod.help).toBe("Usage:\n\n- run it\n<div>\n\n<p>hi</p>\n");
    expect(mod.sep).toBe("a = // b");
    expect(mod.y).toBe(1);
  });
});

describe("finding #9: expression-position let: works on the FIRST file (macro packages loaded before the gate)", () => {
  it("arrow-body let:/yield: expands and runs without pre-importing @typesugar/std/macros", async () => {
    const file = path.join(VDIR, "first-file-let.ts");
    const code = `import "@typesugar/std/syntax/do";
export const f = () =>
let: {
  x << [1, 2];
}
yield: { x * 10 }
`;
    const files = new Map([[file, code]]);
    const p = virtualPipeline(files);
    const r = p.transform(file);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Runtime modules are loaded only AFTER the transform, so nothing but the
    // pipeline itself can have registered std's macros.
    const std = await import("@typesugar/std");
    const stdDo = await import("@typesugar/std/syntax/do");
    const js = ts.transpileModule(r.code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    const req = (spec: string) =>
      spec === "@typesugar/std" ? std : spec === "@typesugar/std/syntax/do" ? stdDo : {};
    new Function("require", "exports", "module", js)(req, mod.exports, mod);
    expect((mod.exports.f as () => unknown)()).toEqual([10, 20]);
  });
});

describe("finding #12: macro diagnostic positions are mapped back through preprocessing", () => {
  it("points at the macro call in the ORIGINAL source after an HKT rewrite", () => {
    const file = path.join(VDIR, "diagpos.ts");
    const code = `${MACROS_IMPORT}interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
  of<A>(a: A): F<A>;
}
export const boom = comptime(() => { throw new Error("boom"); });
`;
    const p = virtualPipeline(new Map([[file, code]]));
    const r = p.transform(file);
    const err = r.diagnostics.find((d) => d.severity === "error");
    expect(err).toBeDefined();
    expect(code.slice(err!.start, err!.start + 8)).toBe("comptime");
  });
});

describe("finding #7: dependency tracking", () => {
  it("records NodeNext `.js` imports, re-exports, nested import() and transitive deps", () => {
    const main = path.join(VDIR, "deps-main.ts");
    const a = path.join(VDIR, "deps-a.ts");
    const b = path.join(VDIR, "deps-b.ts");
    const c = path.join(VDIR, "deps-c.ts");
    const d = path.join(VDIR, "deps-d.ts");
    const files = new Map([
      [
        main,
        `import { a } from "./deps-a.js";
export { b } from "./deps-b.js";
export async function lazy() { return (await import("./deps-c.js")).c; }
export const x = a;
`,
      ],
      [a, `import { d } from "./deps-d.js";\nexport const a = d;\n`],
      [b, `export const b = 2;\n`],
      [c, `export const c = 3;\n`],
      [d, `export const d = 4;\n`],
    ]);
    const p = virtualPipeline(files);
    const deps = [...(p.transform(main).dependencies ?? [])].sort();
    expect(deps).toEqual([a, b, c, d].sort());
  });

  it("a transitive dependency's edit invalidates the cached result", () => {
    const main = path.join(VDIR, "tdeps-main.ts");
    const a = path.join(VDIR, "tdeps-a.ts");
    const d = path.join(VDIR, "tdeps-d.ts");
    const files = new Map([
      [main, `import { a } from "./tdeps-a.js";\nexport const x = a;\n`],
      [a, `export { d as a } from "./tdeps-d.js";\n`],
      [d, `export const d = 4;\n`],
    ]);
    const p = virtualPipeline(files);
    const r1 = p.transform(main);
    files.set(d, `export const d = 5;\n`);
    // No invalidate() call: content-hash validation alone must notice.
    const r2 = p.transform(main);
    expect(r2).not.toBe(r1);
  });
});

describe("findings #3/#15: disk transform cache keys and contents", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-diskcache-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function diskPipeline(
    file: string,
    code: string,
    compilerOptions: ts.CompilerOptions,
    cfg?: Record<string, unknown>
  ) {
    return new TransformationPipeline(
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true,
        ...compilerOptions,
      },
      [file],
      {
        readFile: (f) => (f === file ? code : ts.sys.readFile(f)),
        fileExists: (f) => f === file || ts.sys.fileExists(f),
        diskCache: path.join(tmp, "transforms"),
        cacheDir: false,
        transformerConfig: cfg ? { cfgConfig: cfg } : undefined,
      }
    );
  }
  const stats = (p: TransformationPipeline) =>
    (p as unknown as { diskCache: { stats: { hits: number } } }).diskCache.stats;

  it("replays macro diagnostics on a disk hit instead of dropping them", () => {
    const file = path.join(VDIR, "disk-diag.ts");
    const code = `${MACROS_IMPORT}export const ok = comptime(() => 1);\nexport const boom = comptime(() => { throw new Error("boom"); });\n`;
    const p1 = diskPipeline(file, code, { target: ts.ScriptTarget.ES2022 });
    expect(p1.transform(file).diagnostics.some((d) => d.severity === "error")).toBe(true);
    p1.cleanup();
    const p2 = diskPipeline(file, code, { target: ts.ScriptTarget.ES2022 });
    const r2 = p2.transform(file);
    expect(stats(p2).hits).toBe(1);
    expect(r2.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("never serves an entry written under different compiler options or cfg config", () => {
    const file = path.join(VDIR, "disk-key.ts");
    const code = `${MACROS_IMPORT}export const v = comptime(() => 1 + 1);\n`;
    const p1 = diskPipeline(file, code, { target: ts.ScriptTarget.ES2022 });
    p1.transform(file);
    p1.cleanup();

    const p2 = diskPipeline(file, code, { target: ts.ScriptTarget.ES2017 });
    p2.transform(file);
    expect(stats(p2).hits).toBe(0);

    const p3 = diskPipeline(file, code, { target: ts.ScriptTarget.ES2022 }, { debug: true });
    p3.transform(file);
    expect(stats(p3).hits).toBe(0);
  });

  it("deletes a file's superseded entry when it is rewritten", async () => {
    const { DiskTransformCache } = await import("../src/cache.js");
    const dir = path.join(tmp, "t");
    const c = new DiskTransformCache(dir, { configKey: "k" });
    c.set("/f.ts", "h1", [], {}, "code1", null);
    c.set("/f.ts", "h2", [], {}, "code2", null);
    const entries = fs.readdirSync(dir).filter((f) => f !== "manifest.json");
    expect(entries).toHaveLength(1);
    expect(
      new DiskTransformCache(dir, { configKey: "other" }).get("/f.ts", "h2", () => undefined)
    ).toBeUndefined();
  });
});

describe("cacheDir: false is honoured by TransformationPipeline", () => {
  it("writes no expansion cache when cacheDir is false", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-nocache-"));
    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      const file = path.join(VDIR, "nocache.ts");
      const code = `${MACROS_IMPORT}export const v = comptime(() => 3);\n`;
      const p = new TransformationPipeline(
        { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
        [file],
        {
          readFile: (f) => (f === file ? code : ts.sys.readFile(f)),
          fileExists: (f) => f === file || ts.sys.fileExists(f),
          cacheDir: false,
        }
      );
      p.transform(file);
      expect(getExpansionCacheStats()).toBeUndefined();
      p.cleanup();
      expect(fs.existsSync(path.join(tmp, ".typesugar-cache"))).toBe(false);
    } finally {
      process.chdir(cwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("tooling #11: shouldTransform accepts user files anywhere and .mts/.cts", () => {
  it("does not exclude user files under packages/<core|macros|...>/src", () => {
    const p = virtualPipeline(new Map([[path.join(VDIR, "x.ts"), ""]]));
    expect(p.shouldTransform("/repo/packages/core/src/app.ts")).toBe(true);
    expect(p.shouldTransform("/repo/packages/macros/src/thing.ts")).toBe(true);
    expect(p.shouldTransform("/repo/src/mod.mts")).toBe(true);
    expect(p.shouldTransform("/repo/src/mod.cts")).toBe(true);
    expect(p.shouldTransform("/repo/src/mod.d.mts")).toBe(false);
    expect(p.shouldTransform("/repo/node_modules/x/index.ts")).toBe(false);
  });
});

describe("createPipeline loads typesugar config from the project, not process.cwd()", () => {
  it("finds the project's config when cwd is elsewhere", async () => {
    const { config } = await import("@typesugar/core");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-projcfg-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "p", typesugar: { features: { fromProject: true } } })
      );
      fs.writeFileSync(path.join(tmp, "a.ts"), "export const a = 1;\n");
      fs.writeFileSync(path.join(tmp, "tsconfig.json"), JSON.stringify({ files: ["a.ts"] }));
      config.reset();
      createPipeline(path.join(tmp, "tsconfig.json"));
      expect(config.get("features.fromProject")).toBe(true);
    } finally {
      config.reset();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("finding #20: no regex rewrite of user code in transpileExpanded (fixCompanionConsts)", () => {
  it("leaves a user's `const X: Record<string, any> = {}` a const", () => {
    const out = transpileExpanded(`export const settings: Record<string, any> = {};\n`, "user.ts", {
      target: ts.ScriptTarget.ES2022,
    }).outputText;
    expect(out).toContain("export const settings = {}");
  });
});

describe("finding #14: HKT rewriter Kind import", () => {
  it("injects Kind when the file only has a NAMESPACE import of a typesugar package", async () => {
    const { rewriteHKTTypeReferences } = await import("../src/hkt-rewriter.js");
    const r = rewriteHKTTypeReferences(
      `import * as fp from "@typesugar/fp";\ninterface Functor<F> { map<A, B>(fa: F<A>, f: (a: A) => B): F<B>; }\n`,
      "ns.ts"
    );
    expect(r.code).toContain("Kind<F, A>");
    expect(r.code).toMatch(/import type \{ Kind \} from "@typesugar\/type-system"/);
  });

  it("does not add a duplicate Kind when one is already imported from elsewhere", async () => {
    const { rewriteHKTTypeReferences } = await import("../src/hkt-rewriter.js");
    for (const src of [
      `import type { Kind } from "@typesugar/std";\n`,
      `import { Kind } from "./hkt";\n`,
      `type Kind<F, A> = unknown;\n`,
    ]) {
      const r = rewriteHKTTypeReferences(
        `${src}interface Functor<F> { map<A, B>(fa: F<A>, f: (a: A) => B): F<B>; }\n`,
        "dup.ts"
      );
      expect(r.code).toContain("Kind<F, A>");
      expect(r.code).not.toContain("@typesugar/type-system");
      // still a valid program: no TS2300 duplicate identifier
      const sf = ts.createSourceFile("dup.ts", r.code, ts.ScriptTarget.Latest, true);
      const kindBindings = sf.statements.filter(
        (s) =>
          (ts.isImportDeclaration(s) &&
            s.importClause?.namedBindings &&
            ts.isNamedImports(s.importClause.namedBindings) &&
            s.importClause.namedBindings.elements.some((e) => e.name.text === "Kind")) ||
          (ts.isTypeAliasDeclaration(s) && s.name.text === "Kind")
      );
      expect(kindBindings).toHaveLength(1);
    }
  });
});

describe("macros-typeclass #6 (pipeline side): derivation caches are cleared per program", () => {
  it("a reused TransformerState (CLI watch) sees an edited type on the next program", async () => {
    const { macroTransformerFactory, TransformerState } = await import("../src/pipeline.js");
    const file = path.join(VDIR, "watch-derive.ts");
    const state = new TransformerState({ cacheDir: false });
    const run = (code: string) => {
      const host = ts.createCompilerHost({});
      const orig = host.getSourceFile.bind(host);
      host.getSourceFile = (f, lv) =>
        f === file ? ts.createSourceFile(f, code, lv, true) : orig(f, lv);
      const origRead = host.readFile.bind(host);
      host.readFile = (f) => (f === file ? code : origRead(f));
      const origExists = host.fileExists.bind(host);
      host.fileExists = (f) => f === file || origExists(f);
      const program = ts.createProgram(
        [file],
        {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          skipLibCheck: true,
        },
        host
      );
      const sf = program.getSourceFile(file)!;
      const out = ts.transform(sf, [macroTransformerFactory(program, { cacheDir: false }, state)]);
      const text = ts.createPrinter().printFile(out.transformed[0]);
      out.dispose();
      return text;
    };
    const header = `import { derive, Eq } from "@typesugar/macros";\n@derive(Eq)\nexport class Point { constructor(`;
    const first = run(`${header}public x: number) {} }\n`);
    expect(first).toContain("a.x === b.x");
    const second = run(`${header}public x: number, public y: number) {} }\n`);
    expect(second).toContain("a.y === b.y");
  });
});
