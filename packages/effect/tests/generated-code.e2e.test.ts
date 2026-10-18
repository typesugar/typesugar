/**
 * @typesugar/effect — end-to-end tests through the REAL transformer.
 *
 * Each test runs `transformCode` (the same pipeline the build uses) over a
 * source file, checks the reported diagnostics, and EXECUTES the emitted code
 * against the installed `effect` package (3.x). Tests that only grep output
 * text cannot catch "the generated call does not exist / has a different
 * arity in Effect 3" bugs; these do.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { createRequire } from "module";
import { Effect, Either, Exit, Layer, Context } from "effect";
import "../src/macros.js";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../transformer/dist/pipeline.js";
import { effectEitherMonadError, flatMapEffect, parCombineEffect } from "../src/index.js";
import { layerRegistry, registerLayer } from "../src/macros/layer.js";
import {
  testLayer,
  combineLayers,
  succeedMock,
  failMock,
  dieMock,
  mockService,
} from "../src/testing.js";

const FILE = path.resolve(__dirname, "../__effect_e2e_input.ts");
const req = createRequire(import.meta.url);

interface Expanded {
  code: string;
  errors: string[];
  warnings: string[];
}

function expand(src: string): Expanded {
  const r = transformCode(src, { fileName: FILE });
  const diags: any[] = r.diagnostics ?? [];
  const msg = (d: any) => String(d.message ?? d.messageText);
  return {
    code: r.code,
    errors: diags.filter((d) => d.severity === "error").map(msg),
    warnings: diags.filter((d) => d.severity === "warning").map(msg),
  };
}

/** Transpile the emitted TS to CJS and run it against the real `effect`; returns its exports. */
function run(code: string, globals: Record<string, unknown> = {}): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const require = (id: string) => {
    if (id === "effect") return req("effect");
    if (id === "@typesugar/effect") return {};
    throw new Error("unexpected require: " + id);
  };
  const names = Object.keys(globals);
  new Function("require", "module", "exports", ...names, js)(
    require,
    mod,
    mod.exports,
    ...names.map((n) => globals[n])
  );
  return mod.exports;
}

// ============================================================================
// #10 — layer composition must use Layer.mergeAll (Layer.merge takes 2 args)
// ============================================================================

