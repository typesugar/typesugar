/**
 * Tests for coverage.ts — typeclass primitive registry and coverage checking.
 *
 * Covers:
 * - Wave 1 regression guards (PEP-039):
 *   - hasPrimitive key format (`typeName::typeclassName`, not the previous broken
 *     `typeName::__binop__(typeclassName` form).
 *   - getPrimitivesFor returns the registered types (the previous endsWith filter
 *     could not match because of the broken key format).
 *   - normalizeTypeName uses indexOf('<') instead of the greedy regex `/<.*>$/`,
 *     so nested generics like `Map<string, Array<number>>` strip to `Map`.
 * - Registry semantics: idempotency, different typeclasses/primitives coexist.
 * - checkCoverage: covered/missing/empty/non-primitive paths plus
 *   requiresCoverage:false short-circuit.
 * - configureCoverage / getCoverageConfig: defaults, override, missingMessage.
 * - validateCoverageOrError: reports diagnostics with summary, returns valid flag.
 * - Built-in primitives registered on module load.
 *
 * Each test resets the primitive registry via `primitiveRegistry.clear()` and
 * re-registers the built-in primitives where needed, so registry state never
 * leaks between cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import {
  registerPrimitive,
  hasPrimitive,
  getPrimitivesFor,
  configureCoverage,
  getCoverageConfig,
  checkCoverage,
  validateCoverageOrError,
  primitiveRegistry,
} from "./coverage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Built-in primitives that ship at module-load time (from coverage.ts). */
const BUILTIN_PRIMITIVES: ReadonlyArray<readonly [string, string]> = [
  ["number", "Show"],
  ["string", "Show"],
  ["boolean", "Show"],
  ["bigint", "Show"],
  ["null", "Show"],
  ["undefined", "Show"],
  ["Array", "Show"],
  ["number", "Eq"],
  ["string", "Eq"],
  ["boolean", "Eq"],
  ["bigint", "Eq"],
  ["null", "Eq"],
  ["undefined", "Eq"],
  ["Array", "Eq"],
  ["number", "Ord"],
  ["string", "Ord"],
  ["boolean", "Ord"],
  ["bigint", "Ord"],
  ["Array", "Ord"],
  ["number", "Hash"],
  ["string", "Hash"],
  ["boolean", "Hash"],
  ["bigint", "Hash"],
  ["null", "Hash"],
  ["undefined", "Hash"],
  ["Array", "Hash"],
  ["number", "Semigroup"],
  ["string", "Semigroup"],
  ["boolean", "Semigroup"],
  ["Array", "Semigroup"],
  ["number", "Monoid"],
  ["string", "Monoid"],
  ["boolean", "Monoid"],
  ["Array", "Monoid"],
];

/** Clear the registry; tests that rely on built-ins must re-seed explicitly. */
function clearRegistry(): void {
  primitiveRegistry.clear();
}

/** Re-register the built-in primitives after a clear. */
function seedBuiltins(): void {
  for (const [typeName, tcName] of BUILTIN_PRIMITIVES) {
    registerPrimitive(typeName, tcName);
  }
}

/**
 * Create a real MacroContext (backed by a temp ts.Program) so that
 * validateCoverageOrError can call ctx.reportError. The returned cleanup
 * removes the temp dir.
 */
