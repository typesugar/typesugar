/**
 * Tests for the @hkt JSDoc macro (Tier 3: _ marker on type aliases).
 *
 * Verifies that `/** @hkt *​/ type FooF = Foo<_>` generates a correct
 * `interface FooF extends TypeFunction` with `this["__kind__"]` substitution.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";
import { clearRegistries, clearSyntaxRegistry } from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
});

// ============================================================================
// @hkt Tier 3: type alias with _ marker
// ============================================================================

describe("@hkt type alias with _ marker", () => {
  it("generates TypeFunction interface for Array<_>", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type ArrayF = Array<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-array.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface ArrayF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('this["__kind__"]');
    expect(result.code).not.toContain("type ArrayF");
  });

  it("generates TypeFunction interface for Map<K, _> with type parameter", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type MapF<K> = Map<K, _>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-map.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface MapF<K>");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('this["__kind__"]');
    expect(result.code).toContain("Map<K,");
  });

  it("generates TypeFunction interface for Promise<_>", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type PromiseF = Promise<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-promise.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface PromiseF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('Promise<this["__kind__"]>');
  });

  it("generates TypeFunction interface for Set<_>", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type SetF = Set<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-set.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface SetF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('Set<this["__kind__"]>');
  });

  it("preserves export modifier", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
export type ArrayF = Array<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-export.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("export interface ArrayF");
  });

  it("preserves constrained type parameters", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type MapF<K extends string> = Map<K, _>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-constrained.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface MapF<K extends string>");
    expect(result.code).toContain("extends TypeFunction");
  });
});

// ============================================================================
// @hkt error cases
// ============================================================================

describe("@hkt error cases", () => {
  it("reports TS9303 when type alias has no _ placeholder", () => {
    const code = `
/** @hkt */
type BadF = Array<number>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-no-underscore.ts" });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("TS9303");
  });

  it("reports TS9304 when type alias has multiple _ placeholders", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type PairF = [_, _];
    `.trim();

    const result = transformCode(code, { fileName: "hkt-multi-underscore.ts" });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("TS9304");
  });
});
