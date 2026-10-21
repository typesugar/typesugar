/**
 * `==` / `!=` dispatch through std's `Eq` exactly like `===` / `!==`.
 *
 * Eq's methods carried only `@op ===` and `@op !==`, so in a file that imports
 * `@typesugar/std/syntax/eq/ops`, `a === b` compared structurally while
 * `a == b` silently stayed reference identity (and, without the import, TS9804
 * warned for `===` but not for `==`). Eq now tags each method with both
 * spellings (`@op ===` + `@op ==`, `@op !==` + `@op !=`), using multiple
 * `@op` tags on one method. These tests pin the rewrite, the runtime result,
 * the TS9804 parity, and every case that must stay native.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { transformCode, TransformationPipeline } from "@typesugar/transformer/pipeline";

const MARKER = `import "@typesugar/std/syntax/eq/ops";`;

const DECLS = [
  `import { derive, Eq } from "typesugar";`,
  ``,
  `@derive(Eq)`,
  `interface P { x: number; y: number }`,
  ``,
  `const a: P = { x: 1, y: 2 };`,
  `const b: P = { x: 1, y: 2 };`,
].join("\n");

type Result = ReturnType<typeof transformCode>;

let counter = 0;
function run(body: string, opts: { activated: boolean; directive?: string }): Result {
  const code = [opts.directive ?? "", opts.activated ? MARKER : "", DECLS, body].join("\n");
  return transformCode(code, { fileName: `eq-loose-${counter++}.ts` });
}

const hints = (r: Result) => r.diagnostics.filter((d) => d.code === 9804);
const errors = (r: Result) => r.diagnostics.filter((d) => d.severity === "error");

/** Strip types, drop the side-effect imports, and evaluate the module's exports. */
function evaluate(code: string): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
  const { __esModule: _esModule, ...exports } = mod.exports;
  return exports;
}

describe("Eq: == and != dispatch like === and !==", () => {
  const body = [
    `export const strictEq = a === b;`,
    `export const looseEq = a == b;`,
    `export const strictNe = a !== b;`,
    `export const looseNe = a != b;`,
  ].join("\n");

  it("rewrites a == b to P.Eq.equals and a != b to P.Eq.notEquals", () => {
    const r = run(body, { activated: true });
    expect(errors(r)).toEqual([]);
    expect(hints(r)).toEqual([]);
    expect(r.code).toContain("looseEq = P.Eq.equals(a, b)");
    expect(r.code).toContain("looseNe = P.Eq.notEquals(a, b)");
    expect(r.code).toContain("strictEq = P.Eq.equals(a, b)");
    expect(r.code).toContain("strictNe = P.Eq.notEquals(a, b)");
  });

  it("gives the same runtime results for == / != as for === / !==", () => {
    const out = evaluate(run(body, { activated: true }).code);
    expect(out).toEqual({ strictEq: true, looseEq: true, strictNe: false, looseNe: false });
  });

  it("fires TS9804 for == and != in a file that has not activated Eq syntax", () => {
    const r = run(body, { activated: false });
    const h = hints(r);
    expect(h).toHaveLength(4);
    const byOp = (op: string) => h.filter((d) => d.message.includes(`Operator '${op}' on 'P'`));
    expect(byOp("==")[0].message).toContain("Eq.equals");
    expect(byOp("!=")[0].message).toContain("Eq.notEquals");
    for (const op of ["===", "==", "!==", "!="]) expect(byOp(op)).toHaveLength(1);
    // Every equality hint names Object.is as the way to keep reference identity.
    for (const d of h) expect(d.message).toContain("Object.is(");
    // Still native without activation.
    expect(r.code).toContain("looseEq = a == b");
    expect(r.code).toContain("looseNe = a != b");
  });
});

