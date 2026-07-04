/**
 * PEP-052 Wave 6 Phase D — std/fp marker-fallback registrations reach the
 * actual playground `transform()` entry point (`src/index.ts`), which is the
 * real motivating in-memory host: no filesystem, no real module resolution,
 * a synthetic `fileName` that was never on disk.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { transform, clearCache } from "../src/index.js";

describe("playground transform — PEP-052 Wave 6 marker fallback", () => {
  beforeEach(() => {
    clearCache();
  });

  it("activates Eq operator syntax for @typesugar/std/syntax/eq/ops with no real module resolution", () => {
    const code = `
import "@typesugar/std/syntax/eq/ops";

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
export const r = p === q;
`.trim();

    const result = transform(code, { fileName: "playground-marker-fallback-eq.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Zero-cost specialization inlines the dictionary call directly,
    // replacing the entire `p === q` expression — assert the exact
    // rewritten statement rather than a substring regex.
    expect(result.code).toContain("export const r = p.x === q.x && p.y === q.y;");
  });

  it("leaves `===` native without the marker import", () => {
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
export const r = p === q;
`.trim();

    const result = transform(code, { fileName: "playground-marker-fallback-eq-off.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("export const r = p === q;");
  });
});
