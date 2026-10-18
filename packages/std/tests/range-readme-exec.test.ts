/**
 * The std README's Range section (packages/std/README.md "### Range"),
 * transformed through the real pipeline and EXECUTED (docs review 2026-10,
 * W#7): `size/isEmpty/forEach/map/filter/reduce/last` were not exported from
 * the root under their method names, so the extension resolver had nothing to
 * pair `r.size()` with — the calls type-checked and threw at runtime.
 */
import { describe, it, expect } from "vitest";
import { transformAndRun } from "./match-exec-helpers.js";

describe("README Range examples", () => {
  it("query, iterate and materialize", () => {
    const r =
      transformAndRun(`import { to, until, step, reversed, toArray, contains, size, first, last, isEmpty, forEach, map, filter, reduce } from "@typesugar/std";
const r1 = (1).to(10);
const r2 = (1).until(10);
const r3 = (0).to(100).step(10);
const r4 = (1).to(5).reversed();
export const materialized = (1).to(5).toArray();
export const sizes = [toArray(r1).length, toArray(r2).length, toArray(r3), toArray(r4)];
export const query = [(1).to(100).contains(42), (1).to(10).size(), (1).to(10).first(), (1).to(10).last(), (1).to(10).isEmpty()];
export const seen: string[] = [];
(1).to(5).forEach((n, i) => seen.push(\`\${i}: \${n}\`));
export const squares = (1).to(5).map((n) => n * n);
export const evens = (1).to(10).filter((n) => n % 2 === 0);
export const total = (1).to(5).reduce(0, (sum, n) => sum + n);
export const arrLast = [1, 2, 3].last();`);
    if (r.runError) throw new Error(`${String(r.runError)}\n--- emitted ---\n${r.code}`);
    expect(r.errors).toEqual([]);
    const ex = r.exports;
    expect(ex.materialized).toEqual([1, 2, 3, 4, 5]);
    expect(ex.sizes).toEqual([
      10,
      9,
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      [5, 4, 3, 2, 1],
    ]);
    expect(ex.query).toEqual([true, 10, 1, 10, false]);
    expect(ex.seen).toEqual(["0: 1", "1: 2", "2: 3", "3: 4", "4: 5"]);
    expect(ex.squares).toEqual([1, 4, 9, 16, 25]);
    expect(ex.evens).toEqual([2, 4, 6, 8, 10]);
    expect(ex.total).toBe(15);
    expect(ex.arrLast).toBe(3);
  });
});
