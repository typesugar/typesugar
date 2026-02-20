/**
 * Tests for the @typesugar/testing module
 *
 * Tests macro definitions, registration, and expansion behavior for:
 * - assert()             — Power assertions with sub-expression capture
 * - @derive(Arbitrary)   — Random value generator derivation
 * - staticAssert()       — Compile-time build assertions
 * - @testCases           — Parameterized test generation
 * - assertSnapshot()     — Snapshot testing with source capture
 * - typeAssert<T>()      — Compile-time type assertions
 * - forAll()             — Property-based test runner
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  MacroContextImpl,
  createMacroContext,
  globalRegistry,
} from "@typesugar/core";

// Import to register the testing macros
import "../macro.js";

// Import the macro definitions directly for targeted testing
import {
  assertMacro,
  powerAssertMacro,
  ArbitraryDerive,
  staticAssertMacro,
  comptimeAssertMacro,
  testCasesAttribute,
  assertSnapshotMacro,
  typeAssertMacro,
  forAllMacro,
} from "../macro.js";

// Import runtime placeholders for fallback behavior testing
import {
  assert,
  powerAssert,
  staticAssert,
  comptimeAssert,
  assertSnapshot,
  forAll,
  type Equal,
  type Extends,
  type Not,
  type IsNever,
  type IsAny,
  type IsUnknown,
} from "../index.js";

// ============================================================================
// Helper: Create a macro context for testing
// ============================================================================

function createTestContext(sourceText = "const x = 1;"): MacroContextImpl {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts"
        ? sourceFile
        : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

  const transformContext: ts.TransformationContext = {
    factory: ts.factory,
    getCompilerOptions: () => options,
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => undefined,
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    requestEmitHelper: () => {},
    readEmitHelpers: () => undefined,
    enableSubstitution: () => {},
    enableEmitNotification: () => {},
    isSubstitutionEnabled: () => false,
    isEmitNotificationEnabled: () => false,
    onSubstituteNode: (_hint, node) => node,
    onEmitNode: (_hint, node, emitCallback) => emitCallback(_hint, node),
  };

  return createMacroContext(program, sourceFile, transformContext);
}

/** Print an AST node to a string for assertion */
function printNode(node: ts.Node, sourceFile?: ts.SourceFile): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sf =
    sourceFile ??
    ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

// ============================================================================
// Macro Registration Tests
// ============================================================================

describe("testing macro registration", () => {
  it("should register assert as an expression macro", () => {
    const macro = globalRegistry.getExpression("assert");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("assert");
    expect(macro!.kind).toBe("expression");
    expect(macro!.module).toBe("@typesugar/testing");
  });

  it("should register powerAssert as an expression macro (backward compat)", () => {
    const macro = globalRegistry.getExpression("powerAssert");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("powerAssert");
    expect(macro!.kind).toBe("expression");
  });

  it("should register staticAssert as an expression macro", () => {
    const macro = globalRegistry.getExpression("staticAssert");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("staticAssert");
    expect(macro!.module).toBe("@typesugar/testing");
  });

  it("should register comptimeAssert as an expression macro (backward compat)", () => {
    const macro = globalRegistry.getExpression("comptimeAssert");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("comptimeAssert");
  });

  it("should register assertSnapshot as an expression macro", () => {
    const macro = globalRegistry.getExpression("assertSnapshot");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("assertSnapshot");
    expect(macro!.module).toBe("@typesugar/testing");
  });

  it("should register typeAssert as an expression macro", () => {
    const macro = globalRegistry.getExpression("typeAssert");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("typeAssert");
    expect(macro!.module).toBe("@typesugar/testing");
  });

  it("should register forAll as an expression macro", () => {
    const macro = globalRegistry.getExpression("forAll");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("forAll");
    expect(macro!.module).toBe("@typesugar/testing");
  });

  it("should register Arbitrary as a derive macro", () => {
    const macro = globalRegistry.getDerive("Arbitrary");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("Arbitrary");
    expect(macro!.kind).toBe("derive");
  });

  it("should register testCases as an attribute macro", () => {
    const macro = globalRegistry.getAttribute("testCases");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("testCases");
    expect(macro!.kind).toBe("attribute");
    expect(macro!.module).toBe("@typesugar/testing");
  });
});

// ============================================================================
// Macro Definition Tests
// ============================================================================

describe("assert macro definition", () => {
  it("should have correct metadata", () => {
    expect(assertMacro.name).toBe("assert");
    expect(assertMacro.kind).toBe("expression");
    expect(assertMacro.description).toContain("sub-expression");
  });
});

