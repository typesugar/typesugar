/**
 * How a fluent `match()` types the value it reads.
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
