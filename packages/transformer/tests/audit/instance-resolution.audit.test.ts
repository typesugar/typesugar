/**
 * 2026-11 correctness audit — INSTANCE RESOLUTION and IMPORT-SCOPED ACTIVATION
 * (packages/macros/src/instance-resolver.ts, instance-scanner.ts,
 * packages/transformer-core/src/rewriting.ts `tryRewriteTypeclassOperator`,
 * method-sugar.ts, and the per-Program `instanceMethodRegistry` in
 * packages/macros/src/specialize.ts).
 *
 * Findings F14–F19 and F25 in audit/FABLE-AUDIT-2026-11.md (PEP-052
 * import-scoped activation / PEP-053). Each `it.fails` asserts the CORRECT
 * behavior; controls are plain `it`.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  project,
  transformOne,
  exportLine,
  errors,
  EQ_TYPECLASS,
  EQ_OPS_MARKER,
  AUDIT_COMPILER_OPTIONS,
} from "./_harness.js";

const EQ_LIB = `
${EQ_TYPECLASS}
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
export const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};
`;

describe("audit F14: per-Program inlining registry leaks instance bodies across files by bare name", () => {
  const EQ_ONLY = `
/** @typeclass */
export interface Eq<A> {
  /** @op === */
  equals(a: A, b: A): boolean;
}
`;
  const A_TS = `${EQ_ONLY}
export interface PointA { x: number; }
/** @impl Eq<PointA> */
const eqPoint: Eq<PointA> = { equals: (a, b) => a.x === b.x };
declare const p: PointA; declare const q: PointA;
export const r = eqPoint.equals(p, q);
`;
  const C_TS = `${EQ_ONLY}
export interface PointB { name: string; }
export const eqPoint: Eq<PointB> = { equals: (a, b) => a.name === b.name };
`;
  const B_IMPORTS_C = `
import { eqPoint, PointB } from "./c";
declare const p: PointB; declare const q: PointB;
export const r = eqPoint.equals(p, q);
`;

  it("control: b.ts alone (fresh program) inlines its own eqPoint", () => {
    const proj = project({ "c.ts": C_TS, "b.ts": B_IMPORTS_C });
    expect(exportLine(proj.transform("b.ts").code, "r")).toBe(
      "export const r = p.name === q.name;"
    );
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F14 (PEP-053 instanceMethodRegistry keyed by bare name)
  it("b.ts must not inherit a.ts's `eqPoint` body when both are built in one program", () => {
    const proj = project({ "a.ts": A_TS, "c.ts": C_TS, "b.ts": B_IMPORTS_C });
    expect(exportLine(proj.transform("a.ts").code, "r")).toBe("export const r = p.x === q.x;");
    expect(exportLine(proj.transform("b.ts").code, "r")).toBe(
      "export const r = p.name === q.name;"
    );
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F14 (PEP-053 instanceMethodRegistry keyed by bare name)
  it("a same-file use BEFORE the local declaration must not pick up another file's body", () => {
    const B_USE_FIRST = `${EQ_ONLY}
export interface PointB { name: string; }
export function cmp(p: PointB, q: PointB) { return eqPoint.equals(p, q); }
/** @impl Eq<PointB> */
const eqPoint: Eq<PointB> = { equals: (a, b) => a.name === b.name };
`;
    const proj = project({ "a.ts": A_TS, "b.ts": B_USE_FIRST });
    proj.transform("a.ts");
    const b = proj.transform("b.ts").code;
    expect(b).not.toContain("p.x === q.x");
  });
});

describe("audit F15: operand types are matched structurally and only on the left operand", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F15 (PEP-052 resolveInstance / isTypeMatch)
  it("an instance for a structurally identical but different type must not be used for Point", () => {
    const result = transformOne(
      `
import { Eq, Point, eqPoint } from "./eq-lib";
import "./eq-ops";
export interface Vec { x: number; y: number; }
/** @impl Eq<Vec> */
export const eqVec: Eq<Vec> = { equals: (a, b) => a.x === b.x, notEquals: (a, b) => a.x !== b.x };
declare const p1: Point; declare const p2: Point;
export const r = p1 === p2;
`,
      { "eq-lib.ts": EQ_LIB, "eq-ops.ts": EQ_OPS_MARKER }
    );
    const line = exportLine(result.code, "r")!;
    // Correct: eqPoint (compares x AND y), either as a call or inlined. Current
    // output is eqVec's body `p1.x === p2.x` — the local Eq<Vec> won for Point.
    expect(line).not.toContain("eqVec");
    expect(line).toMatch(/eqPoint\.equals\(p1, p2\)|p1\.y === p2\.y/);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F15 (PEP-052 tryRewriteTypeclassOperator ignores rightType)
  it("a === b with b: Point | null (strictNullChecks) must stay native or null-safe", () => {
    const result = transformOne(
      `