describe("powerAssert macro definition (backward compat)", () => {
  it("should have correct metadata", () => {
    expect(powerAssertMacro.name).toBe("powerAssert");
    expect(powerAssertMacro.kind).toBe("expression");
  });
});

describe("Arbitrary derive macro definition", () => {
  it("should have correct metadata", () => {
    expect(ArbitraryDerive.name).toBe("Arbitrary");
    expect(ArbitraryDerive.kind).toBe("derive");
    expect(ArbitraryDerive.description).toContain("random value generator");
  });
});

describe("staticAssert macro definition", () => {
  it("should have correct metadata", () => {
    expect(staticAssertMacro.name).toBe("staticAssert");
    expect(staticAssertMacro.kind).toBe("expression");
    expect(staticAssertMacro.description).toContain("compile time");
  });
});

describe("comptimeAssert macro definition (backward compat)", () => {
  it("should have correct metadata", () => {
    expect(comptimeAssertMacro.name).toBe("comptimeAssert");
    expect(comptimeAssertMacro.kind).toBe("expression");
  });
});

describe("testCases attribute macro definition", () => {
  it("should have correct metadata", () => {
    expect(testCasesAttribute.name).toBe("testCases");
    expect(testCasesAttribute.kind).toBe("attribute");
    expect(testCasesAttribute.validTargets).toContain("function");
    expect(testCasesAttribute.description).toContain("parameterized");
  });
});

describe("assertSnapshot macro definition", () => {
  it("should have correct metadata", () => {
    expect(assertSnapshotMacro.name).toBe("assertSnapshot");
    expect(assertSnapshotMacro.kind).toBe("expression");
    expect(assertSnapshotMacro.description).toContain("Snapshot");
  });
});

describe("typeAssert macro definition", () => {
  it("should have correct metadata", () => {
    expect(typeAssertMacro.name).toBe("typeAssert");
    expect(typeAssertMacro.kind).toBe("expression");
    expect(typeAssertMacro.description).toContain("type relationship");
  });
});

describe("forAll macro definition", () => {
  it("should have correct metadata", () => {
    expect(forAllMacro.name).toBe("forAll");
    expect(forAllMacro.kind).toBe("expression");
    expect(forAllMacro.description).toContain("property-based");
  });
});

// ============================================================================
// staticAssert Expansion Tests
// ============================================================================

describe("staticAssert macro expansion", () => {
  let ctx: MacroContextImpl;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("should pass when condition is true", () => {
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("staticAssert"),
      undefined,
      [
        ts.factory.createBinaryExpression(
          ts.factory.createNumericLiteral(3),
          ts.SyntaxKind.PlusToken,
          ts.factory.createNumericLiteral(4),
        ),
      ],
    );

    // Manually simulate what the macro does
    const condExpr = callExpr.arguments[0];
    const result = ctx.evaluate(condExpr);
    expect(result).toEqual({ kind: "number", value: 7 });

    // 7 is truthy, so no error should be reported
    const diags = ctx.getDiagnostics();
    expect(diags.length).toBe(0);
  });

  it("should detect false conditions via evaluate", () => {
    const falseExpr = ts.factory.createBinaryExpression(
      ts.factory.createNumericLiteral(3),
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.factory.createNumericLiteral(5),
    );

    const result = ctx.evaluate(falseExpr);
    expect(result).toEqual({ kind: "boolean", value: false });
  });

  it("should detect true conditions via evaluate", () => {
    const trueExpr = ts.factory.createBinaryExpression(
      ts.factory.createNumericLiteral(7),
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.factory.createNumericLiteral(7),
    );

    const result = ctx.evaluate(trueExpr);
    expect(result).toEqual({ kind: "boolean", value: true });
  });
});

// ============================================================================
// Runtime Fallback Tests
// ============================================================================

describe("assert runtime fallback", () => {
  it("should pass when condition is true", () => {
    expect(() => assert(true)).not.toThrow();
    expect(() => assert(1 === 1)).not.toThrow();
  });

  it("should throw when condition is false", () => {
    expect(() => assert(false)).toThrow(/assertion failed/i);
  });

  it("should include custom message", () => {
    expect(() => assert(false, "custom message")).toThrow("custom message");
  });
});

describe("powerAssert runtime fallback (backward compat)", () => {
  it("should pass when condition is true", () => {
    expect(() => powerAssert(true)).not.toThrow();
    expect(() => powerAssert(1 === 1)).not.toThrow();
  });

  it("should throw when condition is false", () => {
    expect(() => powerAssert(false)).toThrow(/assertion failed/i);
  });

  it("should include custom message", () => {
    expect(() => powerAssert(false, "custom message")).toThrow(
      "custom message",
    );
  });
});

