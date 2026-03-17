/**
 * Tests for Wave 5: Exhaustiveness Analysis & Optimization (PEP-008)
 *
 * Covers:
 * - Switch optimization for 7+ literal arms
 * - MatchError runtime class
 * - Unreachable pattern detection (pattern-based)
 * - Dead arm detection (duplicate literals)
 * - Exhaustiveness analysis infrastructure
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import {
  expandFluentMatch,
  isAllPureLiteralArms,
  analyzeScrutineeType,
  type ScrutineeAnalysis,
} from "../packages/std/src/macros/match-v2.js";
import { MatchError } from "../packages/std/src/data/match-error.js";

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

// ============================================================================
// MatchError Runtime Class
// ============================================================================

describe("MatchError runtime class", () => {
  it("should be an instance of Error", () => {
    const err = new MatchError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MatchError);
  });

  it("should store the unmatched value", () => {
    const value = { kind: "unknown" };
    const err = new MatchError(value);
    expect(err.value).toBe(value);
  });

  it("should have descriptive message for string value", () => {
    const err = new MatchError("oops");
    expect(err.message).toContain('"oops"');
    expect(err.message).toContain("Non-exhaustive match");
  });

  it("should have descriptive message for number value", () => {
    const err = new MatchError(42);
    expect(err.message).toContain("42");
  });

  it("should have descriptive message for object value", () => {
    const err = new MatchError({ a: 1 });
    expect(err.message).toContain('{"a":1}');
  });

  it("should have descriptive message for null value", () => {
    const err = new MatchError(null);
    expect(err.message).toContain("null");
  });

  it("should have descriptive message for undefined value", () => {
    const err = new MatchError(undefined);
    expect(err.message).toContain("undefined");
  });

  it("should set name to MatchError", () => {
    const err = new MatchError("x");
    expect(err.name).toBe("MatchError");
  });

  it("should have correct prototype chain (instanceof works)", () => {
    const err = new MatchError("x");
    expect(Object.getPrototypeOf(err)).toBe(MatchError.prototype);
  });
});

// ============================================================================
// Switch Optimization (7+ literal arms)
// ============================================================================

describe("Wave 5: switch optimization", () => {
  it("should generate switch statement for 7+ pure literal arms", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 8; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`result_${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("switch");
    expect(output).toContain("case 1:");
    expect(output).toContain("case 8:");
    expect(output).toContain('"default"');
    expect(output).not.toContain("if (");
  });

  it("should generate switch with MatchError default when no .else()", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 7; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("switch");
    expect(output).toContain("MatchError");
    expect(output).toContain("throw new");
  });

  it("should use switch for string literal arms", () => {
    const { ctx, printExpr } = createTestContext();

    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (const day of days) {
      steps.push({ method: "case", args: [str(day)] });
      steps.push({ method: "then", args: [str(day.toUpperCase())] });
    }
    steps.push({ method: "else", args: [str("unknown")] });

    const { outermost, rootArgs } = buildChain(ident("day"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("switch");
    expect(output).toContain('case "mon":');
    expect(output).toContain('case "sun":');
  });

  it("should NOT use switch for 6 literal arms", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 6; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).not.toContain("switch");
    expect(output).toContain("if (");
  });

  it("should NOT use switch when arms have guards", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 8; i++) {
      steps.push({ method: "case", args: [num(i)] });
      if (i === 3) steps.push({ method: "if", args: [ident("someCondition")] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).not.toContain("switch");
    expect(output).toContain("if (");
  });

  it("should NOT use switch when arms have OR patterns", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 8; i++) {
      steps.push({ method: "case", args: [num(i)] });
      if (i === 2) steps.push({ method: "or", args: [num(99)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).not.toContain("switch");
  });
});

// ============================================================================
// isAllPureLiteralArms helper
// ============================================================================

describe("isAllPureLiteralArms", () => {
  it("should return true for pure literal arms", () => {
    const arms = [
      { pattern: num(1), alternatives: [], result: str("a") },
      { pattern: num(2), alternatives: [], result: str("b") },
    ];
    expect(isAllPureLiteralArms(arms)).toBe(true);
  });

  it("should return false when arm has guard", () => {
    const arms = [{ pattern: num(1), alternatives: [], result: str("a"), guard: ident("cond") }];
    expect(isAllPureLiteralArms(arms)).toBe(false);
  });

  it("should return false when arm has OR alternatives", () => {
    const arms = [{ pattern: num(1), alternatives: [num(2)], result: str("a") }];
    expect(isAllPureLiteralArms(arms)).toBe(false);
  });

  it("should return false when arm has wildcard pattern", () => {
    const arms = [{ pattern: ident("_"), alternatives: [], result: str("a") }];
    expect(isAllPureLiteralArms(arms)).toBe(false);
  });

  it("should return false when arm has variable pattern", () => {
    const arms = [{ pattern: ident("x"), alternatives: [], result: str("a") }];
    expect(isAllPureLiteralArms(arms)).toBe(false);
  });
});

// ============================================================================
// Unreachable Pattern Detection (pattern-based)
// ============================================================================

describe("Wave 5: unreachable pattern detection", () => {
  it("should warn on duplicate literal patterns", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [num(1)] },
      { method: "then", args: [str("first")] },
      { method: "case", args: [num(1)] },
      { method: "then", args: [str("second")] },
      { method: "else", args: [str("other")] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.message.includes("already matched"))).toBe(true);
  });

  it("should warn on pattern after catch-all wildcard", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [num(1)] },
      { method: "then", args: [str("one")] },
      { method: "case", args: [ident("_")] },
      { method: "then", args: [str("catch-all")] },
      { method: "case", args: [num(2)] },
      { method: "then", args: [str("unreachable")] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.message.includes("Unreachable"))).toBe(true);
  });

  it("should warn on pattern after catch-all variable", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [ident("val")] },
      { method: "then", args: [ident("val")] },
      { method: "case", args: [num(99)] },
      { method: "then", args: [str("unreachable")] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.message.includes("Unreachable"))).toBe(true);
  });

  it("should NOT warn on guarded catch-all followed by more patterns", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [ident("_")] },
      { method: "if", args: [ident("someCondition")] },
      { method: "then", args: [str("guarded")] },
      { method: "case", args: [num(2)] },
      { method: "then", args: [str("reachable")] },
      { method: "else", args: [str("default")] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBe(0);
  });

  it("should warn on duplicate string literal patterns", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [str("hello")] },
      { method: "then", args: [num(1)] },
      { method: "case", args: [str("hello")] },
      { method: "then", args: [num(2)] },
      { method: "else", args: [num(0)] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.message.includes("already matched"))).toBe(true);
  });
});

// ============================================================================
// Type Analysis Infrastructure
// ============================================================================

describe("analyzeScrutineeType", () => {
  function getChecker(): ts.TypeChecker {
    return getSharedProgram().getTypeChecker();
  }

  it("should classify string type as non-enumerable", () => {
    const checker = getChecker();
    const stringType = checker.getStringType();
    const result = analyzeScrutineeType(checker, stringType);
    expect(result.kind).toBe("non-enumerable");
  });

  it("should classify number type as non-enumerable", () => {
    const checker = getChecker();
    const numberType = checker.getNumberType();
    const result = analyzeScrutineeType(checker, numberType);
    expect(result.kind).toBe("non-enumerable");
  });

  it("should classify boolean type as boolean", () => {
    const checker = getChecker();
    const boolType = checker.getBooleanType();
    const result = analyzeScrutineeType(checker, boolType);
    expect(result.kind).toBe("boolean");
    expect(result.literalMembers).toEqual(new Set(["true", "false"]));
  });

  it("should classify string literal type as literal-union with single member", () => {
    const checker = getChecker();
    const litType = checker.getStringLiteralType("ok");
    const result = analyzeScrutineeType(checker, litType);
    expect(result.kind).toBe("literal-union");
    expect(result.literalMembers).toEqual(new Set(['"ok"']));
  });

  it("should classify number literal type as literal-union with single member", () => {
    const checker = getChecker();
    const litType = checker.getNumberLiteralType(42);
    const result = analyzeScrutineeType(checker, litType);
    expect(result.kind).toBe("literal-union");
    expect(result.literalMembers).toEqual(new Set(["42"]));
  });

  it("should classify union of string literals as literal-union", () => {
    const checker = getChecker();
    const okType = checker.getStringLiteralType("ok");
    const failType = checker.getStringLiteralType("fail");
    const unionType = checker.getUnionType([okType, failType]);
    const result = analyzeScrutineeType(checker, unionType);
    expect(result.kind).toBe("literal-union");
    expect(result.literalMembers).toEqual(new Set(['"ok"', '"fail"']));
  });

  it("should classify union of number literals as literal-union", () => {
    const checker = getChecker();
    const t1 = checker.getNumberLiteralType(200);
    const t2 = checker.getNumberLiteralType(404);
    const t3 = checker.getNumberLiteralType(500);
    const unionType = checker.getUnionType([t1, t2, t3]);
    const result = analyzeScrutineeType(checker, unionType);
    expect(result.kind).toBe("literal-union");
    expect(result.literalMembers).toEqual(new Set(["200", "404", "500"]));
  });
});

// ============================================================================
// Generated MatchError Output
// ============================================================================

describe("Wave 5: MatchError generation", () => {
  it("should generate MatchError throw without .else() (IIFE path)", () => {
    const { ctx, printExpr } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [num(1)] },
      { method: "then", args: [str("one")] },
      { method: "case", args: [num(2)] },
      { method: "then", args: [str("two")] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);
    expect(output).toContain("throw new MatchError");
  });

  it("should NOT generate MatchError with .else()", () => {
    const { ctx, printExpr } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [num(1)] },
      { method: "then", args: [str("one")] },
      { method: "else", args: [str("default")] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);
    expect(output).not.toContain("MatchError");
  });

  it("should generate MatchError with scrutinee value in switch path", () => {
    const { ctx, printExpr } = createTestContext();
    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 7; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("switch");
    expect(output).toContain("throw new MatchError");
  });
});

// ============================================================================
// Switch Output Shape Verification
// ============================================================================

describe("Wave 5: switch output shape", () => {
  it("should evaluate scrutinee exactly once in switch", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 7; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(
      f.createCallExpression(ident("getVal"), undefined, []),
      ...steps
    );
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("switch");
    // The scrutinee (getVal()) should appear once in a const declaration
    const getValCount = output.split("getVal()").length - 1;
    expect(getValCount).toBe(1);
  });

  it("should wrap switch in IIFE", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 7; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("(() => {");
    expect(output).toContain("})()");
  });

  it("should have return in each case clause", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 1; i <= 7; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`r${i}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    // Each case should have a return
    const returnCount = output.split("return").length - 1;
    expect(returnCount).toBe(8); // 7 cases + 1 default
  });

  it("should handle mixed numeric and string literal arms in switch", () => {
    const { ctx, printExpr } = createTestContext();

    const steps: { method: string; args: ts.Expression[] }[] = [];
    for (let i = 0; i < 4; i++) {
      steps.push({ method: "case", args: [num(i)] });
      steps.push({ method: "then", args: [str(`num_${i}`)] });
    }
    for (const s of ["a", "b", "c"]) {
      steps.push({ method: "case", args: [str(s)] });
      steps.push({ method: "then", args: [str(`str_${s}`)] });
    }
    steps.push({ method: "else", args: [str("default")] });

    const { outermost, rootArgs } = buildChain(ident("x"), ...steps);
    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain("switch");
    expect(output).toContain("case 0:");
    expect(output).toContain('case "a":');
  });
});

// ============================================================================
// Fully-Covered Arm Optimization
// ============================================================================

describe("Wave 5: fully-covered arm optimization", () => {
  function createTypedContext(unionMembers: string[]): {
    ctx: MacroContextImpl;
    printExpr: (node: ts.Expression) => string;
  } {
    const { ctx, printExpr } = createTestContext();
    const checker = getSharedProgram().getTypeChecker();
    const memberTypes = unionMembers.map((m) => checker.getStringLiteralType(m));
    const unionType = memberTypes.length === 1 ? memberTypes[0] : checker.getUnionType(memberTypes);
    ctx.getTypeOf = () => unionType;
    return { ctx, printExpr };
  }

  it('should omit runtime check for second arm when scrutinee is "ok" | "fail"', () => {
    const { ctx, printExpr } = createTypedContext(["ok", "fail"]);

    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [str("ok")] },
      { method: "then", args: [num(1)] },
      { method: "case", args: [str("fail")] },
      { method: "then", args: [num(2)] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain('=== "ok"');
    expect(output).not.toContain('=== "fail"');
    expect(output).toContain("return 2");
  });

  it("should omit runtime check for last arm of 3-member union", () => {
    const { ctx, printExpr } = createTypedContext(["a", "b", "c"]);

    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [str("a")] },
      { method: "then", args: [num(1)] },
      { method: "case", args: [str("b")] },
      { method: "then", args: [num(2)] },
      { method: "case", args: [str("c")] },
      { method: "then", args: [num(3)] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain('=== "a"');
    expect(output).toContain('=== "b"');
    expect(output).not.toContain('=== "c"');
    expect(output).toContain("return 3");
  });

  it("should NOT optimize when arm has a guard", () => {
    const { ctx, printExpr } = createTypedContext(["ok", "fail"]);

    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [str("ok")] },
      { method: "then", args: [num(1)] },
      { method: "case", args: [str("fail")] },
      { method: "if", args: [ident("cond")] },
      { method: "then", args: [num(2)] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain('=== "fail"');
  });

  it("should still work with else clause present", () => {
    const { ctx, printExpr } = createTypedContext(["ok", "fail"]);

    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [str("ok")] },
      { method: "then", args: [num(1)] },
      { method: "case", args: [str("fail")] },
      { method: "then", args: [num(2)] },
      { method: "else", args: [num(0)] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);

    expect(output).toContain('=== "ok"');
    expect(output).not.toContain('=== "fail"');
  });
});

// ============================================================================
// Code Review Fixes (PEP-008)
// ============================================================================

describe("Code review fixes", () => {
  function createTypedCtx(unionMembers: string[]): {
    ctx: MacroContextImpl;
    printExpr: (node: ts.Expression) => string;
  } {
    const { ctx, printExpr } = createTestContext();
    const checker = getSharedProgram().getTypeChecker();
    const memberTypes = unionMembers.map((m) => checker.getStringLiteralType(m));
    const unionType = memberTypes.length === 1 ? memberTypes[0] : checker.getUnionType(memberTypes);
    ctx.getTypeOf = () => unionType;
    return { ctx, printExpr };
  }

  it("C2: fully-covered arm with AS binding should still generate binding", () => {
    const { ctx, printExpr } = createTypedCtx(["ok", "fail"]);

    const { outermost, rootArgs } = buildChain(
      ident("status"),
      { method: "case", args: [str("ok")] },
      { method: "then", args: [num(1)] },
      { method: "case", args: [str("fail")] },
      { method: "as", args: [ident("s")] },
      { method: "then", args: [ident("s")] }
    );

    const result = expandFluentMatch(ctx, outermost, rootArgs);
    const output = printExpr(result);
    // Must generate binding for `s` even though arm is fully covered
    expect(output).toContain("const s");
  });

  it("H2: wildcard in OR alternative should make match exhaustive", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [num(42)] },
      { method: "or", args: [ident("_")] },
      { method: "then", args: [str("yes")] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    // Should NOT report non-exhaustive because _ in .or() covers everything
    expect(diagnostics.filter((d) => d.message.includes("Non-exhaustive"))).toHaveLength(0);
  });

  it("M5: duplicate literal in OR should be reported as unreachable", () => {
    const { ctx } = createTestContext();
    const { outermost, rootArgs } = buildChain(
      ident("x"),
      { method: "case", args: [num(42)] },
      { method: "or", args: [num(42)] },
      { method: "then", args: [str("yes")] },
      { method: "else", args: [str("no")] }
    );

    expandFluentMatch(ctx, outermost, rootArgs);
    const diagnostics = ctx.getDiagnostics();
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(
      warnings.some(
        (w) =>
          w.message.includes("already matched") ||
          w.message.includes("Unreachable") ||
          w.message.includes("duplicate")
      )
    ).toBe(true);
  });
});
