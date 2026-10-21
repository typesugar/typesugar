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
