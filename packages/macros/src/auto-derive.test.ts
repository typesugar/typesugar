/**
 * Tests for auto-derive.ts — GenericDerivation registry and Scala 3-style
 * compile-time typeclass derivation via Mirror/Generic.
 *
 * Covers:
 * - Registry: registerGenericDerivation / getGenericDerivation / hasGenericDerivation
 *   for registering new strategies, overwriting, missing lookups, and behaviour
 *   after clearDerivationCaches().
 * - canDeriveViaGeneric: registered TC + product meta → true; sum-type with
 *   deriveSum support → true; unregistered typeclass → false; meta missing → false;
 *   field lacks instance → false.
 * - tryDeriveViaGeneric end-to-end against a real ts.Program:
 *   • unknown typeclass → null with `derivation-strategy` not-found trace
 *   • registered TC + product meta (via registerGenericMeta) → expression + trace
 *   • registered TC + sum meta → expression via deriveSum
 *   • meta extracted from TypeChecker for interface / class / type-alias product
 *   • discriminated-union type alias → sum meta with switch-based output
 *   • type not in scope → null with `generic-meta` not-found trace
 *   • field-instance check failure → null with rejected trace
 *   • derivation strategy returns null → null with `code-generation` rejected trace
 *   • in-memory cache hit on second call
 * - makePrimitiveChecker: primitive types true, nullable wrappers, array element
 *   types, object types false, unknown types false.
 * - clearDerivationCaches: clears mirror + derivation caches.
 *
 * Built-in registrations (Show, Eq, Ord, Hash, Clone, Debug, Default, Json,
 * TypeGuard, Semigroup, Monoid) are populated at module load — tests below use
 * unique typeclass names with a "TestTC_" prefix to avoid colliding with them.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import {
  registerGenericDerivation,
  getGenericDerivation,
  hasGenericDerivation,
  tryDeriveViaGeneric,
  canDeriveViaGeneric,
  clearDerivationCaches,
  makePrimitiveChecker,
  type GenericDerivation,
} from "./auto-derive.js";
import { registerGenericMeta, type GenericMeta } from "./generic.js";

// ---------------------------------------------------------------------------
// Test-registration tracking — auto-derive has no unregister API, so we
// overwrite removed entries with a stub on cleanup. Tests always use unique
// names (TestTC_*) so they don't shadow the built-in derivations.
// ---------------------------------------------------------------------------

const TEST_TC_PREFIX = "TestTC_";
let registeredNames: string[] = [];

function makeStrategy(name: string, overrides: Partial<GenericDerivation> = {}): GenericDerivation {
  const strategy: GenericDerivation = {
    typeclassName: name,
    fieldTypeclass: null,
    hasFieldInstance: () => true,
    deriveProduct: (_ctx, typeName, meta) =>
      `({ name: "${typeName}", fields: ${JSON.stringify(meta.fieldNames ?? [])} })`,
    ...overrides,
  };
  registerGenericDerivation(name, strategy);
  registeredNames.push(name);
  return strategy;
}

afterEach(() => {
  // Best-effort cleanup: overwrite any test-only registrations with a stub
  // that always returns null, then clear the meta + derivation caches so
  // nothing leaks into the next test.
  for (const n of registeredNames) {
    registerGenericDerivation(n, {
      typeclassName: n,
      fieldTypeclass: null,
      hasFieldInstance: () => false,
      deriveProduct: () => null,
    });
  }
  registeredNames = [];
  clearDerivationCaches();
});

beforeEach(() => {
  clearDerivationCaches();
});

// ---------------------------------------------------------------------------
// Program harness — used for tests that need a real TypeChecker
// ---------------------------------------------------------------------------

function makeProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-derive-test-"));
  const filePath = path.join(tmpDir, "test.ts");
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

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Run a closure with a fully-wired MacroContext rooted at the given source.
 * The transformer is a no-op — we only need the context.
 */
