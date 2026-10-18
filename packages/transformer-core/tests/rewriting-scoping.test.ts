/**
 * Scoping of the process-global rewrite registries (@opaque type-rewrite
 * registry, standalone-extension registry) consumed by rewriting.ts.
 *
 * Deep-review findings (core #3, #18, #42; macros-other #3):
 *
 * - #3: @opaque constructor/constant/method erasure matched by bare NAME, so
 *   once any file registered `Option` (e.g. via .d.ts discovery from an
 *   `import { Some } from "fakefp"`), an unrelated file's own `function Some`,
 *   `enum { None }`, `{ None: 1 }`, `const None`, `{ None }` and
 *   `class Option { contains() }` were all rewritten -- and the result
 *   depended on the order files were transformed in.
 * - #18: a standalone extension registered by one file rewrote `x.clamp()` in
 *   another file that had no `clamp` binding at all (ReferenceError).
 * - #42: opaque method inlining used a fixed `_opt` parameter (captured a user
 *   `_opt`) and evaluated method arguments lazily.
 *
 * These tests drive the real `transformCode` pipeline over a real on-disk
 * multi-file program and EXECUTE the transformed output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  clearTypeRewrites,
  registerTypeRewrite,
  standaloneExtensionRegistry,
} from "@typesugar/core";

import { transformCode } from "../src/transform.js";
import { discoverOpaqueTypesFromImports, resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_FP_DTS = [
  "/** @opaque A | null */",
  "export interface Option<A> {",
  "  map<B>(f: (a: A) => B): Option<B>;",
  "  contains(a: A): boolean;",
  "}",
  "export declare function Some<A>(a: A): Option<A>;",
  "export declare const None: Option<never>;",
  "export declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;",
  "export declare function contains<A>(o: Option<A>, a: A): boolean;",
].join("\n");

interface Project {
  dir: string;
  program: ts.Program;
  file(name: string): string;
  cleanup(): void;
}

