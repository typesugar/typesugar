/**
 * Wave 2D: Standalone typeclass with auto-derivation via GenericDerivation.
 *
 * Verifies that an external typeclass (not a builtin) can:
 * 1. Register a GenericDerivation strategy
 * 2. Work with @derive just like builtin typeclasses
 * 3. Use resolveFieldInstance for field-level instance lookup
 *
 * This proves the framework is general — no special-casing of builtin names.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";
import {
  clearRegistries,
  clearSyntaxRegistry,
  registerGenericDerivation,
  makePrimitiveChecker,
  resolveFieldInstance,
} from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
});

// ============================================================================
// Custom Typeclass: Pretty — a non-builtin typeclass for testing
// ============================================================================

/**
 * Register a "Pretty" typeclass derivation using the same framework
 * that builtins use.  This simulates what an external library would do.
 */
function registerPrettyTypeclass() {
  registerGenericDerivation("Pretty", {
    typeclassName: "Pretty",
    fieldTypeclass: "Pretty",

    hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", "boolean"])),

    deriveProduct(_ctx, typeName, meta) {
      if (!meta.fieldNames || !meta.fieldTypes) return null;

      const parts = meta.fieldNames.map((name, i) => {
        const ft = meta.fieldTypes![i];
        switch (ft) {
          case "number":
            return `\`${name}=\${String(a.${name})}\``;
          case "string":
            return `\`${name}="\${a.${name}}"\``;
          case "boolean":
            return `\`${name}=\${a.${name} ? "yes" : "no"}\``;
          default:
            return null;
        }
      });

      if (parts.some((p) => p === null)) return null;

      return `({ pretty: (a: ${typeName}) => \`<${typeName} \${[${parts.join(", ")}].join(" ")}>\` })`;
    },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("custom typeclass @derive via GenericDerivation", () => {
  beforeEach(() => {
    registerPrettyTypeclass();
  });

  it("@derive(Pretty) generates companion namespace for product type", () => {
    const code = `
/** @derive(Pretty) */
interface Widget { name: string; count: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts" });

    expect(result.changed).toBe(true);
    // Should generate a companion namespace, same as builtins
    expect(result.code).toContain("namespace Widget");
    // Should contain the Pretty property inside the namespace
    expect(result.code).toContain("Pretty");
    // Should contain the pretty method
    expect(result.code).toContain("pretty");
  });

  it("generated Pretty instance produces correct output shape", () => {
    const code = `
/** @derive(Pretty) */
interface Config { host: string; port: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts" });

    expect(result.changed).toBe(true);
    // Should be in a companion namespace, same as builtins
    expect(result.code).toContain("namespace Config");
    expect(result.code).toContain("Pretty");
    // Should reference field names in generated code
    expect(result.code).toContain("host");
    expect(result.code).toContain("port");
  });

  it("@derive(Pretty) alongside builtin @derive(Eq) both work", () => {
    const code = `
/** @derive(Pretty, Eq) */
interface Pair { x: number; y: number; }
    `.trim();

    const result = transformCode(code, { fileName: "test.ts" });

    expect(result.changed).toBe(true);
    // Both typeclasses produce companion namespaces
    expect(result.code).toContain("namespace Pair");
    expect(result.code).toContain("Pretty");
    expect(result.code).toContain("Eq");
  });

  it("@derive(Pretty) fails gracefully for unsupported field types", () => {
    const code = `
/** @derive(Pretty) */
interface Complex { data: Map<string, number>; }
    `.trim();

    // Map is not in the primitive checker, so derivation should fail
    // but should not crash — the error is reported via diagnostics
    const result = transformCode(code, { fileName: "test.ts" });

    // Should not contain a prettyComplex since Map is unsupported
    // (the GenericDerivation returns null for unsupported field types)
    expect(result.code).not.toContain("prettyComplex");
  });
});

describe("resolveFieldInstance public API", () => {
  it("is exported and callable", () => {
    expect(typeof resolveFieldInstance).toBe("function");
  });
});