function withMacroContext<T>(
  source: string,
  fn: (
    ctx: ReturnType<typeof createMacroContext>,
    sourceFile: ts.SourceFile,
    program: ts.Program
  ) => T
): T {
  const { program, sourceFile, cleanup } = makeProgramFromSource(source);
  let result!: T;
  try {
    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      result = fn(ctx, sourceFile, program);
      return (sf) => sf;
    };
    ts.transform(sourceFile, [transformerFactory]);
  } finally {
    cleanup();
  }
  return result;
}

// ===========================================================================
// Registry — register / get / has
// ===========================================================================

describe("registerGenericDerivation / getGenericDerivation / hasGenericDerivation", () => {
  it("registers and retrieves a new derivation strategy", () => {
    const name = `${TEST_TC_PREFIX}RegNew`;
    const strategy = makeStrategy(name);
    expect(getGenericDerivation(name)).toBe(strategy);
  });

  it("hasGenericDerivation returns true after registration", () => {
    const name = `${TEST_TC_PREFIX}RegHas`;
    expect(hasGenericDerivation(name)).toBe(false);
    makeStrategy(name);
    expect(hasGenericDerivation(name)).toBe(true);
  });

  it("getGenericDerivation returns undefined for missing typeclass", () => {
    expect(getGenericDerivation(`${TEST_TC_PREFIX}DefinitelyMissing_xyz`)).toBeUndefined();
  });

  it("hasGenericDerivation returns false for missing typeclass", () => {
    expect(hasGenericDerivation(`${TEST_TC_PREFIX}DefinitelyMissing_xyz`)).toBe(false);
  });

  it("overwriting an existing registration replaces the old strategy", () => {
    const name = `${TEST_TC_PREFIX}Overwrite`;
    const a = makeStrategy(name, {
      deriveProduct: () => `({ tag: "v1" })`,
    });
    expect(getGenericDerivation(name)).toBe(a);

    const b = makeStrategy(name, {
      deriveProduct: () => `({ tag: "v2" })`,
    });
    expect(getGenericDerivation(name)).toBe(b);
    expect(getGenericDerivation(name)).not.toBe(a);
  });

  it("exposes the built-in Show / Eq / Ord registrations (module-load side-effects)", () => {
    // These are registered when auto-derive.ts is loaded.
    expect(hasGenericDerivation("Show")).toBe(true);
    expect(hasGenericDerivation("Eq")).toBe(true);
    expect(hasGenericDerivation("Ord")).toBe(true);
    expect(hasGenericDerivation("Hash")).toBe(true);
    expect(hasGenericDerivation("Clone")).toBe(true);
    expect(hasGenericDerivation("Default")).toBe(true);
    expect(hasGenericDerivation("Json")).toBe(true);
    expect(hasGenericDerivation("TypeGuard")).toBe(true);
    expect(hasGenericDerivation("Debug")).toBe(true);
    expect(hasGenericDerivation("Semigroup")).toBe(true);
    expect(hasGenericDerivation("Monoid")).toBe(true);
  });
});

// ===========================================================================
// clearDerivationCaches
// ===========================================================================

describe("clearDerivationCaches", () => {
  it("clearing caches does NOT unregister derivation strategies", () => {
    // Strategy registry is separate from the mirror/derivation caches.
    const name = `${TEST_TC_PREFIX}ClearKeep`;
    makeStrategy(name);
    clearDerivationCaches();
    expect(getGenericDerivation(name)).toBeDefined();
    expect(hasGenericDerivation(name)).toBe(true);
  });

  it("clears the in-memory derivation cache (second call regenerates)", () => {
    const name = `${TEST_TC_PREFIX}ClearMem`;
    const typeName = `${TEST_TC_PREFIX}ClearMemType`;
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["x"],
      fieldTypes: ["number"],
    });

    let invocations = 0;
    makeStrategy(name, {
      deriveProduct: () => {
        invocations += 1;
        return `({ count: ${invocations} })`;
      },
    });

    withMacroContext("export {};", (ctx) => {
      tryDeriveViaGeneric(ctx, name, typeName);
      tryDeriveViaGeneric(ctx, name, typeName); // cache hit
      expect(invocations).toBe(1);

      clearDerivationCaches();

      tryDeriveViaGeneric(ctx, name, typeName); // regenerates
      expect(invocations).toBe(2);
    });
  });
});