describe("layerMake<R>() composition (#10)", () => {
  const src = `
import { Effect, Layer, Context } from "effect";
import { layerMake } from "@typesugar/effect";

export class C extends Context.Tag("C")<C, { readonly n: number }>() {}
export class B extends Context.Tag("B")<B, { readonly n: number }>() {}
export class A extends Context.Tag("A")<A, { readonly n: number }>() {}
export class D extends Context.Tag("D")<D, { readonly n: number }>() {}

const cLive = Layer.succeed(C, { n: 1 });
const dLive = Layer.succeed(D, { n: 100 });
const bLive = Layer.effect(B, Effect.map(C, (c) => ({ n: c.n + 1 })));
const aLive = Layer.effect(A, Effect.map(B, (b) => ({ n: b.n + 10 })));

export const app = layerMake<A | B | C | D>(aLive, bLive, cLive, dLive);
export const prog = Effect.gen(function* () {
  const a = yield* A;
  const b = yield* B;
  const c = yield* C;
  const d = yield* D;
  return [a.n, b.n, c.n, d.n];
});
`;

  it("provides every layer when more than two are composed", () => {
    const e = expand(src);
    expect(e.errors).toEqual([]);
    expect(e.code).not.toMatch(/Layer\.merge\(/);
    const m = run(e.code);
    expect(Effect.runSync(Effect.provide(m.prog, m.app))).toEqual([12, 2, 1, 100]);
  });

  it("wires transitive dependencies (A needs B needs C) without leaking requirements", () => {
    const e = expand(
      src
        .replace(
          "layerMake<A | B | C | D>(aLive, bLive, cLive, dLive)",
          "layerMake<A>(aLive, bLive, cLive)"
        )
        .replace(/const d = yield\* D;\n|const b = yield\* B;\n|const c = yield\* C;\n/g, "")
        .replace("[a.n, b.n, c.n, d.n]", "a.n")
    );
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(Effect.runSync(Effect.provide(m.prog, m.app))).toBe(12);
  });
  it("imports Layer itself when the file doesn't bind it", () => {
    const e = expand(`
import { Effect, Context, Layer as L } from "effect";
import { layerMake } from "@typesugar/effect";
export class C extends Context.Tag("C")<C, { readonly n: number }>() {}
export class B extends Context.Tag("B")<B, { readonly n: number }>() {}
const cLive = L.succeed(C, { n: 1 });
const bLive = L.effect(B, Effect.map(C, (c) => ({ n: c.n + 1 })));
export const app = layerMake<B | C>(bLive, cLive);
export const prog = Effect.map(B, (b) => b.n);
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(Effect.runSync(Effect.provide(m.prog, m.app))).toBe(2);
  });
});

describe("resolveLayer<R>() (#10, #28)", () => {
  const src = `
import { Effect, Context, Layer } from "effect";
import { resolveLayer } from "@typesugar/effect";
export class C extends Context.Tag("C")<C, { readonly n: number }>() {}
export class B extends Context.Tag("B")<B, { readonly n: number }>() {}
export class A extends Context.Tag("A")<A, { readonly n: number }>() {}
const cLive = Layer.succeed(C, { n: 1 });
const bLive = Layer.effect(B, Effect.map(C, (c) => ({ n: c.n + 1 })));
const aLive = Layer.effect(A, Effect.map(B, (b) => ({ n: b.n + 10 })));
export const app = resolveLayer<A>();
export const prog = Effect.map(A, (a) => a.n);
`;
  const reg = (sourceFile: string) => {
    layerRegistry.clear();
    registerLayer({ name: "cLive", provides: "C", requires: [], sourceFile, layerType: "succeed" });
    registerLayer({
      name: "bLive",
      provides: "B",
      requires: ["C"],
      sourceFile,
      layerType: "effect",
    });
    registerLayer({
      name: "aLive",
      provides: "A",
      requires: ["B"],
      sourceFile,
      layerType: "effect",
    });
  };

  it("composes registered in-scope layers transitively", () => {
    reg(FILE);
    try {
      const e = expand(src);
      expect(e.errors).toEqual([]);
      const m = run(e.code);
      expect(Effect.runSync(Effect.provide(m.prog, m.app))).toBe(12);
    } finally {
      layerRegistry.clear();
    }
  });

  it("does not silently fall back to layers from files that aren't imported", () => {
    reg("/somewhere/else/layers.ts");
    try {
      const e = expand(src);
      expect(e.errors.join("\n")).toMatch(/not imported by this file/);
    } finally {
      layerRegistry.clear();
    }
  });
});

// ============================================================================
// #11 — fusePipeline must not rewrite property names / duplicate side effects
// ============================================================================

describe("fusePipeline() (#11)", () => {
  it("keeps object shorthand / property names intact", () => {
    const e = expand(`
import { Effect } from "effect";
import { fusePipeline } from "@typesugar/effect";
const e = Effect.succeed({ name: "ann" });
export const a = fusePipeline(Effect.map(Effect.map(e, (u) => u.name), (name) => ({ name })));
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(Effect.runSync(m.a)).toEqual({ name: "ann" });
  });

  it("evaluates the inner function once per element, not once per use", () => {
    const e = expand(`
import { Effect } from "effect";
import { fusePipeline } from "@typesugar/effect";
export let calls = 0;
const expensive = (s: string) => { calls++; return s + "!"; };
const e = Effect.succeed({ name: "ann" });
export const b = fusePipeline(Effect.map(Effect.map(e, (u) => expensive(u.name)), (n) => [n, n]));
export const getCalls = () => calls;
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(Effect.runSync(m.b)).toEqual(["ann!", "ann!"]);
    expect(m.getCalls()).toBe(1);
  });

  it("does not capture a shadowed parameter", () => {
    const e = expand(`
import { Effect } from "effect";
import { fusePipeline } from "@typesugar/effect";
const e = Effect.succeed({ name: "ann" });
export const c = fusePipeline(Effect.map(Effect.map(e, (u) => u.name), (n) => [1].map((n) => n + 1)));
`);
    expect(e.errors).toEqual([]);
    expect(Effect.runSync(run(e.code).c)).toEqual([2]);
  });

  it("does not make flatMap(succeed(x), f) eager", () => {
    const e = expand(`
import { Effect } from "effect";
import { fusePipeline } from "@typesugar/effect";
export let ran = 0;
export const d = fusePipeline(Effect.flatMap(Effect.succeed(1), (x) => { ran++; return Effect.succeed(x + 1); }));
export const getRan = () => ran;
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(m.getRan()).toBe(0);
    expect(Effect.runSync(m.d)).toBe(2);
    expect(m.getRan()).toBe(1);
  });
});

// ============================================================================
// #12 — compileGen must not drop non-yield statements
// ============================================================================

describe("compileGen() (#12)", () => {
  it("keeps consts, calls and ordering between yields", () => {
    const e = expand(`
import { Effect } from "effect";
import { compileGen } from "@typesugar/effect";
export const log: string[] = [];
const getUser = (id: string) => Effect.sync(() => { log.push("get " + id); return { name: "ann", age: 20 }; });
const audit = (msg: string) => { log.push(msg); };
export const prog = (id: string) => compileGen(Effect.gen(function* () {
  const user = yield* getUser(id);
  const doubled = user.age * 2;
  audit("loaded " + user.name);
  yield* Effect.sync(() => log.push("after"));
  return { name: user.name, doubled };
}));
`);
    expect(e.errors).toEqual([]);
    expect(e.code).not.toMatch(/Effect\.gen/);
    const m = run(e.code);
    const p = m.prog("7");
    expect(m.log).toEqual([]); // still lazy
    expect(Effect.runSync(p)).toEqual({ name: "ann", doubled: 40 });
    expect(m.log).toEqual(["get 7", "loaded ann", "after"]);
  });

  it("reports an error (and leaves Effect.gen) for unsupported control flow", () => {
    const e = expand(`
import { Effect } from "effect";
import { compileGen } from "@typesugar/effect";
export const prog = compileGen(Effect.gen(function* () {
  for (const x of [1, 2]) { yield* Effect.log(String(x)); }
  return 1;
}));
`);
    expect(e.errors.join("\n")).toMatch(/compileGen|@compiled/);
  });
});

// ============================================================================
// #13 — specializeSchema must agree with Schema.decodeUnknownSync
// ============================================================================

describe("specializeSchema() (#13)", () => {
  function both(schemaSrc: string) {
    const e = expand(`
import { Schema } from "effect";
import { specializeSchema } from "@typesugar/effect";
export const schema = ${schemaSrc};
export const dec = specializeSchema(${schemaSrc});
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    const { Schema } = req("effect");
    const ref = Schema.decodeUnknownSync(m.schema);
    return (input: unknown) => {
      let expected: unknown;
      let expectedOk = true;
      try {
        expected = ref(input);
      } catch {
        expectedOk = false;
      }
      let actual: unknown;
      let actualOk = true;
      try {
        actual = m.dec(input);
      } catch {
        actualOk = false;
      }
      expect({ ok: actualOk, v: actual }).toEqual({ ok: expectedOk, v: expected });
    };
  }

  it("nested union field falls back to the FIELD's schema, not the top-level one", () => {
    const check = both(
      `Schema.Struct({ id: Schema.Number, kind: Schema.Union(Schema.Literal("a"), Schema.Literal("b")) })`
    );
    check({ id: 1, kind: "a" });
    check({ id: 1, kind: "c" });
  });

  it("Schema.BigInt decodes from string like Effect does", () => {
    const check = both(`Schema.Struct({ n: Schema.BigInt })`);
    check({ n: "12" });
    check({ n: 12n });
  });

  it("Literal with several values accepts all of them", () => {
    const check = both(`Schema.Literal("x", "y")`);
    check("x");
    check("y");
    check("z");
  });

  it("optional field: absent, present-undefined and present", () => {
    const check = both(`Schema.Struct({ nick: Schema.optional(Schema.String) })`);
    check({});
    check({ nick: undefined });
    check({ nick: "a" });
    check({ nick: 1 });
  });

  it("quoted keys are validated and kept", () => {
    const check = both(`Schema.Struct({ "first-name": Schema.String })`);
    check({ "first-name": "a" });
    check({ "first-name": 1 });
  });

  it("nested arrays/tuples/nullable", () => {
    const check = both(
      `Schema.Struct({ xs: Schema.Array(Schema.Tuple(Schema.String, Schema.NullOr(Schema.Number))) })`
    );
    check({
      xs: [
        ["a", 1],
        ["b", null],
      ],
    });
    check({ xs: [["a", "1"]] });
    check({ xs: [["a"]] });
  });

  it("specializeSchemaUnsafe evaluates its input expression once", () => {
    const e = expand(`
import { Schema } from "effect";
import { specializeSchemaUnsafe } from "@typesugar/effect";
export let n = 0;
const next = () => { n++; return { a: "x", b: 2 }; };
export const v = specializeSchemaUnsafe(Schema.Struct({ a: Schema.String, b: Schema.Number }), next());
export const getN = () => n;
`);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(m.v).toEqual({ a: "x", b: 2 });
    expect(m.getN()).toBe(1);
  });
});

// ============================================================================
// #14 / #15 — @service output must load without the user importing Context
// ============================================================================

describe("@service (#14, #15)", () => {
  const src = `
import { Effect } from "effect";
import { service } from "@typesugar/effect";

@service
export interface UserRepo {
  find(id?: string, ...rest: number[]): Effect.Effect<string>;
  pick<T>(xs: T[]): Effect.Effect<T>;
}

export const prog = Effect.provideService(
  UserRepo.find("u1", 1, 2),
  UserRepoTag,
  { find: (id?: string, ...rest: number[]) => Effect.succeed((id ?? "none") + ":" + rest.length), pick: (xs: any[]) => Effect.succeed(xs[0]) }
);
`;

  it("emits a Context import and runs against real Effect", () => {
    const e = expand(src);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    expect(Effect.runSync(m.prog)).toBe("u1:2");
  });

  it("preserves optional/rest parameters and method generics in the Tag shape", () => {
    const e = expand(src);
    expect(e.code).toMatch(/id\?: string/);
    expect(e.code).toMatch(/\.\.\.rest: number\[\]/);
    expect(e.code).toMatch(/pick: <T>\(xs: T\[\]\)/);
  });
});

// ============================================================================
// #16 / #23 — @derive(EffectSchema / EffectHash / EffectEqual)
// ============================================================================

describe("@derive(EffectSchema, EffectHash, EffectEqual) (#16)", () => {
  const src = `
import { Schema, Hash, Equal } from "effect";
import { EffectSchema, EffectHash, EffectEqual } from "@typesugar/effect";

/** @derive(EffectSchema, EffectHash, EffectEqual) */
export interface Tree {
  value: number;
  label: string;
  children: Tree[];
}

/** @derive(EffectSchema, EffectHash, EffectEqual) */
export interface Point {
  x: number;
  y: number;
  tag?: "a" | "b";
}
`;

  it("generates a working recursive schema (no TDZ)", () => {
    const e = expand(src);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    const { Schema } = req("effect");
    const t = { value: 1, label: "r", children: [{ value: 2, label: "c", children: [] }] };
    expect(Schema.decodeUnknownSync(m.TreeSchema)(t)).toEqual(t);
    expect(() => Schema.decodeUnknownSync(m.TreeSchema)({ ...t, children: [{}] })).toThrow();
    expect(Schema.decodeUnknownSync(m.PointSchema)({ x: 1, y: 2, tag: "a" })).toEqual({
      x: 1,
      y: 2,
      tag: "a",
    });
    expect(() => Schema.decodeUnknownSync(m.PointSchema)({ x: 1, y: 2, tag: "c" })).toThrow();
  });

  it("generates a hash function consistent with equality", () => {
    const m = run(expand(src).code);
    const h1 = m.PointHash({ x: 1, y: 2 });
    expect(typeof h1).toBe("number");
    expect(m.PointHash({ x: 1, y: 2 })).toBe(h1);
    expect(m.PointHash({ x: 2, y: 1 })).not.toBe(h1);
  });

  it("generates an Equivalence", () => {
    const m = run(expand(src).code);
    expect(m.PointEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(m.PointEqual({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
  });
});

describe("@derive on a discriminated union (#16)", () => {
  const src = `
import { EffectSchema, EffectHash, EffectEqual } from "@typesugar/effect";
export interface Circle { kind: "circle"; r: number }
export interface Rect { kind: "rect"; w: number; h: number }
/** @derive(EffectSchema, EffectHash, EffectEqual) */
export type Shape = Circle | Rect;
`;
  it("reports an error (not an empty Union) when variants can't be resolved", () => {
    const e = expand(`
import { EffectSchema } from "@typesugar/effect";
/** @derive(EffectSchema) */
export type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number };
`);
    expect(e.errors.join("\n")).toMatch(/could not resolve the union's variants/);
  });

  it("schema, hash and equality all discriminate on the tag", () => {
    const e = expand(src);
    expect(e.errors).toEqual([]);
    const m = run(e.code);
    const { Schema } = req("effect");
    expect(Schema.decodeUnknownSync(m.ShapeSchema)({ kind: "rect", w: 1, h: 2 })).toEqual({
      kind: "rect",
      w: 1,
      h: 2,
    });
    expect(() => Schema.decodeUnknownSync(m.ShapeSchema)({ kind: "rect", r: 1 })).toThrow();
    expect(m.ShapeEqual({ kind: "circle", r: 1 }, { kind: "circle", r: 1 })).toBe(true);
    expect(m.ShapeEqual({ kind: "circle", r: 1 }, { kind: "rect", w: 1, h: 1 })).toBe(false);
    expect(m.ShapeHash({ kind: "circle", r: 1 })).toBe(m.ShapeHash({ kind: "circle", r: 1 }));
    expect(m.ShapeHash({ kind: "circle", r: 1 })).not.toBe(m.ShapeHash({ kind: "circle", r: 2 }));
  });
});

// ============================================================================
// #22 — testing helpers must return real Layers / Effects
// ============================================================================

describe("testing helpers (#22)", () => {
  class Repo extends Context.Tag("Repo")<
    Repo,
    { readonly get: (id: string) => Effect.Effect<string> }
  >() {}
  class Log extends Context.Tag("Log")<Log, { readonly n: number }>() {}

  it("testLayer / combineLayers work with Effect.provide", () => {
    const mock = mockService<{ get: (id: string) => Effect.Effect<string> }>({
      get: (id) => Effect.succeed("user " + id),
    });
    const layer = combineLayers(testLayer(Repo, mock), testLayer(Log, { n: 3 }));
    const prog = Effect.gen(function* () {
      const r = yield* Repo;
      const l = yield* Log;
      return (yield* r.get("1")) + " " + l.n;
    });
    expect(Effect.runSync(Effect.provide(prog, layer as Layer.Layer<Repo | Log>))).toBe("user 1 3");
  });

  it("mockService is not thenable (await resolves)", async () => {
    const mock = mockService<{ get: () => number }>();
    expect((mock as any).then).toBeUndefined();
    await expect(Promise.resolve(mock)).resolves.toBe(mock);
  });

  it("succeedMock / failMock / dieMock return real Effects", () => {
    expect(Effect.runSync(succeedMock(5)() as Effect.Effect<number>)).toBe(5);
    const f = Effect.runSyncExit(failMock("boom")() as Effect.Effect<never, string>);
    expect(Exit.isFailure(f)).toBe(true);
    expect(Effect.runSync(Effect.flip(failMock("boom")() as Effect.Effect<never, string>))).toBe(
      "boom"
    );
    const d = Effect.runSyncExit(dieMock(new Error("x"))() as Effect.Effect<never>);
    expect(Exit.isFailure(d)).toBe(true);
  });
});

// ============================================================================
// #26 / #27 — runtime instances
// ============================================================================

describe("runtime instances (#26, #27)", () => {
  it("effectEitherMonadError.handleErrorWith passes the error value, not an Option", () => {
    const M = effectEitherMonadError<number>();
    const r = M.handleErrorWith(Either.left(1) as any, (e: number) => Either.right(e + 1) as any);
    expect(r).toEqual(Either.right(2));
  });

  it("flatMapEffect / parCombineEffect work (no CJS require under ESM)", () => {
    const fa = flatMapEffect.map(Effect.succeed(1), (x: number) => x + 1);
    expect(Effect.runSync(fa as Effect.Effect<number>)).toBe(2);
    const fb = flatMapEffect.flatMap(Effect.succeed(1), (x: number) => Effect.succeed(x * 3));
    expect(Effect.runSync(fb as Effect.Effect<number>)).toBe(3);
    const all = parCombineEffect.all([Effect.succeed(1), Effect.succeed(2)]);
    expect(Effect.runSync(all as Effect.Effect<number[]>)).toEqual([1, 2]);
  });
});