describe("Eq: == and != cases that stay native", () => {
  const nullish = [
    `export const n1 = a == null;`,
    `export const n2 = a != null;`,
    `export const n3 = a == undefined;`,
    `export const n4 = null == a;`,
    `export const n5 = a != undefined;`,
  ].join("\n");

  it("null / undefined checks: no rewrite, no diagnostic", () => {
    for (const activated of [true, false]) {
      const r = run(nullish, { activated });
      expect(r.diagnostics).toEqual([]);
      expect(r.code).toContain("n1 = a == null");
      expect(r.code).toContain("n2 = a != null");
      expect(r.code).toContain("n3 = a == undefined");
      expect(r.code).toContain("n4 = null == a");
      expect(r.code).toContain("n5 = a != undefined");
    }
  });

  it("a right operand that is not the Eq type (a == 5) stays native, exactly like a === 5", () => {
    const loose = run(`// @ts-ignore\nexport const r = a == 5;`, { activated: true });
    const strict = run(`// @ts-ignore\nexport const r = a === 5;`, { activated: true });
    expect(loose.code).toContain("r = a == 5");
    expect(loose.code).not.toContain("Eq.equals");
    expect(hints(loose)).toEqual([]);
    // Same treatment as the === spelling. In an activated file both report the
    // existing "right operand must also be 'P'" error (TypeScript itself
    // rejects the comparison too, TS2367); no TS9804, no rewrite.
    expect(errors(strict)).toHaveLength(1);
    expect(errors(strict)[0].message).toContain("right operand must also be 'P'");
    expect(loose.diagnostics.map((d) => d.message.replaceAll("'=='", "'==='"))).toEqual(
      strict.diagnostics.map((d) => d.message)
    );
    // And no TS9804 without activation.
    const inactive = run(`// @ts-ignore\nexport const r = [a == 5, a != 5];`, { activated: false });
    expect(hints(inactive)).toEqual([]);
  });

  it("primitive operands", () => {
    const body = [
      `declare const n: number;`,
      `declare const s: string;`,
      `export const r = [n == 1, n != 2, s == "x", s != "y", a.x == b.x];`,
    ].join("\n");
    for (const activated of [true, false]) {
      const r = run(body, { activated });
      expect(r.diagnostics).toEqual([]);
      expect(r.code).toContain(`[n == 1, n != 2, s == "x", s != "y", a.x == b.x]`);
    }
  });

  it("Object.is(a, b) is a call and is never rewritten", () => {
    const r = run(`export const same = Object.is(a, b);`, { activated: true });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("same = Object.is(a, b)");
  });

  it('a "use no typesugar" file', () => {
    for (const activated of [true, false]) {
      const r = run(`export const r = [a == b, a != b];`, {
        activated,
        directive: `"use no typesugar";`,
      });
      expect(hints(r)).toEqual([]);
      expect(r.code).toContain("[a == b, a != b]");
    }
  });

  it("the // @ts-no-typesugar operators line opt-out", () => {
    // Before this change the rewrite gate checked only the `extensions`
    // feature, so the documented `operators` opt-out silenced TS9804 but did
    // not stop the rewrite in an activated file (for === as well as ==).
    for (const activated of [true, false]) {
      const r = run(
        [
          `export const r = [a == b, a != b, a === b, a !== b]; // @ts-no-typesugar operators`,
          `export const s = a == b;`,
        ].join("\n"),
        { activated }
      );
      expect(hints(r)).toHaveLength(activated ? 0 : 1); // only the unmarked line warns
      expect(r.code).toContain("[a == b, a != b, a === b, a !== b]");
      expect(r.code).toContain(activated ? "s = P.Eq.equals(a, b)" : "s = a == b");
    }
  });

  it('a "use no typesugar operators" file', () => {
    const r = run(`export const r = [a == b, a != b, a === b];`, {
      activated: true,
      directive: `"use no typesugar operators";`,
    });
    expect(hints(r)).toEqual([]);
    expect(r.code).toContain("[a == b, a != b, a === b]");
  });
});

