/**
 * Tests for conditional compilation macros (cfg, cfgAttr)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import { cfgMacro, setCfgConfig, evaluateCfgCondition } from "../src/macros/cfg.js";

describe("conditional compilation", () => {
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

  describe("evaluateCfgCondition", () => {
    beforeEach(() => {
      setCfgConfig({
        debug: true,
        production: false,
        platform: { node: true, browser: false },
        version: "2.0",
      });
    });

    it("should evaluate simple truthy conditions", () => {
      expect(evaluateCfgCondition("debug")).toBe(true);
      expect(evaluateCfgCondition("production")).toBe(false);
    });

    it("should evaluate negation", () => {
      expect(evaluateCfgCondition("!debug")).toBe(false);
      expect(evaluateCfgCondition("!production")).toBe(true);
    });

    it("should evaluate dotted paths", () => {
      expect(evaluateCfgCondition("platform.node")).toBe(true);
      expect(evaluateCfgCondition("platform.browser")).toBe(false);
    });

    it("should evaluate AND conditions", () => {
      expect(evaluateCfgCondition("debug && platform.node")).toBe(true);
      expect(evaluateCfgCondition("debug && production")).toBe(false);
    });

    it("should evaluate OR conditions", () => {
      expect(evaluateCfgCondition("debug || production")).toBe(true);
      expect(evaluateCfgCondition("production || platform.browser")).toBe(false);
    });

    it("should evaluate equality conditions", () => {
      expect(evaluateCfgCondition("version == '2.0'")).toBe(true);
      expect(evaluateCfgCondition("version == '1.0'")).toBe(false);
    });

    it("should evaluate inequality conditions", () => {
      expect(evaluateCfgCondition("version != '1.0'")).toBe(true);
      expect(evaluateCfgCondition("version != '2.0'")).toBe(false);
    });

    it("should evaluate complex conditions with parentheses", () => {
      expect(evaluateCfgCondition("(debug || production) && platform.node")).toBe(true);
      expect(evaluateCfgCondition("(production || platform.browser) && debug")).toBe(false);
    });

    it("should handle undefined keys as falsy", () => {
      expect(evaluateCfgCondition("nonexistent")).toBe(false);
      expect(evaluateCfgCondition("!nonexistent")).toBe(true);
    });
  });

  describe("cfg macro", () => {
    beforeEach(() => {
      setCfgConfig({ debug: true, production: false });
    });

    it("should include expression when condition is true", () => {
      const thenExpr = ts.factory.createNumericLiteral(42);
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("cfg"),
        undefined,
        [ts.factory.createStringLiteral("debug"), thenExpr]
      );

      const result = cfgMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("debug"),
        thenExpr,
      ]);

      expect(ts.isNumericLiteral(result)).toBe(true);
      expect((result as ts.NumericLiteral).text).toBe("42");
    });

    it("should return undefined when condition is false", () => {
      const thenExpr = ts.factory.createNumericLiteral(42);
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("cfg"),
        undefined,
        [ts.factory.createStringLiteral("production"), thenExpr]
      );

      const result = cfgMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("production"),
        thenExpr,
      ]);

      expect(ts.isIdentifier(result)).toBe(true);
      expect((result as ts.Identifier).text).toBe("undefined");
    });

    it("should use else branch when condition is false", () => {
      const thenExpr = ts.factory.createStringLiteral("debug mode");
      const elseExpr = ts.factory.createStringLiteral("production mode");
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("cfg"),
        undefined,
        [ts.factory.createStringLiteral("production"), thenExpr, elseExpr]
      );

      const result = cfgMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("production"),
        thenExpr,
        elseExpr,
      ]);

      expect(ts.isStringLiteral(result)).toBe(true);
      expect((result as ts.StringLiteral).text).toBe("production mode");
    });
  });
});
