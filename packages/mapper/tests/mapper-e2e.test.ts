/**
 * @typesugar/mapper — end-to-end tests through the REAL transformer.
 *
 * Each test runs `transformCode` (the same pipeline the build uses) over a
 * source file, checks the reported diagnostics, and — where the expansion is
 * expected to succeed — executes the emitted code.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import "../src/macros.js";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../transformer/dist/pipeline.js";

const FILE = path.resolve(__dirname, "../__mapper_e2e_input.ts");

interface Expanded {
  code: string;
  errors: string[];
  warnings: string[];
}

function expand(body: string): Expanded {
  const src = `import { transformInto, transformArrayInto } from "@typesugar/mapper";\n${body}`;
  const r = transformCode(src, { fileName: FILE });
  const diags: any[] = r.diagnostics ?? [];
  const msg = (d: any) => String(d.message ?? d.messageText);
  return {
    code: r.code,
    errors: diags.filter((d) => d.severity === "error").map(msg),
    warnings: diags.filter((d) => d.severity === "warning").map(msg),
  };
}

/** Transpile the emitted TS to CJS and run it; returns its exports. */
function run(code: string): Record<string, any> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const req = (id: string) => {
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  return mod.exports;
}

function expectNoErrors(e: Expanded) {
  expect(e.errors).toEqual([]);
  expect(e.code).not.toMatch(/\btransformInto\s*</);
  expect(e.code).not.toMatch(/\btransformArrayInto\s*</);
}

describe("FMG-2: field type compatibility", () => {
  it("reports an error for a string -> number field", () => {
    const e = expand(`
interface S { id: string } interface D { id: number }
declare const s: S;
export const d = transformInto<S, D>(s);
`);
    expect(e.errors.join("\n")).toMatch(/id/);
    expect(e.errors.join("\n")).toMatch(/not assignable|incompatible/i);
  });

  it("reports an error for optional -> required (transformArrayInto)", () => {
    const e = expand(`
interface S { a?: number } interface D { a: number }
declare const s: S[];
export const d = transformArrayInto<S, D>(s);
`);
    expect(e.errors.join("\n")).toMatch(/'a'/);
  });

  it("reports an error for a renamed field of the wrong type", () => {
    const e = expand(`
interface S { n: string } interface D { id: number }
declare const s: S;
export const d = transformInto<S, D>(s, { rename: { id: "n" } });
`);
    expect(e.errors.join("\n")).toMatch(/id/);
  });

  it("accepts compatible fields (literal -> wider, required -> optional)", () => {
    const e = expand(`
interface S { kind: "a"; n: number } interface D { kind: string; n?: number }
const s: S = { kind: "a", n: 1 };
export const d = transformInto<S, D>(s);
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ kind: "a", n: 1 });
  });
});

describe("FMG-4: await/yield in the source expression", () => {
  it("await in the source of a complex expression still runs", async () => {
    const e = expand(`
interface S { id: number; name: string } interface D { id: number }
async function get(): Promise<S> { return { id: 7, name: "x" }; }
export async function f() { return transformInto<S, D>(await get()); }
`);
    expectNoErrors(e);
    const out = run(e.code);
    await expect(out.f()).resolves.toEqual({ id: 7 });
  });

  it("yield in the source of a generator still runs", () => {
    const e = expand(`
interface S { id: number; name: string } interface D { id: number }
export function* g(): Generator<number, D, S> { return transformInto<S, D>(yield 1); }
`);
    expectNoErrors(e);
    const it = run(e.code).g();
    it.next();
    expect(it.next({ id: 3, name: "y" }).value).toEqual({ id: 3 });
  });

  it("the source expression is evaluated exactly once", () => {
    const e = expand(`
interface S { a: number; b: number } interface D { a: number; b: number }
let calls = 0;
function mk(): S { calls++; return { a: 1, b: 2 }; }
export const d = transformInto<S, D>(mk());
export const count = () => calls;
`);
    expectNoErrors(e);
    const out = run(e.code);
    expect(out.d).toEqual({ a: 1, b: 2 });
    expect(out.count()).toBe(1);
  });
});

describe("FMG-6: optional nested source objects", () => {
  const decls = `
interface S { address?: { city: string } }
interface D { address?: { location: string } }
`;
  it("maps a present optional nested object with its renames", () => {
    const e = expand(`${decls}
const s: S = { address: { city: "Paris" } };
export const d = transformInto<S, D>(s, { nested: { address: { rename: { location: "city" } } } });
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ address: { location: "Paris" } });
  });

  it("passes undefined through for an absent optional nested object", () => {
    const e = expand(`${decls}
const s: S = {};
export const d = transformInto<S, D>(s, { nested: { address: { rename: { location: "city" } } } });
`);
    expectNoErrors(e);
    expect(run(e.code).d.address).toBeUndefined();
  });

  it("reports an error for optional nested source -> required nested target", () => {
    const e = expand(`
interface S { address?: { city: string } }
interface D { address: { location: string } }
declare const s: S;
export const d = transformInto<S, D>(s, { nested: { address: { rename: { location: "city" } } } });
`);
    expect(e.errors.join("\n")).toMatch(/address/);
  });
});

