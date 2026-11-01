/**
 * 2026-11 correctness audit — AUTO-SPECIALIZATION (`tryAutoSpecialize` /
 * `inlineAutoSpecializeForHoisting` in packages/transformer-core/src/specialization.ts,
 * instance recognition in packages/macros/src/instance-extraction.ts).
 *
 * Findings F10–F13 in audit/FABLE-AUDIT-2026-11.md (PEP-053 always-on
 * specialization). Each `it.fails` asserts the CORRECT output and flips red once
 * fixed. Controls are plain `it`.
 */

import { describe, it, expect } from "vitest";
import { transformOne, exportLine, errors } from "./_harness.js";

const FUNCTOR = `
export interface Functor<F> { map<A, B>(fa: any, f: (a: A) => B): any; }
/** @impl Functor<Array> */
export const arrayFunctor: Functor<Array<any>> = { map: (fa: any[], f: (a: any) => any) => fa.map(f) };
`;

/**
 * The hoisted `const __typesugar___<fn>_…__ = …;` declaration, if any — the whole
 * statement, since a block-bodied specialization prints across several lines.
 */
function hoistedLine(code: string, fnName: string): string | undefined {
  const m = new RegExp(`^const __typesugar___${fnName}_[\\s\\S]*?;\\n(?=\\S)`, "m").exec(
    code + "\n"
  );
  return m?.[0].trimEnd();
}