// ===========================================================================
// canDeriveViaGeneric
// ===========================================================================

describe("canDeriveViaGeneric", () => {
  it("returns false for an unregistered typeclass", () => {
    expect(canDeriveViaGeneric(`${TEST_TC_PREFIX}NoSuch_aa`, "AnyType")).toBe(false);
  });

  it("returns false when no GenericMeta exists for the type", () => {
    const name = `${TEST_TC_PREFIX}CanDeriveNoMeta`;
    makeStrategy(name);
    expect(canDeriveViaGeneric(name, `${TEST_TC_PREFIX}UnknownType`)).toBe(false);
  });

  it("returns true when registered + meta present + no fieldTypeclass requirement", () => {
    const name = `${TEST_TC_PREFIX}CanDeriveProduct`;
    const typeName = `${TEST_TC_PREFIX}CanDeriveProductType`;
    makeStrategy(name); // default has fieldTypeclass: null
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["x"],
      fieldTypes: ["number"],
    });
    expect(canDeriveViaGeneric(name, typeName)).toBe(true);
  });

  it("returns true for sum-type meta when strategy has deriveSum support", () => {
    const name = `${TEST_TC_PREFIX}CanDeriveSum`;
    const typeName = `${TEST_TC_PREFIX}CanDeriveSumType`;
    makeStrategy(name, {
      deriveSum: (_ctx, t) => `({ sum: "${t}" })`,
    });
    registerGenericMeta(typeName, {
      kind: "sum",
      discriminant: "kind",
      variants: [
        { tag: "a", typeName: "A" },
        { tag: "b", typeName: "B" },
      ],
    });
    expect(canDeriveViaGeneric(name, typeName)).toBe(true);
  });

  it("returns false when a field lacks the required field-level instance", () => {
    const name = `${TEST_TC_PREFIX}CanDeriveFieldFail`;
    const typeName = `${TEST_TC_PREFIX}CanDeriveFieldFailType`;
    makeStrategy(name, {
      fieldTypeclass: name, // requires per-field instance
      hasFieldInstance: (ft) => ft === "number", // only number is ok
    });
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["x", "y"],
      fieldTypes: ["number", "Foo"], // "Foo" is rejected
    });
    expect(canDeriveViaGeneric(name, typeName)).toBe(false);
  });
});

// ===========================================================================
// tryDeriveViaGeneric — error / trace paths
// ===========================================================================

