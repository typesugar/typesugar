/**
 * @typesugar/validate — end-to-end tests through the REAL transformer.
 *
 * Each test runs `transformCode` over a source file, then executes the
 * emitted validators against real values (no grepping of output text).
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../macros.js";
// @ts-ignore -- load the transformer's built pipeline directly
import { TransformationPipeline } from "../../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../../__validate_e2e_input.ts");

interface Expanded {
  code: string;
  errors: string[];
  warnings: string[];
}

/** Run the real pipeline (like `transformCode`, but with configurable strictness). */
function expand(body: string, strict = true): Expanded {
  const src = `import { is, assert, assertType, validate } from "@typesugar/validate";\n${body}`;
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict,
      skipLibCheck: true,
    },
    [FILE],
    {
      readFile: (f: string) => (f === FILE ? src : ts.sys.readFile(f)),
      fileExists: (f: string) => f === FILE || ts.sys.fileExists(f),
    }
  );
  const r = pipeline.transform(FILE);
  const diags: any[] = r.diagnostics ?? [];
  const msg = (d: any) => String(d.message ?? d.messageText);
  return {
    code: r.code,
    errors: diags.filter((d) => d.severity === "error").map(msg),
    warnings: diags.filter((d) => d.severity === "warning").map(msg),
  };
}

function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    if (id === "@typesugar/validate") return {};
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

function build(body: string, strict = true): Record<string, any> {
  const e = expand(body, strict);
  expect(e.errors).toEqual([]);
  return run(e.code);
}

describe("#17 unions, literals, bigint, enums", () => {
  it("string | number union", () => {
    const m = build(`export const g = is<string | number>();`);
    expect(m.g("a")).toBe(true);
    expect(m.g(1)).toBe(true);
    expect(m.g({})).toBe(false);
    expect(m.g(null)).toBe(false);
  });
  it("single string literal", () => {
    const m = build(`export const g = is<"admin">();`);
    expect(m.g("admin")).toBe(true);
    expect(m.g("root")).toBe(false);
  });
  it("numeric literal union", () => {
    const m = build(`export const g = is<1 | 2 | 3>();`);
    expect(m.g(2)).toBe(true);
    expect(m.g(99)).toBe(false);
    expect(m.g("2")).toBe(false);
  });
  it("bigint", () => {
    const m = build(`export const g = is<bigint>();`);
    expect(m.g(1n)).toBe(true);
    expect(m.g("x")).toBe(false);
  });
  it("enums (numeric and string)", () => {
    const m = build(`
      enum Color { Red, Green }
      enum Dir { Up = "UP", Down = "DOWN" }
      export const c = is<Color>();
      export const d = is<Dir>();
    `);
    expect(m.c(0)).toBe(true);
    expect(m.c(1)).toBe(true);
    expect(m.c(5)).toBe(false);
    expect(m.d("UP")).toBe(true);
    expect(m.d("LEFT")).toBe(false);
  });
  it("discriminated union of objects", () => {
    const m = build(`
      type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
      export const g = is<Shape>();
    `);
    expect(m.g({ kind: "circle", r: 1 })).toBe(true);
    expect(m.g({ kind: "square", side: 1 })).toBe(true);
    expect(m.g({ kind: "circle", side: 1 })).toBe(false);
    expect(m.g({ kind: "tri" })).toBe(false);
  });
  it("union inside validate<T>() reports an error", () => {
    const m = build(`export const v = validate<{ id: string | number }>();`);
    expect(m.v({ id: true }).error).toBeDefined();
    expect(m.v({ id: 1 }).value).toEqual({ id: 1 });
  });
  it("unsupported types are a compile-time error, not an always-true check", () => {
    const e = expand(`
      export function f<T>() { return is<T>(); }
    `);
    expect(e.errors.length).toBeGreaterThan(0);
  });
});

