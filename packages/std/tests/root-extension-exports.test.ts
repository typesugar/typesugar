/**
 * Method syntax for an augmented method needs an import whose NAME is the
 * method's (`import { groupBy } from "@typesugar/std"` for `xs.groupBy(f)`),
 * or its `*Ext` namespace. std's root exported the array `groupBy` only as
 * `arrayGroupBy` (a leftover alias from when map.ts also exported a
 * `groupBy`), so the std showcase's `[...].groupBy(f)` had nothing to resolve
 * to and threw "groupBy is not a function" at run time.
 */
import { describe, it, expect } from "vitest";
import * as std from "@typesugar/std";
import { transformAndRun } from "./match-exec-helpers.js";

describe("std root exports for method syntax", () => {
  it("exports the array groupBy under its method name (and keeps arrayGroupBy)", () => {
    expect(typeof (std as Record<string, unknown>).groupBy).toBe("function");
    expect((std as Record<string, unknown>).groupBy).toBe(
      (std as Record<string, unknown>).arrayGroupBy
    );
  });

  it('["ant", "bee", "bat"].groupBy(f) with groupBy imported is rewritten and runs', () => {
    const r = transformAndRun(`import { groupBy } from "@typesugar/std";
export const grouped = ["ant", "bee", "bat"].groupBy((s) => s[0]);`);
    if (r.runError) throw new Error(`${String(r.runError)}\n--- emitted ---\n${r.code}`);
    expect(r.errors).toEqual([]);
    expect(r.exports.grouped).toEqual({ a: ["ant"], b: ["bee", "bat"] });
  });
});