describe("tryDeriveViaGeneric — error and trace paths", () => {
  it("returns null with derivation-strategy not-found trace for unknown typeclass", () => {
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, `${TEST_TC_PREFIX}NoStrategy`, "AnyType");
      expect(result.expression).toBeNull();
      expect(result.trace).toHaveLength(1);
      expect(result.trace[0].step).toBe("derivation-strategy");
      expect(result.trace[0].result).toBe("not-found");
      expect(result.trace[0].reason).toMatch(/no GenericDerivation registered/);
    });
  });

  it("returns null with generic-meta not-found trace when type is not in scope", () => {
    const name = `${TEST_TC_PREFIX}MissingMeta`;
    makeStrategy(name);
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, `${TEST_TC_PREFIX}NotDeclaredAnywhere`);
      expect(result.expression).toBeNull();
      // Trace should include the strategy-found step followed by a generic-meta failure.
      const stepNames = result.trace.map((t) => t.step);
      expect(stepNames).toContain("derivation-strategy");
      expect(stepNames).toContain("generic-meta");
      const metaStep = result.trace.find((t) => t.step === "generic-meta")!;
      expect(metaStep.result).toBe("not-found");
    });
  });

  it("returns null with field-check rejection trace when a field lacks an instance", () => {
    const name = `${TEST_TC_PREFIX}FieldReject`;
    const typeName = `${TEST_TC_PREFIX}FieldRejectType`;
    makeStrategy(name, {
      fieldTypeclass: name,
      hasFieldInstance: (ft) => ft === "number",
    });
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["good", "bad"],
      fieldTypes: ["number", "WeirdType"],
    });
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, typeName);
      expect(result.expression).toBeNull();
      const metaStep = result.trace.find((t) => t.step === "generic-meta");
      expect(metaStep).toBeDefined();
      expect(metaStep!.result).toBe("rejected");
      expect(metaStep!.children).toBeDefined();
      const badField = metaStep!.children!.find((c) => c.target.includes("`bad`"));
      expect(badField).toBeDefined();
      expect(badField!.result).toBe("rejected");
    });
  });

  it("returns null with code-generation rejected trace when deriveProduct returns null", () => {
    const name = `${TEST_TC_PREFIX}CodegenNull`;
    const typeName = `${TEST_TC_PREFIX}CodegenNullType`;
    makeStrategy(name, {
      deriveProduct: () => null,
    });
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["x"],
      fieldTypes: ["number"],
    });
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, typeName);
      expect(result.expression).toBeNull();
      const codegenStep = result.trace.find((t) => t.step === "code-generation");
      expect(codegenStep).toBeDefined();
      expect(codegenStep!.result).toBe("rejected");
    });
  });

  it("returns null when the meta is a sum type but the strategy has no deriveSum", () => {
    const name = `${TEST_TC_PREFIX}SumNoSupport`;
    const typeName = `${TEST_TC_PREFIX}SumNoSupportType`;
    makeStrategy(name, {
      // deriveSum intentionally omitted
    });
    registerGenericMeta(typeName, {
      kind: "sum",
      discriminant: "kind",
      variants: [{ tag: "a", typeName: "A" }],
    });
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, typeName);
      expect(result.expression).toBeNull();
      const codegenStep = result.trace.find((t) => t.step === "code-generation");
      expect(codegenStep).toBeDefined();
      expect(codegenStep!.result).toBe("rejected");
    });
  });
});

// ===========================================================================
// tryDeriveViaGeneric — success paths with registered meta
// ===========================================================================

