/**
 * Tests for fluent match() extractor patterns (PEP-008 Wave 4)
 *
 * Covers:
 * - Sum-variant extractors: Some(v), None, Left(l), Right(r), Ok(v), Err(e), Cons(h, t), Nil
 * - (Product and custom extractors from Destructure instances:
 *   packages/std/tests/match-destructure-instances.test.ts)
 * - Zero-arg extractors: None, Nil as bare identifiers
 * - Nested extractor patterns: Some({ x, y })
 * - Guard combinations with extractors
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext, clearTypeRewrites } from "@typesugar/core";
import { expandFluentMatch } from "../packages/std/src/macros/match.js";

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

/** Build a CallExpression: name(args...) */
function call(name: string, ...args: ts.Expression[]): ts.CallExpression {
  return f.createCallExpression(f.createIdentifier(name), undefined, args);
}

// ============================================================================
// Tests
// ============================================================================

describe("fluent match() extractor patterns (PEP-008 Wave 4)", () => {
  beforeEach(() => {
    // Reset the global type-rewrite registry so a prior test file that registered
    // Option/Either as @opaque (None → null constant constructor) can't leak in
    // and change this file's extractor codegen. These tests assert the default,
    // unregistered behavior.
    clearTypeRewrites();
  });

  // Extractor patterns (Some/None, Left/Right, Cons/Nil, Ok/Err, products,
  // custom) resolve Destructure instances by the constructor's symbol, which
  // needs a real program: see packages/std/tests/match-destructure-instances,
  // match-fp-extractors and match-extractor-output.

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