${EQ_TYPECLASS}
export interface Point { x: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x, notEquals: (a, b) => a.x !== b.x };
declare const a: Point; declare const b: Point | null;
export const r = a === b;
`,
      {},
      { ...AUDIT_COMPILER_OPTIONS, strictNullChecks: true }
    );
    // `a.x === b.x` throws when b is null; native `===` returned false.
    expect(exportLine(result.code, "r")).not.toBe("export const r = a.x === b.x;");
  });

  it("control: a nullable LEFT operand gets a null-safe rewrite (no longer asymmetric)", () => {
    const result = transformOne(
      `
${EQ_TYPECLASS}
export interface Point { x: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x, notEquals: (a, b) => a.x !== b.x };
declare const a: Point; declare const b: Point | null;
export const r = b === a;
`,
      {},
      { ...AUDIT_COMPILER_OPTIONS, strictNullChecks: true }
    );
    // Originally `b === a` (native): the left operand's union wasn't matched at
    // all. The #80–#83 stack now handles both sides and guards the nullable one.
    expect(exportLine(result.code, "r")).toBe(
      "export const r = (b === a || (b != null && eqPoint.equals(b, a)));"
    );
  });
});

describe("audit F16: same-named instances from different modules must be reported ambiguous", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F16 (PEP-052 pickResult dedupes by exportName only)
  it("lib1.eqPoint vs lib2.eqPoint is an ambiguity, not a silent import-order pick", () => {
    const EQ = `${EQ_TYPECLASS}\nexport interface Point { x: number; y: number; }\n`;
    const result = transformOne(
      `
import { Point } from "./eq";
import { one } from "./lib1";
import { two } from "./lib2";
import "./eq-ops";
declare const p: Point; declare const q: Point;
export const r = p === q;
`,
      {
        "eq.ts": EQ,
        "lib1.ts": `import { Eq, Point } from "./eq";
/** @impl Eq<Point> */
export const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x, notEquals: (a, b) => a.x !== b.x };
export const one = 1;`,
        "lib2.ts": `import { Eq, Point } from "./eq";
/** @impl Eq<Point> */
export const eqPoint: Eq<Point> = { equals: (a, b) => a.y === b.y, notEquals: (a, b) => a.y !== b.y };
export const two = 2;`,
        "eq-ops.ts": EQ_OPS_MARKER,
      }
    );
    expect(result.diagnostics.some((d) => /[Aa]mbiguous/.test(d.message))).toBe(true);
  });
});

describe("audit F17: type-only imports and runtime references", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F17 (PEP-052 getImportMap ignores `import type`)
  it("an instance named only in an `import type` clause must not be referenced at runtime", () => {
    const result = transformOne(
      `
import type { Point, eqPoint } from "./eq-lib";
import "./eq-ops";
declare const p1: Point; declare const p2: Point;
export const r = p1 === p2;
`,
      { "eq-lib.ts": EQ_LIB, "eq-ops.ts": EQ_OPS_MARKER }
    );
    const line = exportLine(result.code, "r")!;
    const hasValueImport = /^import \{[^}]*\beqPoint\b[^}]*\} from "\.\/eq-lib";/m.test(
      result.code
    );
    // Correct outputs: left native, a VALUE import of eqPoint was injected,
    // or the body was inlined so nothing references eqPoint at runtime
    // (the third added with the F17 fix, which inlines an instance reached
    // through `import type` instead of importing it). Native output has no
    // eqPoint either, so the last check covers it.
    expect(hasValueImport || !/\beqPoint\b/.test(line)).toBe(true);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F17 (PEP-052 module-scan over type-only imports)
  it("a module reached only through `import type` must not become a runtime dependency", () => {
    const result = transformOne(
      `
