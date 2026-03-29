/**
 * Tests for pattern-based / declarative macros
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import { globalRegistry } from "@typesugar/core";
import { defineSyntaxMacro, defineRewrite } from "@typesugar/macros";

describe("pattern-based / declarative macros", () => {
  let ctx: MacroContextImpl;
  let printer: ts.Printer;

  function printExpr(node: ts.Expression): string {
    return printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile);
  }

  beforeAll(() => {
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
    printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  });

  describe("defineSyntaxMacro", () => {
    it("should define a single-arm syntax macro", () => {
      const macro = defineSyntaxMacro("double", {
        pattern: "double($x:expr)",
        expand: "($x) * 2",
      });

      expect(macro.kind).toBe("expression");
      expect(macro.name).toBe("double");
    });

    it("should expand a single-arm macro", () => {
      const macro = defineSyntaxMacro("triple_test", {
        pattern: "triple_test($x:expr)",
        expand: "($x) * 3",
      });

      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("triple_test"),
        undefined,
        [ts.factory.createNumericLiteral(5)]
      );

      const result = macro.expand(ctx, callExpr, [ts.factory.createNumericLiteral(5)]);

      const text = printExpr(result);
      expect(text).toContain("5");
      expect(text).toContain("3");
    });

    it("should expand a multi-arm macro", () => {
      const macro = defineSyntaxMacro("multi_test", {
        arms: [
          {
            pattern: "multi_test($x:ident)",
            expand: "$x.toString()",
          },
          {
            pattern: "multi_test($x:expr)",
            expand: "String($x)",
          },
        ],
      });

      // Test with identifier — should match first arm
      const idResult = macro.expand(
        ctx,
        ts.factory.createCallExpression(ts.factory.createIdentifier("multi_test"), undefined, [
          ts.factory.createIdentifier("foo"),
        ]),
        [ts.factory.createIdentifier("foo")]
      );

      expect(printExpr(idResult)).toContain("toString");
    });

    it("should correctly expand captures containing > characters", () => {
      const macro = defineSyntaxMacro("check_gt", {
        pattern: "check_gt($cond:expr)",
        expand: "($cond) ? 1 : 0",
      });

      // Build: a > b ? c : d  as the argument (a conditional with > comparison)
      const arg = ts.factory.createConditionalExpression(
        ts.factory.createBinaryExpression(
          ts.factory.createIdentifier("a"),
          ts.SyntaxKind.GreaterThanToken,
          ts.factory.createIdentifier("b")
        ),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        ts.factory.createIdentifier("c"),
        ts.factory.createToken(ts.SyntaxKind.ColonToken),
        ts.factory.createIdentifier("d")
      );

      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("check_gt"),
        undefined,
        [arg]
      );

      const result = macro.expand(ctx, callExpr, [arg]);
      const text = printExpr(result);
      // The expansion should contain the > operator and ternary structure
      expect(text).toContain(">");
      expect(text).toContain("a");
      expect(text).toContain("b");
    });

    it("should reject stmts captures in expression position", () => {
      const macro = defineSyntaxMacro("stmts_test", {
        arms: [
          {
            pattern: "stmts_test($s:stmts)",
            expand: "$s",
          },
        ],
      });

      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("stmts_test"),
        undefined,
        [ts.factory.createIdentifier("foo")]
      );

      // Should fall through to "no arm matched" since stmts rejects in expr position.
      // The macro returns the original callExpr when no arm matches.
      const result = macro.expand(ctx, callExpr, [ts.factory.createIdentifier("foo")]);
      // Result should be the original call expression (no arm matched)
      expect(result).toBe(callExpr);
    });

    it("should return captured node directly for single-capture templates", () => {
      const macro = defineSyntaxMacro("identity_test", {
        pattern: "identity_test($x:expr)",
        expand: "$x",
      });

      const arg = ts.factory.createNumericLiteral(42);
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("identity_test"),
        undefined,
        [arg]
      );

      const result = macro.expand(ctx, callExpr, [arg]);
      // When template is just "$x", the node should be returned directly
      expect(result).toBe(arg);
    });
  });

  describe("defineRewrite", () => {
    it("should define a simple rewrite macro", () => {
      const macro = defineRewrite("negate_test", "negate_test($x:expr)", "!($x)");

      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("negate_test"),
        undefined,
        [ts.factory.createTrue()]
      );

      const result = macro.expand(ctx, callExpr, [ts.factory.createTrue()]);
      const text = printExpr(result);
      expect(text).toContain("!");
      expect(text).toContain("true");
    });
  });
});
