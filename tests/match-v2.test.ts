/**
 * Tests for the fluent match() chain macro (PEP-008 Wave 1)
 *
 * Covers: literal patterns, wildcard, variable binding, guards,
 * .else() catch-all, MatchError generation, ternary optimization.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import { expandFluentMatch } from "../packages/std/src/macros/match-v2.js";

// ============================================================================
// Test Helpers
// ============================================================================

let _cachedProgram: ts.Program | undefined;
const _options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  strict: true,
};

function getSharedProgram(): ts.Program {
  if (!_cachedProgram) {
    const sf = ts.createSourceFile(
      "test.ts",
      "const x = 1;",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const host = ts.createCompilerHost(_options);
    _cachedProgram = ts.createProgram(["test.ts"], _options, {
      ...host,
      getSourceFile: (name) =>
        name === "test.ts" ? sf : host.getSourceFile(name, ts.ScriptTarget.Latest),
    });
  }
  return _cachedProgram;
}

function createTestContext(): {
  ctx: MacroContextImpl;
  printExpr: (node: ts.Expression) => string;
} {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    "const x = 1;",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const transformContext: ts.TransformationContext = {
    factory: ts.factory,
    getCompilerOptions: () => _options,
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

  const ctx = createMacroContext(getSharedProgram(), sourceFile, transformContext);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  return {
    ctx,
    printExpr: (node: ts.Expression) =>
      printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile),
  };
}

const f = ts.factory;

/**
 * Build a fluent chain AST: match(scrutinee).method1(arg1).method2(arg2)...
 *
 * Returns the outermost CallExpression and the root match call's arguments.
 */
function buildChain(
  scrutinee: ts.Expression,
  ...steps: { method: string; args: ts.Expression[] }[]
): { outermost: ts.CallExpression; rootArgs: ts.Expression[] } {
  let current: ts.Expression = f.createCallExpression(f.createIdentifier("match"), undefined, [
    scrutinee,
  ]);

  for (const step of steps) {
    const propAccess = f.createPropertyAccessExpression(current, f.createIdentifier(step.method));
    current = f.createCallExpression(propAccess, undefined, step.args);
  }

  return {
    outermost: current as ts.CallExpression,
    rootArgs: [scrutinee],
  };
}

function ident(name: string): ts.Identifier {
  return f.createIdentifier(name);
}
function num(n: number): ts.NumericLiteral {
  return f.createNumericLiteral(n);
}
function str(s: string): ts.StringLiteral {
  return f.createStringLiteral(s);
}

// ============================================================================
// Tests
// ============================================================================

