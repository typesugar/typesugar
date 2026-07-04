/**
 * PEP-052 — same-file `@derive` companion visible to operator sugar (task #30).
 *
 * `tryRewriteTypeclassOperator` resolves instances via `InstanceScanner.scanLocalFile`,
 * which reads `sourceFile.statements` — the pre-transform parse tree. A `@derive(Eq)`
 * companion is synthesized by the SAME transform pass and spliced only into the
 * transformer's output tree, so the scan-based path could never see it: `===` on a
 * `@derive`'d class stayed native reference equality even with the operator syntax
 * marker imported, as long as the companion and the use site were in the same file.
 *
 * Fixed by having `@derive`'s GenericDerivation expansion register the companion it
 * just built (`InstanceScanner.registerSynthesized`) at the moment it's created, so a
 * later use site in the same file finds it without needing to re-scan the source text.
 */

import { describe, it, expect } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";

describe("PEP-052: @derive companion in the same file as its operator use site", () => {
  it("rewrites === for a @derive(Eq) class declared and used in the same file", () => {
    const code = `
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";

@derive(Eq)
class Point {
  constructor(public x: number, public y: number) {}
}

declare const p1: Point;
declare const p2: Point;
export const same = p1 === p2;
`.trim();

    const result = transformCode(code, { fileName: "derive-same-file-eq.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Point.Eq.equals(p1, p2)");
    expect(result.code).not.toMatch(/export const same = p1 === p2;/);
  });

  it("rewrites < for a @derive(Ord) class declared and used in the same file", () => {
    const code = `
import "@typesugar/std/syntax/ord/ops";
import { derive, Ord } from "typesugar";

@derive(Ord)
class Point {
  constructor(public x: number, public y: number) {}
}

declare const p1: Point;
declare const p2: Point;
export const lt = p1 < p2;
`.trim();

    const result = transformCode(code, { fileName: "derive-same-file-ord.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Point.Ord.lessThan(p1, p2)");
    expect(result.code).not.toMatch(/export const lt = p1 < p2;/);
  });

  it("leaves === native without the operator syntax marker (activation gate still applies)", () => {
    const code = `
import { derive, Eq } from "typesugar";

@derive(Eq)
class Point {
  constructor(public x: number, public y: number) {}
}

declare const p1: Point;
declare const p2: Point;
export const same = p1 === p2;
`.trim();

    const result = transformCode(code, { fileName: "derive-same-file-eq-off.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("export const same = p1 === p2;");
  });

  it("still resolves a SECOND @derive'd class declared later in the same file (no stale registration)", () => {
    const code = `
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";

@derive(Eq)
class First {
  constructor(public a: number) {}
}

declare const f1: First;
declare const f2: First;
export const firstSame = f1 === f2;

@derive(Eq)
class Second {
  constructor(public b: number) {}
}

declare const s1: Second;
declare const s2: Second;
export const secondSame = s1 === s2;
`.trim();

    const result = transformCode(code, { fileName: "derive-same-file-eq-two-classes.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("First.Eq.equals(f1, f2)");
    expect(result.code).toContain("Second.Eq.equals(s1, s2)");
  });
});
