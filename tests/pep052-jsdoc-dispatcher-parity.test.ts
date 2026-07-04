/**
 * PEP-052 Wave 8 — JSDoc dispatcher unification gate.
 *
 * Before this wave, transformer-core's JSDoc/decorator dispatchers had no
 * special case for `@derive`/`@deriving` (PEP-032 deleted the standalone
 * `derive` ATTRIBUTE macro, so both pipelines must route it through
 * `globalRegistry.getDerive` directly instead of the ordinary attribute
 * lookup) — `@deriving` JSDoc tags emitted a false "unknown macro" warning
 * and real `@derive(...)` decorators silently no-op'd. `@adt` was simply
 * missing from transformer-core's `JSDOC_MACRO_TAGS` map entirely, so it was
 * never even recognized as a macro-triggering tag.
 *
 * This suite runs the same fixtures through BOTH pipelines and asserts they
 * agree — the "jsdoc-macros + derive suites on both pipelines" gate the PEP
 * calls for, which didn't exist before this wave.
 */
import { describe, it, expect } from "vitest";

import "@typesugar/macros";

import { transformCode } from "@typesugar/transformer";
import { transformCode as transformCodeInMemory } from "@typesugar/transformer-core";

function errorsOf(diags: { severity: string }[]) {
  return diags.filter((d) => d.severity === "error");
}

describe("PEP-052 Wave 8: @deriving JSDoc tag — parity between legacy and transformer-core", () => {
  it("both pipelines derive Eq from a JSDoc tag", () => {
    const code = `
/** @deriving Eq */
export interface Point { x: number; y: number; }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-deriving-eq-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-deriving-eq-core.ts" });

    expect(errorsOf(legacy.diagnostics)).toEqual([]);
    expect(errorsOf(core.diagnostics)).toEqual([]);
    expect(legacy.changed).toBe(true);
    expect(legacy.code).toContain("namespace Point");
    expect(legacy.code).toContain("Eq");
    expect(core.code).toContain("namespace Point");
    expect(core.code).toContain("Eq");
  });

  it("both pipelines derive multiple typeclasses from one @deriving tag", () => {
    const code = `
/** @deriving Eq, Show */
export interface Range { start: number; end: number; }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-deriving-multi-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-deriving-multi-core.ts" });

    expect(errorsOf(legacy.diagnostics)).toEqual([]);
    expect(errorsOf(core.diagnostics)).toEqual([]);
    for (const result of [legacy, core]) {
      expect(result.code).toContain("Eq");
      expect(result.code).toContain("Show");
    }
  });

  it("both pipelines accept @derive (not just @deriving) as a JSDoc tag", () => {
    const code = `
/** @derive Eq */
export interface Coord { x: number; y: number; }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-derive-tag-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-derive-tag-core.ts" });

    expect(errorsOf(legacy.diagnostics)).toEqual([]);
    expect(errorsOf(core.diagnostics)).toEqual([]);
    expect(legacy.code).toContain("Eq");
    expect(core.code).toContain("Eq");
  });

  it("both pipelines strip optional wrapping parens: @deriving (Eq, Show)", () => {
    const code = `
/** @deriving (Eq, Show) */
export interface Wrapped { value: number; }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-deriving-parens-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-deriving-parens-core.ts" });

    expect(errorsOf(legacy.diagnostics)).toEqual([]);
    expect(errorsOf(core.diagnostics)).toEqual([]);
    for (const result of [legacy, core]) {
      expect(result.code).toContain("Eq");
      expect(result.code).toContain("Show");
    }
  });
});

describe("PEP-052 Wave 8: real @derive(...) decorator — parity between legacy and transformer-core", () => {
  it("both pipelines expand a real @derive(Eq) decorator on a class", () => {
    const code = `
@derive(Eq)
export class Point2 { constructor(public x: number, public y: number) {} }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-derive-decorator-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-derive-decorator-core.ts" });

    expect(errorsOf(legacy.diagnostics)).toEqual([]);
    expect(errorsOf(core.diagnostics)).toEqual([]);
    expect(legacy.code).toContain("Eq");
    expect(core.code).toContain("Eq");
    // The decorator itself must be stripped from the output in both.
    expect(legacy.code).not.toContain("@derive(Eq)");
    expect(core.code).not.toContain("@derive(Eq)");
  });
});

describe("PEP-052 Wave 8: @adt JSDoc tag — now recognized by transformer-core", () => {
  // Before this wave, transformer-core's JSDOC_MACRO_TAGS map didn't even
  // contain "adt", so a bare `/** @adt */` tag was silently ignored — no
  // warning, no error, nothing. Now that it's in the map, the tag reaches
  // the real adt attribute macro in BOTH pipelines, which reports the same
  // validation error for a non-union type in both (proving routing parity,
  // not full JSDoc-argument support for @adt specifically — that's a
  // separate, pre-existing concern: even the LEGACY pipeline, which has
  // always had "adt" in its map, can't fully expand a bare JSDoc `@adt` tag
  // on a real union today; only the decorator form `@adt` does).
  it("both pipelines report the same @adt validation error for a non-union type", () => {
    const code = `
/** @adt */
export type Shape = { kind: "circle"; radius: number };
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-adt-invalid-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-adt-invalid-core.ts" });

    expect(errorsOf(legacy.diagnostics).length).toBeGreaterThan(0);
    expect(errorsOf(core.diagnostics).length).toBeGreaterThan(0);
    expect(errorsOf(legacy.diagnostics)[0].message).toContain("union type");
    expect(errorsOf(core.diagnostics)[0].message).toContain("union type");
  });

  it("both pipelines route the JSDoc tag to the real macro instead of silently ignoring it", () => {
    // Before this wave: transformer-core's JSDOC_MACRO_TAGS map had no "adt"
    // entry at all, so this fixture produced changed: false, zero
    // diagnostics — completely silent. (The decorator form `@adt` is a
    // separate code path not gated by this map at all, so it isn't a useful
    // comparison here — see task #25 for a real, pre-existing, unrelated bug
    // found in @adt's own variant extraction under transformer-core.)
    const code = `
/** @adt */
export type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
    `.trim();

    const core = transformCodeInMemory(code, { fileName: "parity-adt-recognized-core.ts" });
    expect(core.changed || errorsOf(core.diagnostics).length > 0).toBe(true);
  });
});