describe("tryDeriveViaGeneric — success paths", () => {
  it("derives a product via pre-registered GenericMeta and returns an expression", () => {
    const name = `${TEST_TC_PREFIX}OkProduct`;
    const typeName = `${TEST_TC_PREFIX}OkProductType`;
    makeStrategy(name, {
      deriveProduct: (_ctx, t, meta) =>
        `({ kind: "product", type: "${t}", fields: ${JSON.stringify(meta.fieldNames)} })`,
    });
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["x", "y"],
      fieldTypes: ["number", "number"],
    });
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, typeName);
      expect(result.expression).not.toBeNull();
      // The derivation strategy emits a parenthesised object literal,
      // ts.parseExpression preserves that.
      const expr = result.expression!;
      // Could be wrapped in a ParenthesizedExpression
      const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
      expect(ts.isObjectLiteralExpression(inner)).toBe(true);

      // Trace should end with a code-generation found step.
      const codegen = result.trace.find((t) => t.step === "code-generation");
      expect(codegen).toBeDefined();
      expect(codegen!.result).toBe("found");
    });
  });

  it("derives a sum type via deriveSum and returns an expression", () => {
    const name = `${TEST_TC_PREFIX}OkSum`;
    const typeName = `${TEST_TC_PREFIX}OkSumType`;
    makeStrategy(name, {
      deriveSum: (_ctx, t, meta) => `({ kind: "sum", type: "${t}", disc: "${meta.discriminant}" })`,
    });
    registerGenericMeta(typeName, {
      kind: "sum",
      discriminant: "kind",
      variants: [
        { tag: "a", typeName: "A" },
        { tag: "b", typeName: "B" },
      ],
    });
    withMacroContext("export {};", (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, typeName);
      expect(result.expression).not.toBeNull();
      const codegen = result.trace.find((t) => t.step === "code-generation");
      expect(codegen).toBeDefined();
      expect(codegen!.result).toBe("found");
    });
  });

  it("on second call returns a cache-hit trace and the same code", () => {
    const name = `${TEST_TC_PREFIX}CacheHit`;
    const typeName = `${TEST_TC_PREFIX}CacheHitType`;
    let invocations = 0;
    makeStrategy(name, {
      deriveProduct: (_ctx, t) => {
        invocations += 1;
        return `({ name: "${t}", inv: ${invocations} })`;
      },
    });
    registerGenericMeta(typeName, {
      kind: "product",
      fieldNames: ["a"],
      fieldTypes: ["number"],
    });
    withMacroContext("export {};", (ctx) => {
      const first = tryDeriveViaGeneric(ctx, name, typeName);
      expect(first.expression).not.toBeNull();
      expect(invocations).toBe(1);

      const second = tryDeriveViaGeneric(ctx, name, typeName);
      expect(second.expression).not.toBeNull();
      expect(invocations).toBe(1); // not regenerated

      const cacheStep = second.trace.find((t) => t.step === "cache-lookup");
      expect(cacheStep).toBeDefined();
      expect(cacheStep!.result).toBe("found");
    });
  });

  it("passes typeName + meta unchanged to deriveProduct", () => {
    const name = `${TEST_TC_PREFIX}PassThrough`;
    const typeName = `${TEST_TC_PREFIX}PassThroughType`;
    let captured: { t: string; meta: GenericMeta | null } = { t: "", meta: null };
    makeStrategy(name, {
      deriveProduct: (_ctx, t, meta) => {
        captured = { t, meta };
        return `({})`;
      },
    });
    const meta: GenericMeta = {
      kind: "product",
      fieldNames: ["alpha", "beta"],
      fieldTypes: ["string", "boolean"],
    };
    registerGenericMeta(typeName, meta);

    withMacroContext("export {};", (ctx) => {
      tryDeriveViaGeneric(ctx, name, typeName);
    });

    expect(captured.t).toBe(typeName);
    expect(captured.meta?.kind).toBe("product");
    expect(captured.meta?.fieldNames).toEqual(["alpha", "beta"]);
    expect(captured.meta?.fieldTypes).toEqual(["string", "boolean"]);
  });
});

// ===========================================================================
// tryDeriveViaGeneric — TypeChecker mirror synthesis
// ===========================================================================

