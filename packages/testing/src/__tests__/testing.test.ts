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
import { MacroContextImpl, createMacroContext, globalRegistry } from "@typesugar/core";

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
  assertTypeMacro,
  mockAttribute,
  mockExpressionMacro,
} from "../macro.js";

// Import runtime placeholders for fallback behavior testing
import {
  assert,
  staticAssert,
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
    ts.ScriptKind.TS
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
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
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
  const sf = sourceFile ?? ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

/** Depth-first search for the first node matching `pred`. */
function findFirst(sf: ts.SourceFile, pred: (n: ts.Node) => boolean): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (pred(n)) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
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
    // Note: staticAssert is now re-exported from @typesugar/macros
    expect(macro!.module).toBe("typesugar");
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
          ts.factory.createNumericLiteral(4)
        ),
      ]
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
      ts.factory.createNumericLiteral(5)
    );

    const result = ctx.evaluate(falseExpr);
    expect(result).toEqual({ kind: "boolean", value: false });
  });

  it("should detect true conditions via evaluate", () => {
    const trueExpr = ts.factory.createBinaryExpression(
      ts.factory.createNumericLiteral(7),
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.factory.createNumericLiteral(7)
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

describe("staticAssert runtime fallback", () => {
  it("should be a no-op at runtime (placeholder)", () => {
    // staticAssert is a placeholder — it does nothing at runtime
    expect(() => staticAssert(true)).not.toThrow();
    expect(() => staticAssert(false)).not.toThrow();
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
      }
    );
    expect(count).toBe(10);
  });

  it("should default to 100 iterations", () => {
    let count = 0;
    forAll(
      (seed) => seed,
      (_value) => {
        count++;
      }
    );
    expect(count).toBe(100);
  });

  it("should report the failing input on property violation", () => {
    expect(() =>
      forAll(
        (seed) => seed,
        (value) => {
          if (value === 5) throw new Error("bad value");
        }
      )
    ).toThrow(/Property failed after 6 tests/);
  });

  it("should include the failing value in the error", () => {
    expect(() =>
      forAll(
        (seed) => ({ n: seed }),
        (value) => {
          if (value.n === 3) throw new Error("nope");
        }
      )
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
      []
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
      []
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
      []
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
// Expansion tests for the AST-constructed macros (PEP-057)
//
// Each of these calls the macro's `expand()` directly and asserts on the
// meaningfully-shaped generated output — the migration from string-templating
// to `ts.factory` codegen must be semantically equivalent. Spliced real nodes
// are printed against the original source file so their text is preserved.
// ============================================================================

describe("assert macro expansion (power-assert diagram)", () => {
  it("builds a power-assert IIFE capturing sub-expressions", () => {
    const ctx = createTestContext("assert(user.age > 18);");
    const callExpr = findFirst(ctx.sourceFile, ts.isCallExpression) as ts.CallExpression;
    expect(callExpr).toBeDefined();

    const result = assertMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);

    // The guarded condition is the real user expression.
    expect(code).toContain("const __pa_result__ = user.age > 18;");
    expect(code).toContain("if (!__pa_result__)");
    // The captured sub-expressions include the whole expr and its parts.
    expect(code).toContain("__pa_vals__");
    expect(code).toContain("user.age > 18");
    expect(code).toContain("user.age");
    // The failure path renders a diagram and throws.
    expect(code).toContain("Power Assert Failed");
    expect(code).toContain("assert(");
    expect(code).toContain("throw new Error(__pa_d__)");
  });

  it("threads a custom message into __pa_msg__", () => {
    const ctx = createTestContext('assert(x === y, "values differ");');
    const callExpr = findFirst(ctx.sourceFile, ts.isCallExpression) as ts.CallExpression;
    const result = assertMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);
    expect(code).toContain('let __pa_msg__: any = "values differ"');
  });
});

describe("@testCases attribute expansion", () => {
  it("expands one function into N it() calls with destructured params", () => {
    const ctx = createTestContext(
      [
        "const cases = [{ a: 1, b: 2, expected: 3 }, { a: 5, b: 5, expected: 10 }];",
        "function checkAdd(a, b, expected) { expect(a + b).toBe(expected); }",
      ].join("\n")
    );
    const fnDecl = findFirst(ctx.sourceFile, ts.isFunctionDeclaration) as ts.FunctionDeclaration;
    const casesArr = findFirst(
      ctx.sourceFile,
      ts.isArrayLiteralExpression
    ) as ts.ArrayLiteralExpression;
    const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("testCases"));

    const result = testCasesAttribute.expand(ctx, decorator, fnDecl, [casesArr]);
    expect(Array.isArray(result)).toBe(true);
    const stmts = result as ts.Node[];
    expect(stmts.length).toBe(2);

    const code = stmts.map((s) => printNode(s, ctx.sourceFile)).join("\n");
    expect(code).toContain('it("checkAdd (case #1: a=1, b=2, expected=3)"');
    expect(code).toContain('it("checkAdd (case #2: a=5, b=5, expected=10)"');
    // Params are destructured from the case object via real initializer nodes.
    expect(code).toContain("const a = 1;");
    expect(code).toContain("const expected = 3;");
    // The original function body is spliced in directly (no brace-stripping).
    expect(code).toContain("expect(a + b).toBe(expected)");
  });
});

describe("forAll macro expansion", () => {
  it("builds a bounded loop that runs the property and reports failures", () => {
    const ctx = createTestContext("forAll(gen, prop);");
    const callExpr = findFirst(ctx.sourceFile, ts.isCallExpression) as ts.CallExpression;
    const result = forAllMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);

    // Default count is 100; generator is invoked with the loop index.
    expect(code).toContain("< 100;");
    expect(code).toContain("gen(");
    // Property is parenthesized-called with the generated value.
    expect(code).toContain("(prop)(");
    expect(code).toContain("instanceof Error");
    expect(code).toContain("Property failed after");
    expect(code).toContain("JSON.stringify");
    expect(code).toContain("throw new Error");
  });

  it("uses an explicit count argument when provided", () => {
    const ctx = createTestContext("forAll(gen, 25, prop);");
    const callExpr = findFirst(ctx.sourceFile, ts.isCallExpression) as ts.CallExpression;
    const result = forAllMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);
    expect(code).toContain("< 25;");
  });
});

describe("assertType macro expansion", () => {
  it("emits field metadata and per-field validation from the type", () => {
    const ctx = createTestContext(
      [
        "interface User { id: number; name: string; email?: string; }",
        "declare function assertType<T>(v: any): void;",
        "declare const u: any;",
        "assertType<User>(u);",
      ].join("\n")
    );
    const callExpr = findFirst(
      ctx.sourceFile,
      (n) => ts.isCallExpression(n) && !!n.typeArguments
    ) as ts.CallExpression;
    expect(callExpr).toBeDefined();

    const result = assertTypeMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);

    // typeName baked into a string literal (not a spliced statement).
    expect(code).toContain("Type assertion failed for 'User'");
    // Field metadata derived from the checker.
    expect(code).toContain('name: "id"');
    expect(code).toContain('type: "number"');
    expect(code).toContain('name: "name"');
    expect(code).toContain('type: "string"');
    // email is optional.
    expect(code).toContain('name: "email"');
    expect(code).toContain("optional: true");
    // Runtime validation shape.
    expect(code).toContain("Array.isArray");
    expect(code).toContain("Field '");
  });

  it("appends a custom message via string concatenation when given", () => {
    const ctx = createTestContext(
      [
        "interface P { x: number; }",
        "declare function assertType<T>(v: any, m?: string): void;",
        "declare const p: any;",
        'assertType<P>(p, "bad");',
      ].join("\n")
    );
    const callExpr = findFirst(
      ctx.sourceFile,
      (n) => ts.isCallExpression(n) && !!n.typeArguments
    ) as ts.CallExpression;
    const result = assertTypeMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);
    expect(code).toContain('"bad" !== undefined');
    expect(code).toContain('": " + "bad"');
  });
});