describe("audit F10: the removed dictionary parameter must not be referenced by the specialized body", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F10 (PEP-053 auto-specialization)
  it("value member M.empty (Monoid) must not dangle", () => {
    const result = transformOne(`
interface Monoid<A> { empty: A; combine(a: A, b: A): A; }
/** @impl Monoid<number> */
const sumMonoid: Monoid<number> = { empty: 0, combine: (a, b) => a + b };
function fold<A>(M: Monoid<A>, xs: A[]): A { return xs.reduce((acc, x) => M.combine(acc, x), M.empty); }
export const r = fold(sumMonoid, [1, 2, 3]);
`);
    expect(errors(result)).toEqual([]);
    const hoisted = hoistedLine(result.code, "fold");
    // Either not specialized at all, or specialized without a free `M`.
    if (hoisted) expect(hoisted).not.toMatch(/\bM\./);
    else expect(exportLine(result.code, "r")).toBe("export const r = fold(sumMonoid, [1, 2, 3]);");
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F10 (PEP-053 auto-specialization)
  it("a dictionary method passed as a callback (xs.reduce(M.combine, …)) must not dangle", () => {
    const result = transformOne(`
interface Monoid<A> { empty: A; combine(a: A, b: A): A; }
/** @impl Monoid<number> */
const sumMonoid: Monoid<number> = { empty: 0, combine: (a, b) => a + b };
function fold2<A>(M: Monoid<A>, xs: A[]): A { return xs.reduce(M.combine, M.empty); }
export const r2 = fold2(sumMonoid, [1, 2, 3]);
`);
    const hoisted = hoistedLine(result.code, "fold2");
    if (hoisted) expect(hoisted).not.toMatch(/\bM\b/);
    else
      expect(exportLine(result.code, "r2")).toBe("export const r2 = fold2(sumMonoid, [1, 2, 3]);");
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F10 (PEP-053 auto-specialization)
  it("a dictionary forwarded to another function must not dangle", () => {
    const result = transformOne(`
${FUNCTOR}
function helper<F>(F: Functor<F>, fa: any) { return F.map(fa, (x: number) => x + 1); }
function double<F>(F: Functor<F>, fa: any) { return helper(F, F.map(fa, (x: number) => x * 2)); }
export const r = double(arrayFunctor, [1, 2, 3]);
`);
    const hoisted = hoistedLine(result.code, "double");
    if (hoisted) expect(hoisted).not.toMatch(/helper\(F,/);
    else
      expect(exportLine(result.code, "r")).toBe(
        "export const r = double(arrayFunctor, [1, 2, 3]);"
      );
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F10 (PEP-053 auto-specialization)
  it("a recursive call through the dictionary must not dangle", () => {
    const result = transformOne(`
${FUNCTOR}
function times<F>(F: Functor<F>, fa: any, n: number): any {
  return n <= 0 ? fa : times(F, F.map(fa, (x: number) => x * 2), n - 1);
}
export const r = times(arrayFunctor, [1, 2, 3], 2);
`);
    const hoisted = hoistedLine(result.code, "times");
    if (hoisted) expect(hoisted).not.toMatch(/times\(F,/);
    else
      expect(exportLine(result.code, "r")).toBe(
        "export const r = times(arrayFunctor, [1, 2, 3], 2);"
      );
  });
});

describe("audit F11: auto-specialization must only fire on typeclass dictionaries", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F11 (PEP-053 instance recognition)
  it("a Partial<T> config object is not an instance — the call must be left alone", () => {
    const result = transformOne(`
interface Handlers { onA: () => number; extra?: number; }
const cfg: Partial<Handlers> = { onA: () => 1 };
function run(h: Partial<Handlers>) { return h.onA() + (h.extra ?? 0); }
export const r = run(cfg);
`);
    expect(hoistedLine(result.code, "run")).toBeUndefined();
    expect(exportLine(result.code, "r")).toBe("export const r = run(cfg);");
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F11 (PEP-053 instance recognition)
  it("a Record<string, fn> map is not an instance — the call must be left alone", () => {
    const result = transformOne(`
const handlers: Record<string, () => number> = { a: () => 1, b: () => 2 };
function pick(h: Record<string, () => number>, key: string) { return h.a() + h[key](); }
export const r = pick(handlers, "b");
`);
    expect(hoistedLine(result.code, "pick")).toBeUndefined();
    expect(exportLine(result.code, "r")).toBe('export const r = pick(handlers, "b");');
  });
});

describe("audit F12: two instances for the same type must not share one specialization", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F12 (PEP-053 SpecializationCache key)
  it("render(upper, …) and render(quoted, …) must inline different bodies", () => {
    const result = transformOne(`
interface Show<A> { show(a: A): string; }
/** @impl Show<string> */
const upper: Show<string> = { show: (s) => s.toUpperCase() };
/** @impl Show<string> */
const quoted: Show<string> = { show: (s) => JSON.stringify(s) };
function render<A>(S: Show<A>, a: A): string { return "<" + S.show(a) + ">"; }
export const r1 = render(upper, "a");
export const r2 = render(quoted, "a");
`);
    expect(errors(result)).toEqual([]);
    const r1 = exportLine(result.code, "r1")!;
    const r2 = exportLine(result.code, "r2")!;
    const callee = (l: string) => l.match(/= (\w+)\(/)?.[1];
    // Same hoisted function for both call sites ⇒ one instance's body was discarded.
    if (callee(r1)?.startsWith("__typesugar")) expect(callee(r1)).not.toBe(callee(r2));
    expect(result.code).toContain("JSON.stringify");
  });
});

describe("audit F13: dead-instance elimination must never delete an exported binding", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F13 (PEP-053 eliminateDeadDerivedInstances)
  it("export const combineNum stays exported after local inlining", () => {
    const result = transformOne(`
/** @typeclass */
interface Combine<A> { combine(a: A, b: A): A; }
/** @impl Combine<number> */
export const combineNum: Combine<number> = { combine: (a, b) => a + b };
export const r = combineNum.combine(1, 2);
`);
    expect(result.code).toContain("export const combineNum");
  });
});

describe("controls (must stay green)", () => {
  it("specializes a plain dictionary-only call (the PEP-053 happy path)", () => {
    const result = transformOne(`
${FUNCTOR}
function double<F>(F: Functor<F>, fa: any) { return F.map(fa, (x: number) => x * 2); }
export const r = double(arrayFunctor, [1, 2, 3]);
`);
    expect(errors(result)).toEqual([]);
    expect(hoistedLine(result.code, "double")).toContain("fa.map(");
  });
});
