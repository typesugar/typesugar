/**
 * Tests for staticAssert, compileError, compileWarning macros
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import {
  staticAssertMacro,
  compileErrorMacro,
  compileWarningMacro,
} from "../src/macros/static-assert.js";

describe("static assertion and diagnostic macros", () => {
  let ctx: MacroContextImpl;

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
  });

  describe("staticAssert", () => {
    it("should pass when condition is true", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("staticAssert"),
        undefined,
        [ts.factory.createTrue()]
      );

      const result = staticAssertMacro.expand(ctx, callExpr, [ts.factory.createTrue()]);

      // Should produce `undefined` (assertion removed)
      expect(ts.isIdentifier(result)).toBe(true);
      expect((result as ts.Identifier).text).toBe("undefined");

      // No errors
      expect(ctx.getDiagnostics()).toHaveLength(0);
    });

    it("should report error when condition is false", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("staticAssert"),
        undefined,
        [ts.factory.createFalse(), ts.factory.createStringLiteral("must be true")]
      );

      staticAssertMacro.expand(ctx, callExpr, [
        ts.factory.createFalse(),
        ts.factory.createStringLiteral("must be true"),
      ]);

      const diags = ctx.getDiagnostics();
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain("must be true");
    });

    it("should evaluate numeric conditions", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("staticAssert"),
        undefined,
        [ts.factory.createNumericLiteral(0)]
      );

      staticAssertMacro.expand(ctx, callExpr, [ts.factory.createNumericLiteral(0)]);

      const diags = ctx.getDiagnostics();
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain("staticAssert");
    });

    it("should pass for truthy numeric conditions", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("staticAssert"),
        undefined,
        [ts.factory.createNumericLiteral(42)]
      );

      staticAssertMacro.expand(ctx, callExpr, [ts.factory.createNumericLiteral(42)]);

      expect(ctx.getDiagnostics()).toHaveLength(0);
    });
  });

  describe("compileError", () => {
    it("should emit an error with the given message", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("compileError"),
        undefined,
        [ts.factory.createStringLiteral("something went wrong")]
      );

      compileErrorMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("something went wrong"),
      ]);

      const diags = ctx.getDiagnostics();
      expect(diags.length).toBe(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toBe("something went wrong");
    });
  });

  describe("compileWarning", () => {
    it("should emit a warning with the given message", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("compileWarning"),
        undefined,
        [ts.factory.createStringLiteral("deprecated API")]
      );

      compileWarningMacro.expand(ctx, callExpr, [ts.factory.createStringLiteral("deprecated API")]);

      const diags = ctx.getDiagnostics();
      expect(diags.length).toBe(1);
      expect(diags[0].severity).toBe("warning");
      expect(diags[0].message).toBe("deprecated API");
    });
  });
});
