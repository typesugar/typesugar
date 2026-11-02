/**
 * Tests for fluent match() extractor patterns (PEP-008 Wave 4)
 *
 * Covers:
 * - Sum-variant extractors: Some(v), None, Left(l), Right(r), Ok(v), Err(e), Cons(h, t), Nil
 * - Product extractors: Point(x, y), registered via registerProductExtractor
 * - Custom Destructure extractors: Email({ user, domain }), registered via registerCustomExtractor
 * - Zero-arg extractors: None, Nil as bare identifiers
 * - Nested extractor patterns: Some({ x, y })
 * - Guard combinations with extractors
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext, clearTypeRewrites } from "@typesugar/core";
import {
  expandFluentMatch,
  registerProductExtractor,
  registerCustomExtractor,
  clearRegisteredExtractors,
} from "../packages/std/src/macros/match.js";

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

/**
 * Evaluate a printed match expansion with the given free variables bound,
 * so the tests check what the generated code DOES, not only its text.
 */
function run(text: string, scope: Record<string, unknown>): unknown {
  class MatchError extends Error {}
  const names = Object.keys(scope);
  return new Function(...names, "MatchError", `return ${text};`)(
    ...names.map((n) => scope[n]),
    MatchError
  );
}

/** Build a CallExpression: name(args...) */
function call(name: string, ...args: ts.Expression[]): ts.CallExpression {
  return f.createCallExpression(f.createIdentifier(name), undefined, args);
}

// ============================================================================
// Tests
// ============================================================================

