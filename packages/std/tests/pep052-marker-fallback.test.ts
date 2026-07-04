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
 *
 * The marker file set is discovered by GLOBBING `src/syntax/` rather than a
 * hand-maintained list, so a marker file added to (or removed from) that
 * directory without a matching change to `packages/std/src/macros/index.ts`'s
 * registration table is caught here automatically — a hardcoded copy of the
 * same list would silently miss exactly that drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import "@typesugar/macros";
import "@typesugar/std/macros"; // registers the fallback table under test
import { transformCode as transformCodeInMemory } from "@typesugar/transformer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const syntaxDir = path.join(here, "../src/syntax");

function tagOf(file: string, tagName: string): string | undefined {
  const src = readFileSync(file, "utf8");
  const m = src.match(new RegExp(`@${tagName}\\s+(\\S+)`));
  return m?.[1];
}

/** Discovered from the filesystem: `{path, typeclass, hasOps}` per marker. */
const STD_SYNTAX_TYPECLASSES: Array<{ path: string; typeclass: string; hasOps: boolean }> = readdirSync(
  syntaxDir,
  { withFileTypes: true }
)
  .filter((e) => e.isFile() && e.name.endsWith(".ts"))
  .map((e) => {
    const markerPath = e.name.replace(/\.ts$/, "");
    const typeclass = tagOf(path.join(syntaxDir, e.name), "syntax-methods");
    if (!typeclass) return null; // e.g. do.ts carries @syntax-labels, not a Wave 6 marker
    const opsFile = path.join(syntaxDir, markerPath, "ops.ts");
    return { path: markerPath, typeclass, hasOps: existsSync(opsFile) };
  })
  .filter((x): x is { path: string; typeclass: string; hasOps: boolean } => x !== null);

describe("PEP-052 Wave 6: std marker fallback ↔ marker file consistency", () => {
  it("discovered at least one @syntax-methods marker (glob isn't silently empty)", () => {
    expect(STD_SYNTAX_TYPECLASSES.length).toBeGreaterThan(0);
  });

  for (const { path: markerPath, typeclass, hasOps } of STD_SYNTAX_TYPECLASSES) {
    it(`syntax/${markerPath}.ts is registered as a method fallback for ${typeclass}`, async () => {
      const { getSyntaxMarkerFallback } = await import("@typesugar/core");
      const entry = getSyntaxMarkerFallback(`@typesugar/std/syntax/${markerPath}`);
      expect(entry?.methods).toContain(typeclass);
    });

    if (hasOps) {
      it(`syntax/${markerPath}/ops.ts's @syntax-operators tag names ${typeclass} and is registered`, async () => {
        const opsTag = tagOf(path.join(syntaxDir, markerPath, "ops.ts"), "syntax-operators");
        expect(opsTag).toBe(typeclass);

        const { getSyntaxMarkerFallback } = await import("@typesugar/core");
        const entry = getSyntaxMarkerFallback(`@typesugar/std/syntax/${markerPath}/ops`);
        expect(entry?.operators).toContain(typeclass);
      });
    }
  }
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
    // Zero-cost specialization inlines the dictionary call directly, replacing
    // the entire `p === q` expression — assert the exact rewritten statement
    // rather than a substring regex (a `[^.]p === q` negative match cannot
    // anchor at string offset 0 and would silently pass either way).
    expect(result.code).toContain("export const r = p.x === q.x && p.y === q.y;");
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
    expect(result.code).toContain("export const r = p === q;");
  });
});
