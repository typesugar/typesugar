/**
 * `@derive` companions used from ANOTHER file of the same program (source,
 * not a `.d.ts`): the companion is generated when its own file is
 * transformed, which may come after the file that uses it, so the using file
 * finds it from the `@derive` annotation. Before the fix only method syntax
 * did; `===` stayed a reference comparison and summon/implicit() derived a
 * second instance (TS9009).
 */
import { describe, it, expect } from "vitest";
import {
  transformAll,
  transformErrors,
  typecheck,
  run,
  type Files,
} from "./external-types-harness.js";

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

describe("operators find the instances summon finds (review round 2)", () => {
  // Reviewer repro: `s1 === s2` on a derived union alias and `a === b` on a
  // `Box<number>` whose `@derive(Eq) interface Box<T>` can't derive (generic
  // types aren't supported yet, docs/guides/derive.md "Generic Types": TS9106
  // at the declaration) both stayed reference comparisons, silently at the
  // use site, although summon<Eq<...>>() found Shape's instance and reported
  // TS9001 for Box's.
  const BOX = `/** @derive(Eq) */
export interface Box<T> { value: T }
/** @derive(Eq) */
export type Shape = { kind: "c"; r: number } | { kind: "s"; side: number };
`;
  const MAIN = `import "@typesugar/std/syntax/eq/ops";
import { summon } from "typesugar";
import type { Eq } from "@typesugar/std";
import { Box, Shape } from "./box";
const a: Box<number> = { value: 1 }, b: Box<number> = { value: 1 };
const s1: Shape = { kind: "c", r: 1 }, s2: Shape = { kind: "c", r: 1 };
export const boxes = a === b;
export const shapes = [s1 === s2, summon<Eq<Shape>>().equals(s1, s2)];
console.log(s1 === s2, summon<Eq<Shape>>().equals(s1, s2));
`;
  for (const order of [
    ["main.ts", "box.ts"],
    ["box.ts", "main.ts"],
  ]) {
    it(`Shape compares by Eq; Box<number> with no instance is TS9001 at the operator (${order.join(" then ")})`, () => {
      const t = transformAll({ "box.ts": BOX, "main.ts": MAIN }, order);
      expect(transformErrors(t)["box.ts"]).toEqual([
        expect.stringMatching(/\[TS9106\] Cannot derive Eq for 'Box'/),
      ]);
      const mainErrs = t.located["main.ts"].filter((d) => d.severity === "error");
      expect(mainErrs).toHaveLength(1);
      expect(mainErrs[0].message).toMatch(/\[TS9001\] No instance found for `Eq<Box<number>>`/);
      expect(mainErrs[0].message).toContain("derived<Eq<Box<number>>>()");
      expect(mainErrs[0].text).toBe("===");
      expect(mainErrs[0].line).toBe(7);
      const out = t.code["main.ts"];
      expect(out).toContain(
        "export const shapes = [Shape.Eq.equals(s1, s2), Shape.Eq.equals(s1, s2)];"
      );
      expect(out).toContain("console.log(Shape.Eq.equals(s1, s2), Shape.Eq.equals(s1, s2));");
    });
  }
});
