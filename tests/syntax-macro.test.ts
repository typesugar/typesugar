/**
 * Tests for pattern-based / declarative macros
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import { globalRegistry } from "../src/core/registry.js";
import { defineSyntaxMacro, defineRewrite } from "../src/macros/syntax-macro.js";

describe("pattern-based / declarative macros", () => {
  let ctx: MacroContextImpl;
  let printer: ts.Printer;

  function printExpr(node: ts.Expression): string {
    return printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile);
  }

  beforeEach(() => {
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