describe("fluent match() macro (PEP-008 Wave 1)", () => {
  describe("literal patterns", () => {
    it("should compile single number literal + else to ternary", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(42)] },
        { method: "then", args: [str("yes")] },
        { method: "else", args: [str("no")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("x === 42");
      expect(text).toContain('"yes"');
      expect(text).toContain('"no"');
      expect(text).toContain("?");
      expect(text).not.toContain("=>"); // ternary, not IIFE
    });

    it("should compile string literal pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [str("hello")] },
        { method: "then", args: [num(1)] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('x === "hello"');
      expect(text).toContain("?");
    });

    it("should compile boolean literal pattern (true)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [f.createTrue()] },
        { method: "then", args: [str("yes")] },
        { method: "else", args: [str("no")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("x === true");
    });

    it("should compile boolean literal pattern (false)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [f.createFalse()] },
        { method: "then", args: [str("yes")] },
        { method: "else", args: [str("no")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("x === false");
    });

    it("should compile null literal pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [f.createNull()] },
        { method: "then", args: [str("nothing")] },
        { method: "else", args: [str("something")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("x === null");
    });

    it("should compile undefined literal pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("undefined")] },
        { method: "then", args: [str("missing")] },
        { method: "else", args: [str("present")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("x === undefined");
    });

    it("should compile multiple literal arms to IIFE", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(1)] },
        { method: "then", args: [str("one")] },
        { method: "case", args: [num(2)] },
        { method: "then", args: [str("two")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=>");
      expect(text).toContain("=== 1");
      expect(text).toContain("=== 2");
      expect(text).toContain('"one"');
      expect(text).toContain('"two"');
      expect(text).toContain('"other"');
    });

    it("should compile negative number literal pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const negOne = f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, num(1));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [negOne] },
        { method: "then", args: [str("neg")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== -1");
    });
  });

  describe("wildcard pattern (_)", () => {
    it("should generate unconditional return for _", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(1)] },
        { method: "then", args: [str("one")] },
        { method: "case", args: [ident("_")] },
        { method: "then", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== 1");
      expect(text).toContain('"one"');
      expect(text).toContain('"other"');
      expect(text).not.toMatch(/(?<![a-zA-Z0-9_])_ ===/);
      expect(text).not.toMatch(/(?<![a-zA-Z0-9_])const _(?![a-zA-Z0-9_])/);
    });
  });

  describe("variable binding pattern", () => {
    it("should bind scrutinee to named variable", () => {
      const { ctx, printExpr } = createTestContext();
      const nTimesTwo = f.createBinaryExpression(ident("n"), ts.SyntaxKind.AsteriskToken, num(2));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("n")] },
        { method: "then", args: [nTimesTwo] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const n =");
      expect(text).toContain("n * 2");
    });

    it("should bind variable with guard (gate criterion)", () => {
      const { ctx, printExpr } = createTestContext();
      const nGtZero = f.createBinaryExpression(ident("n"), ts.SyntaxKind.GreaterThanToken, num(0));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("n")] },
        { method: "if", args: [nGtZero] },
        { method: "then", args: [ident("n")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const n =");
      expect(text).toContain("n > 0");
      expect(text).toContain("return n");
      expect(text).toContain("return 0");
    });
  });

  describe("guards (.if())", () => {
    it("should combine literal check with guard", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(ident("x"), ts.SyntaxKind.GreaterThanToken, num(10));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(42)] },
        { method: "if", args: [guard] },
        { method: "then", args: [str("big 42")] },
        { method: "else", args: [str("nope")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      // Literal + guard → IIFE (not ternary, because of guard)
      expect(text).toContain("=== 42");
      expect(text).toContain("&&");
      expect(text).toContain("x > 10");
    });

    it("should apply guard to wildcard pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(ident("x"), ts.SyntaxKind.GreaterThanToken, num(0));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("_")] },
        { method: "if", args: [guard] },
        { method: "then", args: [str("positive")] },
        { method: "else", args: [str("non-positive")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("x > 0");
      expect(text).toContain('"positive"');
      expect(text).not.toContain("_ ===");
    });
  });

  describe(".else() and MatchError", () => {
    it("should generate return for .else() clause", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(1)] },
        { method: "then", args: [str("one")] },
        { method: "else", args: [str("default")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).not.toContain("MatchError");
    });

    it("should throw MatchError when no .else() is present", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(1)] },
        { method: "then", args: [str("one")] },
        { method: "case", args: [num(2)] },
        { method: "then", args: [str("two")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("throw new MatchError");
    });
  });

  describe("scrutinee evaluation", () => {
    it("should evaluate scrutinee once in IIFE (const __m)", () => {
      const { ctx, printExpr } = createTestContext();
      const complexScrutinee = f.createCallExpression(ident("getVal"), undefined, []);
      const { outermost, rootArgs } = buildChain(
        complexScrutinee,
        { method: "case", args: [num(1)] },
        { method: "then", args: [str("one")] },
        { method: "case", args: [num(2)] },
        { method: "then", args: [str("two")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("getVal()");
      // scrutinee should appear exactly once (in the const declaration)
      const callCount = (text.match(/getVal\(\)/g) || []).length;
      expect(callCount).toBe(1);
    });
  });

  describe("gate criteria", () => {
    it("match(x).case(42).then('yes').else('no') → ternary", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(42)] },
        { method: "then", args: [str("yes")] },
        { method: "else", args: [str("no")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toBe('x === 42 ? "yes" : "no"');
    });

    it("match(x).case(n).if(n > 0).then(n).else(0) binds n correctly", () => {
      const { ctx, printExpr } = createTestContext();
      const nGtZero = f.createBinaryExpression(ident("n"), ts.SyntaxKind.GreaterThanToken, num(0));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("n")] },
        { method: "if", args: [nGtZero] },
        { method: "then", args: [ident("n")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const n =");
      expect(text).toContain("n > 0");
      expect(text).toContain("return n");
      expect(text).toContain("return 0");
    });

    it("match(x).case(_).then('any') generates no check", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("_")] },
        { method: "then", args: [str("any")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"any"');
      expect(text).not.toContain("===");
      expect(text).not.toContain("if");
    });

    it("variables in .if() and .then() resolve to .case() bindings", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(ident("val"), ts.SyntaxKind.GreaterThanToken, num(0));
      const result_expr = f.createBinaryExpression(ident("val"), ts.SyntaxKind.PlusToken, num(1));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ident("val")] },
        { method: "if", args: [guard] },
        { method: "then", args: [result_expr] },
        { method: "else", args: [num(0)] }
      );

      const resultNode = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(resultNode);

      expect(text).toContain("const val =");
      expect(text).toContain("val > 0");
      expect(text).toContain("val + 1");
    });
  });

  describe("complex chains", () => {
    it("should handle multiple arms with mixed patterns", () => {
      const { ctx, printExpr } = createTestContext();
      const nGtZero = f.createBinaryExpression(ident("n"), ts.SyntaxKind.GreaterThanToken, num(0));
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(0)] },
        { method: "then", args: [str("zero")] },
        { method: "case", args: [ident("n")] },
        { method: "if", args: [nGtZero] },
        { method: "then", args: [str("positive")] },
        { method: "case", args: [ident("_")] },
        { method: "then", args: [str("negative")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== 0");
      expect(text).toContain('"zero"');
      expect(text).toContain("const n =");
      expect(text).toContain("n > 0");
      expect(text).toContain('"positive"');
      expect(text).toContain('"negative"');
    });
  });
});