describe("tryDeriveViaGeneric — TypeChecker mirror synthesis", () => {
  it("extracts meta from an interface declaration (no pre-registered meta)", () => {
    const name = `${TEST_TC_PREFIX}IfaceExtract`;
    let capturedMeta: GenericMeta | null = null;
    makeStrategy(name, {
      deriveProduct: (_ctx, t, meta) => {
        capturedMeta = meta;
        return `({ type: "${t}" })`;
      },
    });
    const source = `export interface AdIfacePoint { x: number; y: number; }`;
    withMacroContext(source, (ctx, sf) => {
      const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
      const result = tryDeriveViaGeneric(ctx, name, "AdIfacePoint", iface);
      expect(result.expression).not.toBeNull();
    });
    expect(capturedMeta).not.toBeNull();
    expect(capturedMeta!.kind).toBe("product");
    expect(capturedMeta!.fieldNames).toEqual(["x", "y"]);
    expect(capturedMeta!.fieldTypes).toEqual(["number", "number"]);
  });

  it("extracts meta from a class declaration", () => {
    const name = `${TEST_TC_PREFIX}ClassExtract`;
    let capturedMeta: GenericMeta | null = null;
    makeStrategy(name, {
      deriveProduct: (_ctx, _t, meta) => {
        capturedMeta = meta;
        return `({})`;
      },
    });
    const source = `
      export class AdClassPair {
        left: number = 0;
        right: string = "";
      }
    `;
    withMacroContext(source, (ctx, sf) => {
      const cls = sf.statements.find(ts.isClassDeclaration)!;
      tryDeriveViaGeneric(ctx, name, "AdClassPair", cls);
    });
    expect(capturedMeta!.kind).toBe("product");
    expect(capturedMeta!.fieldNames?.sort()).toEqual(["left", "right"]);
  });

  it("extracts meta from a type alias product", () => {
    const name = `${TEST_TC_PREFIX}AliasExtract`;
    let capturedMeta: GenericMeta | null = null;
    makeStrategy(name, {
      deriveProduct: (_ctx, _t, meta) => {
        capturedMeta = meta;
        return `({})`;
      },
    });
    const source = `export type AdAliasPoint = { a: string; b: boolean; };`;
    withMacroContext(source, (ctx, sf) => {
      const alias = sf.statements.find(ts.isTypeAliasDeclaration)!;
      tryDeriveViaGeneric(ctx, name, "AdAliasPoint", alias);
    });
    expect(capturedMeta!.kind).toBe("product");
    expect(capturedMeta!.fieldNames).toEqual(["a", "b"]);
    expect(capturedMeta!.fieldTypes).toEqual(["string", "boolean"]);
  });

  it("detects a discriminated-union type alias and produces sum meta with switch-style output", () => {
    const name = `${TEST_TC_PREFIX}DUExtract`;
    let capturedMeta: GenericMeta | null = null;
    let capturedTypeName = "";
    makeStrategy(name, {
      deriveSum: (_ctx, t, meta) => {
        capturedMeta = meta;
        capturedTypeName = t;
        const cases = meta
          .variants!.map((v) => `case "${v.tag}": return "${v.typeName}"`)
          .join("; ");
        return `({ show: (a) => { switch (a.${meta.discriminant}) { ${cases}; default: return "unknown" } } })`;
      },
      deriveProduct: () => null,
    });
    const source = `
      export interface AdCircle { kind: "circle"; radius: number }
      export interface AdSquare { kind: "square"; side: number }
      export type AdShape = AdCircle | AdSquare;
    `;
    let result!: ReturnType<typeof tryDeriveViaGeneric>;
    withMacroContext(source, (ctx, sf) => {
      const alias = sf.statements
        .filter(ts.isTypeAliasDeclaration)
        .find((a) => a.name.text === "AdShape")!;
      result = tryDeriveViaGeneric(ctx, name, "AdShape", alias);
    });
    expect(result.expression).not.toBeNull();
    expect(capturedTypeName).toBe("AdShape");
    expect(capturedMeta!.kind).toBe("sum");
    expect(capturedMeta!.discriminant).toBe("kind");
    expect(capturedMeta!.variants?.map((v) => v.tag).sort()).toEqual(["circle", "square"]);

    // Render the produced expression and verify it is a switch on the discriminant.
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const rendered = printer.printNode(
      ts.EmitHint.Unspecified,
      result.expression!,
      ts.createSourceFile("x.ts", "", ts.ScriptTarget.ES2020, true)
    );
    expect(rendered).toContain("switch");
    expect(rendered).toContain("kind");
    expect(rendered).toContain('"circle"');
    expect(rendered).toContain('"square"');
  });

  it("scope-search fallback (no AST node) currently yields no usable meta for interfaces — known limitation", () => {
    // BUG/LIMITATION discovered while writing this test:
    //   extractMetaFromTypeChecker's fallback path uses getSymbolsInScope(...)
    //   and then getDeclaredTypeOfSymbol(sym). For interface symbols obtained
    //   that way, getDeclaredTypeOfSymbol returns the empty "any" type, so the
    //   property scan yields zero data fields and the function returns null.
    //   In practice, summon/implicits always pass the declaring AST node, which
    //   avoids the issue. This test pins the current behaviour so we'll notice
    //   if it changes (intended or otherwise).
    const name = `${TEST_TC_PREFIX}ScopeFallback`;
    let invoked = false;
    makeStrategy(name, {
      deriveProduct: () => {
        invoked = true;
        return `({})`;
      },
    });
    const source = `
      export interface AdScopeIface { x: number; }
      export const adScopeUse: AdScopeIface = { x: 0 };
    `;
    withMacroContext(source, (ctx) => {
      const result = tryDeriveViaGeneric(ctx, name, "AdScopeIface");
      // Current behavior: the scope-search path can't materialize an interface's
      // properties without the AST node, so derivation fails with a generic-meta miss.
      expect(result.expression).toBeNull();
      const metaStep = result.trace.find((t) => t.step === "generic-meta");
      expect(metaStep?.result).toBe("not-found");
    });
    // deriveProduct is never called because meta extraction failed.
    expect(invoked).toBe(false);
  });

  it("scope-search fallback DOES work when the AST node is passed (interface path)", () => {
    // Confirms the workaround real callers use: pass the declaring node so
    // getSymbolAtLocation(node.name) returns a fully-populated symbol.
    const name = `${TEST_TC_PREFIX}ScopeFallbackWithNode`;
    let invoked = false;
    makeStrategy(name, {
      deriveProduct: () => {
        invoked = true;
        return `({})`;
      },
    });
    const source = `export interface AdScopeIface2 { x: number; }`;
    withMacroContext(source, (ctx, sf) => {
      const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
      const result = tryDeriveViaGeneric(ctx, name, "AdScopeIface2", iface);
      expect(result.expression).not.toBeNull();
    });
    expect(invoked).toBe(true);
  });

  it("returns null when meta has only methods (no data fields)", () => {
    const name = `${TEST_TC_PREFIX}AllMethods`;
    makeStrategy(name);
    const source = `
      export interface AdMethodsOnly { foo(): number; bar(): string; }
    `;
    withMacroContext(source, (ctx, sf) => {
      const iface = sf.statements.find(ts.isInterfaceDeclaration)!;
      const result = tryDeriveViaGeneric(ctx, name, "AdMethodsOnly", iface);
      expect(result.expression).toBeNull();
      const metaStep = result.trace.find((t) => t.step === "generic-meta");
      expect(metaStep).toBeDefined();
      expect(metaStep!.result).toBe("not-found");
    });
  });
});

