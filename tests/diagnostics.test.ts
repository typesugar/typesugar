/**
 * Integration tests for typesugar macro diagnostics.
 *
 * Mirrors the error-showcase.ts file with automated assertions.
 * Each test verifies that transformCode produces the expected TS9xxx
 * diagnostic code when given code that should trigger it.
 *
 * Also tests "negative" cases: valid code that should NOT produce diagnostics.
 */

import { describe, it, expect } from "vitest";
import { transformCode, type TransformDiagnostic } from "@typesugar/transformer";

// Macro registration happens via side effects when @typesugar/macros is loaded.
// Node's require cache means this happens once per process — which is fine for
// integration tests that only inspect diagnostics.

const IMPORTS = `
import { comptime, summon, staticAssert, includeStr } from "typesugar";
import type { Eq, Ord } from "@typesugar/std";
`.trim();

function transform(code: string, fileName = "test-diag.ts") {
  const fullCode = `${IMPORTS}\n${code.trim()}`;
  return transformCode(fullCode, {
    fileName,
    backend: "typescript",
  });
}

function errors(result: { diagnostics?: TransformDiagnostic[] }): TransformDiagnostic[] {
  return (result.diagnostics ?? []).filter((d) => d.severity === "error");
}

function expectDiag(
  result: { diagnostics?: TransformDiagnostic[] },
  code: number,
  opts?: { messageContains?: string; count?: number }
) {
  const matching = errors(result).filter((d) => d.code === code);
  const count = opts?.count ?? 1;
  expect(
    matching.length,
    `Expected ${count} TS${code} diagnostic(s), got ${matching.length}. ` +
      `All errors: ${
        errors(result)
          .map((d) => `TS${d.code}`)
          .join(", ") || "(none)"
      }`
  ).toBe(count);
  if (opts?.messageContains) {
    expect(matching[0].message).toContain(opts.messageContains);
  }
}

function expectNoDiags(result: { diagnostics?: TransformDiagnostic[] }) {
  const errs = errors(result);
  expect(
    errs.length,
    `Expected 0 errors, got: ${errs.map((d) => `TS${d.code}: ${d.message.slice(0, 80)}`).join("\n")}`
  ).toBe(0);
}

// ===========================================================================
// Typeclass Resolution (TS9001, TS9005, TS9008)
// ===========================================================================

describe("Typeclass Resolution Diagnostics", () => {
  it("TS9001: summon with no instance for opaque type", () => {
    const result = transform(`
      interface OpaqueType {
        readonly _brand: unique symbol;
        value: unknown;
      }
      const eq = summon<Eq<OpaqueType>>();
    `);
    expectDiag(result, 9001, { messageContains: "OpaqueType" });
  });

  it("TS9005: summon() with no type argument", () => {
    const result = transform(`
      const x = summon();
    `);
    expectDiag(result, 9005, { messageContains: "type argument" });
  });

  it("TS9008: summon<number>() is not a typeclass reference", () => {
    const result = transform(`
      const x = summon<number>();
    `);
    expectDiag(result, 9008, { messageContains: "type reference" });
  });
});

// ===========================================================================
// Derive Failures (TS9101, TS9103, TS9104)
// ===========================================================================

describe("Derive Diagnostics", () => {
  it("TS9101: cannot derive Eq for type with function field", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      interface HasFunction {
        x: number;
        callback: () => void;
      }
    `);
    expectDiag(result, 9101, { messageContains: "Eq" });
  });

  it("TS9103: @deriving on union without discriminant", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type NoDiscriminant = { name: string } | { age: number };
    `);
    expectDiag(result, 9103, { messageContains: "discriminant" });
  });

  it("TS9104: @deriving on empty interface", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      interface EmptyType {}
    `);
    expectDiag(result, 9104, { messageContains: "no fields" });
  });

  it("TS9104: @deriving on empty class", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      class EmptyClass {}
    `);
    expectDiag(result, 9104, { messageContains: "no fields" });
  });
});

// ===========================================================================
// Macro Syntax (TS9205, TS9209, TS9212, TS9217, TS9219)
// ===========================================================================

describe("Macro Syntax Diagnostics", () => {
  it("TS9205: includeStr with non-literal argument", () => {
    const result = transform(`
      const path = "./template.txt";
      const content = includeStr(path);
    `);
    expectDiag(result, 9205, { messageContains: "compile-time constant" });
  });

  it("TS9209: comptime with runtime value", () => {
    const result = transform(`
      declare const runtimeValue: number;
      const x = comptime(() => runtimeValue * 2);
    `);
    expectDiag(result, 9209, { messageContains: "compile time" });
  });

  it("TS9212: includeStr with non-existent file", () => {
    const result = transform(`
      const content = includeStr("./this-file-does-not-exist.txt");
    `);
    expectDiag(result, 9212, { messageContains: "this-file-does-not-exist.txt" });
  });

  it("TS9217: staticAssert with false condition", () => {
    const result = transform(`
      staticAssert(1 + 1 === 3, "Math is broken");
    `);
    expectDiag(result, 9217, { messageContains: "Math is broken" });
  });

  it("TS9217: staticAssert with falsy numeric literal", () => {
    const result = transform(`
      staticAssert(0, "zero is falsy");
    `);
    expectDiag(result, 9217, { messageContains: "zero is falsy" });
  });

  it("TS9219: staticAssert with non-constant condition", () => {
    const result = transform(`
      declare const dynamicCondition: boolean;
      staticAssert(dynamicCondition, "Dynamic not allowed");
    `);
    expectDiag(result, 9219, { messageContains: "compile-time constant" });
  });
});