describe("PEP-052 Wave 8: derive diagnostics (TS9101/TS9103/TS9104) — parity between legacy and transformer-core", () => {
  // These fixtures mirror tests/diagnostics.test.ts's "Derive Diagnostics"
  // suite (legacy-only). Porting expandDeriveDecorator's dispatch onto
  // transformer-core's shared implementation required first PORTING these
  // diagnostic checks into that shared implementation — it had none of them
  // before this wave (verified: it silently produced zero diagnostics for
  // all three fixtures below). These tests are the parity gate for that fix.
  it("both pipelines report TS9101 for a function-typed field", () => {
    const code = `
/** @deriving Eq */
interface HasFunction { x: number; callback: () => void; }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-ts9101-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-ts9101-core.ts" });

    // Check the message names the actual offending field, not just the code
    // — proves it fired for THIS field, not coincidentally for an unrelated
    // reason that happens to share the diagnostic code.
    expect(
      errorsOf(legacy.diagnostics).some((d) => d.code === 9101 && d.message.includes("callback"))
    ).toBe(true);
    expect(
      errorsOf(core.diagnostics).some((d) => d.code === 9101 && d.message.includes("callback"))
    ).toBe(true);
  });

  it("both pipelines report TS9103 for a union without a discriminant", () => {
    const code = `
/** @deriving Eq */
type NoDiscriminant = { name: string } | { age: number };
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-ts9103-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-ts9103-core.ts" });

    expect(errorsOf(legacy.diagnostics).some((d) => d.code === 9103)).toBe(true);
    expect(errorsOf(core.diagnostics).some((d) => d.code === 9103)).toBe(true);
  });

  it("both pipelines report TS9104 for an empty interface", () => {
    const code = `
/** @deriving Eq */
interface EmptyType {}
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-ts9104-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-ts9104-core.ts" });

    expect(
      errorsOf(legacy.diagnostics).some((d) => d.code === 9104 && d.message.includes("EmptyType"))
    ).toBe(true);
    expect(
      errorsOf(core.diagnostics).some((d) => d.code === 9104 && d.message.includes("EmptyType"))
    ).toBe(true);
  });

  it("both pipelines report TS9104 for a class with only methods (methods aren't derivable fields)", () => {
    // Also the regression test for a separate parity gap this wave found and
    // fixed: transformer-core's extractTypeInfo was missing the
    // method/accessor skip check legacy's always had, so it would have
    // incorrectly counted a method as a derivable data field instead of
    // reporting "no fields" here.
    const code = `
/** @deriving Eq */
class HasOnlyMethods { getValue() { return 1; } get computed() { return 2; } }
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-ts9104-methods-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-ts9104-methods-core.ts" });

    expect(
      errorsOf(legacy.diagnostics).some(
        (d) => d.code === 9104 && d.message.includes("HasOnlyMethods")
      )
    ).toBe(true);
    expect(
      errorsOf(core.diagnostics).some(
        (d) => d.code === 9104 && d.message.includes("HasOnlyMethods")
      )
    ).toBe(true);
  });

  // NOTE: mirrors tests/diagnostics.test.ts's "TS9103 does not fire for
  // single-member union" fixture verbatim (pre-existing, not introduced by
  // this wave) — despite the name, `{ value: number }` isn't syntactically a
  // union at all (no `|`), so this actually tests that TS9103's
  // union-specific check is correctly skipped for an ordinary product type,
  // not a true single-variant-union boundary (TypeScript has no such
  // construct — a union always has ≥2 members once you write a `|`).
  it("neither pipeline reports TS9103 for an ordinary (non-union) product type", () => {
    const code = `
/** @deriving Eq */
type Wrapper = { value: number };
    `.trim();

    const legacy = transformCode(code, { fileName: "parity-ts9103-single-legacy.ts" });
    const core = transformCodeInMemory(code, { fileName: "parity-ts9103-single-core.ts" });

    expect(errorsOf(legacy.diagnostics)).toEqual([]);
    expect(errorsOf(core.diagnostics)).toEqual([]);
  });
});