describe("@mock attribute expansion", () => {
  it("generates a call-tracking mock with typeToTypeNode signatures", () => {
    const ctx = createTestContext(
      "interface UserService { getUser(id: string): number; ping(): void; }"
    );
    const iface = findFirst(ctx.sourceFile, ts.isInterfaceDeclaration) as ts.InterfaceDeclaration;
    const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("mock"));

    const result = mockAttribute.expand(ctx, decorator, iface, []);
    expect(Array.isArray(result)).toBe(true);
    const stmts = result as ts.Node[];
    // First node is the untouched original declaration.
    expect(stmts[0]).toBe(iface);

    const code = printNode(stmts[1], ctx.sourceFile);
    expect(code).toContain("mockUserService");
    expect(code).toContain("MockOf<UserService>");
    expect(code).toContain("createMockFn<");
    expect(code).toContain("_calls");
    expect(code).toContain("_reset");
    expect(code).toContain("getUser");
    expect(code).toContain("ping");
    // typeToTypeNode produced a real function type, not a stringified blob.
    expect(code).toMatch(/id:\s*string/);
  });

  it("honors a custom mock name argument", () => {
    const ctx = createTestContext("interface Svc { call(): void; }");
    const iface = findFirst(ctx.sourceFile, ts.isInterfaceDeclaration) as ts.InterfaceDeclaration;
    const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("mock"));
    const result = mockAttribute.expand(ctx, decorator, iface, [
      ts.factory.createStringLiteral("myMock"),
    ]);
    const stmts = result as ts.Node[];
    const code = printNode(stmts[1], ctx.sourceFile);
    expect(code).toContain("const myMock: MockOf<Svc>");
  });
});

describe("mock<T>() expression expansion", () => {
  it("builds a mock IIFE from the type argument", () => {
    const ctx = createTestContext(
      [
        "interface UserService { getUser(id: string): number; }",
        "declare function mock<T>(): any;",
        "const m = mock<UserService>();",
      ].join("\n")
    );
    const callExpr = findFirst(
      ctx.sourceFile,
      (n) => ts.isCallExpression(n) && !!n.typeArguments
    ) as ts.CallExpression;
    expect(callExpr).toBeDefined();

    const result = mockExpressionMacro.expand(ctx, callExpr, callExpr.arguments);
    const code = printNode(result, ctx.sourceFile);

    expect(code).toContain("createMockFn<");
    expect(code).toContain("MockOf<UserService>");
    expect(code).toContain("getUser");
    expect(code).toContain("_reset");
    expect(code).toMatch(/id:\s*string/);
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

  it("testing-specific macros should be import-scoped to @typesugar/testing", () => {
    // Testing-specific macros that are defined in @typesugar/testing
    const testingSpecificMacros = [
      globalRegistry.getExpression("assert"),
      globalRegistry.getExpression("assertSnapshot"),
      globalRegistry.getExpression("typeAssert"),
      globalRegistry.getExpression("forAll"),
      globalRegistry.getAttribute("testCases"),
    ];

    for (const macro of testingSpecificMacros) {
      expect(macro).toBeDefined();
      expect(macro!.module).toBe("@typesugar/testing");
    }

    // staticAssert is re-exported from @typesugar/macros (has module "typesugar")
    const staticAssertMacro = globalRegistry.getExpression("staticAssert");
    expect(staticAssertMacro).toBeDefined();
    expect(staticAssertMacro!.module).toBe("typesugar");
  });
});