describe("#18 null input, nullable fields, methods, array-field misclassification", () => {
  it("null input does not crash validate/assert", () => {
    const m = build(`
      interface U { name: string }
      export const v = validate<U>();
      export const a = assert<U>();
      export const g = is<U>();
    `);
    expect(() => m.v(null)).not.toThrow(TypeError);
    expect(m.v(null).error).toBeDefined();
    expect(() => m.a(undefined)).toThrow(/Validation failed/);
    expect(m.g(null)).toBe(false);
  });
  it("required T | null accepts null", () => {
    const m = build(`export const g = is<{ x: string | null }>();`);
    expect(m.g({ x: null })).toBe(true);
    expect(m.g({ x: "a" })).toBe(true);
    expect(m.g({ x: 1 })).toBe(false);
    expect(m.g({})).toBe(false);
  });
  it("required T | null accepts null without strictNullChecks too", () => {
    const m = build(
      `export const g = is<{ x: string | null }>(); export const t = is<number | null>();`,
      false
    );
    expect(m.g({ x: null })).toBe(true);
    expect(m.g({ x: 1 })).toBe(false);
    expect(m.t(null)).toBe(true);
    expect(m.t("1")).toBe(false);
  });
  it("methods are validated as functions", () => {
    const m = build(`export const g = is<{ run(): void; n: number }>();`);
    expect(m.g({ run: () => {}, n: 1 })).toBe(true);
    expect(m.g({ run: {}, n: 1 })).toBe(false);
  });
  it("object with an array field is not treated as an array", () => {
    const m = build(`export const g = is<{ tags: string[] }>();`);
    expect(m.g({ tags: [] })).toBe(true);
    expect(m.g({ tags: ["a"] })).toBe(true);
    expect(m.g({ tags: [1] })).toBe(false);
    expect(m.g([])).toBe(false);
  });
});

describe("#19 property keys, tuples, Date, recursive types", () => {
  it("quoted / non-identifier keys", () => {
    const m = build(`export const g = is<{ "first-name": string; 0: number }>();`);
    expect(m.g({ "first-name": "a", 0: 1 })).toBe(true);
    expect(m.g({ "first-name": 1, 0: 1 })).toBe(false);
  });
  it("tuples", () => {
    const m = build(`export const g = is<[string, number]>();`);
    expect(m.g(["a", 1])).toBe(true);
    expect(m.g([1, "a"])).toBe(false);
    expect(m.g(["a"])).toBe(false);
  });
  it("Date fields", () => {
    const m = build(`export const g = is<{ at: Date }>();`);
    expect(m.g({ at: new Date() })).toBe(true);
    expect(m.g({ at: "2020" })).toBe(false);
  });
  it("recursive types", () => {
    const m = build(`
      interface Tree { value: number; children: Tree[] }
      export const g = is<Tree>();
      export const v = validate<Tree>();
    `);
    expect(m.g({ value: 1, children: [{ value: 2, children: [] }] })).toBe(true);
    expect(m.g({ value: 1, children: [{ value: "x", children: [] }] })).toBe(false);
    expect(m.v({ value: 1, children: [{ value: "x", children: [] }] }).error).toBeDefined();
  });
});

