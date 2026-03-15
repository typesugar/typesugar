/**
 * Tests for the fluent match() chain macro (PEP-008 Waves 1–3)
 *
 * Covers:
 * - Wave 1: literal patterns, wildcard, variable binding, guards,
 *   .else() catch-all, MatchError generation, ternary optimization.
 * - Wave 2: array patterns, object patterns, nested patterns,
 *   rest/spread patterns, mixed literal+binding in objects.
 * - Wave 3: type constructor patterns, OR patterns, AS patterns, regex patterns.
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

// ============================================================================
// Wave 2: Array + Object Patterns
// ============================================================================

function arr(...elements: ts.Expression[]): ts.ArrayLiteralExpression {
  return f.createArrayLiteralExpression(elements);
}

function spread(expr: ts.Expression): ts.SpreadElement {
  return f.createSpreadElement(expr);
}

function obj(...props: ts.ObjectLiteralElementLike[]): ts.ObjectLiteralExpression {
  return f.createObjectLiteralExpression(props);
}

function shortProp(name: string): ts.ShorthandPropertyAssignment {
  return f.createShorthandPropertyAssignment(name);
}

function prop(key: string, value: ts.Expression): ts.PropertyAssignment {
  return f.createPropertyAssignment(key, value);
}

function spreadAssign(name: string): ts.SpreadAssignment {
  return f.createSpreadAssignment(ident(name));
}

describe("fluent match() macro (PEP-008 Wave 2)", () => {
  // ==========================================================================
  // Array Patterns
  // ==========================================================================
  describe("array patterns", () => {
    it("should match empty array []", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr()] },
        { method: "then", args: [str("empty")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length === 0");
      expect(text).toContain('"empty"');
    });

    it("should match [a, b] with exact length 2", () => {
      const { ctx, printExpr } = createTestContext();
      const sum = f.createBinaryExpression(ident("a"), ts.SyntaxKind.PlusToken, ident("b"));
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("a"), ident("b"))] },
        { method: "then", args: [sum] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length === 2");
      expect(text).toContain("const a =");
      expect(text).toContain("const b =");
      expect(text).toContain("a + b");
    });

    it("should handle [first, _, _] — wildcard positions not bound (gate criterion)", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(
        ident("first"),
        ts.SyntaxKind.GreaterThanToken,
        num(0)
      );
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("first"), ident("_"), ident("_"))] },
        { method: "if", args: [guard] },
        { method: "then", args: [ident("first")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length === 3");
      expect(text).toContain("const first =");
      expect(text).toContain("first > 0");
      // wildcards should NOT create bindings (but allow __typesugar_ prefixed names)
      expect(text).not.toContain("const _ =");
      expect(text).not.toMatch(/const _\b(?!_)/); // const _ but not const __
    });

    it("should handle [head, ...tail] — rest pattern (gate criterion)", () => {
      const { ctx, printExpr } = createTestContext();
      const tailLen = f.createPropertyAccessExpression(ident("tail"), "length");
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("head"), spread(ident("tail")))] },
        { method: "then", args: [tailLen] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length >= 1");
      expect(text).toContain("const head =");
      expect(text).toContain("const tail =");
      expect(text).toContain(".slice(1)");
      expect(text).toContain("tail.length");
    });

    it("should handle [_, ...rest] — discard head, capture rest", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("_"), spread(ident("rest")))] },
        { method: "then", args: [ident("rest")] },
        { method: "else", args: [arr()] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length >= 1");
      expect(text).not.toMatch(/const _ =/);
      expect(text).toContain("const rest =");
      expect(text).toContain(".slice(1)");
    });

    it("should match [x] — singleton array", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("x"))] },
        { method: "then", args: [ident("x")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length === 1");
      expect(text).toContain("const x =");
    });

    it("should handle multiple array arms", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr()] },
        { method: "then", args: [str("empty")] },
        { method: "case", args: [arr(ident("x"))] },
        { method: "then", args: [ident("x")] },
        { method: "else", args: [str("many")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".length === 0");
      expect(text).toContain(".length === 1");
      expect(text).toContain('"empty"');
      expect(text).toContain('"many"');
    });
  });

  // ==========================================================================
  // Object Patterns
  // ==========================================================================
  describe("object patterns", () => {
    it("should match { name, age } — shorthand bindings (gate criterion)", () => {
      const { ctx, printExpr } = createTestContext();
      const ageCheck = f.createBinaryExpression(
        ident("age"),
        ts.SyntaxKind.GreaterThanToken,
        num(18)
      );
      const { outermost, rootArgs } = buildChain(
        ident("obj"),
        { method: "case", args: [obj(shortProp("name"), shortProp("age"))] },
        { method: "if", args: [ageCheck] },
        { method: "then", args: [ident("name")] },
        { method: "else", args: [str("minor")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"object"');
      expect(text).toContain("!== null");
      expect(text).toContain('"name" in');
      expect(text).toContain('"age" in');
      expect(text).toContain("const name =");
      expect(text).toContain("const age =");
      expect(text).toContain("age > 18");
    });

    it("should match { name: n } — renamed binding", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("obj"),
        { method: "case", args: [obj(prop("name", ident("n")))] },
        { method: "then", args: [ident("n")] },
        { method: "else", args: [str("none")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"name" in');
      expect(text).toContain("const n =");
      expect(text).toContain(".name");
    });

    it("should match { kind: 'circle' } — literal property value (structural check)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("shape"),
        { method: "case", args: [obj(prop("kind", str("circle")))] },
        { method: "then", args: [str("round")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"kind" in');
      expect(text).toContain('.kind === "circle"');
      expect(text).toContain('"round"');
      // No binding for literal value
      expect(text).not.toContain("const kind =");
    });

    it("should match { kind: 'circle', radius: r } — literal + binding", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("shape"),
        {
          method: "case",
          args: [obj(prop("kind", str("circle")), prop("radius", ident("r")))],
        },
        { method: "then", args: [ident("r")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"kind" in');
      expect(text).toContain('.kind === "circle"');
      expect(text).toContain('"radius" in');
      expect(text).toContain("const r =");
      expect(text).toContain(".radius");
    });

    it("should match { ...rest } — rest pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const keysLen = f.createCallExpression(
        f.createPropertyAccessExpression(
          f.createCallExpression(
            f.createPropertyAccessExpression(ident("Object"), "keys"),
            undefined,
            [ident("rest")]
          ),
          "length"
        ),
        undefined,
        []
      );
      const { outermost, rootArgs } = buildChain(
        ident("obj"),
        { method: "case", args: [obj(spreadAssign("rest"))] },
        { method: "then", args: [ident("rest")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"object"');
      expect(text).toContain("...rest");
    });

    it("should handle object pattern without guard", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("obj"),
        { method: "case", args: [obj(shortProp("x"))] },
        { method: "then", args: [ident("x")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"x" in');
      expect(text).toContain("const x =");
      expect(text).toContain("return x");
    });
  });

  // ==========================================================================
  // Nested Patterns
  // ==========================================================================
  describe("nested patterns", () => {
    it("should match { user: { name } } — nested object (gate criterion)", () => {
      const { ctx, printExpr } = createTestContext();
      const innerObj = obj(shortProp("name"));
      const outerObj = obj(prop("user", innerObj));
      const { outermost, rootArgs } = buildChain(
        ident("data"),
        { method: "case", args: [outerObj] },
        { method: "then", args: [ident("name")] },
        { method: "else", args: [str("unknown")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      // Outer checks
      expect(text).toContain('"user" in');
      // Nested checks on .user
      expect(text).toContain('"name" in');
      // Binding
      expect(text).toContain("const name =");
      expect(text).toContain(".user");
    });

    it("should match { user: { name, age } } — nested with multiple props", () => {
      const { ctx, printExpr } = createTestContext();
      const innerObj = obj(shortProp("name"), shortProp("age"));
      const outerObj = obj(prop("user", innerObj));
      const { outermost, rootArgs } = buildChain(
        ident("data"),
        { method: "case", args: [outerObj] },
        { method: "then", args: [ident("name")] },
        { method: "else", args: [str("none")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"user" in');
      expect(text).toContain('"name" in');
      expect(text).toContain('"age" in');
      expect(text).toContain("const name =");
      expect(text).toContain("const age =");
    });

    it("should match [{ x }, { y }] — array of objects", () => {
      const { ctx, printExpr } = createTestContext();
      const sum = f.createBinaryExpression(ident("x"), ts.SyntaxKind.PlusToken, ident("y"));
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(obj(shortProp("x")), obj(shortProp("y")))] },
        { method: "then", args: [sum] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length === 2");
      // Nested object checks for elements
      expect(text).toContain('"x" in');
      expect(text).toContain('"y" in');
      expect(text).toContain("const x =");
      expect(text).toContain("const y =");
    });

    it("should match { items: [first, ...rest] } — object with nested array", () => {
      const { ctx, printExpr } = createTestContext();
      const innerArr = arr(ident("first"), spread(ident("rest")));
      const outerObj = obj(prop("items", innerArr));
      const { outermost, rootArgs } = buildChain(
        ident("data"),
        { method: "case", args: [outerObj] },
        { method: "then", args: [ident("first")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      // Outer object check
      expect(text).toContain('"items" in');
      // Nested array check on .items
      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length >= 1");
      expect(text).toContain("const first =");
      expect(text).toContain("const rest =");
      expect(text).toContain(".slice(1)");
    });

    it("should match { user: { name }, active: true } — mixed nested + literal", () => {
      const { ctx, printExpr } = createTestContext();
      const innerObj = obj(shortProp("name"));
      const outerObj = obj(prop("user", innerObj), prop("active", f.createTrue()));
      const { outermost, rootArgs } = buildChain(
        ident("data"),
        { method: "case", args: [outerObj] },
        { method: "then", args: [ident("name")] },
        { method: "else", args: [str("inactive")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"user" in');
      expect(text).toContain('"active" in');
      expect(text).toContain(".active === true");
      expect(text).toContain('"name" in');
      expect(text).toContain("const name =");
    });
  });

  // ==========================================================================
  // Gate Criteria (explicit verification)
  // ==========================================================================
  describe("Wave 2 gate criteria", () => {
    it("GATE: match(arr).case([first, _, _]).if(first > 0).then(first) works", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(
        ident("first"),
        ts.SyntaxKind.GreaterThanToken,
        num(0)
      );
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("first"), ident("_"), ident("_"))] },
        { method: "if", args: [guard] },
        { method: "then", args: [ident("first")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length === 3");
      expect(text).toContain("const first");
      expect(text).toContain("first > 0");
      expect(text).toContain("return first");
    });

    it("GATE: match(obj).case({ name, age }).if(age > 18).then(name) works", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(ident("age"), ts.SyntaxKind.GreaterThanToken, num(18));
      const { outermost, rootArgs } = buildChain(
        ident("obj"),
        { method: "case", args: [obj(shortProp("name"), shortProp("age"))] },
        { method: "if", args: [guard] },
        { method: "then", args: [ident("name")] },
        { method: "else", args: [str("minor")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"name" in');
      expect(text).toContain('"age" in');
      expect(text).toContain("const name");
      expect(text).toContain("const age");
      expect(text).toContain("age > 18");
      expect(text).toContain("return name");
    });

    it("GATE: match(data).case({ user: { name } }).then(name) works with nesting", () => {
      const { ctx, printExpr } = createTestContext();
      const innerObj = obj(shortProp("name"));
      const outerObj = obj(prop("user", innerObj));
      const { outermost, rootArgs } = buildChain(
        ident("data"),
        { method: "case", args: [outerObj] },
        { method: "then", args: [ident("name")] },
        { method: "else", args: [str("unknown")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"user" in');
      expect(text).toContain('"name" in');
      expect(text).toContain("const name");
      expect(text).toContain("return name");
    });

    it("GATE: match(arr).case([head, ...tail]).then(tail.length) works with rest", () => {
      const { ctx, printExpr } = createTestContext();
      const tailLen = f.createPropertyAccessExpression(ident("tail"), "length");
      const { outermost, rootArgs } = buildChain(
        ident("arr"),
        { method: "case", args: [arr(ident("head"), spread(ident("tail")))] },
        { method: "then", args: [tailLen] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain(".length >= 1");
      expect(text).toContain("const head");
      expect(text).toContain("const tail");
      expect(text).toContain(".slice(1)");
      expect(text).toContain("tail.length");
    });
  });
});

// ============================================================================
// Wave 3: Type Constructors + OR + AS + Regex
// ============================================================================

/** Build a CallExpression like `String(s)` or `Date(d)` for type constructor patterns. */
function ctorPat(ctorName: string, binding: ts.Expression): ts.CallExpression {
  return f.createCallExpression(ident(ctorName), undefined, [binding]);
}