describe("FMG-7: config shapes the macro cannot read are errors, not silently ignored", () => {
  const decls = `
interface S { name: string; fullName: string; first: string }
interface D { name: string }
`;
  it("rename value with 'as const' is honoured", () => {
    const e = expand(`${decls}
const s: S = { name: "n", fullName: "full", first: "f" };
export const d = transformInto<S, D>(s, { rename: { name: "fullName" as const } });
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ name: "full" });
  });

  it("config held in a variable is an error", () => {
    const e = expand(`${decls}
declare const s: S;
const cfg = { rename: { name: "fullName" as const } };
export const d = transformInto<S, D>(s, cfg);
`);
    expect(e.errors.join("\n")).toMatch(/inline object literal/i);
  });

  it("method-syntax compute is honoured", () => {
    const e = expand(`
interface S { first: string } interface D { label: string }
const s: S = { first: "ab" };
export const d = transformInto<S, D>(s, { compute: { label(x) { return x.first.toUpperCase(); } } });
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ label: "AB" });
  });

  it("shorthand compute is honoured", () => {
    const e = expand(`
interface S { first: string } interface D { label: string }
const s: S = { first: "ab" };
const label = (x: S) => x.first + "!";
export const d = transformInto<S, D>(s, { compute: { label } });
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ label: "ab!" });
  });

  it("ignore.target with 'as const' is honoured", () => {
    const e = expand(`
interface S { a: number } interface D { a: number; b: number }
const s: S = { a: 1 };
export const d = transformInto<S, D>(s, { ignore: { target: ["b"] as const } } as any);
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ a: 1 });
  });

  it("spread in config is an error", () => {
    const e = expand(`${decls}
declare const s: S;
const base = { rename: { name: "fullName" as const } };
export const d = transformInto<S, D>(s, { ...base });
`);
    expect(e.errors.join("\n")).toMatch(/spread|not supported|cannot/i);
  });

  it("non-literal rename value is an error", () => {
    const e = expand(`${decls}
declare const s: S;
const key = "fullName" as const;
export const d = transformInto<S, D>(s, { rename: { name: key } });
`);
    expect(e.errors.join("\n")).toMatch(/rename/i);
  });

  it("unknown config key is an error", () => {
    const e = expand(`${decls}
declare const s: S;
export const d = transformInto<S, D>(s, { renames: { name: "fullName" } } as any);
`);
    expect(e.errors.join("\n")).toMatch(/renames/);
  });
});

describe("FMG-12: renamePaths", () => {
  it("honours deeper paths", () => {
    const e = expand(`
interface S { a: { b: { c: number } } }
interface D { a: { b: { x: number } } }
const s: S = { a: { b: { c: 5 } } };
export const d = transformInto<S, D>(s, { renamePaths: { "a.b.x": "a.b.c" } });
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ a: { b: { x: 5 } } });
  });

  it("reports unmapped required nested target fields", () => {
    const e = expand(`
interface S { address: { city: string } }
interface D { address: { location: string; zip: string } }
declare const s: S;
export const d = transformInto<S, D>(s, { renamePaths: { "address.location": "address.city" } });
`);
    expect(e.errors.join("\n")).toMatch(/zip/);
  });

  it("reports a source path that does not exist", () => {
    const e = expand(`
interface S { address: { city: string } }
interface D { address: { location: string } }
declare const s: S;
export const d = transformInto<S, D>(s, { renamePaths: { "address.location": "address.town" } });
`);
    expect(e.errors.join("\n")).toMatch(/town/);
  });

  it("copies the remaining nested fields alongside the rename", () => {
    const e = expand(`
interface S { address: { city: string; zip: string } }
interface D { address: { location: string; zip: string } }
const s: S = { address: { city: "Oslo", zip: "0150" } };
export const d = transformInto<S, D>(s, { renamePaths: { "address.location": "address.city" } });
`);
    expectNoErrors(e);
    expect(run(e.code).d).toEqual({ address: { location: "Oslo", zip: "0150" } });
  });
});