// ===========================================================================
// makePrimitiveChecker
// ===========================================================================

describe("makePrimitiveChecker", () => {
  const PRIMITIVES = new Set(["number", "string", "boolean", "bigint", "null", "undefined"]);
  const check = makePrimitiveChecker(PRIMITIVES);

  it("returns true for each registered primitive", () => {
    expect(check("number")).toBe(true);
    expect(check("string")).toBe(true);
    expect(check("boolean")).toBe(true);
    expect(check("bigint")).toBe(true);
    expect(check("null")).toBe(true);
    expect(check("undefined")).toBe(true);
  });

  it("returns false for object / unknown types", () => {
    expect(check("MyType")).toBe(false);
    expect(check("{ x: number }")).toBe(false);
    expect(check("Map<string, number>")).toBe(false);
    expect(check("any")).toBe(false);
    expect(check("unknown")).toBe(false);
  });

  it("strips ` | null` and ` | undefined` wrappers", () => {
    expect(check("number | null")).toBe(true);
    expect(check("null | number")).toBe(true);
    expect(check("string | undefined")).toBe(true);
    expect(check("undefined | string")).toBe(true);
  });

  it("recurses through array types via [] suffix", () => {
    expect(check("number[]")).toBe(true);
    expect(check("string[]")).toBe(true);
    expect(check("MyType[]")).toBe(false);
  });

  it("recurses through Array<T> syntax", () => {
    expect(check("Array<number>")).toBe(true);
    expect(check("Array<string>")).toBe(true);
    expect(check("Array<MyType>")).toBe(false);
  });

  it("returns false when the primitive set is empty", () => {
    const none = makePrimitiveChecker(new Set());
    expect(none("number")).toBe(false);
    expect(none("string")).toBe(false);
  });

  it("respects a custom restricted primitive set", () => {
    const numericOnly = makePrimitiveChecker(new Set(["number"]));
    expect(numericOnly("number")).toBe(true);
    expect(numericOnly("string")).toBe(false);
    expect(numericOnly("number[]")).toBe(true);
    expect(numericOnly("number | null")).toBe(true);
  });
});
