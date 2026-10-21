/**
 * `@derive` companions used from ANOTHER file of the same program (source,
 * not a `.d.ts`): the companion is generated when its own file is
 * transformed, which may come after the file that uses it, so the using file
 * finds it from the `@derive` annotation. Before the fix only method syntax
 * did; `===` stayed a reference comparison and summon/implicit() derived a
 * second instance (TS9009).
 */
import { describe, it, expect } from "vitest";
import { transformAll, typecheck, run, type Files } from "./external-types-harness.js";

const POINT = `/** @derive(Eq, Ord, Clone) */
export interface Point {
  x: number;
  y: number;
}
`;

const USE = `import "@typesugar/std/syntax/eq/ops";
import "@typesugar/std/syntax/ord/ops";
import { summon, implicit } from "typesugar";
import type { Eq } from "@typesugar/std";
import { Point } from "./point";

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };
const p3: Point = { x: 3, y: 0 };
function same<A>(a: A, b: A, E: Eq<A> = implicit()): boolean {
  return E.equals(a, b);
}
export const op = [p1 === p2, p1 === p3, p1 < p3];
export const viaSummon = summon<Eq<Point>>().equals(p1, p3);
export const viaImplicit = [same(p1, p2), same(p1, p3)];
`;

describe("@derive companions from another source file", () => {
  // Both orders: the using file transformed before and after the declaring one.
  for (const order of [
    ["use.ts", "point.ts"],
    ["point.ts", "use.ts"],
  ]) {
    it(`operators, summon and implicit() reference Point's companions (${order.join(" then ")})`, () => {
      const files: Files = { "point.ts": POINT, "use.ts": USE };
      const t = transformAll(files, order);
      expect(t.diagnostics).toEqual({ "point.ts": [], "use.ts": [] });
      const out = t.code["use.ts"];
      expect(out).toContain(
        "export const op = [Point.Eq.equals(p1, p2), Point.Eq.equals(p1, p3), Point.Ord.lessThan(p1, p3)];"
      );
      expect(out).toContain("export const viaSummon = Point.Eq.equals(p1, p3);");
      expect(out).toContain(
        "export const viaImplicit = [same(p1, p2, Point.Eq), same(p1, p3, Point.Eq)];"
      );
      expect(typecheck(t.code)).toEqual([]);
      const m = run(t.code, "use.ts");
      expect(m.op).toEqual([true, false, true]);
      expect(m.viaSummon).toBe(false);
      expect(m.viaImplicit).toEqual([true, false]);
    });
  }

  it("a type whose field is another file's derived type uses that type's companion", () => {
    const t = transformAll({
      "point.ts": POINT,
      "segment.ts": `import { Point } from "./point";
/** @derive(Eq) */
export interface Segment {
  from: Point;
  to: Point;
}
`,
    });
    expect(t.diagnostics).toEqual({ "point.ts": [], "segment.ts": [] });
    expect(t.code["segment.ts"]).toContain("Point.Eq.equals(a.from, b.from)");
  });
});

describe("one derived type reached through two import bindings", () => {
  it("the same companion under two names is one instance, not an ambiguity", () => {
    // Before: "Ambiguous Eq instance for type 'Vec': Vec.Eq, Vec.Eq" — the
    // two bindings were two candidates although both are vec.ts's `Vec`.
    const t = transformAll({
      "vec.ts": `/** @derive(Eq) */
export interface Vec {
  x: number;
  y: number;
}
`,
      "idx.ts": `export { Vec } from "./vec";
`,
      "reexp.ts": `import { Vec } from "./vec";
export { Vec };
`,
      "use.ts": `import "@typesugar/std/syntax/eq/ops";
import { Vec } from "./idx";
import { Vec as V2 } from "./reexp";
const a: Vec = { x: 1, y: 2 };
const b: V2 = { x: 1, y: 2 };
const c: V2 = { x: 3, y: 4 };
export const r = [a === b, b === c];
`,
    });
    expect(t.diagnostics["use.ts"]).toEqual([]);
    expect(t.code["use.ts"]).toMatch(
      /export const r = \[(Vec|V2)\.Eq\.equals\(a, b\), (Vec|V2)\.Eq\.equals\(b, c\)\];/
    );
    expect(typecheck(t.code)).toEqual([]);
    expect(run(t.code, "use.ts").r).toEqual([true, false]);
  });
});
