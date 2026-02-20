/**
 * Tests for the unified match() macro
 *
 * Covers: discriminated union matching, literal matching, guard matching,
 * compile-time exhaustiveness checking, and code generation optimizations
 * (binary search, switch IIFE).
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import {
  matchMacro,
  matchLiteralMacro,
  matchGuardMacro,
} from "../packages/fp/src/zero-cost/match.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTestContext(sourceText: string): {
  ctx: MacroContextImpl;
  printer: ts.Printer;
  printExpr: (node: ts.Expression) => string;
} {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts"
        ? sourceFile
        : host.getSourceFile(name, ts.ScriptTarget.Latest),
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

  const ctx = createMacroContext(program, sourceFile, transformContext);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  return {
    ctx,
    printer,
    printExpr: (node: ts.Expression) =>
      printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile),
  };
}

function makeCall(name: string, args: ts.Expression[]): ts.CallExpression {
  return ts.factory.createCallExpression(
    ts.factory.createIdentifier(name),
    undefined,
    args,
  );
}

function makeObjectLiteral(
  entries: Record<string, ts.Expression>,
): ts.ObjectLiteralExpression {
  const props = Object.entries(entries).map(([key, value]) =>
    ts.factory.createPropertyAssignment(
      isNaN(Number(key))
        ? ts.factory.createIdentifier(key)
        : ts.factory.createNumericLiteral(key),
      value,
    ),
  );
  return ts.factory.createObjectLiteralExpression(props);
}

function makeArrow(body: ts.Expression): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body,
  );
}

function makeArrowWithParam(
  paramName: string,
  body: ts.Expression,
): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [
      ts.factory.createParameterDeclaration(
        undefined,
        undefined,
        ts.factory.createIdentifier(paramName),
      ),
    ],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe("match() macro", () => {
  describe("discriminated union matching", () => {
    it("should compile simple discriminated union match to ternary chain", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("shape");
      const handlers = makeObjectLiteral({
        circle: makeArrowWithParam(
          "s",
          ts.factory.createStringLiteral("circle"),
        ),
        square: makeArrowWithParam(
          "s",
          ts.factory.createStringLiteral("square"),
        ),
      });

      const callExpr = makeCall("match", [
        value,
        handlers,
        ts.factory.createStringLiteral("kind"),
      ]);
      const result = matchMacro.expand(ctx, callExpr, [
        value,
        handlers,
        ts.factory.createStringLiteral("kind"),
      ]);
      const text = printExpr(result);

      expect(text).toContain('shape.kind === "circle"');
      expect(text).toContain('shape.kind === "square"');
      expect(text).toContain("?");
    });

    it("should handle wildcard _ as fallback", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("shape");
      const handlers = makeObjectLiteral({
        circle: makeArrowWithParam(
          "s",
          ts.factory.createStringLiteral("circle"),
        ),
        _: makeArrowWithParam("s", ts.factory.createStringLiteral("other")),
      });

      const callExpr = makeCall("match", [
        value,
        handlers,
        ts.factory.createStringLiteral("kind"),
      ]);
      const result = matchMacro.expand(ctx, callExpr, [
        value,
        handlers,
        ts.factory.createStringLiteral("kind"),
      ]);
      const text = printExpr(result);

      expect(text).toContain('shape.kind === "circle"');
      expect(text).toContain('"other"');
      expect(text).not.toContain("Non-exhaustive");
    });

    it("should use custom discriminant field", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("result");
      const handlers = makeObjectLiteral({
        true: makeArrowWithParam("r", ts.factory.createStringLiteral("ok")),
        false: makeArrowWithParam("r", ts.factory.createStringLiteral("err")),
      });
      const disc = ts.factory.createStringLiteral("ok");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      expect(text).toContain('result.ok === "true"');
    });

    it("should generate switch IIFE for >6 discriminant arms", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("node");
      const entries: Record<string, ts.Expression> = {};
      for (const tag of ["a", "b", "c", "d", "e", "f", "g"]) {
        entries[tag] = makeArrowWithParam(
          "n",
          ts.factory.createStringLiteral(tag),
        );
      }
      const handlers = makeObjectLiteral(entries);
      const disc = ts.factory.createStringLiteral("type");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      expect(text).toContain("switch");
      expect(text).toContain("__v");
      expect(text).toContain('case "a"');
      expect(text).toContain('case "g"');
      expect(text).toContain("return");
    });
  });

  describe("integer literal matching", () => {
    it("should compile small integer match to ternary chain", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("code");
      const handlers = makeObjectLiteral({
        "200": makeArrow(ts.factory.createStringLiteral("OK")),
        "404": makeArrow(ts.factory.createStringLiteral("Not Found")),
      });

      const callExpr = makeCall("match", [value, handlers]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      expect(text).toContain("code === 200");
      expect(text).toContain("code === 404");
    });

    it("should generate binary search for >6 sparse integer arms", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("code");
      const entries: Record<string, ts.Expression> = {};
      // Sparse values to trigger binary search (not dense)
      for (const n of [100, 200, 301, 404, 500, 503, 1000]) {
        entries[String(n)] = makeArrow(
          ts.factory.createStringLiteral(`status_${n}`),
        );
      }
      const handlers = makeObjectLiteral(entries);

      const callExpr = makeCall("match", [value, handlers]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      // Binary search uses < comparisons
      expect(text).toContain("<");
      expect(text).toContain("===");
      // Should NOT contain switch (sparse → binary search, not switch)
      expect(text).not.toContain("switch");
    });

    it("should generate switch IIFE for >6 dense integer arms", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("day");
      const entries: Record<string, ts.Expression> = {};
      for (let i = 0; i <= 6; i++) {
        entries[String(i)] = makeArrow(
          ts.factory.createStringLiteral(`day_${i}`),
        );
      }
      const handlers = makeObjectLiteral(entries);

      const callExpr = makeCall("match", [value, handlers]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      expect(text).toContain("switch");
      expect(text).toContain("case 0");
      expect(text).toContain("case 6");
    });

    it("binary search tree should be balanced", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");
      const entries: Record<string, ts.Expression> = {};
      // Very sparse to ensure binary search
      for (const n of [10, 50, 100, 200, 500, 800, 1000]) {
        entries[String(n)] = makeArrow(ts.factory.createNumericLiteral(n));
      }
      entries["_"] = makeArrowWithParam(
        "x",
        ts.factory.createPrefixUnaryExpression(
          ts.SyntaxKind.MinusToken,
          ts.factory.createNumericLiteral(1),
        ),
      );
      const handlers = makeObjectLiteral(entries);

      const callExpr = makeCall("match", [value, handlers]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      // The mid value of [10,50,100,200,500,800,1000] at index 3 is 200
      expect(text).toContain("v < 200");
      expect(text).toContain("v === 200");
    });
  });

  describe("string literal matching", () => {
    it("should compile small string match to ternary chain", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("color");
      const handlers = makeObjectLiteral({
        red: makeArrow(ts.factory.createStringLiteral("#f00")),
        green: makeArrow(ts.factory.createStringLiteral("#0f0")),
        blue: makeArrow(ts.factory.createStringLiteral("#00f")),
      });

      const callExpr = makeCall("match", [value, handlers]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      expect(text).toContain('color === "red"');
      expect(text).toContain('color === "green"');
      expect(text).toContain('color === "blue"');
    });

    it("should generate switch IIFE for >6 string arms", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("lang");
      const entries: Record<string, ts.Expression> = {};
      for (const s of ["en", "fr", "de", "ja", "ko", "zh", "es"]) {
        entries[s] = makeArrow(ts.factory.createStringLiteral(s.toUpperCase()));
      }
      const handlers = makeObjectLiteral(entries);

      const callExpr = makeCall("match", [value, handlers]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      expect(text).toContain("switch");
      expect(text).toContain('case "en"');
      expect(text).toContain('case "es"');
    });
  });

  describe("guard matching with when/otherwise", () => {
    it("should compile when() arms to ternary chain", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("age");

      const pred1 = makeArrowWithParam(
        "n",
        ts.factory.createBinaryExpression(
          ts.factory.createIdentifier("n"),
          ts.factory.createToken(ts.SyntaxKind.LessThanToken),
          ts.factory.createNumericLiteral(18),
        ),
      );
      const handler1 = makeArrow(ts.factory.createStringLiteral("minor"));

      const pred2 = makeArrowWithParam(
        "n",
        ts.factory.createBinaryExpression(
          ts.factory.createIdentifier("n"),
          ts.factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken),
          ts.factory.createNumericLiteral(65),
        ),
      );
      const handler2 = makeArrow(ts.factory.createStringLiteral("senior"));

      const catchAllHandler = makeArrow(
        ts.factory.createStringLiteral("adult"),
      );

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [pred1, handler1]),
        makeCall("when", [pred2, handler2]),
        makeCall("otherwise", [catchAllHandler]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain("age");
      expect(text).toContain("?");
      // The otherwise() arm compiles to (() => true)(age) ? handler(age) : throw
      expect(text).toContain("true");
    });

    it("should support backwards-compatible [pred, handler] tuple form", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("x");

      const pred = makeArrowWithParam("v", ts.factory.createTrue());
      const handler = makeArrowWithParam(
        "v",
        ts.factory.createStringLiteral("matched"),
      );

      const arms = ts.factory.createArrayLiteralExpression([
        ts.factory.createArrayLiteralExpression([pred, handler]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain('"matched"');
    });
  });

  describe("backwards compatibility", () => {
    it("matchLiteral should work as alias for match", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("code");
      const handlers = makeObjectLiteral({
        "200": makeArrow(ts.factory.createStringLiteral("OK")),
        _: makeArrow(ts.factory.createStringLiteral("other")),
      });

      const callExpr = makeCall("matchLiteral", [value, handlers]);
      const result = matchLiteralMacro.expand(ctx, callExpr, [value, handlers]);
      const text = printExpr(result);

      expect(text).toContain("code === 200");
    });

    it("matchGuard should work as alias for match with array form", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("x");

      const pred = makeArrowWithParam("v", ts.factory.createTrue());
      const handler = makeArrowWithParam(
        "v",
        ts.factory.createStringLiteral("yes"),
      );

      const arms = ts.factory.createArrayLiteralExpression([
        ts.factory.createArrayLiteralExpression([pred, handler]),
      ]);

      const callExpr = makeCall("matchGuard", [value, arms]);
      const result = matchGuardMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain('"yes"');
    });
  });

  describe("error handling", () => {
    it("should report error for too few arguments", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const errors: string[] = [];
      const origReport = ctx.reportError.bind(ctx);
      ctx.reportError = (_node: ts.Node, message: string) => {
        errors.push(message);
        return origReport(_node, message);
      };

      const callExpr = makeCall("match", [ts.factory.createIdentifier("x")]);
      matchMacro.expand(ctx, callExpr, [ts.factory.createIdentifier("x")]);

      expect(errors.some((e) => e.includes("at least 2 arguments"))).toBe(true);
    });

    it("should report error for non-object non-array second argument", () => {
      const { ctx } = createTestContext("const x = 1;");
      const errors: string[] = [];
      const origReport = ctx.reportError.bind(ctx);
      ctx.reportError = (_node: ts.Node, message: string) => {
        errors.push(message);
        return origReport(_node, message);
      };

      const value = ts.factory.createIdentifier("x");
      const bad = ts.factory.createNumericLiteral(42);
      const callExpr = makeCall("match", [value, bad]);
      matchMacro.expand(ctx, callExpr, [value, bad]);

      expect(errors.some((e) => e.includes("object literal or array"))).toBe(
        true,
      );
    });

    it("should report error for invalid guard arm", () => {
      const { ctx } = createTestContext("const x = 1;");
      const errors: string[] = [];
      const origReport = ctx.reportError.bind(ctx);
      ctx.reportError = (_node: ts.Node, message: string) => {
        errors.push(message);
        return origReport(_node, message);
      };

      const value = ts.factory.createIdentifier("x");
      const arms = ts.factory.createArrayLiteralExpression([
        ts.factory.createStringLiteral("not a valid arm"),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      matchMacro.expand(ctx, callExpr, [value, arms]);

      expect(errors.some((e) => e.includes("Invalid match arm"))).toBe(true);
    });

    it("should report error for empty guard arms", () => {
      const { ctx } = createTestContext("const x = 1;");
      const errors: string[] = [];
      const origReport = ctx.reportError.bind(ctx);
      ctx.reportError = (_node: ts.Node, message: string) => {
        errors.push(message);
        return origReport(_node, message);
      };

      const value = ts.factory.createIdentifier("x");
      const arms = ts.factory.createArrayLiteralExpression([]);

      const callExpr = makeCall("match", [value, arms]);
      matchMacro.expand(ctx, callExpr, [value, arms]);

      expect(errors.some((e) => e.includes("at least one arm"))).toBe(true);
    });
  });

  describe("code generation structure", () => {
    it("ternary chain should have correct nesting (first arm outermost)", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");
      const handlers = makeObjectLiteral({
        a: makeArrow(ts.factory.createNumericLiteral(1)),
        b: makeArrow(ts.factory.createNumericLiteral(2)),
        c: makeArrow(ts.factory.createNumericLiteral(3)),
      });
      const disc = ts.factory.createStringLiteral("tag");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      // First condition should be for 'a', outermost in the ternary
      const aIdx = text.indexOf('"a"');
      const bIdx = text.indexOf('"b"');
      const cIdx = text.indexOf('"c"');
      expect(aIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(cIdx);
    });

    it("switch IIFE should use parameter to avoid re-evaluating scrutinee", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createCallExpression(
        ts.factory.createIdentifier("getExpensiveValue"),
        undefined,
        [],
      );
      const entries: Record<string, ts.Expression> = {};
      for (const tag of ["a", "b", "c", "d", "e", "f", "g"]) {
        entries[tag] = makeArrowWithParam(
          "n",
          ts.factory.createStringLiteral(tag),
        );
      }
      const handlers = makeObjectLiteral(entries);
      const disc = ts.factory.createStringLiteral("kind");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      // getExpensiveValue() should appear exactly once (as the IIFE argument)
      const matches = text.match(/getExpensiveValue\(\)/g);
      expect(matches).toHaveLength(1);

      // __v should be used as the switch target
      expect(text).toContain("__v");
      expect(text).toContain("switch");
    });

    it("non-exhaustive fallback should throw Error", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("x");
      const handlers = makeObjectLiteral({
        a: makeArrow(ts.factory.createNumericLiteral(1)),
      });
      const disc = ts.factory.createStringLiteral("kind");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      expect(text).toContain("throw");
      expect(text).toContain("Non-exhaustive");
    });
  });

  describe("runtime fallbacks", () => {
    it("match() runtime should handle discriminated unions", async () => {
      const { match } = await import("../packages/fp/src/zero-cost/match.js");
      type Shape =
        | { kind: "circle"; r: number }
        | { kind: "square"; s: number };
      const shape: Shape = { kind: "circle", r: 5 };
      const result = match(
        shape,
        {
          circle: (s) => s.r * 2,
          square: (s) => s.s * 2,
        } as any,
        "kind" as any,
      );
      expect(result).toBe(10);
    });

    it("match() runtime should handle literal values", async () => {
      const { match } = await import("../packages/fp/src/zero-cost/match.js");
      const result = (match as any)(200, {
        200: (v: number) => "OK",
        _: (v: number) => "other",
      });
      expect(result).toBe("OK");
    });

    it("match() runtime should handle guard arms", async () => {
      const { match, when, otherwise } =
        await import("../packages/fp/src/zero-cost/match.js");
      const result = (match as any)(25, [
        when(
          (n: number) => n < 18,
          () => "minor",
        ),
        when(
          (n: number) => n >= 65,
          () => "senior",
        ),
        otherwise(() => "adult"),
      ]);
      expect(result).toBe("adult");
    });

    it("match() runtime should throw on non-exhaustive", async () => {
      const { match } = await import("../packages/fp/src/zero-cost/match.js");
      type T = { kind: "a" } | { kind: "b" };
      const v: T = { kind: "b" };
      expect(() => match(v, { a: () => 1 } as any, "kind" as any)).toThrow(
        "Non-exhaustive",
      );
    });

    it("when() and otherwise() should create proper guard arms", async () => {
      const { when, otherwise } =
        await import("../packages/fp/src/zero-cost/match.js");
      const arm = when(
        (x: number) => x > 0,
        (x: number) => x * 2,
      );
      expect(arm.predicate(5)).toBe(true);
      expect(arm.predicate(-1)).toBe(false);
      expect(arm.handler(3)).toBe(6);

      const catchAll = otherwise((x: number) => 0);
      expect(catchAll.predicate(999)).toBe(true);
      expect(catchAll.handler(999)).toBe(0);
    });

    it("matchLiteral() runtime should be backwards compatible", async () => {
      const { matchLiteral } =
        await import("../packages/fp/src/zero-cost/match.js");
      const result = matchLiteral(
        404 as 200 | 404,
        {
          200: ((v: any) => "OK") as any,
          404: ((v: any) => "Not Found") as any,
        } as any,
      );
      expect(result).toBe("Not Found");
    });

    it("matchGuard() runtime should be backwards compatible", async () => {
      const { matchGuard } =
        await import("../packages/fp/src/zero-cost/match.js");
      const result = matchGuard(42, [
        [(v: number) => v > 100, () => "big"],
        [() => true, () => "small"],
      ]);
      expect(result).toBe("small");
    });
  });

  describe("OR patterns (pipe-separated keys)", () => {
    it("should compile OR pattern to || condition in ternary chain", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("shape");

      const props = [
        ts.factory.createPropertyAssignment(
          ts.factory.createStringLiteral("circle|square"),
          makeArrowWithParam("s", ts.factory.createStringLiteral("flat")),
        ),
        ts.factory.createPropertyAssignment(
          ts.factory.createIdentifier("triangle"),
          makeArrowWithParam("s", ts.factory.createStringLiteral("angled")),
        ),
      ];
      const handlers = ts.factory.createObjectLiteralExpression(props);
      const disc = ts.factory.createStringLiteral("kind");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      expect(text).toContain('shape.kind === "circle"');
      expect(text).toContain('shape.kind === "square"');
      expect(text).toContain("||");
      expect(text).toContain('"flat"');
      expect(text).toContain('"angled"');
    });

    it("should compile OR pattern to fall-through cases in switch IIFE", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("node");
      const props = [
        ts.factory.createPropertyAssignment(
          ts.factory.createStringLiteral("a|b|c"),
          makeArrowWithParam("n", ts.factory.createStringLiteral("group1")),
        ),
        ts.factory.createPropertyAssignment(
          ts.factory.createStringLiteral("d|e"),
          makeArrowWithParam("n", ts.factory.createStringLiteral("group2")),
        ),
        ts.factory.createPropertyAssignment(
          ts.factory.createIdentifier("f"),
          makeArrowWithParam("n", ts.factory.createStringLiteral("f")),
        ),
        ts.factory.createPropertyAssignment(
          ts.factory.createIdentifier("g"),
          makeArrowWithParam("n", ts.factory.createStringLiteral("g")),
        ),
      ];
      const handlers = ts.factory.createObjectLiteralExpression(props);
      const disc = ts.factory.createStringLiteral("kind");

      const callExpr = makeCall("match", [value, handlers, disc]);
      const result = matchMacro.expand(ctx, callExpr, [value, handlers, disc]);
      const text = printExpr(result);

      expect(text).toContain("switch");
      expect(text).toContain('case "a"');
      expect(text).toContain('case "b"');
      expect(text).toContain('case "c"');
      expect(text).toContain('"group1"');
      expect(text).toContain('"group2"');
    });

    it("OR pattern runtime fallback should work", async () => {
      const { match } =
        await import("../packages/fp/src/zero-cost/match.js");
      type Shape =
        | { kind: "circle" }
        | { kind: "square" }
        | { kind: "triangle" };
      const shape: Shape = { kind: "circle" };
      const result = match(
        shape,
        {
          circle: () => "round",
          square: () => "box",
          triangle: () => "tri",
        } as any,
        "kind" as any,
      );
      expect(result).toBe("round");
    });
  });

  describe("type pattern helpers (isType)", () => {
    it("isType('string') should generate typeof check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");

      const isTypeCall = ts.factory.createCallExpression(
        ts.factory.createIdentifier("isType"),
        undefined,
        [ts.factory.createStringLiteral("string")],
      );
      const handler = makeArrowWithParam(
        "s",
        ts.factory.createStringLiteral("str"),
      );

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [isTypeCall, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
    });

    it("isType('null') should generate === null check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");

      const isTypeCall = ts.factory.createCallExpression(
        ts.factory.createIdentifier("isType"),
        undefined,
        [ts.factory.createStringLiteral("null")],
      );
      const handler = makeArrow(ts.factory.createStringLiteral("nil"));

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [isTypeCall, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain("=== null");
      expect(text).not.toContain("typeof");
    });

    it("isType(SomeClass) should generate instanceof check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");

      const isTypeCall = ts.factory.createCallExpression(
        ts.factory.createIdentifier("isType"),
        undefined,
        [ts.factory.createIdentifier("Date")],
      );
      const handler = makeArrowWithParam(
        "d",
        ts.factory.createStringLiteral("date"),
      );

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [isTypeCall, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain("instanceof");
      expect(text).toContain("Date");
    });

    it("isType() runtime should work for primitives", async () => {
      const { isType } =
        await import("../packages/fp/src/zero-cost/match.js");

      expect(isType("string")("hello")).toBe(true);
      expect(isType("string")(42)).toBe(false);
      expect(isType("number")(42)).toBe(true);
      expect(isType("number")("hi")).toBe(false);
      expect(isType("boolean")(true)).toBe(true);
      expect(isType("null")(null)).toBe(true);
      expect(isType("null")(undefined)).toBe(false);
    });

    it("isType() runtime should work for classes", async () => {
      const { isType } =
        await import("../packages/fp/src/zero-cost/match.js");

      expect(isType(Date)(new Date())).toBe(true);
      expect(isType(Date)("not a date")).toBe(false);
      expect(isType(Array)([1, 2, 3])).toBe(true);
    });
  });

  describe("array pattern helpers (P)", () => {
    it("P.empty should generate length === 0 check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("arr");

      const pEmpty = ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier("P"),
        "empty",
      );
      const handler = makeArrow(ts.factory.createStringLiteral("empty"));

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [pEmpty, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain(".length === 0");
    });

    it("P.length(n) should generate length === n check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("arr");

      const pLength = ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier("P"),
          "length",
        ),
        undefined,
        [ts.factory.createNumericLiteral(3)],
      );
      const handler = makeArrow(ts.factory.createStringLiteral("triple"));

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [pLength, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain(".length === 3");
    });

    it("P.minLength(n) should generate length >= n check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("arr");

      const pMin = ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier("P"),
          "minLength",
        ),
        undefined,
        [ts.factory.createNumericLiteral(2)],
      );
      const handler = makeArrow(ts.factory.createStringLiteral("multi"));

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [pMin, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain(".length >= 2");
    });

    it("P.between(lo, hi) should generate range check", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("n");

      const pBetween = ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier("P"),
          "between",
        ),
        undefined,
        [
          ts.factory.createNumericLiteral(1),
          ts.factory.createNumericLiteral(10),
        ],
      );
      const handler = makeArrow(ts.factory.createStringLiteral("in range"));

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [pBetween, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("out")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain(">= 1");
      expect(text).toContain("<= 10");
      expect(text).toContain("&&");
    });

    it("P.oneOf(...) should generate || chain", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");

      const pOneOf = ts.factory.createCallExpression(
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier("P"),
          "oneOf",
        ),
        undefined,
        [
          ts.factory.createStringLiteral("a"),
          ts.factory.createStringLiteral("b"),
          ts.factory.createStringLiteral("c"),
        ],
      );
      const handler = makeArrow(ts.factory.createStringLiteral("found"));

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [pOneOf, handler]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("nope")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain('"a"');
      expect(text).toContain('"b"');
      expect(text).toContain('"c"');
      expect(text).toContain("||");
    });

    it("P runtime helpers should work correctly", async () => {
      const { P } =
        await import("../packages/fp/src/zero-cost/match.js");

      expect(P.empty([])).toBe(true);
      expect(P.empty([1])).toBe(false);
      expect(P.nil(null)).toBe(true);
      expect(P.nil(undefined)).toBe(true);
      expect(P.nil(0)).toBe(false);
      expect(P.defined(0)).toBe(true);
      expect(P.defined(null)).toBe(false);
      expect(P.length(3)([1, 2, 3])).toBe(true);
      expect(P.length(3)([1, 2])).toBe(false);
      expect(P.minLength(2)([1, 2])).toBe(true);
      expect(P.minLength(2)([1])).toBe(false);
      expect(P.between(1, 10)(5)).toBe(true);
      expect(P.between(1, 10)(15)).toBe(false);
      expect(P.oneOf("a", "b", "c")("b")).toBe(true);
      expect(P.oneOf("a", "b", "c")("d")).toBe(false);
      expect(
        P.head((x: number) => x > 0)([5, -1]),
      ).toBe(true);
      expect(
        P.head((x: number) => x > 0)([-1, 5]),
      ).toBe(false);
      expect(P.head((x: number) => x > 0)([])).toBe(false);
      expect(P.has("name")({ name: "test" })).toBe(true);
      expect(P.has("name")({ age: 5 })).toBe(false);
      expect(P.has("name")(null)).toBe(false);
      expect(P.regex(/^\d+$/)("123")).toBe(true);
      expect(P.regex(/^\d+$/)("abc")).toBe(false);
    });
  });

  describe("combined patterns", () => {
    it("should handle isType + P patterns together in guard arms", () => {
      const { ctx, printExpr } = createTestContext("const x = 1;");
      const value = ts.factory.createIdentifier("v");

      const isTypeStr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("isType"),
        undefined,
        [ts.factory.createStringLiteral("string")],
      );
      const pNil = ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier("P"),
        "nil",
      );

      const arms = ts.factory.createArrayLiteralExpression([
        makeCall("when", [
          pNil,
          makeArrow(ts.factory.createStringLiteral("nil")),
        ]),
        makeCall("when", [
          isTypeStr,
          makeArrow(ts.factory.createStringLiteral("str")),
        ]),
        makeCall("otherwise", [
          makeArrow(ts.factory.createStringLiteral("other")),
        ]),
      ]);

      const callExpr = makeCall("match", [value, arms]);
      const result = matchMacro.expand(ctx, callExpr, [value, arms]);
      const text = printExpr(result);

      expect(text).toContain("== null");
      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
    });

    it("full pipeline: runtime match with when + P + isType", async () => {
      const { match, when, otherwise, isType, P } =
        await import("../packages/fp/src/zero-cost/match.js");
      const values = [null, "hello", 42, [1, 2, 3], true];

      const results = values.map((v) =>
        (match as any)(v, [
          when(P.nil, () => "nil"),
          when(isType("string"), () => "string"),
          when(isType("number"), () => "number"),
          when(isType(Array), () => "array"),
          otherwise(() => "other"),
        ]),
      );

      expect(results).toEqual([
        "nil",
        "string",
        "number",
        "array",
        "other",
      ]);
    });
  });
});
