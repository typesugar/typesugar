/**
 * Tests for the comptime macro
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";

describe("comptime macro - compile-time evaluation", () => {
  let ctx: MacroContextImpl;

  beforeEach(() => {
    // Create a minimal context for testing
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

    ctx = createMacroContext(program, sourceFile, transformContext);
  });

  describe("literal evaluation", () => {
    it("should evaluate numeric literals", () => {
      const node = ts.factory.createNumericLiteral(42);
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 42 });
    });

    it("should evaluate string literals", () => {
      const node = ts.factory.createStringLiteral("hello");
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "string", value: "hello" });
    });

    it("should evaluate boolean literals", () => {
      const trueNode = ts.factory.createTrue();
      const falseNode = ts.factory.createFalse();

      expect(ctx.evaluate(trueNode)).toEqual({ kind: "boolean", value: true });
      expect(ctx.evaluate(falseNode)).toEqual({
        kind: "boolean",
        value: false,
      });
    });

    it("should evaluate null and undefined", () => {
      const nullNode = ts.factory.createNull();
      expect(ctx.evaluate(nullNode)).toEqual({ kind: "null" });
    });
  });

  describe("arithmetic operations", () => {
    it("should evaluate addition", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(5),
        ts.SyntaxKind.PlusToken,
        ts.factory.createNumericLiteral(3)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 8 });
    });

    it("should evaluate subtraction", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(10),
        ts.SyntaxKind.MinusToken,
        ts.factory.createNumericLiteral(4)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 6 });
    });

    it("should evaluate multiplication", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(6),
        ts.SyntaxKind.AsteriskToken,
        ts.factory.createNumericLiteral(7)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 42 });
    });

    it("should evaluate division", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(20),
        ts.SyntaxKind.SlashToken,
        ts.factory.createNumericLiteral(4)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 5 });
    });

    it("should evaluate modulo", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(17),
        ts.SyntaxKind.PercentToken,
        ts.factory.createNumericLiteral(5)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 2 });
    });

    it("should evaluate exponentiation", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(2),
        ts.SyntaxKind.AsteriskAsteriskToken,
        ts.factory.createNumericLiteral(10)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 1024 });
    });
  });

  describe("comparison operations", () => {
    it("should evaluate less than", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(3),
        ts.SyntaxKind.LessThanToken,
        ts.factory.createNumericLiteral(5)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "boolean", value: true });
    });

    it("should evaluate equality", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(5),
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.factory.createNumericLiteral(5)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "boolean", value: true });
    });
  });

  describe("string operations", () => {
    it("should evaluate string concatenation", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createStringLiteral("hello"),
        ts.SyntaxKind.PlusToken,
        ts.factory.createStringLiteral(" world")
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "string", value: "hello world" });
    });

    it("should evaluate string + number concatenation", () => {
      const node = ts.factory.createBinaryExpression(
        ts.factory.createStringLiteral("value: "),
        ts.SyntaxKind.PlusToken,
        ts.factory.createNumericLiteral(42)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "string", value: "value: 42" });
    });
  });

  describe("array operations", () => {
    it("should evaluate array literals", () => {
      const node = ts.factory.createArrayLiteralExpression([
        ts.factory.createNumericLiteral(1),
        ts.factory.createNumericLiteral(2),
        ts.factory.createNumericLiteral(3),
      ]);
      const result = ctx.evaluate(node);
      expect(result).toEqual({
        kind: "array",
        elements: [
          { kind: "number", value: 1 },
          { kind: "number", value: 2 },
          { kind: "number", value: 3 },
        ],
      });
    });
  });

  describe("object operations", () => {
    it("should evaluate object literals", () => {
      const node = ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment("x", ts.factory.createNumericLiteral(1)),
        ts.factory.createPropertyAssignment("y", ts.factory.createNumericLiteral(2)),
      ]);
      const result = ctx.evaluate(node);
      expect(result.kind).toBe("object");
      if (result.kind === "object") {
        expect(result.properties.get("x")).toEqual({
          kind: "number",
          value: 1,
        });
        expect(result.properties.get("y")).toEqual({
          kind: "number",
          value: 2,
        });
      }
    });
  });

  describe("unary operations", () => {
    it("should evaluate negation", () => {
      const node = ts.factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        ts.factory.createNumericLiteral(5)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: -5 });
    });

    it("should evaluate logical not", () => {
      const node = ts.factory.createPrefixUnaryExpression(
        ts.SyntaxKind.ExclamationToken,
        ts.factory.createTrue()
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "boolean", value: false });
    });
  });

  describe("conditional expressions", () => {
    it("should evaluate ternary expressions (true branch)", () => {
      const node = ts.factory.createConditionalExpression(
        ts.factory.createTrue(),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        ts.factory.createNumericLiteral(1),
        ts.factory.createToken(ts.SyntaxKind.ColonToken),
        ts.factory.createNumericLiteral(2)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 1 });
    });

    it("should evaluate ternary expressions (false branch)", () => {
      const node = ts.factory.createConditionalExpression(
        ts.factory.createFalse(),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        ts.factory.createNumericLiteral(1),
        ts.factory.createToken(ts.SyntaxKind.ColonToken),
        ts.factory.createNumericLiteral(2)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 2 });
    });
  });

  describe("complex expressions", () => {
    it("should evaluate nested arithmetic", () => {
      // (2 + 3) * 4
      const node = ts.factory.createBinaryExpression(
        ts.factory.createParenthesizedExpression(
          ts.factory.createBinaryExpression(
            ts.factory.createNumericLiteral(2),
            ts.SyntaxKind.PlusToken,
            ts.factory.createNumericLiteral(3)
          )
        ),
        ts.SyntaxKind.AsteriskToken,
        ts.factory.createNumericLiteral(4)
      );
      const result = ctx.evaluate(node);
      expect(result).toEqual({ kind: "number", value: 20 });
    });
  });
});

describe("MacroContext utilities", () => {
  let ctx: MacroContextImpl;

  beforeEach(() => {
    const sourceFile = ts.createSourceFile(
      "test.ts",
      "",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const options: ts.CompilerOptions = {};
    const host = ts.createCompilerHost(options);
    const program = ts.createProgram([], options, host);

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

    ctx = createMacroContext(program, sourceFile, transformContext);
  });

  it("should create identifiers", () => {
    const id = ctx.createIdentifier("test");
    expect(ts.isIdentifier(id)).toBe(true);
    expect(id.text).toBe("test");
  });

  it("should create numeric literals", () => {
    const num = ctx.createNumericLiteral(42);
    expect(ts.isNumericLiteral(num)).toBe(true);
    expect(num.text).toBe("42");
  });

  it("should create string literals", () => {
    const str = ctx.createStringLiteral("hello");
    expect(ts.isStringLiteral(str)).toBe(true);
    expect(str.text).toBe("hello");
  });

  it("should create array literals", () => {
    const arr = ctx.createArrayLiteral([ctx.createNumericLiteral(1), ctx.createNumericLiteral(2)]);
    expect(ts.isArrayLiteralExpression(arr)).toBe(true);
    expect(arr.elements.length).toBe(2);
  });

  it("should create object literals", () => {
    const obj = ctx.createObjectLiteral([
      { name: "x", value: ctx.createNumericLiteral(1) },
      { name: "y", value: ctx.createNumericLiteral(2) },
    ]);
    expect(ts.isObjectLiteralExpression(obj)).toBe(true);
    expect(obj.properties.length).toBe(2);
  });

  it("should generate unique names", () => {
    const name1 = ctx.generateUniqueName("test");
    const name2 = ctx.generateUniqueName("test");
    expect(name1.text).not.toBe(name2.text);
    expect(name1.text).toContain("test");
    expect(name2.text).toContain("test");
  });

  it("should convert comptime values to expressions", () => {
    const numExpr = ctx.comptimeValueToExpression({
      kind: "number",
      value: 42,
    });
    expect(ts.isNumericLiteral(numExpr)).toBe(true);

    const strExpr = ctx.comptimeValueToExpression({
      kind: "string",
      value: "hello",
    });
    expect(ts.isStringLiteral(strExpr)).toBe(true);

    const boolExpr = ctx.comptimeValueToExpression({
      kind: "boolean",
      value: true,
    });
    expect(boolExpr.kind).toBe(ts.SyntaxKind.TrueKeyword);

    const arrExpr = ctx.comptimeValueToExpression({
      kind: "array",
      elements: [{ kind: "number", value: 1 }],
    });
    expect(ts.isArrayLiteralExpression(arrExpr)).toBe(true);
  });
});