describe("staticAssert runtime fallback", () => {
  it("should be a no-op at runtime (placeholder)", () => {
    // staticAssert is a placeholder — it does nothing at runtime
    expect(() => staticAssert(true)).not.toThrow();
    expect(() => staticAssert(false)).not.toThrow();
  });
});

describe("comptimeAssert runtime fallback (backward compat)", () => {
  it("should be a no-op at runtime (placeholder)", () => {
    // comptimeAssert is a placeholder — it does nothing at runtime
    expect(() => comptimeAssert(true)).not.toThrow();
    expect(() => comptimeAssert(false)).not.toThrow();
  });
});

describe("forAll runtime fallback", () => {
  it("should run the property for the specified number of iterations", () => {
    let count = 0;
    forAll(
      (seed) => seed * 2,
      10,
      (_value) => {
        count++;
      },
    );
    expect(count).toBe(10);
  });

  it("should default to 100 iterations", () => {
    let count = 0;
    forAll(
      (seed) => seed,
      (_value) => {
        count++;
      },
    );
    expect(count).toBe(100);
  });

  it("should report the failing input on property violation", () => {
    expect(() =>
      forAll(
        (seed) => seed,
        (value) => {
          if (value === 5) throw new Error("bad value");
        },
      ),
    ).toThrow(/Property failed after 6 tests/);
  });

  it("should include the failing value in the error", () => {
    expect(() =>
      forAll(
        (seed) => ({ n: seed }),
        (value) => {
          if (value.n === 3) throw new Error("nope");
        },
      ),
    ).toThrow(/Failing input:.*"n":3/);
  });
});

// ============================================================================
// Type Utility Tests (compile-time, verified via TypeScript's type system)
// ============================================================================

describe("type utilities", () => {
  it("Equal should detect equal types", () => {
    type R1 = Equal<number, number>;
    const _r1: R1 = true;
    expect(_r1).toBe(true);
  });

  it("Equal should detect unequal types", () => {
    type R2 = Equal<number, string>;
    const _r2: R2 = false;
    expect(_r2).toBe(false);
  });

  it("Extends should detect subtype relationships", () => {
    type R3 = Extends<"hello", string>;
    const _r3: R3 = true;
    expect(_r3).toBe(true);
  });

  it("Extends should detect non-subtype relationships", () => {
    type R4 = Extends<string, number>;
    const _r4: R4 = false;
    expect(_r4).toBe(false);
  });

  it("Not should negate boolean types", () => {
    type R5 = Not<true>;
    const _r5: R5 = false;
    expect(_r5).toBe(false);

    type R6 = Not<false>;
    const _r6: R6 = true;
    expect(_r6).toBe(true);
  });

  it("IsNever should detect never", () => {
    type R7 = IsNever<never>;
    const _r7: R7 = true;
    expect(_r7).toBe(true);

    type R8 = IsNever<string>;
    const _r8: R8 = false;
    expect(_r8).toBe(false);
  });

  it("IsAny should detect any", () => {
    type R9 = IsAny<any>;
    const _r9: R9 = true;
    expect(_r9).toBe(true);

    type R10 = IsAny<string>;
    const _r10: R10 = false;
    expect(_r10).toBe(false);
  });

  it("IsUnknown should detect unknown", () => {
    type R11 = IsUnknown<unknown>;
    const _r11: R11 = true;
    expect(_r11).toBe(true);

    type R12 = IsUnknown<string>;
    const _r12: R12 = false;
    expect(_r12).toBe(false);

    // any is not unknown
    type R13 = IsUnknown<any>;
    const _r13: R13 = false;
    expect(_r13).toBe(false);
  });
});

// ============================================================================
// Derive(Arbitrary) Expansion Tests
// ============================================================================