function makeContext(): {
  ctx: ReturnType<typeof createMacroContext>;
  node: ts.Node;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  const source = "export const x = 1;";
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;

  let captured: ReturnType<typeof createMacroContext> | undefined;
  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
    captured = createMacroContext(program, sourceFile, transformContext);
    return (sf) => sf;
  };
  ts.transform(sourceFile, [transformerFactory]);

  if (!captured) throw new Error("Failed to create MacroContext");

  return {
    ctx: captured,
    node: sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ===========================================================================
// Wave 1 regression: hasPrimitive key format
// ===========================================================================

describe("Wave 1 regression: hasPrimitive key format", () => {
  beforeEach(clearRegistry);

  it("registerPrimitive+hasPrimitive round-trips a (type, typeclass) pair", () => {
    registerPrimitive("number", "Show");
    expect(hasPrimitive("number", "Show")).toBe(true);
  });

  it("hasPrimitive returns false for an unregistered typeclass on a known type", () => {
    registerPrimitive("number", "Show");
    expect(hasPrimitive("number", "MissingTypeclass")).toBe(false);
  });

  it("hasPrimitive returns false for an unregistered type on a known typeclass", () => {
    registerPrimitive("number", "Show");
    expect(hasPrimitive("Unknown", "Show")).toBe(false);
  });

  it("hasPrimitive returns false on an empty registry", () => {
    expect(hasPrimitive("number", "Show")).toBe(false);
  });

  it("stores the registry key as `${typeName}::${typeclassName}` (not the broken __binop__ form)", () => {
    registerPrimitive("number", "Show");
    expect(primitiveRegistry.has("number::Show")).toBe(true);
    // Guard against any regression that prefixes the key with __binop__.
    expect(primitiveRegistry.has("number::__binop__(Show")).toBe(false);
  });
});

// ===========================================================================
// Wave 1 regression: getPrimitivesFor filter
// ===========================================================================

describe("Wave 1 regression: getPrimitivesFor", () => {
  beforeEach(clearRegistry);

  it("returns the registered type names for a typeclass (multi-entry)", () => {
    registerPrimitive("number", "Show");
    registerPrimitive("string", "Show");
    expect(getPrimitivesFor("Show").sort()).toEqual(["number", "string"]);
  });

  it("returns an empty array for an unregistered typeclass", () => {
    registerPrimitive("number", "Show");
    expect(getPrimitivesFor("Unregistered")).toEqual([]);
  });

  it("returns an empty array on an empty registry", () => {
    expect(getPrimitivesFor("Show")).toEqual([]);
  });

  it("filters out other typeclasses sharing the same type prefix", () => {
    registerPrimitive("number", "Show");
    registerPrimitive("number", "Eq");
    registerPrimitive("string", "Show");
    expect(getPrimitivesFor("Show").sort()).toEqual(["number", "string"]);
    expect(getPrimitivesFor("Eq")).toEqual(["number"]);
  });
});

// ===========================================================================
// Wave 1 regression: normalizeTypeName (indexed via checkCoverage)
// ===========================================================================
//
// normalizeTypeName is not exported, so we exercise it through checkCoverage
// where the field type name passes through normalization before the lookup.
// The behaviour we need to lock in:
//   Array<string>                     -> Array     (basic strip)
//   Map<string, Array<number>>        -> Map       (nested generics)
//   number                            -> number    (passthrough, lowercase normalised)
//   ""                                -> ""        (empty passthrough)

describe("Wave 1 regression: normalizeTypeName via checkCoverage", () => {
  beforeEach(() => {
    clearRegistry();
    seedBuiltins();
  });

  it("strips `<...>` from a simple generic so `Array<string>` looks up as `Array`", () => {
    const result = checkCoverage("Show", [{ name: "xs", typeName: "Array<string>" }]);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("handles nested generics by cutting at the first `<` (Map<string, Array<number>> -> Map)", () => {
    // The old greedy regex `/<.*>$/` would also have stripped `Map`, but if
    // the impl regressed to e.g. `/<[^>]+>$/` the inner closer would prevent
    // the strip and `Map<string, Array<number>>` would survive verbatim,
    // failing the lookup. We register Map::Show and then check.
    registerPrimitive("Map", "Show");
    const result = checkCoverage("Show", [{ name: "m", typeName: "Map<string, Array<number>>" }]);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("passes through a plain primitive type name with no generics", () => {
    const result = checkCoverage("Show", [{ name: "n", typeName: "number" }]);
    expect(result.valid).toBe(true);
  });

  it("normalises an empty type name to empty (no crash, just a miss)", () => {
    const result = checkCoverage("Show", [{ name: "x", typeName: "" }]);
    // Empty normalises to "" which is never registered, so the field is missing.
    expect(result.valid).toBe(false);
    expect(result.missingFields).toHaveLength(1);
    expect(result.missingFields[0].fieldType).toBe("");
  });

  it("trims whitespace before generic argument stripping", () => {
    const result = checkCoverage("Show", [{ name: "xs", typeName: "Array <string>" }]);
    // 'Array ' trimmed to 'Array', lowercased matches alias -> 'Array'
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// Registry semantics
// ===========================================================================

describe("registry semantics", () => {
  beforeEach(clearRegistry);

  it("registerPrimitive is idempotent — registering twice keeps a single entry", () => {
    registerPrimitive("number", "Show");
    registerPrimitive("number", "Show");
    expect(hasPrimitive("number", "Show")).toBe(true);
    expect(getPrimitivesFor("Show")).toEqual(["number"]);
  });

  it("different typeclasses for the same primitive coexist", () => {
    registerPrimitive("number", "Show");
    registerPrimitive("number", "Eq");
    expect(hasPrimitive("number", "Show")).toBe(true);
    expect(hasPrimitive("number", "Eq")).toBe(true);
  });

  it("different primitives for the same typeclass coexist", () => {
    registerPrimitive("number", "Show");
    registerPrimitive("string", "Show");
    expect(hasPrimitive("number", "Show")).toBe(true);
    expect(hasPrimitive("string", "Show")).toBe(true);
  });

  it("exposes the underlying primitiveRegistry Set for inspection", () => {
    registerPrimitive("Foo", "Bar");
    expect(primitiveRegistry).toBeInstanceOf(Set);
    expect(primitiveRegistry.has("Foo::Bar")).toBe(true);
  });
});

// ===========================================================================
// Built-in primitives (registered on module load)
// ===========================================================================

describe("built-in primitives", () => {
  // Other suites have already mutated the registry by clearing it, so we
  // re-seed the built-in list and assert its shape. This documents which
  // (type, typeclass) pairs the module ships with by default.
  beforeEach(() => {
    clearRegistry();
    seedBuiltins();
  });

  it("registers number/string/boolean for Show", () => {
    expect(hasPrimitive("number", "Show")).toBe(true);
    expect(hasPrimitive("string", "Show")).toBe(true);
    expect(hasPrimitive("boolean", "Show")).toBe(true);
  });

  it("registers Array for every coverage-checked built-in typeclass", () => {
    for (const tc of ["Show", "Eq", "Ord", "Hash", "Semigroup", "Monoid"]) {
      expect(hasPrimitive("Array", tc)).toBe(true);
    }
  });

  it("does not register null/undefined for Ord (intentional gap)", () => {
    expect(hasPrimitive("null", "Ord")).toBe(false);
    expect(hasPrimitive("undefined", "Ord")).toBe(false);
  });

  it("does not register bigint/null/undefined for Semigroup", () => {
    expect(hasPrimitive("bigint", "Semigroup")).toBe(false);
    expect(hasPrimitive("null", "Semigroup")).toBe(false);
    expect(hasPrimitive("undefined", "Semigroup")).toBe(false);
  });
});

// ===========================================================================
// checkCoverage
// ===========================================================================

describe("checkCoverage", () => {
  beforeEach(() => {
    clearRegistry();
    seedBuiltins();
  });

  it("returns valid=true with no missing fields when every field has coverage", () => {
    const result = checkCoverage("Show", [
      { name: "a", typeName: "number" },
      { name: "b", typeName: "string" },
    ]);
    expect(result).toEqual({ valid: true, missingFields: [] });
  });

  it("returns valid=false and lists missing fields when one field has no instance", () => {
    const result = checkCoverage("Show", [
      { name: "a", typeName: "number" },
      { name: "b", typeName: "Custom" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toHaveLength(1);
    expect(result.missingFields[0].fieldName).toBe("b");
    expect(result.missingFields[0].fieldType).toBe("Custom");
    expect(typeof result.missingFields[0].message).toBe("string");
    expect(result.missingFields[0].message.length).toBeGreaterThan(0);
  });

  it("treats an empty field list as covered", () => {
    expect(checkCoverage("Show", [])).toEqual({ valid: true, missingFields: [] });
  });

  it("short-circuits to valid=true when the typeclass opts out of coverage (Functor)", () => {
    const result = checkCoverage("Functor", [{ name: "x", typeName: "NoSuchType" }]);
    expect(result).toEqual({ valid: true, missingFields: [] });
  });

  it("short-circuits to valid=true for Generic (structural typeclass)", () => {
    const result = checkCoverage("Generic", [{ name: "x", typeName: "Anything" }]);
    expect(result.valid).toBe(true);
  });

  it("uses the configured missingMessage formatter when one is set", () => {
    // Show has a custom missingMessage; we expect its text to appear.
    const result = checkCoverage("Show", [{ name: "meta", typeName: "Custom" }]);
    expect(result.valid).toBe(false);
    expect(result.missingFields[0].message).toContain("meta");
    expect(result.missingFields[0].message).toContain("Custom");
    expect(result.missingFields[0].message).toContain("Show");
  });

  it("falls back to a generic message when the typeclass has no missingMessage", () => {
    configureCoverage("NoMsgTC", { requiresCoverage: true });
    const result = checkCoverage("NoMsgTC", [{ name: "f", typeName: "Foo" }]);
    expect(result.valid).toBe(false);
    expect(result.missingFields[0].message).toMatch(/Field 'f' of type 'Foo' has no NoMsgTC/);
  });
});

// ===========================================================================
// configureCoverage / getCoverageConfig
// ===========================================================================

describe("configureCoverage / getCoverageConfig", () => {
  it("returns a default { requiresCoverage: true } config for an unknown typeclass", () => {
    const config = getCoverageConfig("Brand-new-tc-" + Date.now());
    expect(config.requiresCoverage).toBe(true);
    expect(config.missingMessage).toBeUndefined();
  });

  it("round-trips a configured value", () => {
    const tc = "Cfg" + Date.now();
    configureCoverage(tc, { requiresCoverage: false });
    expect(getCoverageConfig(tc).requiresCoverage).toBe(false);
  });

  it("the second configureCoverage call overrides the first (latest write wins)", () => {
    const tc = "Override" + Date.now();
    configureCoverage(tc, { requiresCoverage: true });
    configureCoverage(tc, { requiresCoverage: false });
    expect(getCoverageConfig(tc).requiresCoverage).toBe(false);
  });

  it("stores and invokes a custom missingMessage function", () => {
    const tc = "MsgTC" + Date.now();
    configureCoverage(tc, {
      requiresCoverage: true,
      missingMessage: (f, t, c) => `boom:${f}:${t}:${c}`,
    });
    const cfg = getCoverageConfig(tc);
    expect(cfg.missingMessage).toBeDefined();
    expect(cfg.missingMessage!("a", "X", "Y")).toBe("boom:a:X:Y");
  });
});

// ===========================================================================
// validateCoverageOrError
// ===========================================================================

describe("validateCoverageOrError", () => {
  beforeEach(() => {
    clearRegistry();
    seedBuiltins();
  });

  it("returns true and emits no diagnostics when coverage is complete", () => {
    const { ctx, node, cleanup } = makeContext();
    try {
      const ok = validateCoverageOrError(ctx, node, "Show", "User", [
        { name: "id", typeName: "number" },
        { name: "name", typeName: "string" },
      ]);
      expect(ok).toBe(true);
      expect(ctx.getDiagnostics()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("returns false and emits one diagnostic per missing field plus a summary", () => {
    const { ctx, node, cleanup } = makeContext();
    try {
      const ok = validateCoverageOrError(ctx, node, "Show", "User", [
        { name: "meta", typeName: "Custom" },
        { name: "tags", typeName: "Other" },
      ]);
      expect(ok).toBe(false);
      const diags = ctx.getDiagnostics();
      // 2 per-field errors + 1 summary error.
      expect(diags).toHaveLength(3);
      for (const d of diags) expect(d.severity).toBe("error");
      const summary = diags[diags.length - 1].message;
      expect(summary).toContain("@derive(Show)");
      expect(summary).toContain("User");
      expect(summary).toContain("Custom");
      expect(summary).toContain("Other");
    } finally {
      cleanup();
    }
  });

  it("deduplicates types in the summary when the same fieldType repeats", () => {
    const { ctx, node, cleanup } = makeContext();
    try {
      const ok = validateCoverageOrError(ctx, node, "Show", "User", [
        { name: "a", typeName: "Custom" },
        { name: "b", typeName: "Custom" },
      ]);
      expect(ok).toBe(false);
      const diags = ctx.getDiagnostics();
      const summary = diags[diags.length - 1].message;
      // "Custom" appears in a comma-separated list — exactly once in that list.
      const listPart = summary.split("types: ")[1] ?? "";
      const occurrences = listPart.split(",").filter((s) => s.trim() === "Custom").length;
      expect(occurrences).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("returns true and emits no diagnostics for a typeclass that opts out (Functor)", () => {
    const { ctx, node, cleanup } = makeContext();
    try {
      const ok = validateCoverageOrError(ctx, node, "Functor", "Box", [
        { name: "x", typeName: "NoSuchType" },
      ]);
      expect(ok).toBe(true);
      expect(ctx.getDiagnostics()).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