import type { Point } from "./eq-lib";
import "./eq-ops";
declare const p1: Point; declare const p2: Point;
export const r = p1 === p2;
`,
      { "eq-lib.ts": EQ_LIB, "eq-ops.ts": EQ_OPS_MARKER }
    );
    expect(result.code).not.toMatch(/^import \{ eqPoint \} from "\.\/eq-lib";/m);
  });
});

// Added with the F17 fix: when the body can't be inlined, the instance
// reached through `import type` still needs a value import, and gets one.
describe("F17 fix: the value import stays when the call can't be inlined", () => {
  it("a body calling a helper private to its module keeps the call and imports the instance", () => {
    const helperLib = EQ_LIB.replace(
      "equals: (a, b) => a.x === b.x && a.y === b.y,",
      "equals: (a, b) => same(a, b),"
    ).concat("\nfunction same(a: Point, b: Point) { return a.x === b.x && a.y === b.y; }\n");
    const result = transformOne(
      `
import type { Point } from "./eq-lib";
import "./eq-ops";
declare const p1: Point; declare const p2: Point;
export const r = p1 === p2;
`,
      { "eq-lib.ts": helperLib, "eq-ops.ts": EQ_OPS_MARKER }
    );
    expect(exportLine(result.code, "r")).toBe("export const r = eqPoint.equals(p1, p2);");
    expect(result.code).toMatch(/^import \{ eqPoint \} from "\.\/eq-lib";/m);
  });
});

describe("audit F18: method sugar on a literal-typed receiver", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F18 (PEP-056 method-sugar literal normalization)
  it("(5).show() must resolve the Show<number> instance like n.show() does", () => {
    const result = transformOne(`
/** @typeclass */
interface Show<A> { show(a: A): string; }
/** @impl Show<number> */
const showNum: Show<number> = { show: (a) => String(a) };
declare const n: number;
export const r1 = n.show();
export const r2 = (5).show();
`);
    expect(exportLine(result.code, "r1")).toBe("export const r1 = showNum.show(n);");
    expect(exportLine(result.code, "r2")).not.toBe("export const r2 = (5).show();");
  });
});

describe("audit F19: the documented bare `/** @instance */` form", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F19 (PEP-052 design example vs @impl macro)
  it("transforming a file that declares a bare @instance must not error", () => {
    const result = transformOne(`
${EQ_TYPECLASS}
export interface Point { x: number; }
/** @instance */
export const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x, notEquals: (a, b) => a.x !== b.x };
`);
    expect(errors(result)).toEqual([]);
  });
});

describe("audit F25: operator sugar inside `@impl`-tagged declaration bodies", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F25 (PEP-056 JSDoc-macro results are not re-visited)
  it("`a === b` means the same thing inside a tagged and an untagged instance body", () => {
    const result = transformOne(`
import "@typesugar/std/syntax/eq/ops";
import type { Eq } from "typesugar";
class Inner { constructor(public v: number) {} }
/** @impl Eq<Inner> */
const eqInner: Eq<Inner> = { equals: (a, b) => a.v === b.v, notEquals: (a, b) => a.v !== b.v };
interface Same<A> { same(a: A, b: A): boolean; }
/** @impl Same<Inner> */
const taggedSame: Same<Inner> = { same: (a, b) => a === b };
const untaggedSame: Same<Inner> = { same: (a, b) => a === b };
export const keep = [taggedSame, untaggedSame];
`);
    const tagged = result.code.split("\n").find((l) => l.includes("const taggedSame"))!;
    const untagged = result.code.split("\n").find((l) => l.includes("const untaggedSame"))!;
    expect(tagged.includes("a === b")).toBe(untagged.includes("a === b"));
  });
});

describe("controls (must stay green)", () => {
  it("rewrites === with the marker imported and an instance in scope", () => {
    const result = transformOne(
      `
import { Point, eqPoint } from "./eq-lib";
import "./eq-ops";
declare const a: Point; declare const b: Point;
export const r = a === b;
`,
      { "eq-lib.ts": EQ_LIB, "eq-ops.ts": EQ_OPS_MARKER }
    );
    // Originally `eqPoint.equals(a, b)`: an imported instance's body wasn't
    // inlined. Since the #80–#83 stack it is, across files.
    expect(exportLine(result.code, "r")).toBe("export const r = a.x === b.x && a.y === b.y;");
  });

  it("the probe program options are the pipeline defaults (strictNullChecks off)", () => {
    expect(AUDIT_COMPILER_OPTIONS.strict).toBe(false);
    expect(ts.ModuleResolutionKind.Bundler).toBe(AUDIT_COMPILER_OPTIONS.moduleResolution);
  });
});
