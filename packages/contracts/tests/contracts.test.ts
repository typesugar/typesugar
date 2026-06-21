/**
 * Tests for @typesugar/contracts — Design by Contract macros
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import {
  requiresMacro,
  ensuresMacro,
  oldMacro,
  contractAttribute,
  invariantAttribute,
  setContractConfig,
  shouldEmitCheck,
  type ContractConfig,
} from "@typesugar/contracts";
import { parseContractBlocks } from "@typesugar/contracts";
import { normalizeExpression } from "@typesugar/contracts";
import { tryAlgebraicProof, type TypeFact } from "@typesugar/contracts";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(): MacroContextImpl {
  const sourceText = "const x = 1;";
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
    addDiagnostic: () => {},
  };

  return createMacroContext(program, sourceFile, transformContext);
}

function printNode(node: ts.Node): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sourceFile = ts.createSourceFile(
    "output.ts",
    "",
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
}

// ============================================================================
// Configuration Tests
// ============================================================================

describe("contract configuration", () => {
  afterEach(() => {
    // Reset to defaults
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
  });

  it("should default to mode 'full'", () => {
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
    expect(shouldEmitCheck("precondition")).toBe(true);
    expect(shouldEmitCheck("postcondition")).toBe(true);
    expect(shouldEmitCheck("invariant")).toBe(true);
  });

  it("mode 'none' should strip all checks", () => {
    setContractConfig({
      mode: "none",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
    expect(shouldEmitCheck("precondition")).toBe(false);
    expect(shouldEmitCheck("postcondition")).toBe(false);
    expect(shouldEmitCheck("invariant")).toBe(false);
  });

  it("mode 'assertions' should keep only invariants", () => {
    setContractConfig({
      mode: "assertions",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
    expect(shouldEmitCheck("precondition")).toBe(false);
    expect(shouldEmitCheck("postcondition")).toBe(false);
    expect(shouldEmitCheck("invariant")).toBe(true);
  });

  it("fine-grained strip should override mode", () => {
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: { preconditions: true },
      proverPlugins: [],
    });
    expect(shouldEmitCheck("precondition")).toBe(false);
    expect(shouldEmitCheck("postcondition")).toBe(true);
    expect(shouldEmitCheck("invariant")).toBe(true);
  });
});

// ============================================================================
// requires() Macro Tests
// ============================================================================

describe("requires() macro", () => {
  let ctx: MacroContextImpl;

  beforeEach(() => {
    ctx = createTestContext();
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
  });

  afterEach(() => {
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
  });

  it("should generate a check expression in full mode", () => {
    const condition = ts.factory.createBinaryExpression(
      ts.factory.createIdentifier("x"),
      ts.factory.createToken(ts.SyntaxKind.GreaterThanToken),
      ts.factory.createNumericLiteral(0)
    );

    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("requires"),
      undefined,
      [condition]
    );

    const result = requiresMacro.expand(ctx, callExpr, [condition]);

    // Should produce a binary expression (condition || throw)
    expect(ts.isBinaryExpression(result)).toBe(true);
    const output = printNode(result);
    expect(output).toContain("||");
    expect(output).toContain("Error");
  });

  it("should strip in none mode", () => {
    setContractConfig({
      mode: "none",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });

    const condition = ts.factory.createTrue();
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("requires"),
      undefined,
      [condition]
    );

    const result = requiresMacro.expand(ctx, callExpr, [condition]);

    // Should produce void 0
    const output = printNode(result);
    expect(output).toBe("void 0");
  });

  it("should skip when condition is statically true", () => {
    const condition = ts.factory.createTrue();
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("requires"),
      undefined,
      [condition]
    );

    const result = requiresMacro.expand(ctx, callExpr, [condition]);

    // Should produce void 0 (skipped)
    const output = printNode(result);
    expect(output).toBe("void 0");
  });
});

// ============================================================================
// ensures() Macro Tests
// ============================================================================

describe("ensures() macro", () => {
  let ctx: MacroContextImpl;

  beforeEach(() => {
    ctx = createTestContext();
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
  });

  afterEach(() => {
    setContractConfig({
      mode: "full",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });
  });

  it("should generate a check expression in full mode", () => {
    const condition = ts.factory.createBinaryExpression(
      ts.factory.createIdentifier("result"),
      ts.factory.createToken(ts.SyntaxKind.GreaterThanToken),
      ts.factory.createNumericLiteral(0)
    );

    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("ensures"),
      undefined,
      [condition]
    );

    const result = ensuresMacro.expand(ctx, callExpr, [condition]);

    expect(ts.isBinaryExpression(result)).toBe(true);
    const output = printNode(result);
    expect(output).toContain("||");
    expect(output).toContain("Error");
  });

  it("should strip in none mode", () => {
    setContractConfig({
      mode: "none",
      proveAtCompileTime: false,
      strip: {},
      proverPlugins: [],
    });

    const condition = ts.factory.createTrue();
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("ensures"),
      undefined,
      [condition]
    );

    const result = ensuresMacro.expand(ctx, callExpr, [condition]);
    const output = printNode(result);
    expect(output).toBe("void 0");
  });
});

// ============================================================================
// old() Tests
// ============================================================================

describe("old() macro", () => {
  let ctx: MacroContextImpl;

  beforeEach(() => {
    ctx = createTestContext();
  });

  it("should return identity when used standalone", () => {
    const arg = ts.factory.createIdentifier("x");
    const callExpr = ts.factory.createCallExpression(
      ts.factory.createIdentifier("old"),
      undefined,
      [arg]
    );

    const result = oldMacro.expand(ctx, callExpr, [arg]);
    expect(ts.isIdentifier(result)).toBe(true);
    expect((result as ts.Identifier).text).toBe("x");
  });
});

// ============================================================================
// Contract Block Parser Tests
// ============================================================================

describe("contract block parser", () => {
  it("should parse requires: block", () => {
    const source = ts.createSourceFile(
      "test.ts",
      `function test() {
        requires: {
          x > 0;
          y > 0;
        }
        return x + y;
      }`,
      ts.ScriptTarget.Latest,
      true
    );

    const fn = source.statements[0] as ts.FunctionDeclaration;
    const parsed = parseContractBlocks(fn.body);

    expect(parsed.requires.length).toBe(2);
    expect(parsed.body.length).toBe(1); // return statement
  });

  it("should parse ensures: block with result param", () => {
    const source = ts.createSourceFile(
      "test.ts",
      `function test() {
        ensures: (result) => {
          result > 0;
        }
        return 42;
      }`,
      ts.ScriptTarget.Latest,
      true
    );

    const fn = source.statements[0] as ts.FunctionDeclaration;
    const parsed = parseContractBlocks(fn.body);

    expect(parsed.ensures.length).toBe(1);
    expect(parsed.ensures[0].resultParam).toBe("result");
    expect(parsed.ensures[0].conditions.length).toBe(1);
    expect(parsed.body.length).toBe(1); // return statement
  });

  it("should parse both requires: and ensures: blocks", () => {
    const source = ts.createSourceFile(
      "test.ts",
      `function test() {
        requires: { x > 0; }
        ensures: { y > 0; }
        return x + y;
      }`,
      ts.ScriptTarget.Latest,
      true
    );

    const fn = source.statements[0] as ts.FunctionDeclaration;
    const parsed = parseContractBlocks(fn.body);

    expect(parsed.requires.length).toBe(1);
    expect(parsed.ensures.length).toBe(1);
    expect(parsed.body.length).toBe(1);
  });
});

// ============================================================================
// Predicate Normalization Tests
// ============================================================================

describe("predicate normalization", () => {
  it("should normalize simple comparisons", () => {
    const expr = ts.factory.createBinaryExpression(
      ts.factory.createIdentifier("x"),
      ts.factory.createToken(ts.SyntaxKind.GreaterThanToken),
      ts.factory.createNumericLiteral(0)
    );
    expect(normalizeExpression(expr)).toBe("x > 0");
  });

  it("should normalize property access", () => {
    const expr = ts.factory.createBinaryExpression(
      ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("account"), "balance"),
      ts.factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken),
      ts.factory.createNumericLiteral(0)
    );
    expect(normalizeExpression(expr)).toBe("account.balance >= 0");
  });

  it("should normalize negation", () => {
    const expr = ts.factory.createPrefixUnaryExpression(
      ts.SyntaxKind.ExclamationToken,
      ts.factory.createIdentifier("frozen")
    );
    expect(normalizeExpression(expr)).toBe("!frozen");
  });
});

// ============================================================================
// Algebraic Prover Tests
// ============================================================================

describe("algebraic prover", () => {
  it("should prove sum of positives is positive", () => {
    const facts: TypeFact[] = [
      { variable: "x", predicate: "x > 0" },
      { variable: "y", predicate: "y > 0" },
    ];
    const result = tryAlgebraicProof("x + y > 0", facts);
    expect(result.proven).toBe(true);
    expect(result.method).toBe("algebra");
  });

  it("should prove positive implies non-negative", () => {
    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
    const result = tryAlgebraicProof("x >= 0", facts);
    expect(result.proven).toBe(true);
  });

  it("should prove identity when fact matches goal", () => {
    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
    const result = tryAlgebraicProof("x > 0", facts);
    expect(result.proven).toBe(true);
  });

  it("should prove product of positives is positive", () => {
    const facts: TypeFact[] = [
      { variable: "x", predicate: "x > 0" },
      { variable: "y", predicate: "y > 0" },
    ];
    const result = tryAlgebraicProof("x * y > 0", facts);
    expect(result.proven).toBe(true);
  });

  it("should not prove unrelated goals", () => {
    const facts: TypeFact[] = [{ variable: "x", predicate: "x > 0" }];
    const result = tryAlgebraicProof("y > 0", facts);
    expect(result.proven).toBe(false);
  });

  it("should prove tautology", () => {
    const result = tryAlgebraicProof("true", []);
    expect(result.proven).toBe(true);
  });
});

// ============================================================================
// Runtime Error Tests
// ============================================================================

describe("runtime errors", () => {
  it("requires() should throw on false condition", () => {
    const { requires } = require("@typesugar/contracts");
    expect(() => requires(false, "test")).toThrow("test");
    expect(() => requires(true, "test")).not.toThrow();
  });

  it("ensures() should throw on false condition", () => {
    const { ensures } = require("@typesugar/contracts");
    expect(() => ensures(false, "test")).toThrow("test");
    expect(() => ensures(true, "test")).not.toThrow();
  });

  it("old() should be identity at runtime", () => {
    const { old } = require("@typesugar/contracts");
    expect(old(42)).toBe(42);
    expect(old("hello")).toBe("hello");
  });
});

// ============================================================================
// contracts-refined Integration Tests
// ============================================================================

describe("@typesugar/contracts-refined integration", () => {
  it("should register all built-in predicates when imported", async () => {
    // Import contracts-refined to register predicates
    const contractsRefined = await import("@typesugar/contracts-refined");

    // Use hasRefinementPredicate from the integration module
    // (getRefinementPredicate queries the same registry but through contracts-refined)
    expect(contractsRefined.hasRefinementPredicate("Positive")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("NonNegative")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("Negative")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("Byte")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("Port")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("Percentage")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("NonEmpty")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("Email")).toBe(true);
    expect(contractsRefined.hasRefinementPredicate("Uuid")).toBe(true);
  });

  it("should export helper functions", async () => {
    const contractsRefined = await import("@typesugar/contracts-refined");

    expect(typeof contractsRefined.registerRefinementPredicate).toBe("function");
    expect(typeof contractsRefined.hasRefinementPredicate).toBe("function");
    expect(typeof contractsRefined.getRegisteredPredicates).toBe("function");
  });

  it("should allow registering custom predicates", async () => {
    const contractsRefined = await import("@typesugar/contracts-refined");

    // Register a custom predicate
    contractsRefined.registerRefinementPredicate("PositiveEvenTest", "$ > 0 && $ % 2 === 0");

    // Verify it's registered
    expect(contractsRefined.hasRefinementPredicate("PositiveEvenTest")).toBe(true);
  });

  it("should track registered predicates via getRegisteredPredicates()", async () => {
    const { getRegisteredPredicates } = await import("@typesugar/contracts-refined");

    const predicates = getRegisteredPredicates();
    expect(Array.isArray(predicates)).toBe(true);
    expect(predicates.length).toBeGreaterThan(0);

    // Should have at least the built-in predicates
    const brands = predicates.map((p) => p.brand);
    expect(brands).toContain("Positive");
    expect(brands).toContain("Byte");
    expect(brands).toContain("Port");
    expect(brands).toContain("Email");
    expect(brands).toContain("Uuid");
  });
});