function makeProject(files: Record<string, string>): Project {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rewriting-scoping-")));
  const all: Record<string, string> = {
    "node_modules/fakefp/package.json": JSON.stringify({
      name: "fakefp",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "node_modules/fakefp/index.d.ts": FAKE_FP_DTS,
    ...files,
  };
  const roots: string[] = [];
  for (const [name, content] of Object.entries(all)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    if (name.endsWith(".ts") && !name.startsWith("node_modules/")) roots.push(p);
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, shouldCreate) => {
    const sf = orig(fn, lang, onErr, shouldCreate);
    if (sf && roots.includes(fn)) return ts.createSourceFile(fn, sf.text, lang, true);
    return sf;
  };
  const program = ts.createProgram(roots, options, host);
  return {
    dir,
    program,
    file: (name) => path.join(dir, name),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Transform one file the way the pipeline does: .d.ts discovery, then the visitor. */
function transformFile(project: Project, name: string): string {
  const fileName = project.file(name);
  const sf = project.program.getSourceFile(fileName)!;
  discoverOpaqueTypesFromImports(sf, project.program);
  const result = transformCode(sf.text, { program: project.program, fileName });
  return result.code;
}

/** Transform files in the given order; returns output keyed by file name. */
function transformInOrder(project: Project, order: string[]): Record<string, string> {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
  const out: Record<string, string> = {};
  for (const name of order) out[name] = transformFile(project, name);
  return out;
}

/** Transpile TS output to CJS and run it; returns its `exports`. Imports throw. */
function execute(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (m: string) => {
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", js)(exports, req);
  return exports;
}

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

afterEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

// ---------------------------------------------------------------------------
// #3 — @opaque erasure must resolve the symbol, not match a bare name
// ---------------------------------------------------------------------------

const A_TS = [
  'import { Some, None, type Option } from "fakefp";',
  "export const x: Option<number> = Some(1);",
  "export const y = None;",
].join("\n");

const B_TS = [
  "function Some(x: number) { return { wrapped: x }; }",
  "export const s = Some(1);",
  "export enum Flags { None = 0, A = 1 }",
  "export const obj = { None: 1 };",
  "const None = 5;",
  "export const n = None + 1;",
  "export const sh = { None };",
  "class Option { contains(v: string) { return v === 'x'; } }",
  'export const c = new Option().contains("x");',
].join("\n");

describe("@opaque erasure is scoped to the registered declaration (finding #3)", () => {
  let project: Project;
  beforeEach(() => {
    project = makeProject({ "a.ts": A_TS, "b.ts": B_TS });
  });
  afterEach(() => project.cleanup());

  for (const order of [
    ["a.ts", "b.ts"],
    ["b.ts", "a.ts"],
  ]) {
    it(`leaves unrelated same-named code alone (order: ${order.join(" -> ")})`, () => {
      const out = transformInOrder(project, order);
      const b = execute(out["b.ts"]);
      expect(b.s).toEqual({ wrapped: 1 });
      expect((b.Flags as Record<string, number>).None).toBe(0);
      expect(b.obj).toEqual({ None: 1 });
      expect(b.n).toBe(6);
      expect(b.sh).toEqual({ None: 5 });
      expect(b.c).toBe(true);
      expect(out["b.ts"]).not.toContain("fakefp");
    });

    it(`still erases the real imported constructors (order: ${order.join(" -> ")})`, () => {
      const out = transformInOrder(project, order);
      expect(out["a.ts"]).toMatch(/x(: Option<number>)? = 1;/);
      expect(out["a.ts"]).toContain("y = null");
    });
  }

  it("b.ts output is identical regardless of transform order", () => {
    const ab = transformInOrder(project, ["a.ts", "b.ts"]);
    const ba = transformInOrder(project, ["b.ts", "a.ts"]);
    expect(ab["b.ts"]).toBe(ba["b.ts"]);
    expect(ab["a.ts"]).toBe(ba["a.ts"]);
  });
});

// ---------------------------------------------------------------------------
// #18 — a registered standalone extension needs a binding in the using file
// ---------------------------------------------------------------------------

describe("standalone extensions do not leak into files without a binding (finding #18)", () => {
  let project: Project;
  beforeEach(() => {
    project = makeProject({
      "unbound.ts": [
        "const x: number = 5;",
        "// @ts-ignore",
        "export const r = x.clamp(0, 1);",
      ].join("\n"),
      "bound.ts": [
        "function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }",
        "const x: number = 5;",
        "// @ts-ignore",
        "export const r = x.clamp(0, 1);",
      ].join("\n"),
    });
  });
  afterEach(() => project.cleanup());

  it("does not rewrite x.clamp() to an unbound clamp(x, ...) in another file", () => {
    // What a.ts's `@extension function clamp(n: number, ...)` registers.
    standaloneExtensionRegistry.push({ methodName: "clamp", forType: "number" });
    const out = transformCode(project.program.getSourceFile(project.file("unbound.ts"))!.text, {
      program: project.program,
      fileName: project.file("unbound.ts"),
    }).code;
    expect(out).not.toMatch(/(^|[^.])clamp\(x/);
    expect(out).toContain("x.clamp(0, 1)");
  });

  it("still rewrites when the extension function is bound in the using file", () => {
    standaloneExtensionRegistry.push({ methodName: "clamp", forType: "number" });
    const out = transformCode(project.program.getSourceFile(project.file("bound.ts"))!.text, {
      program: project.program,
      fileName: project.file("bound.ts"),
    }).code;
    expect(out).toContain("clamp(x, 0, 1)");
    expect(execute(out).r).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #42 — opaque method inlining: hygienic temp + eager argument evaluation
// ---------------------------------------------------------------------------

describe("opaque method inlining keeps call semantics (finding #42)", () => {
  let project: Project;
  beforeEach(() => {
    project = makeProject({
      "main.ts": [
        'import type { Option } from "fakefp";',
        "function getOpt(): Option<number> { return 4 as unknown as Option<number>; }",
        "function none(): Option<number> { return null as unknown as Option<number>; }",
        "const _opt = 3;",
        "export const r = getOpt().map((x) => x + _opt);",
        "let calls = 0;",
        "const mk = () => { calls++; return (x: number) => x; };",
        "export const r2 = none().map(mk());",
        "export const callsAfter = calls;",
      ].join("\n"),
    });
    registerTypeRewrite({
      typeName: "Option",
      sourceModule: "fakefp",
      declarationFile: project.file("node_modules/fakefp/index.d.ts"),
      underlyingTypeText: "A | null",
      methods: new Map([["map", "map"]]),
      methodInlines: new Map([["map", { kind: "null-check-apply" }]]),
      transparent: false,
    } as Parameters<typeof registerTypeRewrite>[0]);
  });
  afterEach(() => project.cleanup());

  it("does not capture a user `_opt` and evaluates arguments eagerly", () => {
    const out = transformCode(project.program.getSourceFile(project.file("main.ts"))!.text, {
      program: project.program,
      fileName: project.file("main.ts"),
    }).code;
    expect(out).not.toContain(".map(");
    const m = execute(out);
    expect(m.r).toBe(7);
    expect(m.r2).toBe(null);
    expect(m.callsAfter).toBe(1);
  });
});