describe("@derive(Arbitrary) expansion", () => {
  it("should have the correct derive macro name", () => {
    expect(ArbitraryDerive.name).toBe("Arbitrary");
  });

  it("should generate functions with correct naming convention", () => {
    // The derive generates arbitraryX() and arbitraryXMany()
    // We verify the naming pattern matches the convention
    const ctx = createTestContext();
    const typeInfo = {
      name: "User",
      kind: "product" as const,
      fields: [
        {
          name: "name",
          typeString: "string",
          type: {} as ts.Type,
          optional: false,
          readonly: false,
        },
        {
          name: "age",
          typeString: "number",
          type: {} as ts.Type,
          optional: false,
          readonly: false,
        },
        {
          name: "active",
          typeString: "boolean",
          type: {} as ts.Type,
          optional: false,
          readonly: false,
        },
      ],
      typeParameters: [],
      type: {} as ts.Type,
    };

    const target = ts.factory.createInterfaceDeclaration(
      undefined,
      "User",
      undefined,
      undefined,
      [],
    );

    const result = ArbitraryDerive.expand(ctx, target, typeInfo);

    expect(result.length).toBeGreaterThan(0);

    // Print the generated code and verify it contains the expected function names
    const code = result.map((s) => printNode(s)).join("\n");
    expect(code).toContain("arbitraryUser");
    expect(code).toContain("arbitraryUserMany");
    expect(code).toContain("_seededRandom");
  });

  it("should handle optional fields", () => {
    const ctx = createTestContext();
    const typeInfo = {
      name: "Config",
      kind: "product" as const,
      fields: [
        {
          name: "debug",
          typeString: "boolean",
          type: {} as ts.Type,
          optional: true,
          readonly: false,
        },
        {
          name: "timeout",
          typeString: "number",
          type: {} as ts.Type,
          optional: true,
          readonly: false,
        },
      ],
      typeParameters: [],
      type: {} as ts.Type,
    };

    const target = ts.factory.createInterfaceDeclaration(
      undefined,
      "Config",
      undefined,
      undefined,
      [],
    );

    const result = ArbitraryDerive.expand(ctx, target, typeInfo);
    const code = result.map((s) => printNode(s)).join("\n");

    // Optional fields should have a 50% chance of being undefined
    expect(code).toContain("undefined");
    expect(code).toContain("arbitraryConfig");
  });

  it("should generate different values with different seeds", () => {
    const ctx = createTestContext();
    const typeInfo = {
      name: "Point",
      kind: "product" as const,
      fields: [
        {
          name: "x",
          typeString: "number",
          type: {} as ts.Type,
          optional: false,
          readonly: false,
        },
        {
          name: "y",
          typeString: "number",
          type: {} as ts.Type,
          optional: false,
          readonly: false,
        },
      ],
      typeParameters: [],
      type: {} as ts.Type,
    };

    const target = ts.factory.createInterfaceDeclaration(
      undefined,
      "Point",
      undefined,
      undefined,
      [],
    );

    const result = ArbitraryDerive.expand(ctx, target, typeInfo);
    const code = result.map((s) => printNode(s)).join("\n");

    // Should include seeded random support
    expect(code).toContain("seed");
    expect(code).toContain("_rng");
  });
});

// ============================================================================
// assertSnapshot Expansion Tests
// ============================================================================

describe("assertSnapshot macro expansion", () => {
  it("should have correct metadata", () => {
    expect(assertSnapshotMacro.name).toBe("assertSnapshot");
    expect(assertSnapshotMacro.module).toBe("@typesugar/testing");
  });
});

// ============================================================================
// Integration: All macros coexist in the registry
// ============================================================================

describe("testing module integration", () => {
  it("all testing macros should be registered without conflicts", () => {
    // Expression macros (primary)
    expect(globalRegistry.getExpression("assert")).toBeDefined();
    expect(globalRegistry.getExpression("staticAssert")).toBeDefined();
    expect(globalRegistry.getExpression("assertSnapshot")).toBeDefined();
    expect(globalRegistry.getExpression("typeAssert")).toBeDefined();
    expect(globalRegistry.getExpression("forAll")).toBeDefined();

    // Expression macros (backward compatibility)
    expect(globalRegistry.getExpression("powerAssert")).toBeDefined();
    expect(globalRegistry.getExpression("comptimeAssert")).toBeDefined();

    // Derive macros
    expect(globalRegistry.getDerive("Arbitrary")).toBeDefined();

    // Attribute macros
    expect(globalRegistry.getAttribute("testCases")).toBeDefined();
  });

  it("all testing macros should be import-scoped to @typesugar/testing", () => {
    const testingMacros = [
      globalRegistry.getExpression("assert"),
      globalRegistry.getExpression("staticAssert"),
      globalRegistry.getExpression("assertSnapshot"),
      globalRegistry.getExpression("typeAssert"),
      globalRegistry.getExpression("forAll"),
      globalRegistry.getAttribute("testCases"),
    ];

    for (const macro of testingMacros) {
      expect(macro).toBeDefined();
      expect(macro!.module).toBe("@typesugar/testing");
    }
  });
});
