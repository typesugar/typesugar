/**
 * PEP-052 Wave 1 — std `Eq`/`Ord` operator activation through the real package.
 *
 * Imports the published `@typesugar/std` typeclasses + the `/syntax/*` activation
 * markers (resolved from std's built `dist`, the way a real consumer would), and
 * verifies that operators rewrite ONLY when the relevant marker is imported.
 *
 * Uses `Date` operands because primitive operands (`number`, `string`, …) are
 * intentionally left native by the transformer's primitive skip.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";
import { clearResolverCache, instanceScanner } from "@typesugar/macros";

beforeEach(() => {
  clearResolverCache();
  instanceScanner.clearCache();
});

describe("PEP-052 std Eq/Ord operator activation", () => {
  it("rewrites `d1 === d2` on Date when @typesugar/std/syntax/eq/ops is imported", () => {
    const code = `
import { eqDate } from "@typesugar/std/typeclasses";
import "@typesugar/std/syntax/eq/ops";

declare const d1: Date;
declare const d2: Date;
export const r = d1 === d2;
`.trim();

    const result = transformCode(code, { fileName: "consumer-eq.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/d1 === d2/);
    expect(result.code).toContain("eqDate.equals(d1, d2)");
  });

  it("leaves `d1 === d2` native when no syntax marker is imported", () => {
    const code = `
import { eqDate } from "@typesugar/std/typeclasses";

declare const d1: Date;
declare const d2: Date;
export const r = d1 === d2;
`.trim();

    const result = transformCode(code, { fileName: "consumer-eq-native.ts" });
    expect(result.code).toContain("d1 === d2");
    expect(result.code).not.toContain("eqDate.equals");
  });

  it("rewrites `d1 < d2` on Date when @typesugar/std/syntax/ord/ops is imported", () => {
    const code = `
import { ordDate } from "@typesugar/std/typeclasses";
import "@typesugar/std/syntax/ord/ops";

declare const d1: Date;
declare const d2: Date;
export const r = d1 < d2;
`.trim();

    const result = transformCode(code, { fileName: "consumer-ord.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/d1 < d2/);
    expect(result.code).toContain("ordDate.lessThan(d1, d2)");
  });

  it("does not activate Ord operators when only the Eq marker is imported", () => {
    const code = `
import { ordDate } from "@typesugar/std/typeclasses";
import "@typesugar/std/syntax/eq/ops";

declare const d1: Date;
declare const d2: Date;
export const r = d1 < d2;
`.trim();

    const result = transformCode(code, { fileName: "consumer-cross.ts" });
    expect(result.code).toContain("d1 < d2");
  });
});
