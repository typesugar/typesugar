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
import "@typesugar/effect/syntax/do";
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

  it("one effect/syntax/do import activates labels AND provides the Effect instance (Wave 3)", () => {
    const code = `
import "@typesugar/effect/syntax/do";
import { Effect } from "effect";
const prog =
let: {
  x << Effect.succeed(1);
  y << Effect.succeed(2);
}
yield: { x + y }
`;
    const result = transformCode(code, { fileName: "do-scope-effect-marker.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Effect.flatMap(");
    expect(result.code).not.toContain("let: {");
  });

  it("par: over Effect emits Effect.all via @do-methods metadata (Wave 3 — was broken .map/.ap before)", () => {
    const code = `
import "@typesugar/effect/syntax/do";
import { Effect } from "effect";
declare function fetchA(): import("effect").Effect.Effect<number>;
declare function fetchB(): import("effect").Effect.Effect<number>;
par: {
  a << fetchA();
  b << fetchB();
}
yield: { a + b }
`;
    const result = transformCode(code, { fileName: "do-scope-effect-par.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toContain("Effect.all([");
    expect(result.code).toContain("Effect.map(");
    expect(result.code).not.toContain(".ap(");
  });

  it("no ambient leak (Phase 3): Effect does NOT resolve without a providing import in the fixture", () => {
    // The fixture imports only "effect" (the runtime library) and the std
    // marker. Before Phase 3, the FlatMap<Effect> instance leaked in from the
    // global doNotationRegistry (seeded because THIS TEST PROCESS imported
    // @typesugar/effect — cross-file leakage, the bug PEP-052 exists to fix).
    // Now: labels are activated (std marker), but no FlatMap<Effect> instance
    // is in the file's scope → TS9225 naming the exact import to add.
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
    expect(result.code).not.toContain("Effect.flatMap(");
    const errs = result.diagnostics.filter((d) => d.code === 9225);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("Effect");
    expect(errs[0].message).toContain("@typesugar/effect/syntax/do");
  });
});