describe("comparison operators on a nullable operand (strictNullChecks)", () => {
  // transformCode's program is non-strict; nullability needs strictNullChecks.
  const strictRun = (body: string): Result => {
    const fileName = path.resolve(`eq-nullable-${counter++}.ts`);
    const code = [
      `import "@typesugar/std/syntax/eq/ops";`,
      `import "@typesugar/std/syntax/ord/ops";`,
      `import { derive, Eq, Ord } from "typesugar";`,
      `@derive(Eq, Ord)`,
      `interface P { x: number }`,
      `const a: P = { x: 1 };`,
      `const b: P = { x: 2 };`,
      `let calls = 0;`,
      `function get(p: P | undefined): P | undefined { calls++; return p; }`,
      body,
      `export const callCount = () => calls;`,
    ].join("\n");
    const pipeline = new TransformationPipeline(
      {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
      },
      [fileName],
      {
        readFile: (f) => (f === fileName ? code : ts.sys.readFile(f)),
        fileExists: (f) => f === fileName || ts.sys.fileExists(f),
      }
    );
    return pipeline.transform(fileName) as Result;
  };

  it("=== / !== / == / != keep the native result when an operand is null or undefined", () => {
    const r = strictRun(
      [
        `const c: P | undefined = Math.random() > 2 ? a : undefined;`,
        `const d: P | null = Math.random() > 2 ? a : null;`,
        `const e: P | undefined = { x: 1 };`,
        `export const r = [c === a, c !== a, c == a, c != a, c === c, d == c, d === c, a === b, e! === a];`,
        `export const viaCall = get(a) === get({ x: 1 });`,
      ].join("\n")
    );
    expect(errors(r)).toEqual([]);
    // Non-null operands: the plain call, zero-cost.
    expect(r.code).toContain("P.Eq.equals(a, b)");
    const out = evaluate(r.code) as { r: boolean[]; viaCall: boolean; callCount: () => number };
    expect(out.r).toEqual([false, true, false, true, true, true, false, false, true]);
    // Structural, and each operand evaluated once.
    expect(out.viaCall).toBe(true);
    expect(out.callCount()).toBe(2);
  });

  it("< <= > >= with a nullish operand give the native result instead of throwing", () => {
    const r = strictRun(
      [
        `const c = (Math.random() > 2 ? a : undefined) as P | undefined;`,
        // tsc reports TS18048 here; the rewrite must not turn it into a throw.
        `export const r = [c < a, c <= a, a > c, a >= c, a < b, b > a];`,
      ].join("\n")
    );
    expect(errors(r)).toEqual([]);
    const out = evaluate(r.code) as { r: boolean[] };
    expect(out.r).toEqual([false, false, false, false, true, true]);
  });
});

describe("a derived union narrowed to one variant by assignment", () => {
  it("=== still dispatches to the union's Eq (the variable's declared type)", () => {
    const code = [
      `import "@typesugar/std/syntax/eq/ops";`,
      `/** @derive(Eq) */`,
      `type Shape = { kind: "c"; r: number } | { kind: "s"; side: number };`,
      `const s1: Shape = { kind: "c", r: 1 }, s2: Shape = { kind: "c", r: 1 };`,
      `const s3: Shape = { kind: "s", side: 1 };`,
      `const holder: { s: Shape } = { s: { kind: "c", r: 1 } };`,
      `export const same = s1 === s2;`,
      `export const differ = s1 !== s3;`,
      `export const viaProperty = holder.s === s1;`,
    ].join("\n");
    const r = transformCode(code, { fileName: `eq-narrowed-${counter++}.ts` });
    expect(errors(r)).toEqual([]);
    expect(r.code).toContain("same = Shape.Eq.equals(s1, s2)");
    expect(evaluate(r.code)).toEqual({ same: true, differ: true, viaProperty: true });
  });

  it("a literal operand stays native: a primitive declared type is not borrowed", () => {
    // `recip: (a) => 1 / a` in std (two @op / typeclasses in scope) became
    // "Ambiguous operator '/' for type '1'" when the right operand's declared
    // type, number, was tried for the literal `1`.
    const code = [
      `import "@typesugar/std/syntax/eq/ops";`,
      `const n: number = 2;`,
      `export const r = 1 === n;`,
    ].join("\n");
    const r = transformCode(code, { fileName: `eq-literal-${counter++}.ts` });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toContain("r = 1 === n");
  });

  it("without the Eq import, TS9804 names the union's Eq", () => {
    const code = [
      `/** @derive(Eq) */`,
      `type Shape = { kind: "c"; r: number } | { kind: "s"; side: number };`,
      `const s1: Shape = { kind: "c", r: 1 }, s2: Shape = { kind: "c", r: 1 };`,
      `export const same = s1 === s2;`,
    ].join("\n");
    const r = transformCode(code, { fileName: `eq-narrowed-${counter++}.ts` });
    expect(hints(r)).toHaveLength(1);
    expect(hints(r)[0].message).toContain("Eq.equals");
  });
});
