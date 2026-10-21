/**
 * transformer-core bugs found by running documentation examples through the
 * real pipeline (2026-10 docs review, group core-engine).
 *
 * - generic first parameters (`readonly A[]`) never matched an imported
 *   extension, so `arr.head()` stayed as-is and crashed at runtime
 *   (docs-guides-b #2, docs-start #3, docs-authoring #7).
 * - namespace-import extensions (`import * as std`; `(42).clamp(0, 10)`) were
 *   dropped because the global-augmentation stub counted as a "native" method
 *   (docs-guides-b #12).
 *
 * Each test transforms a real on-disk program and EXECUTES the output against
 * a fake runtime for the imported package.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  clearTypeRewrites,
  standaloneExtensionRegistry,
  defineTypeMacro,
  globalRegistry,
} from "@typesugar/core";
import "@typesugar/macros";

import { transformCode, type TransformCodeResult } from "../src/transform.js";
import { hasJSDocMacroTags } from "../src/macro-helpers.js";
import { discoverOpaqueTypesFromImports, resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

/** A minimal stand-in for @typesugar/std: standalone functions + a global augmentation. */
const FAKE_STD_DTS = [
  "export interface Range { start: number; end: number }",
  "export declare function head<A>(arr: readonly A[]): A | undefined;",
  "export declare function chunk<A>(arr: readonly A[], size: number): A[][];",
  "export declare function swapFirst<T extends unknown[]>(arr: T): T;",
  "export declare function idOf<T extends { id: number }>(x: T): number;",
  "export declare function clamp(n: number, min: number, max: number): number;",
  "export declare function to(a: number, b: number): Range;",
  "export declare function toArray(r: Range): number[];",
  "declare global {",
  "  interface Array<T> { head(): T | undefined; chunk(size: number): T[][]; swapFirst(): T[] }",
  "  interface ReadonlyArray<T> { head(): T | undefined }",
  "  interface Number { clamp(min: number, max: number): number }",
  "  interface String { idOf(): number }",
  "}",
].join("\n");

