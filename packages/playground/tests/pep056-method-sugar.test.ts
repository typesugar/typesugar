/**
 * PEP-056 Wave 1 — method-sugar dispatch (`p.equals(q)` -> `eqPoint.equals(p, q)`)
 * ported into `@typesugar/transformer-core`, exercised through the actual
 * playground `transform()` entry point (`src/index.ts`) — the real motivating
 * case: the browser bundle calls `transformer-core` directly and, before this
 * wave, had no method-sugar dispatcher at all (unlike operator sugar, which
 * already worked there). See PEP-052's own "Implementation status" section,
 * which names this exact gap.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { transform, clearCache } from "../src/index.js";

describe("playground transform — PEP-056 method sugar", () => {
  beforeEach(() => {
    clearCache();
  });

  it("rewrites p.equals(q) to eqPoint.equals(p, q) with the @typesugar/std/syntax/eq method marker", () => {
    const code = `
import "@typesugar/std/syntax/eq";

class Point {
  constructor(public x: number, public y: number) {}
}
interface Eq<A> { equals(a: A, b: A): boolean; notEquals(a: A, b: A): boolean; }

/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};

declare const p: Point;
declare const q: Point;
export const r = p.equals(q);
`.trim();

    const result = transform(code, { fileName: "playground-method-sugar-eq.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("export const r = eqPoint.equals(p, q);");
  });

  it("leaves .equals() as a plain (erroring, unrewritten) method call without the marker import", () => {
    const code = `
class Point {
  constructor(public x: number, public y: number) {}
}
interface Eq<A> { equals(a: A, b: A): boolean; notEquals(a: A, b: A): boolean; }

/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};

declare const p: Point;
declare const q: Point;
export const r = p.equals(q);
`.trim();

    const result = transform(code, { fileName: "playground-method-sugar-eq-off.ts" });
    expect(result.code).toContain("export const r = p.equals(q);");
  });

  it("rewrites p.equals(q) for a same-file @derive(Eq) companion (the pre-transform-scan bug this PEP fixes)", () => {
    const code = `
import "@typesugar/std/syntax/eq";
import { derive, Eq } from "typesugar";

@derive(Eq)
class Point {
  constructor(public x: number, public y: number) {}
}

declare const p: Point;
declare const q: Point;
export const r = p.equals(q);
`.trim();

    const result = transform(code, { fileName: "playground-method-sugar-derive.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("export const r = Point.Eq.equals(p, q);");
  });
});
