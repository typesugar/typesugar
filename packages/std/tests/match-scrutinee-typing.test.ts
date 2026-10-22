/**
 * How a fluent `match()` types the value it reads, and which tests its
 * discriminant switch keeps.
 *
 * The expansion reads the scrutinee from a const (`const _s = s;`) and
 * switches on its discriminant. When TypeScript has narrowed `s` (by
 * assignment, `const circle: Shape = { kind: "circle", ... }`, or by control
 * flow), the const had the narrowed type, so TypeScript called `case
 * "square":` unreachable (TS2678) and `"side" in _circle` narrowed `side` to
 * `unknown` (TS18046): errors in valid code, as soon as the expansion is
 * type-checked (`typesugar check` does that for a match chain's arms). The
 * const is now asserted to the scrutinee's declared type (`const _circle =
 * circle as Shape;`); the assertion is erased from the JavaScript.
 *
 * Inside `case "circle":` the discriminant already says which variant the
 * value is, so `"radius" in _s` tested nothing the type doesn't guarantee.
 * It is emitted only when the field is optional in that variant, or the
 * discriminant doesn't determine one variant.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { transformAndRun } from "./match-exec-helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The TypeScript errors in the expanded code, type-checked as a file of its own. */
function expandedTypeErrors(code: string): string[] {
  const fileName = path.resolve(here, "__match_expanded_check.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["lib.es2023.d.ts"],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, ...rest) =>
    f === fileName
      ? ts.createSourceFile(f, code, ts.ScriptTarget.ES2022, true)
      : getSourceFile(f, lang, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (f) => f === fileName || fileExists(f);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fileName))
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

const SHAPE = `import { match } from "@typesugar/std";
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
`;

describe("a narrowed scrutinee is read at its declared type", () => {
  it("narrowed by assignment: the const is asserted to the declared type, and the expansion type-checks", () => {
    const r = transformAndRun(`${SHAPE}
const circle: Shape = { kind: "circle", radius: 5 };
export const area = match(circle)
  .case({ kind: "circle", radius }).then(radius * 2)
  .case({ kind: "square", side }).then(side ** 2);
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("const _circle = circle as Shape;");
    expect(expandedTypeErrors(r.code)).toEqual([]);
    expect(r.runError).toBeUndefined();
    expect(r.exports.area).toBe(10);
    // The assertion is erased.
    expect(r.js).toContain("const _circle = circle;");
  });

  it("narrowed by control flow: the same", () => {
    const r = transformAndRun(`${SHAPE}
export function notSquare(s: Shape): number {
  if (s.kind === "square") return 0;
  return match(s)
    .case({ kind: "circle", radius }).then(radius)
    .case({ kind: "square", side }).then(side ** 2);
}
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("const _s = s as Shape;");
    expect(expandedTypeErrors(r.code)).toEqual([]);
    expect((r.exports.notSquare as (s: unknown) => number)({ kind: "circle", radius: 3 })).toBe(3);
  });

  it("a value that is not narrowed, or narrowed only out of null, is read as it is", () => {
    const r = transformAndRun(`${SHAPE}
export const plain = (s: Shape) =>
  match(s).case({ kind: "circle", radius }).then(radius).case({ kind: "square", side }).then(side);
export function maybe(t: Shape | null): number {
  if (!t) return 0;
  return match(t).case({ kind: "circle", radius }).then(radius).case({ kind: "square", side }).then(side);
}
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("const _s = s;");
    expect(r.code).toContain("const _t = t;");
    expect(r.code).not.toMatch(/ as /);
    expect(expandedTypeErrors(r.code)).toEqual([]);
  });

  it("narrowed out of null and to one variant: the assertion keeps null out", () => {
    const r = transformAndRun(`${SHAPE}
export function f(t: Shape | null): number {
  if (!t || t.kind === "square") return 0;
  return match(t).case({ kind: "circle", radius }).then(radius).case({ kind: "square", side }).then(side);
}
`);
    expect(r.errors).toEqual([]);
    expect(r.code).not.toContain("null);");
    expect(r.code).toMatch(/const _t = t as /);
    expect(expandedTypeErrors(r.code)).toEqual([]);
    expect((r.exports.f as (s: unknown) => number)({ kind: "circle", radius: 4 })).toBe(4);
  });
});

describe("the discriminant switch tests only what the discriminant leaves open", () => {
  it("a required field of the variant the tag selects is read without an `in` test", () => {
    const r = transformAndRun(`${SHAPE}
export const area = (s: Shape) =>
  match(s).case({ kind: "circle", radius }).then(radius * 2).case({ kind: "square", side }).then(side ** 2);
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain("switch (_s.kind)");
    expect(r.code).not.toContain('"radius" in');
    expect(r.code).not.toContain('"side" in');
    const area = r.exports.area as (s: unknown) => number;
    expect(area({ kind: "circle", radius: 2 })).toBe(4);
    expect(area({ kind: "square", side: 3 })).toBe(9);
  });

  it("an optional field keeps its test: an arm whose field is absent falls through", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type Opt = { kind: "a"; x?: number } | { kind: "b"; y: number };
export const g = (o: Opt) =>
  match(o).case({ kind: "a", x }).then(x).case({ kind: "b", y }).then(y).else(-1);
`);
    expect(r.errors).toEqual([]);
    expect(r.code).toContain('"x" in _o');
    expect(r.code).not.toContain('"y" in _o');
    const g = r.exports.g as (o: unknown) => unknown;
    expect(g({ kind: "a" })).toBe(-1);
    expect(g({ kind: "a", x: 1 })).toBe(1);
  });

  it("a tag that more than one variant carries keeps the test", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
type W = { kind: "a"; x: number } | { kind: "a"; y: string } | { kind: "b"; z: number };
export const g = (w: W) =>
  match(w).case({ kind: "a", x }).then(x).case({ kind: "b", z }).then(z).else(-1);
`);
    expect(r.code).toContain('"x" in _w');
    expect(r.code).not.toContain('"z" in _w');
    const g = r.exports.g as (o: unknown) => unknown;
    expect(g({ kind: "a", y: "s" })).toBe(-1);
  });

  it("a scrutinee of unknown type keeps every test", () => {
    const r = transformAndRun(`import { match } from "@typesugar/std";
export const g = (v: unknown) =>
  match(v).case({ kind: "user", name }).then(name).case({ kind: "bot", id }).then(id).else("other");
`);
    expect(r.code).toContain('"name" in _v');
    expect(r.code).toContain('"id" in _v');
    const g = r.exports.g as (o: unknown) => unknown;
    expect(g({ kind: "user" })).toBe("other");
  });
});
