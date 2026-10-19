/**
 * transformer-core bugs found by running the REWRITTEN documentation examples
 * through the real pipeline (2026-10 docs review, round 3, group r3-engine).
 *
 * 1. Binary `@op` ignored the right operand's type: `v + 5` with a `Vec2`
 *    instance became `({ x: v.x + 5..x, ... })` silently (guides-b #2).
 * 2. Prefix-unary `@op` (`-v` with `@op -` on a one-parameter method) was
 *    never dispatched (guides-b #1).
 * 3. Extension / method sugar on a VARIABLE initialised from an un-annotated
 *    sugared call (`const r3 = (0).to(100).step(10); r3.toArray()`,
 *    `const c = p.clone(); c.equals(p)`) was left as a plain method call and
 *    crashed at runtime (authoring #1, start #3).
 * 4. `import { Effect } from "effect"` (a module namespace imported by NAME)
 *    was scanned as an extension provider, making `eff.map(f)` ambiguous with
 *    `EffectExt.map`; and a chained `.flatMap` after a GENERIC extension call
 *    was not rewritten (start #2).
 * 5. `/** @contract *\/` was not a JSDoc macro tag, and a registered
 *    third-party attribute macro could only be triggered in decorator form
 *    (guides-b #4, start #6).
 * 6. A call completed by `= implicit()` is filled in but deliberately NOT
 *    auto-specialized (PEP-056 parity choice; see
 *    packages/transformer/tests/implicit-no-autospec.test.ts) -- pinned here
 *    so the docs' description stays true (guides-c #1).
 *
 * Each test transforms a real on-disk program and, where the bug was a
 * runtime failure, EXECUTES the output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  clearTypeRewrites,
  standaloneExtensionRegistry,
  defineAttributeMacro,
  globalRegistry,
} from "@typesugar/core";
import "@typesugar/macros";

import { transformCode, type TransformCodeResult } from "../src/transform.js";
import { hasJSDocMacroTags } from "../src/macro-helpers.js";
import { resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

function makeProject(
  main: string,
  extraFiles: Record<string, string> = {}
): { program: ts.Program; fileName: string; cleanup(): void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "docs-review-engine-r3-")));
  const files: Record<string, string> = { ...extraFiles, "main.ts": main };
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
    return transformCode(sf.text, { program: project.program, fileName: project.fileName });
  } finally {
    project.cleanup();
  }
}

/** A fake npm package: `package.json` + `index.d.ts` (+ extra files). */
function fakePackage(name: string, files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    [`node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      types: "index.d.ts",
    }),
  };
  for (const [f, content] of Object.entries(files)) out[`node_modules/${name}/${f}`] = content;
  return out;
}

/** Transpile to CJS and run; `log` collects console.log output. */
function run(code: string, modules: Record<string, unknown> = {}): unknown[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logged: unknown[] = [];
  const req = (m: string) => {
    if (m in modules) return modules[m];
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", "log", js)({}, req, (v: unknown) => logged.push(v));
  return logged;
}

const errors = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.severity === "error");

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
// 1 + 2. @op operand types and prefix-unary dispatch
// ---------------------------------------------------------------------------

const VEC_PRELUDE = [
  `declare function log(v: unknown): void;`,
  `interface Vec2 { x: number; y: number }`,
  `/** @typeclass */`,
  `interface VecOps<A> {`,
  `  /** @op + */`,
  `  add(a: A, b: A): A;`,
  `  /** @op - */`,
  `  sub(a: A, b: A): A;`,
  `  /** @op - */`,
  `  negate(a: A): A;`,
  `}`,
  `/** @impl VecOps<Vec2> */`,
  `const vecOps: VecOps<Vec2> = {`,
  `  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),`,
  `  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),`,
  `  negate: (a) => ({ x: -a.x, y: -a.y }),`,
  `};`,
  `const v: Vec2 = { x: 1, y: 2 };`,
  `const w: Vec2 = { x: 3, y: 4 };`,
].join("\n");

describe("binary @op checks the right operand's type (docs guides-b #2)", () => {
  it("v + w dispatches; v + 5 stays native and reports an error", () => {
    const result = transform(
      [VEC_PRELUDE, `log(v + w);`, `// @ts-ignore`, `export const bad = () => v + 5;`].join("\n")
    );
    // `v + 5` is not turned into `add(v, 5)` (which inlines to `5..x`).
    expect(result.code).not.toMatch(/5\.\.x|add\(v, 5\)/);
    expect(result.code).toMatch(/v \+ 5/);
    const errs = errors(result);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/'\+'/);
    expect(errs[0].message).toMatch(/Vec2/);
    expect(errs[0].message).toMatch(/number|5/);
    expect(run(result.code.replace(/export const bad[^\n]*/, ""))).toEqual([{ x: 4, y: 6 }]);
  });

  it("an object literal assignable to the instance type still dispatches", () => {
    const result = transform([VEC_PRELUDE, `log(v + { x: 10, y: 20 });`].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(run(result.code)).toEqual([{ x: 11, y: 22 }]);
  });
});

