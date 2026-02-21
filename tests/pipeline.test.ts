/**
 * Tests for the macro composition pipeline
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import { pipeline, parenthesize, voidify, awaitify } from "../src/core/pipeline.js";

describe("macro composition pipeline", () => {
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

  describe("pipeline builder", () => {
    it("should create a pipeline with steps", () => {
      const p = pipeline("test").pipe(parenthesize).pipe(voidify);

      const input = ts.factory.createNumericLiteral(42);
      const result = p.execute(ctx, input);

      const text = printExpr(result);
      expect(text).toBe("void (42)");
    });

    it("should chain multiple transformations", () => {
      const p = pipeline("test")
        .pipe((_ctx, expr) => {
          // Wrap in array
          return ts.factory.createArrayLiteralExpression([expr]);
        })
        .pipe((_ctx, expr) => {
          // Access [0]
          return ts.factory.createElementAccessExpression(expr, 0);
        });

      const input = ts.factory.createStringLiteral("hello");
      const result = p.execute(ctx, input);

      const text = printExpr(result);
      expect(text).toBe('["hello"][0]');
    });

    it("should support conditional steps", () => {
      const p = pipeline("test").pipeIf(
        (_ctx, expr) => ts.isNumericLiteral(expr),
        (_ctx, expr) => {
          // Double the number
          return ts.factory.createBinaryExpression(
            expr,
            ts.SyntaxKind.AsteriskToken,
            ts.factory.createNumericLiteral(2)
          );
        }
      );

      // Numeric input — should be doubled
      const numResult = p.execute(ctx, ts.factory.createNumericLiteral(5));
      expect(printExpr(numResult)).toBe("5 * 2");

      // String input — should pass through unchanged
      const strResult = p.execute(ctx, ts.factory.createStringLiteral("hi"));
      expect(printExpr(strResult)).toBe('"hi"');
    });

    it("should support mapElements for arrays", () => {
      const p = pipeline("test").mapElements((_ctx, expr) => {
        return ts.factory.createBinaryExpression(
          expr,
          ts.SyntaxKind.PlusToken,
          ts.factory.createNumericLiteral(1)
        );
      });

      const input = ts.factory.createArrayLiteralExpression([
        ts.factory.createNumericLiteral(1),
        ts.factory.createNumericLiteral(2),
        ts.factory.createNumericLiteral(3),
      ]);

      const result = p.execute(ctx, input);
      const text = printExpr(result);
      expect(text).toContain("1 + 1");
      expect(text).toContain("2 + 1");
      expect(text).toContain("3 + 1");
    });
  });

  describe("utility steps", () => {
    it("parenthesize should wrap in parens", () => {
      const input = ts.factory.createBinaryExpression(
        ts.factory.createNumericLiteral(1),
        ts.SyntaxKind.PlusToken,
        ts.factory.createNumericLiteral(2)
      );
      const result = parenthesize(ctx, input);
      expect(printExpr(result)).toBe("(1 + 2)");
    });

    it("voidify should wrap in void", () => {
      const input = ts.factory.createNumericLiteral(0);
      const result = voidify(ctx, input);
      expect(printExpr(result)).toBe("void 0");
    });

    it("awaitify should wrap in await", () => {
      const input = ts.factory.createIdentifier("promise");
      const result = awaitify(ctx, input);
      expect(printExpr(result)).toBe("await promise");
    });
  });
});