describe("fluent match() extractor patterns (PEP-008 Wave 4)", () => {
  beforeEach(() => {
    clearRegisteredExtractors();
    // Reset the global type-rewrite registry so a prior test file that registered
    // Option/Either as @opaque (None → null constant constructor) can't leak in
    // and change this file's extractor codegen. These tests assert the default,
    // unregistered behavior.
    clearTypeRewrites();
  });

  // --------------------------------------------------------------------------
  // Gate: match(opt).case(Some(v)).then(v) works with Option
  //
  // These scrutinees are bare identifiers with no `_tag` in their type, so the
  // built-in Some/None/Left/Right/Cons/Nil extractors use @typesugar/fp's real
  // (untagged) representations (std fix b3b647e8): Option<A> = A | null,
  // Either = { left } | { right }, List = { head, tail } | null. The
  // `_tag`-typed scheme is covered by packages/std/tests/match-execution.test.ts.
  // --------------------------------------------------------------------------
  describe("Option extractors: Some/None", () => {
    it("should compile Some(v) to discriminant check + value binding", () => {
      const { ctx, printExpr } = createTestContext();
      // match(opt).case(Some(v)).then(v).else("none")
      const { outermost, rootArgs } = buildChain(
        ident("opt"),
        { method: "case", args: [call("Some", ident("v"))] },
        { method: "then", args: [ident("v")] },
        { method: "else", args: [str("none")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_opt != null");
      expect(text).toContain("const v = _opt;");
      expect(text).not.toContain("_tag");
      expect(text).not.toContain("extract");
      expect(run(text, { opt: 5 })).toBe(5);
      expect(run(text, { opt: 0 })).toBe(0);
      expect(run(text, { opt: null })).toBe("none");
    });

    it("should compile None as zero-arg extractor", () => {
      const { ctx, printExpr } = createTestContext();
      // match(opt).case(None).then("nothing").else("something")
      const { outermost, rootArgs } = buildChain(
        ident("opt"),
        { method: "case", args: [ident("None")] },
        { method: "then", args: [str("nothing")] },
        { method: "else", args: [str("something")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_opt == null");
      expect(text).not.toContain("_tag");
      expect(text).not.toContain("extract");
      expect(run(text, { opt: null })).toBe("nothing");
      expect(run(text, { opt: undefined })).toBe("nothing");
      expect(run(text, { opt: 3 })).toBe("something");
    });

    it("should compile Some(v) + None as multi-arm match", () => {
      const { ctx, printExpr } = createTestContext();
      // match(opt).case(Some(v)).then(v).case(None).then("none")
      const { outermost, rootArgs } = buildChain(
        ident("opt"),
        { method: "case", args: [call("Some", ident("v"))] },
        { method: "then", args: [ident("v")] },
        { method: "case", args: [ident("None")] },
        { method: "then", args: [str("none")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_opt != null");
      expect(text).toContain("_opt == null");
      expect(text).not.toContain("_tag");
      expect(run(text, { opt: "x" })).toBe("x");
      expect(run(text, { opt: null })).toBe("none");
    });
  });

  // --------------------------------------------------------------------------
  // Gate: match(either).case(Left(err)).then(err) works with Either
  // --------------------------------------------------------------------------
  describe("Either extractors: Left/Right", () => {
    it("should compile Left(err) to discriminant check + value binding", () => {
      const { ctx, printExpr } = createTestContext();
      // match(either).case(Left(err)).then(err).else("right")
      const { outermost, rootArgs } = buildChain(
        ident("either"),
        { method: "case", args: [call("Left", ident("err"))] },
        { method: "then", args: [ident("err")] },
        { method: "else", args: [str("right")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"left" in _either');
      expect(text).toContain("_either.left");
      expect(text).not.toContain("_tag");
      expect(text).not.toContain("extract");
      expect(run(text, { either: { left: "boom" } })).toBe("boom");
      expect(run(text, { either: { right: 1 } })).toBe("right");
    });

    it("should compile Right(val) to discriminant check + value binding", () => {
      const { ctx, printExpr } = createTestContext();
      // match(either).case(Right(val)).then(val).else("left")
      const { outermost, rootArgs } = buildChain(
        ident("either"),
        { method: "case", args: [call("Right", ident("val"))] },
        { method: "then", args: [ident("val")] },
        { method: "else", args: [str("left")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain('"right" in _either');
      expect(text).toContain("_either.right");
      expect(text).not.toContain("_tag");
      expect(text).not.toContain("extract");
      expect(run(text, { either: { right: 42 } })).toBe(42);
      expect(run(text, { either: { left: "e" } })).toBe("left");
    });
  });

  // --------------------------------------------------------------------------
  // Result extractors: Ok/Err (boolean discriminant)
  // --------------------------------------------------------------------------
  describe("Result extractors: Ok/Err", () => {
    it("should compile Ok(v) with boolean discriminant", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("res"),
        { method: "case", args: [call("Ok", ident("v"))] },
        { method: "then", args: [ident("v")] },
        { method: "else", args: [str("error")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".ok === true");
      expect(text).toContain(".value");
    });

    it("should compile Err(e) with boolean discriminant", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("res"),
        { method: "case", args: [call("Err", ident("e"))] },
        { method: "then", args: [ident("e")] },
        { method: "else", args: [str("ok")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain(".ok === false");
      expect(text).toContain(".error");
    });
  });

  // --------------------------------------------------------------------------
  // List extractors: Cons/Nil
  // --------------------------------------------------------------------------
  describe("List extractors: Cons/Nil", () => {
    it("should compile Cons(h, t) with two payload bindings", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("list"),
        { method: "case", args: [call("Cons", ident("h"), ident("t"))] },
        { method: "then", args: [ident("h")] },
        { method: "else", args: [str("empty")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_list != null");
      expect(text).toContain(".head");
      expect(text).toContain(".tail");
      expect(text).not.toContain("_tag");
      expect(run(text, { list: { head: 1, tail: { head: 2, tail: null } } })).toBe(1);
      expect(run(text, { list: null })).toBe("empty");
    });

    it("should compile Nil as zero-arg extractor", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("list"),
        { method: "case", args: [ident("Nil")] },
        { method: "then", args: [str("empty")] },
        { method: "else", args: [str("non-empty")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_list == null");
      expect(text).not.toContain("_tag");
      expect(run(text, { list: null })).toBe("empty");
      expect(run(text, { list: { head: 1, tail: null } })).toBe("non-empty");
    });
  });

  // --------------------------------------------------------------------------
  // Gate: match(point).case(Point(x, y)).then(x + y) works with auto-derived Product
  // --------------------------------------------------------------------------
  describe("Product extractors (auto-derived)", () => {
    it("should compile Point(x, y) with structural field checks", () => {
      registerProductExtractor("Point", ["x", "y"]);

      const { ctx, printExpr } = createTestContext();
      const addExpr = f.createBinaryExpression(ident("x"), ts.SyntaxKind.PlusToken, ident("y"));

      const { outermost, rootArgs } = buildChain(
        ident("point"),
        { method: "case", args: [call("Point", ident("x"), ident("y"))] },
        { method: "then", args: [addExpr] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      // Inlined structural checks: "x" in __m && "y" in __m
      expect(text).toContain('"x" in');
      expect(text).toContain('"y" in');
      // Field access bindings
      expect(text).toContain(".x");
      expect(text).toContain(".y");
      // No runtime Destructure call
      expect(text).not.toContain("extract");
    });

    it("should handle product with wildcard bindings", () => {
      registerProductExtractor("Rect", ["width", "height", "color"]);

      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("rect"),
        { method: "case", args: [call("Rect", ident("w"), ident("_"), ident("c"))] },
        { method: "then", args: [ident("w")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      // Structural checks for all fields
      expect(text).toContain('"width" in');
      expect(text).toContain('"height" in');
      expect(text).toContain('"color" in');
      // Only binds w and c, not _
      expect(text).toContain(".width");
      expect(text).toContain(".color");
    });
  });

  // --------------------------------------------------------------------------
  // Gate: Custom Destructure instance works: Email({ user, domain })
  // --------------------------------------------------------------------------
  describe("Custom Destructure extractors", () => {
    it("should compile Email({ user, domain }) with extract() call", () => {
      registerCustomExtractor("Email");

      const { ctx, printExpr } = createTestContext();
      const objPat = f.createObjectLiteralExpression([
        f.createShorthandPropertyAssignment("user"),
        f.createShorthandPropertyAssignment("domain"),
      ]);

      const { outermost, rootArgs } = buildChain(
        ident("input"),
        { method: "case", args: [call("Email", objPat)] },
        { method: "then", args: [ident("user")] },
        { method: "else", args: [str("invalid")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      // Uses extract() — runtime call for custom extractors
      expect(text).toContain("Email.extract");
      expect(text).toContain("!== undefined");
    });

    it("should compile custom extractor with simple variable binding", () => {
      registerCustomExtractor("ParseInt");

      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("s"),
        { method: "case", args: [call("ParseInt", ident("n"))] },
        { method: "then", args: [ident("n")] },
        { method: "else", args: [f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, num(1))] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("ParseInt.extract");
      expect(text).toContain("!== undefined");
    });
  });

  // --------------------------------------------------------------------------
  // Gate: Inlined extraction for auto-derived types: no runtime Destructure call
  // --------------------------------------------------------------------------

  describe("zero-cost inlining", () => {
    it("should not generate extract() calls for sum-variant extractors", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("opt"),
        { method: "case", args: [call("Some", ident("v"))] },
        { method: "then", args: [ident("v")] },
        { method: "case", args: [ident("None")] },
        { method: "then", args: [str("none")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).not.toContain("extract");
      expect(text).not.toContain("Destructure");
    });

    it("should not generate extract() calls for product extractors", () => {
      registerProductExtractor("Vec3", ["x", "y", "z"]);

      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("v"),
        { method: "case", args: [call("Vec3", ident("x"), ident("y"), ident("z"))] },
        { method: "then", args: [ident("x")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).not.toContain("extract");
      expect(text).not.toContain("Destructure");
      expect(text).toContain('"x" in');
      expect(text).toContain('"y" in');
      expect(text).toContain('"z" in');
    });
  });

  // --------------------------------------------------------------------------
  // Guards with extractors
  // --------------------------------------------------------------------------
  describe("guards with extractors", () => {
    it("should combine extractor condition with guard", () => {
      const { ctx, printExpr } = createTestContext();
      const guardExpr = f.createBinaryExpression(
        ident("v"),
        ts.SyntaxKind.GreaterThanToken,
        num(0)
      );

      const { outermost, rootArgs } = buildChain(
        ident("opt"),
        { method: "case", args: [call("Some", ident("v"))] },
        { method: "if", args: [guardExpr] },
        { method: "then", args: [ident("v")] },
        { method: "else", args: [f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, num(1))] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_opt != null");
      expect(text).toContain("> 0");
      expect(run(text, { opt: 7 })).toBe(7);
      expect(run(text, { opt: -2 })).toBe(-1);
      expect(run(text, { opt: null })).toBe(-1);
    });
  });

  // --------------------------------------------------------------------------
  // Nested extractor patterns
  // --------------------------------------------------------------------------
  describe("nested patterns within extractors", () => {
    it("should handle Some with nested literal", () => {
      const { ctx, printExpr } = createTestContext();
      // match(opt).case(Some(42)).then("found").else("not found")
      const { outermost, rootArgs } = buildChain(
        ident("opt"),
        { method: "case", args: [call("Some", num(42))] },
        { method: "then", args: [str("found")] },
        { method: "else", args: [str("not found")] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("_opt != null");
      // fp's Some(v) is the value itself: the nested literal tests it directly
      expect(text).toContain("_opt === 42");
      expect(run(text, { opt: 42 })).toBe("found");
      expect(run(text, { opt: 41 })).toBe("not found");
      expect(run(text, { opt: null })).toBe("not found");
    });
  });

  // --------------------------------------------------------------------------
  // Regression: type constructors still work after extractor changes
  // --------------------------------------------------------------------------
  describe("regression: type constructors unaffected", () => {
    it("should still handle String(s) as type constructor", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [call("String", ident("s"))] },
        { method: "then", args: [ident("s")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("typeof");
      expect(text).toContain('"string"');
      expect(text).not.toContain("_tag");
    });

    it("should still handle Date(d) as type constructor", () => {
      const { ctx, printExpr } = createTestContext();
      const { outermost, rootArgs } = buildChain(
        ident("x"),
        { method: "case", args: [call("Date", ident("d"))] },
        { method: "then", args: [ident("d")] },
        { method: "else", args: [num(0)] }
      );

      const result = expandFluentMatch(ctx, outermost, rootArgs);
      const text = printExpr(result);

      expect(text).toContain("instanceof Date");
    });
  });
});
