/**
 * 2026-11 correctness audit — instance-method INLINING semantics
 * (`inlineMethod`/`substituteParams` in packages/macros/src/specialize.ts, reached
 * through `tryInlineDerivedInstanceCall` for both direct `inst.method(args)` calls
 * and the PEP-052 operator rewrite `a === b` → `eqT.equals(a, b)`).
 *
 * Findings F1–F9 and F24 in audit/FABLE-AUDIT-2026-11.md (PEP-053 always-on
 * specialization). Every `it.fails` below asserts the semantically CORRECT output
 * and is expected to flip red (prompting `it.fails` → `it`) once the inliner is
 * fixed. Controls are plain `it`.
 *
 * Root cause shared by all of them: `substituteParams` textually replaces every
 * `Identifier` whose text equals a parameter name with the (same) call-site
 * argument node — no evaluation-order/once-only temporaries, no scope analysis,
 * no check of the method's `async`/`this`/default/rest/destructuring shape.
 */

import { describe, it, expect } from "vitest";
import { transformOne, exportLine, errors, EQ_TYPECLASS } from "./_harness.js";

const POINT_EQ = `
${EQ_TYPECLASS}
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};
`;

describe("audit F1: a side-effecting argument must be evaluated exactly once", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F1 (PEP-053 inlining semantics)
  it("direct call: eqPoint.equals(mk(), q) must not duplicate mk()", () => {
    const result = transformOne(`
${POINT_EQ}
let calls = 0;
function mk(): Point { calls++; return { x: calls, y: 0 }; }
declare const q: Point;
export const r = eqPoint.equals(mk(), q);
`);
    expect(errors(result)).toEqual([]);
    const line = exportLine(result.code, "r")!;
    expect(line.match(/mk\(\)/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F1 (PEP-053 inlining semantics)
  it("operator path: mk() === q must not duplicate mk()", () => {
    const result = transformOne(`
${POINT_EQ}
let calls = 0;
function mk(): Point { calls++; return { x: calls, y: 0 }; }
declare const q: Point;
export const r = mk() === q;
`);
    expect(errors(result)).toEqual([]);
    const line = exportLine(result.code, "r")!;
    expect(line.match(/mk\(\)/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("audit F2: argument evaluation order and arity must be preserved", () => {
  const COMBINE = `
/** @typeclass */
interface Combine<A> { combine(a: A, b: A): A; first(a: A, b: A): A; }
/** @impl Combine<number> */
const combineNum: Combine<number> = {
  combine: (a, b) => b - a,
  first: (a, _b) => a,
};
declare function f(): number;
declare function g(): number;
`;

  // Tracked: audit/FABLE-AUDIT-2026-11.md F2 (PEP-053 inlining semantics)
  it("f() must be evaluated before g() even when the body uses b first", () => {
    const result = transformOne(`${COMBINE}
export const r1 = combineNum.combine(f(), g());
`);
    const line = exportLine(result.code, "r1")!;
    // Either the call is left alone, or the inlined form evaluates f() before g().
    const fIdx = line.indexOf("f()");
    const gIdx = line.indexOf("g()");
    expect(fIdx).toBeGreaterThanOrEqual(0);
    expect(gIdx).toBeGreaterThanOrEqual(0);
    expect(fIdx).toBeLessThan(gIdx);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F2 (PEP-053 inlining semantics)
  it("an argument bound to an unused parameter must still be evaluated", () => {
    const result = transformOne(`${COMBINE}
export const r2 = combineNum.first(f(), g());
`);
    const line = exportLine(result.code, "r2")!;
    expect(line).toContain("g()");
  });
});

describe("audit F3: `this` inside an instance method must keep its receiver", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F3 (PEP-053 inlining semantics)
  it("notEquals(a, b) { return !this.equals(a, b) } must not leak `this` to the call site", () => {
    const result = transformOne(`
${EQ_TYPECLASS}
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals(a, b) { return a.x === b.x && a.y === b.y; },
  notEquals(a, b) { return !this.equals(a, b); },
};
declare const p: Point; declare const q: Point;
export const r = eqPoint.notEquals(p, q);
`);
    const line = exportLine(result.code, "r")!;
    expect(line).not.toMatch(/\bthis\./);
  });
});

describe("audit F4: async method bodies must not be inlined as synchronous expressions", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F4 (PEP-053 inlining semantics)
  it("run: async (a) => a + 1 must still produce a Promise at the call site", () => {
    const result = transformOne(`
/** @typeclass */
interface Runner<A> { run(a: A): Promise<A>; }
/** @impl Runner<number> */
const runNum: Runner<number> = { run: async (a) => a + 1 };
export const r = runNum.run(41);
`);
    const line = exportLine(result.code, "r")!;
    // Correct outputs: the call left alone, or an async wrapper / Promise.resolve.
    expect(line === "export const r = runNum.run(41);" || /async|Promise/.test(line)).toBe(true);
  });
});

describe("audit F5–F8: parameter shapes the substitution cannot express", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F5 (PEP-053 inlining semantics)
  it("a defaulted parameter with no argument must not become a dangling identifier", () => {
    const result = transformOne(`
/** @typeclass */
interface Joiner<A> { join(a: A, b: A, sep?: string): string; }
/** @impl Joiner<string> */
const joinStr: Joiner<string> = { join: (a, b, sep = ",") => a + sep + b };
export const r = joinStr.join("x", "y");
`);
    const line = exportLine(result.code, "r")!;
    expect(line).not.toMatch(/\bsep\b/);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F6 (PEP-053 inlining semantics)
  it("a destructured parameter's bindings must not become dangling identifiers", () => {
    const result = transformOne(`
/** @typeclass */
interface Show<A> { show(a: A): string; }
interface Point { x: number; y: number; }
/** @impl Show<Point> */
const showPoint: Show<Point> = { show: ({ x, y }) => \`(\${x}, \${y})\` };
declare const p: Point;
export const r = showPoint.show(p);
`);
    const line = exportLine(result.code, "r")!;
    // Correct: call left alone, or bindings refer to p (p.x / p.y).
    expect(line === "export const r = showPoint.show(p);" || !/\$\{x\}/.test(line)).toBe(true);
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F8 (PEP-053 inlining semantics)
  it("a rest parameter must receive all arguments, not the first one", () => {
    const result = transformOne(`
/** @typeclass */
interface Sum<A> { sum(...xs: A[]): A; }
/** @impl Sum<number> */
const sumNum: Sum<number> = { sum: (...xs) => xs.length };
export const r = sumNum.sum(1, 2, 3);
`);
    const line = exportLine(result.code, "r")!;
    expect(line).not.toContain("1..length");
    expect(line === "export const r = sumNum.sum(1, 2, 3);" || /\[1, 2, 3\]/.test(line)).toBe(true);
  });
});

describe("audit F7: template-internal binders must not capture call-site identifiers", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F7 (PEP-053 inlining hygiene)
  it("map: (xs, f) => xs.map((a) => f(a)) must not capture a call-site `a`", () => {
    const result = transformOne(`
/** @typeclass */
interface Mapper<F> { map(xs: any, f: (x: any) => any): any; }
/** @impl Mapper<Array> */
const arrMapper: Mapper<Array<any>> = { map: (xs, f) => xs.map((a) => f(a)) };
const a = 10;
declare const list: number[];
export const r = arrMapper.map(list, (v: number) => v + a);
`);
    const line = exportLine(result.code, "r")!;
    // `(v) => v + a` must still see the outer `a`; the inner lambda parameter must not be `a`.
    expect(line).not.toMatch(/\(a\)? ?=>.*\(\(v: number\) => v \+ a\)\(a\)/);
    expect(line).not.toContain("list.map(a => ((v: number) => v + a)(a))");
  });
});

describe("audit F9/F24: identifiers in non-expression positions must not be substituted", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F9 (PEP-053 inlining semantics)
  it("shorthand property `({ x })` must not become `({ f() })`", () => {
    const result = transformOne(`
/** @typeclass */
interface Wrap<A> { wrap(x: A): { x: A }; }
/** @impl Wrap<number> */
const wrapNum: Wrap<number> = { wrap: (x) => ({ x }) };
declare function f(): number;
export const r = wrapNum.wrap(f());
`);
    const line = exportLine(result.code, "r")!;
    expect(line).not.toContain("({ f() })");
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F24 (PEP-053 inlining semantics)
  it("a parameter named like a property must not rewrite the property name", () => {
    const result = transformOne(`
/** @typeclass */
interface Scale<A> { scale(k: number, a: A): A; }
interface Point { x: number; y: number; }
/** @impl Scale<Point> */
const scalePoint: Scale<Point> = { scale: (x, p) => ({ x: p.x * x, y: p.y * x }) };
declare const pt: Point; declare const k: number;
export const r = scalePoint.scale(k, pt);
`);
    const line = exportLine(result.code, "r")!;
    expect(line).not.toContain("pt.k");
    expect(line).not.toMatch(/\{ k:/);
  });
});

describe("controls (must stay green)", () => {
  it("inlines a pure, single-use body and parenthesizes the argument correctly", () => {
    const result = transformOne(`
/** @typeclass */
interface Num<A> { twice(a: A): A; }
/** @impl Num<number> */
const numNum: Num<number> = { twice: (a) => a * 2 };
declare const x: number; declare const y: number;
export const r = numNum.twice(x + y);
`);
    expect(exportLine(result.code, "r")).toBe("export const r = (x + y) * 2;");
  });
});

// Added with the F5/F6/F8 fix: the parameter shapes it rewrites to plain
// parameters (normalizeParameterShapes in specialize.ts), and the ones it
// must leave to the IIFE fallback.
describe("F5/F6/F8 fix: default, rest and destructured parameters inline exactly", () => {
  const JOINER = `
/** @typeclass */
interface Joiner<A> { join(a: A, b: A, sep?: string): string; }
`;

  it("an omitted literal default is inlined", () => {
    const result = transformOne(`${JOINER}
/** @impl Joiner<string> */
const joinStr: Joiner<string> = { join: (a, b, sep = ",") => a + sep + b };
export const r = joinStr.join("x", "y");
`);
    expect(exportLine(result.code, "r")).toBe('export const r = "x" + "," + "y";');
  });

  it("a literal argument for a defaulted parameter replaces the default", () => {
    const result = transformOne(`${JOINER}
/** @impl Joiner<string> */
const joinStr: Joiner<string> = { join: (a, b, sep = ",") => a + sep + b };
export const r = joinStr.join("x", "y", "-");
`);
    expect(exportLine(result.code, "r")).toBe('export const r = "x" + "-" + "y";');
  });

  it("a non-literal default is not moved to the call site (IIFE keeps it)", () => {
    const result = transformOne(`${JOINER}
const SEP = ",";
/** @impl Joiner<string> */
const joinStr: Joiner<string> = { join: (a, b, sep = SEP) => a + sep + b };
declare const s: string;
export const r = joinStr.join("x", "y", s);
`);
    const line = exportLine(result.code, "r")!;
    // `s` may be undefined at run time, so the default can't be decided here.
    expect(line).toMatch(/sep = SEP/);
  });

  it("a renamed destructuring key reads the right property", () => {
    const result = transformOne(`
/** @typeclass */
interface Diff<A> { diff(a: A): number; }
interface Point { x: number; y: number; }
/** @impl Diff<Point> */
const diffPoint: Diff<Point> = { diff: ({ x: px, y }) => px - y };
declare const p: Point;
export const r = diffPoint.diff(p);
`);
    expect(exportLine(result.code, "r")).toBe("export const r = p.x - p.y;");
  });

  it("a destructured parameter over an effectful argument evaluates it once", () => {
    const result = transformOne(`
/** @typeclass */
interface Show<A> { show(a: A): string; }
interface Point { x: number; y: number; }
/** @impl Show<Point> */
const showPoint: Show<Point> = { show: ({ x, y }) => \`(\${x}, \${y})\` };
declare function mk(): Point;
export const r = showPoint.show(mk());
`);
    const line = exportLine(result.code, "r")!;
    // Not rewritten (the argument isn't stable): the IIFE fallback, which
    // destructures the one value `mk()` returns.
    expect(line.match(/mk\(\)/g)).toHaveLength(1);
  });

  it("a rest parameter keeps its arguments' evaluation order", () => {
    const result = transformOne(`
/** @typeclass */
interface Sum<A> { sum(...xs: A[]): number; }
/** @impl Sum<number> */
const sumNum: Sum<number> = { sum: (...xs) => xs.length };
declare function f(): number; declare function g(): number;
export const r = sumNum.sum(f(), g());
`);
    expect(exportLine(result.code, "r")).toBe("export const r = [f(), g()].length;");
  });
});

// Added after review of the F5/F6/F8 fix.
describe("F5/F6/F8 fix: review follow-ups", () => {
  it("a destructured read is not moved past the body's effects", () => {
    const result = transformOne(`
/** @typeclass */
interface Stepper<A> { step(s: A, f: () => number): number; }
interface State { n: number; }
/** @impl Stepper<State> */
const stepState: Stepper<State> = { step: ({ n }, f) => f() + n };
declare const state: State; declare function bump(): number;
export const r = stepState.step(state, bump);
`);
    const line = exportLine(result.code, "r")!;
    // `n` is read at the call, before bump() runs: never `bump() + state.n`.
    // The read can't be substituted after the call, so it is bound first.
    expect(line).not.toBe("export const r = bump() + state.n;");
    expect(line).toBe("export const r = ((n, f) => f() + n)(state.n, bump);");
  });

  it("a TypeScript `this` parameter takes no argument", () => {
    const result = transformOne(`
/** @typeclass */
interface Near<A> { near(a: A, b: A, eps?: number): boolean; }
/** @impl Near<number> */
const nearNum: Near<number> = {
  near(this: void, a: number, b: number, eps = 0.5) { return Math.abs(a - b) <= eps; },
};
declare const x: number; declare const y: number;
export const r = nearNum.near(x, y);
`);
    expect(errors(result)).toEqual([]);
    expect(exportLine(result.code, "r")).toBe("export const r = Math.abs(x - y) <= 0.5;");
  });

  it("a `this` parameter with an extra argument still aligns (IIFE)", () => {
    const result = transformOne(`
/** @typeclass */
interface Near<A> { near(a: A, b: A, eps?: number): boolean; }
/** @impl Near<number> */
const nearNum: Near<number> = {
  near(this: void, a: number, b: number) { return Math.abs(a - b) < 1; },
};
declare const x: number; declare const y: number;
export const r = nearNum.near(x, y, 0.1);
`);
    const line = exportLine(result.code, "r")!;
    expect(line).not.toContain("Math.abs(y - 0.1)");
    expect(line).toBe("export const r = ((a, b) => { return Math.abs(a - b) < 1; })(x, y, 0.1);");
  });
});