// ===========================================================================
// Valid code — should NOT produce diagnostics
// ===========================================================================

describe("Valid code produces no macro errors", () => {
  it("staticAssert with true condition", () => {
    const result = transform(`
      staticAssert(1 + 1 === 2, "Math works");
    `);
    expectNoDiags(result);
  });

  it("staticAssert with truthy numeric literal", () => {
    const result = transform(`
      staticAssert(42, "truthy");
    `);
    expectNoDiags(result);
  });

  it("comptime with constant expression", () => {
    const result = transform(`
      const x = comptime(() => 1 + 2 + 3);
    `);
    expectNoDiags(result);
    expect(result.code).toContain("6");
  });

  it("@deriving Eq on interface with primitive fields", () => {
    const result = transform(`
      import type { Eq, Ord } from "@typesugar/std";
      /** @deriving Eq, Ord */
      interface Point {
        x: number;
        y: number;
      }
    `);
    expectNoDiags(result);
    expect(result.changed).toBe(true);
  });

  it("@deriving Eq on discriminated union with inline type literals", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Shape =
        | { kind: "circle"; radius: number }
        | { kind: "square"; side: number };
    `);
    expectNoDiags(result);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("switch");
    expect(result.code).toContain("kind");
  });

  it("@deriving Eq on discriminated union with named type references", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      interface Circle { kind: "circle"; radius: number; }
      interface Square { kind: "square"; side: number; }
      /** @deriving Eq */
      type Shape = Circle | Square;
    `);
    expectNoDiags(result);
    expect(result.changed).toBe(true);
  });

  it("@deriving Eq on type alias with single object type", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Pair = { x: number; y: number };
    `);
    expectNoDiags(result);
    expect(result.changed).toBe(true);
  });
});

// ===========================================================================
// Inline union derivation correctness
// ===========================================================================

describe("Inline union derivation generates correct code", () => {
  it("generates field-level comparisons per variant", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Event =
        | { kind: "click"; x: number; y: number }
        | { kind: "key"; code: string };
    `);
    expectNoDiags(result);

    // Should reference the discriminant
    expect(result.code).toContain(".kind");

    // Should inline field comparisons (not reference non-existent variant instances)
    expect(result.code).not.toContain("eqEvent_click");
    expect(result.code).not.toContain("eqEvent_key");

    // Should use primitive instance refs for field types
    expect(result.code).toContain("eqNumber");
    expect(result.code).toContain("eqString");
  });

  it("handles variant with no non-discriminant fields", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Token =
        | { kind: "eof" }
        | { kind: "number"; value: number };
    `);
    expectNoDiags(result);
    expect(result.code).toContain("switch");
    // "eof" variant has no fields to compare, should produce "true"
    expect(result.code).toContain("true");
  });

  it("uses _tag as discriminant", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Result =
        | { _tag: "ok"; value: number }
        | { _tag: "err"; error: string };
    `);
    expectNoDiags(result);
    expect(result.code).toContain("_tag");
  });

  it("registers the instance", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Choice =
        | { kind: "a"; value: number }
        | { kind: "b"; label: string };
    `);
    expectNoDiags(result);
    expect(result.code).toContain("registerInstance");
  });
});

// ===========================================================================
// Edge cases and regressions
// ===========================================================================

describe("Diagnostic edge cases", () => {
  it("multiple diagnostics from single file", () => {
    const result = transform(`
      staticAssert(1 + 1 === 3, "first failure");
      staticAssert(2 + 2 === 5, "second failure");
    `);
    expectDiag(result, 9217, { count: 2 });
  });

  it("mixed valid and invalid staticAssert", () => {
    const result = transform(`
      staticAssert(1 + 1 === 2, "this passes");
      staticAssert(1 + 1 === 3, "this fails");
    `);
    expectDiag(result, 9217, { count: 1, messageContains: "this fails" });
  });

  it("TS9103 does not fire for single-member union", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      /** @deriving Eq */
      type Wrapper = { value: number };
    `);
    expectNoDiags(result);
  });

  it("TS9104 fires for each requested typeclass", () => {
    const result = transform(`
      import type { Eq, Ord } from "@typesugar/std";
      /** @deriving Eq, Ord */
      interface Empty {}
    `);
    // Should fire TS9104 once per typeclass
    const ts9104s = errors(result).filter((d) => d.code === 9104);
    expect(ts9104s.length).toBeGreaterThanOrEqual(2);
  });

  it("@deriving with unknown typeclass reports error", () => {
    const result = transform(`
      /** @deriving Serialize */
      interface Foo { x: number; }
    `);
    const errs = errors(result);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("TS9001: summon for type with function field", () => {
    const result = transform(`
      import type { Eq } from "@typesugar/std";
      interface WithFn { cb: () => void; }
      const eq = summon<Eq<WithFn>>();
    `);
    // Should fail to find/derive an instance
    const errs = errors(result);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some((d) => d.code === 9001 || d.code === 9101)).toBe(true);
  });
});