/** Build a regex literal AST node. */
function regex(pattern: string): ts.Expression {
  return f.createRegularExpressionLiteral(pattern);
}

describe("fluent match() macro (PEP-008 Wave 3)", () => {
  // ==========================================================================
  // Type Constructor Patterns
  // ==========================================================================
  describe("type constructor patterns", () => {
    it("GATE: .case(String(s)).then(s.length) generates typeof === 'string'", () => {
      const { ctx, printExpr } = createTestContext();
      const sLen = f.createPropertyAccessExpression(ident("s"), "length");
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("String", ident("s"))] },
        { method: "then", args: [sLen] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
      expect(text).toContain("const s =");
      expect(text).toContain("s.length");
    });

    it("should generate typeof === 'number' for Number(n)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Number", ident("n"))] },
        { method: "then", args: [ident("n")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"number"');
      expect(text).toContain("const n =");
    });

    it("should generate typeof === 'boolean' for Boolean(b)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Boolean", ident("b"))] },
        { method: "then", args: [ident("b")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"boolean"');
      expect(text).toContain("const b =");
    });

    it("should generate typeof === 'bigint' for BigInt(n)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("BigInt", ident("n"))] },
        { method: "then", args: [ident("n")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"bigint"');
    });

    it("should generate typeof === 'symbol' for Symbol(s)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Symbol", ident("s"))] },
        { method: "then", args: [ident("s")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"symbol"');
    });

    it("should generate typeof === 'function' for Function(fn)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Function", ident("fn"))] },
        { method: "then", args: [ident("fn")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"function"');
    });

    it("should generate typeof === 'object' && !== null for Object(o)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Object", ident("o"))] },
        { method: "then", args: [ident("o")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"object"');
      expect(text).toContain("!== null");
      expect(text).toContain("const o =");
    });

    it("GATE: .case(Array(a)).then(a.length) generates Array.isArray()", () => {
      const { ctx, printExpr } = createTestContext();
      const aLen = f.createPropertyAccessExpression(ident("a"), "length");
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Array", ident("a"))] },
        { method: "then", args: [aLen] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
      expect(text).toContain("const a =");
      expect(text).toContain("a.length");
    });

    it("GATE: .case(Date(d)).then(d.toISOString()) generates instanceof Date", () => {
      const { ctx, printExpr } = createTestContext();
      const dIso = f.createCallExpression(
        f.createPropertyAccessExpression(ident("d"), "toISOString"),
        undefined,
        []
      );
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Date", ident("d"))] },
        { method: "then", args: [dIso] },
        { method: "else", args: [str("not a date")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("instanceof Date");
      expect(text).toContain("const d =");
      expect(text).toContain("d.toISOString()");
    });

    it("should generate instanceof for user-defined constructors (TypeError)", () => {
      const { ctx, printExpr } = createTestContext();
      const eMsg = f.createPropertyAccessExpression(ident("e"), "message");
      const { outermost, rootArgs } = buildChain(
        ident("err"),
        { method: "case", args: [ctorPat("TypeError", ident("e"))] },
        { method: "then", args: [eMsg] },
        { method: "else", args: [str("unknown error")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("instanceof TypeError");
      expect(text).toContain("const e =");
      expect(text).toContain("e.message");
    });

    it("should handle type constructor with wildcard binding", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("String", ident("_"))] },
        { method: "then", args: [str("it's a string")] },
        { method: "else", args: [str("nope")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
      expect(text).not.toContain("const _ =");
    });

    it("should handle type constructor with guard", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(
        f.createPropertyAccessExpression(ident("s"), "length"),
        ts.SyntaxKind.GreaterThanToken,
        num(5)
      );
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("String", ident("s"))] },
        { method: "if", args: [guard] },
        { method: "then", args: [ident("s")] },
        { method: "else", args: [str("short or not string")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
      expect(text).toContain("const s =");
      expect(text).toContain("s.length > 5");
    });

    it("should handle multiple type constructor arms", () => {
      const { ctx, printExpr } = createTestContext();
      const sLen = f.createPropertyAccessExpression(ident("s"), "length");
      const nStr = f.createCallExpression(
        f.createPropertyAccessExpression(ident("n"), "toString"),
        undefined,
        []
      );
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("String", ident("s"))] },
        { method: "then", args: [sLen] },
        { method: "case", args: [ctorPat("Number", ident("n"))] },
        { method: "then", args: [nStr] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"string"');
      expect(text).toContain('"number"');
      expect(text).toContain("const s =");
      expect(text).toContain("const n =");
    });
  });

  // ==========================================================================
  // OR Patterns
  // ==========================================================================
  describe("OR patterns", () => {
    it("GATE: .case(200).or(201).or(204).then('ok') generates OR chain", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("status"),
        { method: "case", args: [num(200)] },
        { method: "or", args: [num(201)] },
        { method: "or", args: [num(204)] },
        { method: "then", args: [str("ok")] },
        { method: "else", args: [str("error")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== 200");
      expect(text).toContain("=== 201");
      expect(text).toContain("=== 204");
      expect(text).toContain("||");
      expect(text).toContain('"ok"');
    });

    it("should handle two-alternative OR pattern", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [str("a")] },
        { method: "or", args: [str("b")] },
        { method: "then", args: [str("ab")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"a"');
      expect(text).toContain('"b"');
      expect(text).toContain("||");
    });

    it("should handle OR pattern with guard", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(ident("x"), ts.SyntaxKind.GreaterThanToken, num(100));
      const { outermost, rootArgs } = buildChain(
        ident("status"),
        { method: "case", args: [num(200)] },
        { method: "or", args: [num(201)] },
        { method: "if", args: [guard] },
        { method: "then", args: [str("ok and big")] },
        { method: "else", args: [str("nope")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== 200");
      expect(text).toContain("||");
      expect(text).toContain("=== 201");
      expect(text).toContain("&&");
      expect(text).toContain("x > 100");
    });

    it("should handle OR pattern mixed with normal arms", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(1)] },
        { method: "or", args: [num(2)] },
        { method: "then", args: [str("low")] },
        { method: "case", args: [num(99)] },
        { method: "then", args: [str("high")] },
        { method: "else", args: [str("other")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== 1");
      expect(text).toContain("||");
      expect(text).toContain("=== 2");
      expect(text).toContain("=== 99");
    });
  });

  // ==========================================================================
  // AS Patterns
  // ==========================================================================
  describe("AS patterns", () => {
    it("GATE: .case([x, y]).as(p).then(p) binds both p and x, y", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("val"),
        { method: "case", args: [arr(ident("x"), ident("y"))] },
        { method: "as", args: [ident("p")] },
        { method: "then", args: [ident("p")] },
        { method: "else", args: [str("no match")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const p =");
      expect(text).toContain("const x =");
      expect(text).toContain("const y =");
      expect(text).toContain("return p");
    });

    it("should bind AS pattern with object destructuring", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("val"),
        { method: "case", args: [obj(shortProp("name"), shortProp("age"))] },
        { method: "as", args: [ident("person")] },
        { method: "then", args: [ident("person")] },
        { method: "else", args: [str("no match")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const person =");
      expect(text).toContain("const name =");
      expect(text).toContain("const age =");
      expect(text).toContain("return person");
    });

    it("should handle AS pattern with literal match (no destructured bindings)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [num(42)] },
        { method: "as", args: [ident("val")] },
        { method: "then", args: [ident("val")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("=== 42");
      expect(text).toContain("const val =");
      expect(text).toContain("return val");
    });

    it("should handle AS with wildcard (ignore) binding", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [arr(ident("a"), ident("b"))] },
        { method: "as", args: [ident("_")] },
        { method: "then", args: [ident("a")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const a =");
      expect(text).toContain("const b =");
      expect(text).not.toContain("const _ =");
    });

    it("should handle AS pattern with guard", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(
        f.createPropertyAccessExpression(ident("p"), "length"),
        ts.SyntaxKind.GreaterThanToken,
        num(0)
      );
      const { outermost, rootArgs } = buildChain(
        ident("val"),
        { method: "case", args: [arr(ident("x"), ident("y"))] },
        { method: "as", args: [ident("p")] },
        { method: "if", args: [guard] },
        { method: "then", args: [ident("p")] },
        { method: "else", args: [str("empty")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const p =");
      expect(text).toContain("const x =");
      expect(text).toContain("const y =");
      expect(text).toContain("p.length > 0");
    });
  });

  // ==========================================================================
  // Regex Patterns
  // ==========================================================================
  describe("regex patterns", () => {
    it("GATE: .case(/regex/).as([_, user, domain]).then(...) extracts captures", () => {
      const { ctx, printExpr } = createTestContext();
      const resultExpr = obj(prop("user", ident("user")), prop("domain", ident("domain")));
      const { outermost, rootArgs } = buildChain(
        ident("email"),
        {
          method: "case",
          args: [regex("/^(\\w+)@(\\w+)$/")],
        },
        {
          method: "as",
          args: [arr(ident("_"), ident("user"), ident("domain"))],
        },
        { method: "then", args: [resultExpr] },
        { method: "else", args: [str("invalid")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".match(");
      expect(text).toContain("!== null");
      expect(text).toContain("const user =");
      expect(text).toContain("const domain =");
    });

    it("should handle regex without AS pattern (just match test)", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("s"),
        {
          method: "case",
          args: [regex("/^\\d+$/")],
        },
        { method: "then", args: [str("numeric")] },
        { method: "else", args: [str("not numeric")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".match(");
      expect(text).toContain("!== null");
      expect(text).toContain('"numeric"');
    });

    it("should handle regex with guard", () => {
      const { ctx, printExpr } = createTestContext();
      const guard = f.createBinaryExpression(
        f.createPropertyAccessExpression(ident("user"), "length"),
        ts.SyntaxKind.GreaterThanToken,
        num(3)
      );
      const { outermost, rootArgs } = buildChain(
        ident("email"),
        {
          method: "case",
          args: [regex("/^(\\w+)@(\\w+)$/")],
        },
        {
          method: "as",
          args: [arr(ident("_"), ident("user"), ident("domain"))],
        },
        { method: "if", args: [guard] },
        { method: "then", args: [ident("user")] },
        { method: "else", args: [str("invalid")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".match(");
      expect(text).toContain("!== null");
      expect(text).toContain("const user =");
      expect(text).toContain("user.length > 3");
    });

    it("should handle regex mixed with other pattern arms", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("input"),
        { method: "case", args: [str("")] },
        { method: "then", args: [str("empty")] },
        {
          method: "case",
          args: [regex("/^\\d+$/")],
        },
        { method: "then", args: [str("numeric")] },
        { method: "else", args: [str("text")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('=== ""');
      expect(text).toContain('"empty"');
      expect(text).toContain(".match(");
      expect(text).toContain('"numeric"');
    });
  });

  // ==========================================================================
  // Wave 3 Gate Criteria (all in one place)
  // ==========================================================================
  describe("Wave 3 gate criteria", () => {
    it("GATE: String(s) → typeof === 'string'", () => {
      const { ctx, printExpr } = createTestContext();
      const sLen = f.createPropertyAccessExpression(ident("s"), "length");
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("String", ident("s"))] },
        { method: "then", args: [sLen] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
    });

    it("GATE: Date(d) → instanceof Date", () => {
      const { ctx, printExpr } = createTestContext();
      const dIso = f.createCallExpression(
        f.createPropertyAccessExpression(ident("d"), "toISOString"),
        undefined,
        []
      );
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Date", ident("d"))] },
        { method: "then", args: [dIso] },
        { method: "else", args: [str("nope")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("instanceof Date");
    });

    it("GATE: Array(a) → Array.isArray()", () => {
      const { ctx, printExpr } = createTestContext();
      const aLen = f.createPropertyAccessExpression(ident("a"), "length");
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [ctorPat("Array", ident("a"))] },
        { method: "then", args: [aLen] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("Array.isArray");
    });

    it("GATE: .case(200).or(201).or(204) → OR chain", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("s"),
        { method: "case", args: [num(200)] },
        { method: "or", args: [num(201)] },
        { method: "or", args: [num(204)] },
        { method: "then", args: [str("ok")] },
        { method: "else", args: [str("error")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("||");
      expect(text).toContain("=== 200");
      expect(text).toContain("=== 201");
      expect(text).toContain("=== 204");
    });

    it("GATE: .case([x, y]).as(p) → binds both p and x, y", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("val"),
        { method: "case", args: [arr(ident("x"), ident("y"))] },
        { method: "as", args: [ident("p")] },
        { method: "then", args: [ident("p")] },
        { method: "else", args: [str("no")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("const p =");
      expect(text).toContain("const x =");
      expect(text).toContain("const y =");
    });

    it("GATE: .case(/regex/).as([_, user, domain]) → extracts captures", () => {
      const { ctx, printExpr } = createTestContext();
      const resultExpr = obj(prop("user", ident("user")), prop("domain", ident("domain")));
      const { outermost, rootArgs } = buildChain(
        ident("email"),
        {
          method: "case",
          args: [regex("/^(\\w+)@(\\w+)$/")],
        },
        {
          method: "as",
          args: [arr(ident("_"), ident("user"), ident("domain"))],
        },
        { method: "then", args: [resultExpr] },
        { method: "else", args: [str("invalid")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".match(");
      expect(text).toContain("!== null");
      expect(text).toContain("const user =");
      expect(text).toContain("const domain =");
    });
  });
});