describe("prefix-unary @op (docs guides-b #1)", () => {
  it("-v dispatches to the one-parameter method; v - w still uses the binary one", () => {
    const result = transform([VEC_PRELUDE, `log(-v);`, `log(v - w);`].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(run(result.code)).toEqual([
      { x: -1, y: -2 },
      { x: -2, y: -2 },
    ]);
  });

  it("a unary operator on a primitive is left alone", () => {
    const result = transform([VEC_PRELUDE, `const n = 3;`, `log(-n);`].join("\n"));
    expect(result.code).toMatch(/log\(-n\)/);
    expect(run(result.code)).toEqual([-3]);
  });

  it("a binary-only @op does not dispatch the unary form", () => {
    const result = transform(
      [
        `declare function log(v: unknown): void;`,
        `interface M { n: number }`,
        `/** @typeclass */`,
        `interface Plus<A> {`,
        `  /** @op + */`,
        `  plus(a: A, b: A): A;`,
        `}`,
        `/** @impl Plus<M> */`,
        `const plusM: Plus<M> = { plus: (a, b) => ({ n: a.n + b.n }) };`,
        `const m: M = { n: 1 };`,
        `// @ts-ignore`,
        `log(+m);`,
      ].join("\n")
    );
    expect(result.code).toMatch(/log\(\+m\)/);
  });
});

// ---------------------------------------------------------------------------
// 3. Sugar on a variable initialised from an un-annotated sugared call
// ---------------------------------------------------------------------------

const FAKE_RANGE = fakePackage("fakerange", {
  "index.d.ts": [
    // `step` is also a FIELD, so `(0).to(10).step(5)` is a checker error and
    // the variable it initialises is typed as an error type.
    "export interface Range { start: number; end: number; step: number }",
    "export declare function to(a: number, b: number): Range;",
    "export declare function step(r: Range, n: number): Range;",
    "export declare function toArray(r: Range): number[];",
    "declare global {",
    "  interface Number { to(end: number): Range }",
    "}",
  ].join("\n"),
});

const RANGE_RUNTIME = {
  to: (start: number, end: number) => ({ start, end, step: 1 }),
  step: (r: { start: number; end: number }, step: number) => ({ ...r, step }),
  toArray: (r: { start: number; end: number; step: number }) => {
    const out: number[] = [];
    for (let i = r.start; i <= r.end; i += r.step) out.push(i);
    return out;
  },
};

describe("sugar on a variable initialised from a sugared call (docs authoring #1, start #3)", () => {
  it("const r3 = (0).to(10).step(5); r3.toArray() is rewritten and runs", () => {
    const result = transform(
      [
        `import { to, step, toArray } from "fakerange";`,
        `declare function log(v: unknown): void;`,
        `const r3 = (0).to(10).step(5);`,
        `log(r3.toArray());`,
        `let r4 = r3.step(2);`,
        `log(r4.toArray());`,
      ].join("\n"),
      FAKE_RANGE
    );
    expect(result.code).toContain("toArray(r3)");
    expect(run(result.code, { fakerange: RANGE_RUNTIME })).toEqual([
      [0, 5, 10],
      [0, 2, 4, 6, 8, 10],
    ]);
  });

  it("const c = p.dup(); c.same(p) uses method sugar on the inferred type and runs", () => {
    const result = transform(
      [
        `declare function log(v: unknown): void;`,
        `/** @typeclass */`,
        `interface Dup<A> { dup(a: A): A; same(a: A, b: A): boolean }`,
        `interface P { x: number }`,
        `/** @impl Dup<P> */`,
        `const dupP: Dup<P> = { dup: (a) => ({ x: a.x }), same: (a, b) => a.x === b.x };`,
        `const p: P = { x: 1 };`,
        `const c = p.dup();`,
        `log(c === p);`,
        `log(c.same(p));`,
        `log(p.dup().same(p));`,
      ].join("\n")
    );
    expect(result.code).not.toMatch(/c\.same\(/);
    expect(run(result.code)).toEqual([false, true, true]);
  });
});

// ---------------------------------------------------------------------------
// 4. A module namespace imported by name is not an extension provider
// ---------------------------------------------------------------------------

const FAKE_EFFECT = {
  ...fakePackage("fakeeffect", {
    "index.d.ts": `export * as Effect from "./Effect";`,
    "Effect.d.ts": [
      "export interface Effect<A, E = never> { readonly _A: A; readonly _E: E }",
      "export declare function succeed<A>(a: A): Effect<A>;",
      "export declare function map<A, E, B>(self: Effect<A, E>, f: (a: A) => B): Effect<B, E>;",
      "export declare function flatMap<A, E, B, E2>(self: Effect<A, E>, f: (a: A) => Effect<B, E2>): Effect<B, E | E2>;",
      "export declare function runSync<A, E>(self: Effect<A, E>): A;",
    ].join("\n"),
  }),
  ...fakePackage("fakeeffectext", {
    "index.d.ts": [
      `import type { Effect } from "fakeeffect";`,
      "export declare namespace EffectExt {",
      "  function map<A, E, B>(self: Effect.Effect<A, E>, f: (a: A) => B): Effect.Effect<B, E>;",
      "  function flatMap<A, E, B, E2>(self: Effect.Effect<A, E>, f: (a: A) => Effect.Effect<B, E2>): Effect.Effect<B, E | E2>;",
      "}",
    ].join("\n"),
  }),
};

type Eff = { value: unknown };
const EFFECT_MODULE = {
  succeed: (a: unknown): Eff => ({ value: a }),
  map: (self: Eff, f: (a: unknown) => unknown): Eff => ({ value: f(self.value) }),
  flatMap: (self: Eff, f: (a: unknown) => Eff): Eff => f(self.value),
  runSync: (self: Eff) => self.value,
};
const EFFECT_RUNTIME = {
  fakeeffect: { Effect: EFFECT_MODULE },
  fakeeffectext: { EffectExt: { map: EFFECT_MODULE.map, flatMap: EFFECT_MODULE.flatMap } },
};

describe('EffectExt with `import { Effect } from "effect"` (docs start #2)', () => {
  it("the from-effect.md example: map + chained flatMap rewrite to EffectExt and run", () => {
    const result = transform(
      [
        `import { EffectExt } from "fakeeffectext";`,
        `import { Effect } from "fakeeffect";`,
        `declare function log(v: unknown): void;`,
        `const eff = Effect.succeed(1);`,
        `const r = eff.map((x) => x + 1).flatMap((x) => Effect.succeed(x * 2));`,
        `log(Effect.runSync(r));`,
      ].join("\n"),
      FAKE_EFFECT
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("EffectExt.flatMap(EffectExt.map(eff");
    expect(run(result.code, EFFECT_RUNTIME)).toEqual([4]);
  });

  it("`import * as` of the same module is still an extension provider", () => {
    const result = transform(
      [
        `import * as Effect from "fakeeffect/Effect";`,
        `declare function log(v: unknown): void;`,
        `const eff = Effect.succeed(1);`,
        `log(Effect.runSync(eff.map((x) => x + 1)));`,
      ].join("\n"),
      FAKE_EFFECT
    );
    expect(result.code).toContain("Effect.map(eff");
    expect(run(result.code, { "fakeeffect/Effect": EFFECT_MODULE })).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// 5. JSDoc dispatch: @contract and registered third-party attribute macros
// ---------------------------------------------------------------------------

describe("JSDoc attribute tags: @contract and third-party macros (docs guides-b #4, start #6)", () => {
  it("/** @contract */ on a function is a JSDoc macro tag", () => {
    const sf = ts.createSourceFile(
      "/virtual/c.ts",
      `/** @contract */\nfunction f(n: number): number { return n; }`,
      ts.ScriptTarget.Latest,
      true
    );
    expect(hasJSDocMacroTags(sf.statements[0])).toBe(true);
  });

  const LOGGED = defineAttributeMacro({
    name: "logged",
    module: "my-macros",
    validTargets: ["function"],
    expand(ctx, _decorator, target) {
      if (!ts.isFunctionDeclaration(target) || !target.body) return target;
      const f = ctx.factory;
      const logCall = f.createExpressionStatement(
        f.createCallExpression(f.createIdentifier("log"), undefined, [
          f.createStringLiteral(`calling ${target.name?.text ?? "?"}`),
        ])
      );
      return f.updateFunctionDeclaration(
        target,
        target.modifiers?.filter((m) => !ts.isDecorator(m)),
        target.asteriskToken,
        target.name,
        target.typeParameters,
        target.parameters,
        target.type,
        f.updateBlock(target.body, [logCall, ...target.body.statements])
      );
    },
  });
  const MY_MACROS = fakePackage("my-macros", { "index.d.ts": "export declare const logged: any;" });

  beforeEach(() => {
    globalRegistry.register(LOGGED);
  });

  it("a registered attribute macro whose module the file imports dispatches from JSDoc", () => {
    const result = transform(
      [
        `import "my-macros";`,
        `declare function log(v: unknown): void;`,
        `/** @logged */`,
        `function greet(name: string) { return "hi " + name; }`,
        `log(greet("a"));`,
      ].join("\n"),
      MY_MACROS
    );
    expect(result.diagnostics).toEqual([]);
    expect(run(result.code, { "my-macros": {} })).toEqual(["calling greet", "hi a"]);
  });

  it("does not dispatch when the file does not import the macro's module", () => {
    const result = transform(
      [
        `declare function log(v: unknown): void;`,
        `/** @logged */`,
        `function greet(name: string) { return "hi " + name; }`,
        `log(greet("a"));`,
      ].join("\n"),
      MY_MACROS
    );
    expect(result.diagnostics).toEqual([]);
    expect(run(result.code, { "my-macros": {} })).toEqual(["hi a"]);
  });

  it("keeps the line-start rule for third-party tags", () => {
    const result = transform(
      [
        `import "my-macros";`,
        `declare function log(v: unknown): void;`,
        `/** Unlike a @logged function, this one is quiet. */`,
        `function greet(name: string) { return "hi " + name; }`,
        `log(greet("a"));`,
      ].join("\n"),
      MY_MACROS
    );
    expect(run(result.code, { "my-macros": {} })).toEqual(["hi a"]);
  });
});

// ---------------------------------------------------------------------------
// 6. A call completed by `= implicit()` is filled in, NOT auto-specialized
// ---------------------------------------------------------------------------

describe("= implicit() calls are filled in but not specialized (docs guides-c #1)", () => {
  it("sortWith([3, 1, 2]) fills numberOrd and keeps dictionary passing", () => {
    const result = transform(
      [
        `import { implicit } from "typesugar";`,
        `declare function log(v: unknown): void;`,
        `interface Ord<A> { compare(a: A, b: A): number }`,
        `/** @impl Ord<number> */`,
        `const numberOrd: Ord<number> = {`,
        `  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),`,
        `};`,
        `function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {`,
        `  return items.slice().sort((a, b) => ord.compare(a, b));`,
        `}`,
        `log(sortWith([3, 1, 2]));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("sortWith([3, 1, 2], numberOrd)");
    expect(result.code).not.toMatch(/__typesugar___sortWith_/);
    expect(run(result.code, { typesugar: { implicit: () => undefined } })).toEqual([[1, 2, 3]]);
  });
});

// ---------------------------------------------------------------------------
// Extra (r3-libs): an instance visible only as a .d.ts declaration
// ---------------------------------------------------------------------------

const FAKE_INST = fakePackage("fakeinst", {
  "index.d.ts": [
    "/** @typeclass */",
    "export interface Pretty<A> { pretty(a: A): string }",
    "export declare const prettyNum: Pretty<number>;",
    "export declare const notAnInstance: { pretty(a: number): string };",
  ].join("\n"),
});

describe("auto-specialization of a .d.ts-only instance says why it was skipped", () => {
  const SRC = (arg: string) =>
    [
      `import { prettyNum, notAnInstance, type Pretty } from "fakeinst";`,
      `function render<A>(a: A, P: Pretty<A>): string { return P.pretty(a); }`,
      `export const s = render(1, ${arg});`,
    ].join("\n");
  const ts9602 = (r: TransformCodeResult) => r.diagnostics.filter((d) => /TS9602/.test(d.message));

  it("warns TS9602 naming the instance when it is only a declaration", () => {
    const result = transform(SRC("prettyNum"), FAKE_INST);
    const warns = ts9602(result);
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toMatch(/render/);
    expect(warns[0].message).toMatch(/prettyNum/);
    expect(warns[0].message).toMatch(/\.d\.ts/);
    expect(result.code).toContain("render(1, prettyNum)");
  });

  it("does not warn for a declaration-only value whose type is not a typeclass", () => {
    const result = transform(SRC("notAnInstance"), FAKE_INST);
    expect(ts9602(result)).toEqual([]);
  });
});

describe("a .d.ts instance marked /** @impl */ (validate nativeSchema)", () => {
  it("warns TS9602 even when its declared type is not itself a typeclass", () => {
    const files = fakePackage("fakeval", {
      "index.d.ts": [
        "export interface Schema<F> { parse(s: F, d: unknown): unknown }",
        "interface NativeSchema { readonly parse: (s: string, d: unknown) => unknown }",
        "/** @impl Schema<string> */",
        "export declare const nativeSchema: NativeSchema;",
      ].join("\n"),
    });
    const result = transform(
      [
        `import { nativeSchema, type Schema } from "fakeval";`,
        `function processBody<F>(S: Schema<F>, s: F, d: unknown): unknown { return S.parse(s, d); }`,
        `export const r = processBody(nativeSchema, "x", 1);`,
      ].join("\n"),
      files
    );
    expect(result.diagnostics.filter((d) => /TS9602.*nativeSchema/.test(d.message))).toHaveLength(
      1
    );
  });
});
