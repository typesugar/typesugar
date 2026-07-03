/**
 * PEP-052 Wave 3 — do-notation instance resolution scope tests.
 *
 * Phase 0 characterization: pins the CURRENT behavior of FlatMap/ParCombine
 * lookup so the scope-resolution migration (Phases 2-4) can flip assertions
 * deliberately rather than discover breakage by accident.
 *
 * NOTE the "ambient leak" test below documents the bug PEP-052 exists to fix:
 * an Effect comprehension resolves because THIS TEST PROCESS imported
 * `@typesugar/effect`, even though the transformed fixture file never does.
 * Phase 3 flips it: the fixture will need `@typesugar/effect/syntax/do` in
 * its own imports, and without it the comprehension reports "no instance in
 * scope" instead of silently depending on unrelated files' imports.
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";
import "@typesugar/std/macros";
import "@typesugar/effect"; // ambient seeding — see note above

import { transformCode } from "@typesugar/transformer";

describe("PEP-052 Wave 3 phase 0: current do-notation resolution", () => {
  it("Array comprehension expands with only the std syntax/do import", () => {
    const code = `
import "@typesugar/std/syntax/do";
let: {
  x << [1, 2, 3];
  y << [x * 10];
}
yield: { x + y }
`;
    const result = transformCode(code, { fileName: "do-scope-array.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain(".flatMap(");
    expect(result.code).not.toContain("let: {");
  });

  it("Promise comprehension emits .then chains (method-name metadata)", () => {
    const code = `
import "@typesugar/std/syntax/do";
declare function fetchA(): Promise<number>;
const r =
let: {
  a << fetchA();
}
yield: { a + 1 }
`;
    const result = transformCode(code, { fileName: "do-scope-promise.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain(".then(");
  });

  it("par: over Promise emits Promise.all", () => {
    const code = `
import "@typesugar/std/syntax/do";
declare function fetchA(): Promise<number>;
declare function fetchB(): Promise<number>;
par: {
  a << fetchA();
  b << fetchB();
}
yield: { a + b }
`;
    const result = transformCode(code, { fileName: "do-scope-par.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Promise.all");
  });

  it("Effect comprehension emits Effect.flatMap static calls", () => {
    const code = `
import "@typesugar/std/syntax/do";
import { Effect } from "effect";
const prog =
let: {
  x << Effect.succeed(1);
  y << Effect.succeed(2);
}
yield: { x + y }
`;
    const result = transformCode(code, { fileName: "do-scope-effect.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Effect.flatMap(");
  });

  it("AMBIENT LEAK (current behavior, flipped in Phase 3): Effect resolves without any @typesugar/effect import in the fixture", () => {
    // The fixture imports only "effect" (the runtime library) and the std
    // marker. The FlatMap<Effect> instance is found ONLY because this test
    // process side-effect-imported @typesugar/effect — cross-file leakage.
    const code = `
import "@typesugar/std/syntax/do";
import { Effect } from "effect";
const prog =
let: {
  x << Effect.succeed(1);
  y << Effect.succeed(2);
}
yield: { x + y }
`;
    const result = transformCode(code, { fileName: "do-scope-effect-ambient.ts" });
    // CURRENT: expands via the global doNotationRegistry.
    // PHASE 3: this fixture (unchanged) must instead leave the comprehension
    // unexpanded... except the std syntax/do marker is imported, so the label
    // IS activated — the expected Phase-3 behavior is a "no FlatMap instance
    // for 'Effect' in scope" diagnostic naming @typesugar/effect/syntax/do.
    expect(result.code).toContain("Effect.flatMap(");
  });
});