const FAKE_STD_RUNTIME = {
  head: (arr: unknown[]) => arr[0],
  chunk: (arr: unknown[], size: number) => {
    const out: unknown[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  },
  swapFirst: (arr: unknown[]) => [arr[1], arr[0], ...arr.slice(2)],
  idOf: (x: { id: number }) => x.id,
  clamp: (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi),
  to: (start: number, end: number) => ({ start, end }),
  toArray: (r: { start: number; end: number }) => {
    const out: number[] = [];
    for (let i = r.start; i <= r.end; i++) out.push(i);
    return out;
  },
};

function makeProject(
  main: string,
  extraFiles: Record<string, string> = {}
): { program: ts.Program; fileName: string; cleanup(): void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "docs-review-engine-")));
  const files: Record<string, string> = {
    "node_modules/fakestd/package.json": JSON.stringify({
      name: "fakestd",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "node_modules/fakestd/index.d.ts": FAKE_STD_DTS,
    ...extraFiles,
    "main.ts": main,
  };
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const fileName = path.join(dir, "main.ts");
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
    if (sf && fn === fileName) return ts.createSourceFile(fn, sf.text, lang, true);
    return sf;
  };
  const program = ts.createProgram([fileName], options, host);
  return { program, fileName, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function transform(main: string, extraFiles: Record<string, string> = {}): TransformCodeResult {
  const project = makeProject(main, extraFiles);
  try {
    const sf = project.program.getSourceFile(project.fileName)!;
    discoverOpaqueTypesFromImports(sf, project.program);
    return transformCode(sf.text, { program: project.program, fileName: project.fileName });
  } finally {
    project.cleanup();
  }
}

/** Transpile to CJS and run; `log` collects console.log output. */
function run(code: string, modules: Record<string, unknown> = {}): unknown[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logged: unknown[] = [];
  const req = (m: string) => {
    if (m === "fakestd") return FAKE_STD_RUNTIME;
    if (m in modules) return modules[m];
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", "log", js)({}, req, (v: unknown) => logged.push(v));
  return logged;
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

describe("extensions with a generic first parameter (docs B#2, S#3, W#7)", () => {
  it("rewrites arr.head() / arr.chunk(2) / [..].head() and the output runs", () => {
    const result = transform(
      [
        `import { head, chunk } from "fakestd";`,
        `declare function log(v: unknown): void;`,
        `const arr = [1, 2, 3];`,
        `log(arr.head());`,
        `log(arr.chunk(2));`,
        `log([7, 8].head());`,
        `const ro: readonly string[] = ["a"];`,
        `log(ro.head());`,
      ].join("\n")
    );
    expect(result.code).toContain("head(arr)");
    expect(run(result.code)).toEqual([1, [[1, 2], [3]], 7, "a"]);
  });

  it("checks a bare type-parameter first param against its constraint", () => {
    const result = transform(
      [
        `import { swapFirst, idOf } from "fakestd";`,
        `declare function log(v: unknown): void;`,
        `log([1, 2, 3].swapFirst());`,
        // String does not satisfy `T extends { id: number }`: must NOT rewrite.
        `const s = "x";`,
        `export const keep = () => s.idOf();`,
      ].join("\n")
    );
    expect(result.code).toContain("swapFirst([1, 2, 3])");
    expect(result.code).toContain("s.idOf()");
    expect(run(result.code)).toEqual([[2, 1, 3]]);
  });
});

describe("namespace-import extensions (docs B#12)", () => {
  it("rewrites (42).clamp(0, 10) to std.clamp(42, 0, 10) and keeps the import", () => {
    const result = transform(
      [
        `import * as std from "fakestd";`,
        `declare function log(v: unknown): void;`,
        `log((42).clamp(0, 10));`,
        `log(std.toArray(std.to(1, 3)));`,
      ].join("\n")
    );
    expect(result.code).toMatch(/std\.clamp\(\(?42\)?, 0, 10\)/);
    expect(run(result.code)).toEqual([10, [1, 2, 3]]);
  });

  it("still does not redirect a real native method to a namespace member", () => {
    const result = transform(
      [
        `import * as std from "fakestd";`,
        `declare function log(v: unknown): void;`,
        `log([1, 2].map((x) => x * 2));`,
        `log(std.clamp(5, 0, 1));`,
      ].join("\n")
    );
    expect(result.code).toContain("[1, 2].map(");
    expect(run(result.code)).toEqual([[2, 4], 1]);
  });

  // Integration regression: `host.directoryExists?.bind(host)` (receiver
  // `F | undefined`) matched every imported function's Function.prototype.bind
  // through the erased generic match and was reported as ambiguous.
  it("never redirects a native Function method on an optional receiver", () => {
    const result = transform(
      [
        `import { head, chunk } from "fakestd";`,
        `import * as std from "fakestd";`,
        `declare function log(v: unknown): void;`,
        `const host: { f?: (s: string) => boolean } = { f: (s) => s === "a" };`,
        `const g = host.f?.bind(host);`,
        `const h = host.f!.call(host, "b");`,
        `log(g ? g("a") : "none");`,
        `log(h);`,
        `log([1].head());`,
        `log(chunk([1, 2], 1).length + std.clamp(5, 0, 1));`,
      ].join("\n")
    );
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("host.f?.bind(host)");
    expect(run(result.code)).toEqual([true, false, 1, 3]);
  });

  // `import { join } from "node:path"; xs.join("/")` became `join(xs, "/")`:
  // a rest first parameter (`...paths: string[]`) took the whole receiver.
  it("a rest-parameter function named like a native method does not hijack it", () => {
    const result = transform(
      [
        `import { join } from "fakepath";`,
        `declare function log(v: unknown): void;`,
        `const xs = ["a", "b"];`,
        `log(xs.join("/"));`,
        `log(join("x", "y"));`,
      ].join("\n"),
      {
        "node_modules/fakepath/package.json": JSON.stringify({
          name: "fakepath",
          version: "1.0.0",
          types: "index.d.ts",
        }),
        "node_modules/fakepath/index.d.ts":
          "export declare function join(...paths: string[]): string;",
      }
    );
    expect(result.code).toContain(`xs.join("/")`);
    expect(run(result.code, { fakepath: { join: (...p: string[]) => p.join("|") } })).toEqual([
      "a/b",
      "x|y",
    ]);
  });
});

describe("@opaque companion import subpath (docs C#1)", () => {
  const FAKE_FP = {
    "node_modules/fakefp/package.json": JSON.stringify({
      name: "fakefp",
      version: "1.0.0",
      exports: {
        ".": { types: "./dist/index.d.ts" },
        "./*": { types: "./dist/*.d.ts" },
      },
    }),
    "node_modules/fakefp/dist/index.d.ts": `export * from "./data/option.js";`,
    "node_modules/fakefp/dist/data/option.d.ts": [
      "/** @opaque A | null */",
      "export interface Option<A> {",
      "  map<B>(f: (a: A) => B): Option<B>;",
      "  getOrElse(d: () => A): A;",
      "}",
      "export declare function Some<A>(a: A): Option<A>;",
      "export declare function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B>;",
      "export declare function getOrElse<A>(o: Option<A>, d: () => A): A;",
    ].join("\n"),
  };
  const OPTION_RUNTIME = {
    Some: (a: unknown) => a,
    map: (o: unknown, f: (a: unknown) => unknown) => (o === null ? null : f(o)),
    getOrElse: (o: unknown, d: () => unknown) => (o === null ? d() : o),
  };
  const main = (spec: string) =>
    [
      `import { Some, type Option } from "${spec}";`,
      `declare function log(v: unknown): void;`,
      `const x: Option<number> = Some(42);`,
      `log(x.map((n) => n * 2).getOrElse(() => 0));`,
    ].join("\n");

  for (const spec of ["fakefp", "fakefp/data/option"]) {
    it(`imports companions from the real subpath when the user imports "${spec}"`, () => {
      const result = transform(main(spec), FAKE_FP);
      expect(result.code).not.toContain(`"fakefp/option"`);
      expect(result.code).toMatch(/from "fakefp\/data\/option"/);
      expect(
        run(result.code, { [spec]: OPTION_RUNTIME, "fakefp/data/option": OPTION_RUNTIME })
      ).toEqual([84]);
    });
  }
});

describe("JSDoc attribute tags on function declarations (docs B#4)", () => {
  const virtual = (code: string, name: string) =>
    transformCode(code, { fileName: `/virtual/${name}.ts` });

  it("/** @tailrec */ turns the recursion into a loop (deep recursion runs)", () => {
    const result = virtual(
      [
        `declare function log(v: unknown): void;`,
        `/** @tailrec */`,
        `function sumTo(n: number, acc: number): number {`,
        `  if (n === 0) return acc;`,
        `  return sumTo(n - 1, acc + n);`,
        `}`,
        `log(sumTo(200000, 0));`,
      ].join("\n"),
      "tailrec-jsdoc"
    );
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("while");
    expect(run(result.code)).toEqual([20000100000]);
  });

  it("/** @tailrec */ reports a non-tail call like the decorator form", () => {
    const result = virtual(
      [
        `/** @tailrec */`,
        `export function fact(n: number): number {`,
        `  if (n <= 1) return 1;`,
        `  return n * fact(n - 1);`,
        `}`,
      ].join("\n"),
      "tailrec-jsdoc-bad"
    );
    expect(result.diagnostics.some((d) => /tail position/.test(d.message))).toBe(true);
  });

  it("/** @extension */ registers the function so b.volume() is rewritten", () => {
    const result = virtual(
      [
        `declare function log(v: unknown): void;`,
        `interface Box { w: number; h: number; d: number }`,
        `/** @extension */`,
        `function volume(b: Box): number { return b.w * b.h * b.d; }`,
        `const b: Box = { w: 2, h: 3, d: 4 };`,
        `log((b as any).volume ? "native" : volume(b));`,
        `// @ts-expect-error -- no augmentation; the rewrite makes it a call`,
        `log(b.volume());`,
      ].join("\n"),
      "extension-jsdoc"
    );
    expect(result.code).toContain("volume(b)");
    expect(run(result.code)).toEqual([24, 24]);
  });

  it("a JSDoc tag whose macro does not target functions warns instead of vanishing", () => {
    const result = virtual(
      [`/** @derive(Eq) */`, `export function f(): number { return 1; }`].join("\n"),
      "derive-on-function"
    );
    expect(
      result.diagnostics.some((d) => /@derive/.test(d.message) && /function/.test(d.message))
    ).toBe(true);
  });

  it("keeps the line-start rule: a prose mention on a function does nothing", () => {
    const result = virtual(
      [
        `/** Unlike a @tailrec function, this one recurses normally. */`,
        `export function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }`,
      ].join("\n"),
      "tailrec-prose"
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain("while");
  });
});

describe("type macros dispatch by their own name (docs W#23)", () => {
  const FAKE_TM = {
    "node_modules/faketm/package.json": JSON.stringify({
      name: "faketm",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "node_modules/faketm/index.d.ts": [
      "export type Nullable<T> = T | null | undefined;",
      "export type Wrap<T> = { value: T };",
    ].join("\n"),
  };
  const calls: string[] = [];
  const typeArg = (node: ts.TypeReferenceNode) => node.typeArguments![0];
  for (const name of ["Nullable", "Wrap"]) {
    try {
      globalRegistry.register(
        defineTypeMacro({
          name,
          module: "faketm",
          expand(ctx, node) {
            calls.push(`${name} on ${ts.isIdentifier(node.typeName) ? node.typeName.text : "?"}`);
            const f = ctx.factory;
            return name === "Nullable"
              ? f.createUnionTypeNode([
                  typeArg(node),
                  f.createLiteralTypeNode(f.createNull()),
                  f.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
                ])
              : f.createTypeLiteralNode([
                  f.createPropertySignature(undefined, "value", undefined, typeArg(node)),
                ]);
          },
        })
      );
    } catch {
      // already registered by an earlier run in this worker
    }
  }

  it("does not expand the lib's Readonly<...> with the Nullable macro", () => {
    calls.length = 0;
    const result = transform(
      [
        `import type { Nullable, Wrap } from "faketm";`,
        `export type W = Nullable<string>;`,
        `export type C = Readonly<{ a: 1 }>;`,
        `export type V = Wrap<number>;`,
      ].join("\n"),
      FAKE_TM
    );
    expect(calls).toEqual(["Nullable on Nullable", "Wrap on Wrap"]);
    expect(result.code).toMatch(/type C = Readonly<\{\s*a: 1;?\s*\}>/);
    expect(result.code).toMatch(/type V = \{\s*value: number;?\s*\}/);
  });

  it("a non-macro Readonly<...> first does not hide a later macro", () => {
    calls.length = 0;
    const result = transform(
      [
        `import type { Wrap } from "faketm";`,
        `export type C = Readonly<{ a: 1 }>;`,
        `export type V = Wrap<number>;`,
      ].join("\n"),
      FAKE_TM
    );
    expect(calls).toEqual(["Wrap on Wrap"]);
    expect(result.code).toMatch(/type V = \{\s*value: number;?\s*\}/);
  });
});

describe("unresolved type-macro names do not share a cache slot (docs W#23 repro)", () => {
  // Registered with no module, as the type-macros guide does; none of these
  // names resolves to a declaration in a no-lib virtual program, so each one is
  // the checker's shared `unknownSymbol`.
  const calls: string[] = [];
  for (const name of ["DocNullable", "DocReadonly", "DocWrap"]) {
    try {
      globalRegistry.register(
        defineTypeMacro({
          name,
          expand(ctx, node) {
            calls.push(`${name} on ${ts.isIdentifier(node.typeName) ? node.typeName.text : "?"}`);
            return ctx.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
          },
        })
      );
    } catch {
      // already registered in this worker
    }
  }

  it("each reference is expanded by its own macro", () => {
    calls.length = 0;
    transformCode(
      [
        "type W = DocNullable<string>;",
        "type C = DocReadonly<{ a: 1 }>;",
        "type V = DocWrap<number>;",
      ].join("\n"),
      { fileName: "/virtual/type-macro-cache.ts" }
    );
    expect(calls).toEqual([
      "DocNullable on DocNullable",
      "DocReadonly on DocReadonly",
      "DocWrap on DocWrap",
    ]);
  });
});

describe("each diagnostic is reported once per site (docs C#27, S#29)", () => {
  const count = (result: TransformCodeResult, re: RegExp) =>
    result.diagnostics.filter((d) => re.test(d.message)).length;

  it("a failed `/** @impl */ const` reports once (TS9003 page)", () => {
    const result = transformCode(
      [
        `interface Point { x: number; y: number }`,
        `/** @impl */`,
        "const showPoint = { show: (p: Point) => `(${p.x}, ${p.y})` };",
      ].join("\n"),
      { fileName: "/virtual/impl-no-args.ts" }
    );
    expect(count(result, /@impl requires arguments/)).toBe(1);
    // ...and suggests the JSDoc form, not a decorator (invalid on a const).
    const message = result.diagnostics.find((d) => /@impl requires/.test(d.message))!.message;
    expect(message).toContain("/** @impl Typeclass<Type> */");
    expect(message).not.toContain('@impl("');
  });

  it("a duplicate @impl warns once (TS9006 page)", () => {
    const result = transformCode(
      [
        `/** @typeclass */`,
        `interface Eq<A> { equals(a: A, b: A): boolean }`,
        `interface Point { x: number; y: number }`,
        `/** @impl Eq<Point> */`,
        `const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x && a.y === b.y };`,
        `/** @impl Eq<Point> */`,
        `const eqPointByX: Eq<Point> = { equals: (a, b) => a.x === b.x };`,
      ].join("\n"),
      { fileName: "/virtual/impl-dup.ts" }
    );
    expect(count(result, /already provided by 'eqPoint'/)).toBe(1);
  });

  it("a skipped auto-specialization nested in another call warns once (TS9602)", () => {
    const result = transformCode(
      [
        `declare const out: { log(v: unknown): void };`,
        `/** @typeclass */`,
        `interface Ord<A> { compare(a: A, b: A): number }`,
        `interface Point { x: number }`,
        `/** @impl Ord<Point> */`,
        `const ordPoint: Ord<Point> = { compare: (a, b) => a.x - b.x };`,
        `function countEq<T>(items: T[], ord: Ord<T>): number {`,
        `  let n = 0;`,
        `  for (const x of items) { if (ord.compare(x, x) === 0) n++; }`,
        `  return n;`,
        `}`,
        `out.log(countEq([{ x: 1 }], ordPoint));`,
      ].join("\n"),
      { fileName: "/virtual/spec-skip.ts" }
    );
    expect(count(result, /TS9602/)).toBe(1);
  });

  it("an ambiguous summon nested in another call errors once", () => {
    const result = transformCode(
      [
        `import { summon } from "typesugar";`,
        `declare const out: { log(v: unknown): void };`,
        `/** @typeclass */`,
        `interface Show<A> { show(a: A): string }`,
        `/** @impl Show<number> */`,
        "const ShowNumber: Show<number> = { show: (n) => `${n}` };",
        `/** @impl Show<number> */`,
        "const ShowNumber2: Show<number> = { show: (n) => `#${n}` };",
        `out.log(summon<Show<number>>().show(1));`,
      ].join("\n"),
      { fileName: "/virtual/ambiguous.ts" }
    );
    expect(count(result, /Ambiguous Show instance/)).toBe(1);
  });
});

describe("/** @schema */ is a JSDoc macro tag (sql)", () => {
  it("an interface tagged @schema(...) dispatches", () => {
    const sf = ts.createSourceFile(
      "s.ts",
      `/** @schema("users") */\ninterface User { id: number }\n`,
      ts.ScriptTarget.Latest,
      true
    );
    expect(hasJSDocMacroTags(sf.statements[0])).toBe(true);
  });
});

describe("static companion calls on a derived class (docs S#24)", () => {
  const SRC = [
    `declare const out: { log(v: unknown): void };`,
    `/** @typeclass */`,
    `interface Json<A> { toJson(a: A): unknown; fromJson(json: unknown): A }`,
    `/** @derive(Json) */`,
    `class User {`,
    `  constructor(public id: number, public name: string) {}`,
    `}`,
    `const u = User.fromJson({ id: 1, name: "A" });`,
    `out.log(u.name);`,
    `out.log(new User(2, "B").toJson());`,
  ].join("\n");

  it("User.fromJson(x) compiles to User.Json.fromJson(x) and runs", () => {
    const result = transformCode(SRC, { fileName: "/virtual/static-companion.ts" });
    expect(result.code).toContain("User.Json.fromJson({");
    expect(result.code).not.toMatch(/typeof User\.Json/);
    expect(result.code).toContain("User.Json.toJson(new User(2,");
    const logged: unknown[] = [];
    const js = ts.transpileModule(result.code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    new Function("exports", "out", js)({}, { log: (v: unknown) => logged.push(v) });
    expect(logged).toEqual(["A", { id: 2, name: "B" }]);
  });
});

describe("@deriving is a deprecated alias of @derive", () => {
  const deprecation = (r: TransformCodeResult) =>
    r.diagnostics.filter((d) => /@deriving is deprecated/.test(d.message)).length;

  it("the decorator form derives and warns", () => {
    const r = transformCode(
      [`@deriving(Eq)`, `class P { constructor(public x: number) {} }`].join("\n"),
      { fileName: "/virtual/deriving-decorator.ts" }
    );
    expect(r.code).toMatch(/namespace P \{[\s\S]*export const Eq/);
    expect(deprecation(r)).toBe(1);
  });

  it("the JSDoc form derives and warns", () => {
    const r = transformCode(
      [`/** @deriving Eq */`, `class P { constructor(public x: number) {} }`].join("\n"),
      { fileName: "/virtual/deriving-jsdoc.ts" }
    );
    expect(r.code).toMatch(/namespace P \{[\s\S]*export const Eq/);
    expect(deprecation(r)).toBe(1);
  });

  it("@derive itself does not warn", () => {
    const r = transformCode(
      [`@derive(Eq)`, `class P { constructor(public x: number) {} }`].join("\n"),
      { fileName: "/virtual/derive-decorator.ts" }
    );
    expect(r.code).toMatch(/export const Eq/);
    expect(deprecation(r)).toBe(0);
  });
});

describe("a failed inner expression macro is expanded once (TS9001 twice)", () => {
  it("out.log(summon<Show<number[]>>().show([1])) reports once", () => {
    const r = transformCode(
      [
        `import { summon } from "typesugar";`,
        `declare const out: { log(v: unknown): void };`,
        `/** @typeclass */`,
        `interface Show<A> { show(a: A): string }`,
        `out.log(summon<Show<number[]>>().show([1]));`,
        `summon<Show<string[]>>().show(["a"]);`,
        `const t = summon<Show<boolean[]>>().show([true]);`,
      ].join("\n"),
      { fileName: "/virtual/summon-missing.ts" }
    );
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(errs.map((d) => `${d.start}:${d.message}`)).size).toBe(errs.length);
  });
});
