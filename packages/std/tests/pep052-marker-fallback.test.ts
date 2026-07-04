/**
 * PEP-052 Wave 6 — resolution-free operator/method marker fallback.
 *
 * Verifies (1) that std's fallback registrations exactly match its marker
 * files' own JSDoc tags (drift protection — mirrors Wave 5's `@do-methods`
 * tag consistency test and Wave 3's do-notation fallback consistency test),
 * and (2) the mechanism end-to-end through `@typesugar/transformer-core`'s
 * in-memory `transformCode` — the actual host this wave exists for
 * (`@typesugar/playground`'s browser bundle and any virtual-filename
 * pipeline use the same in-memory-host code path, which cannot resolve
 * modules via the checker at all).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import "@typesugar/macros";
import "@typesugar/std/macros"; // registers the fallback table under test
import { transformCode as transformCodeInMemory } from "@typesugar/transformer-core";

describe("PEP-052 Wave 6: std marker fallback ↔ marker file consistency", () => {
  const here = new URL(".", import.meta.url).pathname;
  const STD_SYNTAX_TYPECLASSES: Array<[path: string, typeclass: string, hasOps: boolean]> = [
    ["eq", "Eq", true],
    ["ord", "Ord", true],
    ["semigroup", "Semigroup", true],
    ["monoid", "Monoid", true],
    ["group", "Group", true],
    ["numeric", "Numeric", true],
    ["integral", "Integral", true],
    ["fractional", "Fractional", true],
    ["clone", "Clone", false],
    ["debug", "Debug", false],
    ["default", "Default", false],
    ["json", "Json", false],
    ["type-guard", "TypeGuard", false],
  ];

  function tagOf(file: string, tagName: string): string {
    const src = readFileSync(file, "utf8");
    const m = src.match(new RegExp(`@${tagName}\\s+(\\S+)`));
    if (!m) throw new Error(`${file} carries no @${tagName} tag`);
    return m[1];
  }

  for (const [path, typeclass, hasOps] of STD_SYNTAX_TYPECLASSES) {
    it(`syntax/${path}.ts's @syntax-methods tag names ${typeclass}`, () => {
      expect(tagOf(`${here}../src/syntax/${path}.ts`, "syntax-methods")).toBe(typeclass);
    });
    if (hasOps) {
      it(`syntax/${path}/ops.ts's @syntax-operators tag names ${typeclass}`, () => {
        expect(tagOf(`${here}../src/syntax/${path}/ops.ts`, "syntax-operators")).toBe(typeclass);
      });
    }
  }

  it("every marker file has a corresponding fallback registration (no unregistered marker)", async () => {
    const { getSyntaxMarkerFallback } = await import("@typesugar/core");
    for (const [path, typeclass, hasOps] of STD_SYNTAX_TYPECLASSES) {
      const methodEntry = getSyntaxMarkerFallback(`@typesugar/std/syntax/${path}`);
      expect(methodEntry?.methods).toContain(typeclass);
      if (hasOps) {
        const opsEntry = getSyntaxMarkerFallback(`@typesugar/std/syntax/${path}/ops`);
        expect(opsEntry?.operators).toContain(typeclass);
      }
    }
  });
});

describe("PEP-052 Wave 6: in-memory-host end-to-end (the host this wave exists for)", () => {
  // NOTE: `eqPoint` needs an explicit `: Eq<Point>` annotation — the instance
  // scanner's `@impl` JSDoc path resolves `forType` via `resolveTypeString`,
  // which only handles primitive keywords (Wave 5); a non-keyword type
  // string like "Point" only resolves through the type-annotation path
  // (`extractFromTypeAnnotation`, which asks the checker directly). This is
  // pre-existing scanner behavior, unrelated to Wave 6.
  it("activates Eq operator syntax with NO real module resolution available", () => {
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

    const result = transformCodeInMemory(code, { fileName: "marker-fallback-eq.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/[^.]p === q/);
    // Zero-cost specialization inlines the dictionary call directly.
    expect(result.code).toContain("p.x === q.x && p.y === q.y");
  });

  it("leaves `===` native in the same host without the marker import", () => {
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

    const result = transformCodeInMemory(code, { fileName: "marker-fallback-eq-off.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("p === q");
    expect(result.code).not.toContain("p.x === q.x");
  });
});
