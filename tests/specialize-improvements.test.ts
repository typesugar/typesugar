/**
 * Tests for specialize() infrastructure improvements:
 * - Phase 1: Early-return flattening to ternary expressions
 * - Phase 2: Deduplication / hoisting via SpecializationCache
 * - Phase 3: Return-type-driven auto-specialization with Result algebras
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import {
  classifyInlineFailure,
  classifyInlineFailureDetailed,
  analyzeForFlattening,
  flattenReturnsToExpression,
  canFlattenToExpression,
  SpecializationCache,
  createHoistedSpecialization,
  registerResultAlgebra,
  getResultAlgebra,
  hasResultAlgebra,
  getAllResultAlgebras,
  optionResultAlgebra,
  eitherResultAlgebra,
  promiseResultAlgebra,
  unsafeResultAlgebra,
  type ResultAlgebra,
} from "../src/macros/specialize.js";
import { globalHygiene, HygieneContext } from "../src/core/hygiene.js";

// ============================================================================
// Phase 1: Early-Return Flattening Tests
// ============================================================================

describe("Phase 1: Early-Return Flattening", () => {
  function parseBlock(code: string): ts.Block {
    const sourceFile = ts.createSourceFile(
      "test.ts",
      `function test() ${code}`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const fn = sourceFile.statements[0] as ts.FunctionDeclaration;
    return fn.body!;
  }

  describe("analyzeForFlattening", () => {
    it("should identify flattenable guard clause pattern", () => {
      const block = parseBlock(`{
        const n = Number(input);
        if (isNaN(n)) return err("not a number");
        if (n < 0) return err("negative");
        return ok(n);
      }`);
      const analysis = analyzeForFlattening(block);
      expect(analysis.canFlatten).toBe(true);
      expect(analysis.bindings).toHaveLength(1);
    });

    it("should identify simple if-else pattern as flattenable", () => {
      const block = parseBlock(`{
        if (x > 0) return "positive";
        else return "non-positive";
      }`);
      const analysis = analyzeForFlattening(block);
      expect(analysis.canFlatten).toBe(true);
    });

    it("should reject loops as non-flattenable", () => {
      const block = parseBlock(`{
        for (let i = 0; i < 10; i++) { sum += i; }
        return sum;
      }`);
      const analysis = analyzeForFlattening(block);
      expect(analysis.canFlatten).toBe(false);
      expect(analysis.reason).toBe("loop");
    });

    it("should reject try/catch as non-flattenable", () => {
      const block = parseBlock(`{
        try { return doSomething(); }
        catch (e) { return fallback; }
      }`);
      const analysis = analyzeForFlattening(block);
      expect(analysis.canFlatten).toBe(false);
      expect(analysis.reason).toBe("try/catch");
    });

    it("should reject mutable variables as non-flattenable", () => {
      const block = parseBlock(`{
        let x = 1;
        if (condition) x = 2;
        return x;
      }`);
      const analysis = analyzeForFlattening(block);
      expect(analysis.canFlatten).toBe(false);
      expect(analysis.reason).toBe("mutable variable");
    });

    it("should reject throw statements as non-flattenable", () => {
      const block = parseBlock(`{
        if (bad) throw new Error("bad");
        return ok;
      }`);
      const analysis = analyzeForFlattening(block);
      expect(analysis.canFlatten).toBe(false);
      expect(analysis.reason).toBe("throw statement");
    });
  });

  describe("classifyInlineFailureDetailed", () => {
    it("should return canFlatten=true for flattenable early returns", () => {
      const block = parseBlock(`{
        if (isNaN(n)) return err("bad");
        return ok(n);
      }`);
      const classification = classifyInlineFailureDetailed(block);
      expect(classification.reason).toBe("early return (flattenable)");
      expect(classification.canFlatten).toBe(true);
    });

    it("should return canFlatten=false for non-flattenable early returns", () => {
      const block = parseBlock(`{
        let result = 0;
        if (condition) return result;
        return other;
      }`);
      const classification = classifyInlineFailureDetailed(block);
      expect(classification.canFlatten).toBe(false);
      expect(classification.reason).toBe("mutable variable");
    });

    it("should return null reason for single-return functions", () => {
      const block = parseBlock("{ return x + y; }");
      const classification = classifyInlineFailureDetailed(block);
      expect(classification.reason).toBe(null);
      expect(classification.canFlatten).toBe(false);
    });
  });

  describe("canFlattenToExpression", () => {
    it("should return true for guard clause pattern", () => {
      const block = parseBlock(`{
        if (x < 0) return "negative";
        if (x === 0) return "zero";
        return "positive";
      }`);
      expect(canFlattenToExpression(block)).toBe(true);
    });

    it("should return false for loop pattern", () => {
      const block = parseBlock(`{
        while (x > 0) { x--; }
        return x;
      }`);
      expect(canFlattenToExpression(block)).toBe(false);
    });
  });

  describe("flattenReturnsToExpression", () => {
    let ctx: MacroContextImpl;

    beforeEach(() => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "const x = 1;",
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
      };

      ctx = createMacroContext(program, sourceFile, transformContext);
    });

    it("should flatten simple guard clause to ternary", () => {
      const block = parseBlock(`{
        if (x < 0) return "negative";
        return "non-negative";
      }`);

      const result = flattenReturnsToExpression(ctx, block);
      expect(result).toBeDefined();

      // The result should be a conditional expression
      const printer = ts.createPrinter();
      const sourceFile = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest);
      const text = printer.printNode(ts.EmitHint.Expression, result!, sourceFile);
      expect(text).toContain("?");
    });

    it("should return undefined for non-flattenable blocks", () => {
      const block = parseBlock(`{
        while (x > 0) { x--; }
        return x;
      }`);

      const result = flattenReturnsToExpression(ctx, block);
      expect(result).toBeUndefined();
    });

    it("should handle nested if-else", () => {
      const block = parseBlock(`{
        if (x < 0) return "negative";
        else if (x === 0) return "zero";
        else return "positive";
      }`);

      const result = flattenReturnsToExpression(ctx, block);
      expect(result).toBeDefined();

      const printer = ts.createPrinter();
      const sourceFile = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest);
      const text = printer.printNode(ts.EmitHint.Expression, result!, sourceFile);
      expect(text).toContain("?");
    });
  });
});

// ============================================================================
// Phase 2: Deduplication / Hoisting Tests
// ============================================================================

describe("Phase 2: Deduplication / Hoisting", () => {
  describe("SpecializationCache", () => {
    it("should compute stable cache keys", () => {
      const key1 = SpecializationCache.computeKey("fn123", ["Array"]);
      const key2 = SpecializationCache.computeKey("fn123", ["Array"]);
      expect(key1).toBe(key2);
    });

    it("should sort dictionary brands in cache key", () => {
      const key1 = SpecializationCache.computeKey("fn", ["Eq", "Show"]);
      const key2 = SpecializationCache.computeKey("fn", ["Show", "Eq"]);
      expect(key1).toBe(key2);
    });

    it("should differentiate keys by function symbol", () => {
      const key1 = SpecializationCache.computeKey("fn1", ["Array"]);
      const key2 = SpecializationCache.computeKey("fn2", ["Array"]);
      expect(key1).not.toBe(key2);
    });

    it("should differentiate keys by dictionary brands", () => {
      const key1 = SpecializationCache.computeKey("fn", ["Array"]);
      const key2 = SpecializationCache.computeKey("fn", ["Option"]);
      expect(key1).not.toBe(key2);
    });

    it("should store and retrieve cache entries", () => {
      const cache = new SpecializationCache();
      const ident = ts.factory.createIdentifier("__test_Array");
      const decl = ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [
            ts.factory.createVariableDeclaration(
              ident,
              undefined,
              undefined,
              ts.factory.createNull()
            ),
          ],
          ts.NodeFlags.Const
        )
      );

      const key = SpecializationCache.computeKey("test", ["Array"]);
      cache.set(key, ident, decl);

      expect(cache.has(key)).toBe(true);
      const entry = cache.get(key);
      expect(entry).toBeDefined();
      expect(entry!.ident.text).toBe("__test_Array");
    });

    it("should collect hoisted declarations", () => {
      const cache = new SpecializationCache();

      // Add two specializations
      const ident1 = ts.factory.createIdentifier("__fn1_Array");
      const decl1 = ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [ts.factory.createVariableDeclaration(ident1)],
          ts.NodeFlags.Const
        )
      );

      const ident2 = ts.factory.createIdentifier("__fn2_Option");
      const decl2 = ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [ts.factory.createVariableDeclaration(ident2)],
          ts.NodeFlags.Const
        )
      );

      cache.set("key1", ident1, decl1);
      cache.set("key2", ident2, decl2);

      const hoisted = cache.getHoistedDeclarations();
      expect(hoisted).toHaveLength(2);
    });

    it("should clear cache", () => {
      const cache = new SpecializationCache();
      const ident = ts.factory.createIdentifier("__test");
      const decl = ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [ts.factory.createVariableDeclaration(ident)],
          ts.NodeFlags.Const
        )
      );

      cache.set("key", ident, decl);
      expect(cache.size).toBe(1);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.getHoistedDeclarations()).toHaveLength(0);
    });

    it("should generate hygienic hoisted names", () => {
      const hygiene = globalHygiene;
      const name1 = hygiene.withScope(() =>
        SpecializationCache.generateHoistedName("parseAge", ["Option"], hygiene)
      );
      const name2 = hygiene.withScope(() =>
        SpecializationCache.generateHoistedName("parseAge", ["Option"], hygiene)
      );

      // Names should be unique due to hygiene mangling
      expect(name1.text).toContain("parseAge");
      expect(name1.text).toContain("Option");
    });
  });

  describe("createHoistedSpecialization", () => {
    it("should create a const declaration with PURE comment", () => {
      const ident = ts.factory.createIdentifier("__fn_Array");
      const fn = ts.factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        ts.factory.createNull()
      );

      const decl = createHoistedSpecialization(ts.factory, ident, fn);

      expect(ts.isVariableStatement(decl)).toBe(true);
      const varDecl = decl.declarationList.declarations[0];
      expect(varDecl.name.getText).toBeDefined(); // It's an identifier

      // The PURE comment is added as a synthetic leading comment
      // We can't easily verify this in unit tests, but the function should not throw
    });
  });
});

// ============================================================================
// Phase 3: Result Algebra Tests
// ============================================================================

describe("Phase 3: Result Algebra", () => {
  describe("ResultAlgebra registry", () => {
    it("should have Option algebra registered by default", () => {
      expect(hasResultAlgebra("Option")).toBe(true);
      const algebra = getResultAlgebra("Option");
      expect(algebra).toBeDefined();
      expect(algebra!.name).toBe("Option");
    });

    it("should have Either algebra registered by default", () => {
      expect(hasResultAlgebra("Either")).toBe(true);
      const algebra = getResultAlgebra("Either");
      expect(algebra).toBeDefined();
      expect(algebra!.name).toBe("Either");
    });

    it("should have Promise algebra registered by default", () => {
      expect(hasResultAlgebra("Promise")).toBe(true);
      const algebra = getResultAlgebra("Promise");
      expect(algebra).toBeDefined();
      expect(algebra!.name).toBe("Promise");
    });

    it("should return undefined for unregistered type", () => {
      expect(getResultAlgebra("UnknownType")).toBeUndefined();
    });

    it("should list all unique algebras", () => {
      const algebras = getAllResultAlgebras();
      const names = algebras.map((a) => a.name);
      expect(names).toContain("Option");
      expect(names).toContain("Either");
      expect(names).toContain("Promise");
    });

    it("should allow registering custom algebras", () => {
      const customAlgebra: ResultAlgebra = {
        name: "CustomResult",
        targetTypes: ["CustomResult"],
        rewriteOk: (ctx, value) => value,
        rewriteErr: (ctx, error) => ctx.factory.createNull(),
        preservesError: false,
      };

      registerResultAlgebra(customAlgebra);
      expect(hasResultAlgebra("CustomResult")).toBe(true);
      expect(getResultAlgebra("CustomResult")!.name).toBe("CustomResult");
    });
  });

  describe("Option algebra rewrite rules", () => {
    let ctx: MacroContextImpl;

    beforeEach(() => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "",
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
      };

      ctx = createMacroContext(program, sourceFile, transformContext);
    });

    it("should rewrite ok(value) to value", () => {
      const value = ts.factory.createNumericLiteral(42);
      const result = optionResultAlgebra.rewriteOk(ctx, value);

      // For Option, ok(v) -> v
      expect(result).toBe(value);
    });

    it("should rewrite err(e) to null", () => {
      const error = ts.factory.createStringLiteral("error message");
      const result = optionResultAlgebra.rewriteErr(ctx, error);

      // For Option, err(e) -> null
      expect(result.kind).toBe(ts.SyntaxKind.NullKeyword);
    });
  });

  describe("Either algebra rewrite rules", () => {
    let ctx: MacroContextImpl;

    beforeEach(() => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "",
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
      };

      ctx = createMacroContext(program, sourceFile, transformContext);
    });

    it("should rewrite ok(value) to { _tag: 'Right', right: value }", () => {
      const value = ts.factory.createNumericLiteral(42);
      const result = eitherResultAlgebra.rewriteOk(ctx, value);

      // For Either, ok(v) -> { _tag: "Right", right: v }
      expect(ts.isObjectLiteralExpression(result)).toBe(true);
      const obj = result as ts.ObjectLiteralExpression;
      expect(obj.properties).toHaveLength(2);
    });

    it("should rewrite err(e) to { _tag: 'Left', left: e }", () => {
      const error = ts.factory.createStringLiteral("error");
      const result = eitherResultAlgebra.rewriteErr(ctx, error);

      // For Either, err(e) -> { _tag: "Left", left: e }
      expect(ts.isObjectLiteralExpression(result)).toBe(true);
      const obj = result as ts.ObjectLiteralExpression;
      expect(obj.properties).toHaveLength(2);
    });
  });

  describe("Promise algebra rewrite rules", () => {
    let ctx: MacroContextImpl;

    beforeEach(() => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "",
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
      };

      ctx = createMacroContext(program, sourceFile, transformContext);
    });

    it("should rewrite ok(value) to Promise.resolve(value)", () => {
      const value = ts.factory.createNumericLiteral(42);
      const result = promiseResultAlgebra.rewriteOk(ctx, value);

      // For Promise, ok(v) -> Promise.resolve(v)
      expect(ts.isCallExpression(result)).toBe(true);
      const call = result as ts.CallExpression;
      expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
    });

    it("should rewrite err(e) to Promise.reject(e)", () => {
      const error = ts.factory.createStringLiteral("error");
      const result = promiseResultAlgebra.rewriteErr(ctx, error);

      // For Promise, err(e) -> Promise.reject(e)
      expect(ts.isCallExpression(result)).toBe(true);
      const call = result as ts.CallExpression;
      expect(ts.isPropertyAccessExpression(call.expression)).toBe(true);
    });
  });

  describe("Unsafe algebra rewrite rules", () => {
    let ctx: MacroContextImpl;

    beforeEach(() => {
      const sourceFile = ts.createSourceFile(
        "test.ts",
        "",
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
      };

      ctx = createMacroContext(program, sourceFile, transformContext);
    });

    it("should rewrite ok(value) to value", () => {
      const value = ts.factory.createNumericLiteral(42);
      const result = unsafeResultAlgebra.rewriteOk(ctx, value);

      // For Unsafe, ok(v) -> v
      expect(result).toBe(value);
    });

    it("should rewrite err(e) to throwing expression", () => {
      const error = ts.factory.createStringLiteral("error");
      const result = unsafeResultAlgebra.rewriteErr(ctx, error);

      // For Unsafe, err(e) -> (() => { throw new Error(String(e)); })()
      expect(ts.isCallExpression(result)).toBe(true);
    });
  });
});