describe("#32 validate<T>() returns fp ValidatedNel", () => {
  it("Valid is { value }, Invalid is { error: NonEmptyList }", async () => {
    const { isValid, isInvalid } = await import("@typesugar/fp");
    const m = build(`
      interface U { name: string; age: number }
      export const v = validate<U>();
    `);
    const ok = m.v({ name: "a", age: 1 });
    expect(isValid(ok)).toBe(true);
    expect(ok.value).toEqual({ name: "a", age: 1 });
    const bad = m.v({ name: 1, age: "x" });
    expect(isInvalid(bad)).toBe(true);
    expect(bad.error.head).toEqual({ path: "$.name", message: "expected string" });
    expect(bad.error.tail.head).toEqual({ path: "$.age", message: "expected number" });
    expect(bad.error.tail.tail).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Docs review r3 (guides-c #6, start #7): the generated code must type-check.
// strictOutput reported TS2339 "Property 'name' does not exist on type
// 'object'" for every member read; type-check the emitted code here.
// ---------------------------------------------------------------------------

function typecheckOutput(code: string): string[] {
  const file = path.resolve(__dirname, "../../__validate_typecheck_input.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === file ? ts.createSourceFile(f, code, lang, true) : origGet(f, lang, ...rest);
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === file || origExists(f);
  const program = ts.createProgram([file], options, host);
  const sf = program.getSourceFile(file)!;
  return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map(
    (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
  );
}

describe("r3: generated validators type-check", () => {
  const body = `
    interface Addr { city: string; "zip-code"?: string }
    interface User {
      name: string;
      age: number;
      tags: string[];
      pair: [string, number?];
      rest: [number, ...string[]];
      addr?: Addr;
      extra: Record<string, number>;
    }
    export const isUser = is<User>();
    export const checkUser = validate<User>();
    export const assertUser = assert<User>();
  `;
  it("is/validate/assert output has no type errors and still runs", () => {
    const e = expand(body);
    expect(e.errors).toEqual([]);
    expect(typecheckOutput(e.code)).toEqual([]);
    const m = run(e.code);
    const good = {
      name: "a",
      age: 1,
      tags: ["x"],
      pair: ["p"],
      rest: [1, "a", "b"],
      addr: { city: "c", "zip-code": "z" },
      extra: { a: 1 },
    };
    expect(m.isUser(good)).toBe(true);
    expect(m.isUser({ ...good, addr: { city: 1 } })).toBe(false);
    expect(m.isUser({ ...good, extra: { a: "x" } })).toBe(false);
    expect(m.checkUser(good)).toEqual({ value: good });
    expect(m.checkUser({ ...good, tags: [1] }).error.head.path).toBe("$.tags[0]");
    expect(m.assertUser(good).name).toBe("a");
    expect(() => m.assertUser({ ...good, rest: ["no"] })).toThrow(/Validation failed/);
  });
});

// ---------------------------------------------------------------------------
// is<T>(value) / assert<T>(value) / validate<T>(value): the immediate form
// (typia's `is<T>(input)` shape). An argument used to be silently dropped:
// `is<U>({ a: 1 })` returned the guard FUNCTION, which is always truthy.
// ---------------------------------------------------------------------------

describe("immediate form: a value argument checks it on the spot", () => {
  const body = `
    interface U { a: number }
    export const yes = is<U>({ a: 1 });
    export const no = is<U>({ a: "x" });
    export const asserted = assert<U>({ a: 2 });
    export const assertedType = assertType<U>({ a: 3 });
    export const valid = validate<U>({ a: 4 });
    export const invalid = validate<U>({ a: "y" });
    export function narrow(x: unknown): number { return is<U>(x) ? x.a : -1; }
    export function bad(): U { return assert<U>({ a: "z" }); }
  `;
  it("returns a boolean / the value / a Validated, and type-checks", () => {
    const e = expand(body);
    expect(e.errors).toEqual([]);
    expect(typecheckOutput(e.code)).toEqual([]);
    const m = run(e.code);
    expect(m.yes).toBe(true);
    expect(m.no).toBe(false);
    expect(m.asserted).toEqual({ a: 2 });
    expect(m.assertedType).toEqual({ a: 3 });
    expect(m.valid).toEqual({ value: { a: 4 } });
    expect(m.invalid.error.head).toEqual({ path: "$.a", message: "expected number" });
    expect(m.narrow({ a: 5 })).toBe(5);
    expect(m.narrow({})).toBe(-1);
    expect(() => m.bad()).toThrow(/Validation failed/);
  });

  it("evaluates the argument exactly once", () => {
    const m = build(`
      interface U { a: number }
      let calls = 0;
      function next(): unknown { calls++; return { a: calls }; }
      export const r = is<U>(next());
      export const count = () => calls;
    `);
    expect(m.r).toBe(true);
    expect(m.count()).toBe(1);
  });

  it("more than one argument is a compile-time error, not silently ignored", () => {
    const e = expand(`export const r = is<number>(1, 2);`);
    expect(e.errors.join("\n")).toMatch(/is<T>\(\) takes no arguments or one value/);
  });
});

// ---------------------------------------------------------------------------
// assertType<T>(): first-class alias of assert<T>() (typescript-is / typia v2
// naming), so a file can also import @typesugar/testing's `assert`.
// ---------------------------------------------------------------------------

describe("assertType<T>() is an alias of assert<T>()", () => {
  it("expands to the same code and behaves the same", () => {
    const viaAssert = expand(
      `interface U { a: number; b?: string[] }\nexport const f = assert<U>();`
    );
    const viaAlias = expand(
      `interface U { a: number; b?: string[] }\nexport const f = assertType<U>();`
    );
    expect(viaAlias.errors).toEqual([]);
    // The harness imports all four names; only the unused-import line differs.
    const body = (code: string) => code.split("\n").filter((l) => !l.startsWith("import "));
    expect(body(viaAlias.code)).toEqual(body(viaAssert.code));
    const m = run(viaAlias.code);
    expect(m.f({ a: 1 })).toEqual({ a: 1 });
    expect(() => m.f({ a: 1, b: [2] })).toThrow(/Validation failed/);
  });
});
