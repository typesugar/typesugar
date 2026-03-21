import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import { fusedMacro, resetFusionCounter } from "../macros.js";

// ============================================================================
// Helpers — parse source to CallExpression and run the macro
// ============================================================================

/**
 * Parse a TypeScript expression and return the outermost CallExpression.
 */
function parseExpr(source: string): ts.CallExpression {
  const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0];
  if (!ts.isExpressionStatement(stmt)) throw new Error("Expected ExpressionStatement");
  const expr = stmt.expression;
  if (!ts.isCallExpression(expr)) throw new Error("Expected CallExpression");
  return expr;
}

/**
 * Print a TS node back to source text.
 */
function print(node: ts.Node): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest);
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

/**
 * Create a minimal MacroContext stub for testing.
 */
function createStubContext(): any {
  const sf = ts.createSourceFile("test.ts", "", ts.ScriptTarget.Latest);
  return {
    factory: ts.factory,
    sourceFile: sf,
  };
}

/**
 * Run the fused macro on a source string and return the output text.
 */
function expandFused(source: string): string {
  const call = parseExpr(source);
  const ctx = createStubContext();
  const args = call.arguments;
  const result = fusedMacro.expand(ctx, call, args as unknown as readonly ts.Expression[]);
  return print(result);
}

// ============================================================================
// Tests
// ============================================================================

describe("fused() macro — compile-time fusion", () => {
  beforeEach(() => {
    resetFusionCounter();
  });

  // --------------------------------------------------------------------------
  // map + reduce
  // --------------------------------------------------------------------------

  it("fuses map + reduce into a single loop", () => {
    const output = expandFused(`fused(arr.map(x => x * 2).reduce((a, b) => a + b, 0))`);
    // Should contain a for-of loop over arr
    expect(output).toContain("for (const __el0 of arr)");
    // Should have a map step creating an intermediate variable
    expect(output).toContain("const __v0_0 =");
    expect(output).toContain("(__el0)");
    // Should call the reduce function with accumulator
    expect(output).toContain("__acc0 =");
    expect(output).toContain("__acc0, __v0_0)");
    // Should initialize the accumulator
    expect(output).toContain("let __acc0 =");
    // Should be wrapped in an IIFE
    expect(output).toContain("(() =>");
    expect(output).toContain("return __acc0");
  });

  // --------------------------------------------------------------------------
  // map + filter + reduce (the canonical example)
  // --------------------------------------------------------------------------

  it("fuses map + filter + reduce into a single loop", () => {
    const output = expandFused(
      `fused(arr.map(x => x * 2).filter(x => x > 5).reduce((a, b) => a + b, 0))`
    );
    expect(output).toContain("for (const __el0 of arr)");
    // Map step creates intermediate variable
    expect(output).toContain("const __v0_0 =");
    // Filter step with continue
    expect(output).toContain("continue");
    // Reduce step with accumulator update
    expect(output).toContain("__acc0 =");
    expect(output).toContain("let __acc0 =");
  });

  // --------------------------------------------------------------------------
  // filter + toArray
  // --------------------------------------------------------------------------

  it("fuses filter + toArray into a single loop", () => {
    const output = expandFused(`fused(data.filter(x => x > 0).toArray())`);
    expect(output).toContain("for (const __el0 of data)");
    expect(output).toContain("(x => x >");
    expect(output).toContain("continue");
    expect(output).toContain("__arr0.push");
    expect(output).toContain("return __arr0");
  });

  // --------------------------------------------------------------------------
  // map + sum
  // --------------------------------------------------------------------------

  it("fuses map + sum into a single loop", () => {
    const output = expandFused(`fused(nums.map(x => x * x).sum())`);
    expect(output).toContain("for (const __el0 of nums)");
    expect(output).toContain("(x => x * x)(__el0)");
    expect(output).toContain("let __sum0 = 0");
    expect(output).toContain("return __sum0");
  });

  // --------------------------------------------------------------------------
  // filter + count
  // --------------------------------------------------------------------------

  it("fuses filter + count into a single loop", () => {
    const output = expandFused(`fused(items.filter(x => x.active).count())`);
    expect(output).toContain("for (const __el0 of items)");
    expect(output).toContain("__count0++");
    expect(output).toContain("return __count0");
  });

  // --------------------------------------------------------------------------
  // filter + find
  // --------------------------------------------------------------------------

  it("fuses map + find into a single loop", () => {
    const output = expandFused(`fused(arr.map(x => x * 2).find(x => x > 10))`);
    expect(output).toContain("for (const __el0 of arr)");
    expect(output).toContain("return __v0_0");
    expect(output).toContain("return null");
  });

  // --------------------------------------------------------------------------
  // some
  // --------------------------------------------------------------------------

  it("fuses filter + some into a single loop", () => {
    const output = expandFused(`fused(arr.filter(x => x > 0).some(x => x === 42))`);
    expect(output).toContain("return true");
    expect(output).toContain("return false");
  });

  // --------------------------------------------------------------------------
  // every
  // --------------------------------------------------------------------------

  it("fuses map + every into a single loop", () => {
    const output = expandFused(`fused(arr.map(x => x > 0).every(x => x))`);
    expect(output).toContain("return false");
    expect(output).toContain("return true");
  });

  // --------------------------------------------------------------------------
  // forEach
  // --------------------------------------------------------------------------

  it("fuses filter + forEach into a single loop", () => {
    const output = expandFused(`fused(arr.filter(x => x > 0).forEach(x => console.log(x)))`);
    expect(output).toContain("for (const __el0 of arr)");
    expect(output).toContain("continue");
    expect(output).toContain("console.log");
  });

  // --------------------------------------------------------------------------
  // first / last
  // --------------------------------------------------------------------------

  it("fuses filter + first into a single loop", () => {
    const output = expandFused(`fused(arr.filter(x => x > 0).first())`);
    expect(output).toContain("return __el0");
    expect(output).toContain("return null");
  });

  it("fuses map + last into a single loop", () => {
    const output = expandFused(`fused(arr.map(x => x * 2).last())`);
    expect(output).toContain("__last0 =");
    expect(output).toContain("return __last0");
  });

  // --------------------------------------------------------------------------
  // Counter increments for multiple fusions
  // --------------------------------------------------------------------------

  it("uses unique variable names across multiple fusions", () => {
    const out1 = expandFused(`fused(a.map(x => x).toArray())`);
    const out2 = expandFused(`fused(b.map(x => x).toArray())`);
    expect(out1).toContain("__el0");
    expect(out2).toContain("__el1");
  });

  // --------------------------------------------------------------------------
  // Pass-through for unrecognized patterns
  // --------------------------------------------------------------------------

  it("passes through for non-chain arguments", () => {
    const source = `fused(42)`;
    const call = parseExpr(source);
    const ctx = createStubContext();
    const result = fusedMacro.expand(
      ctx,
      call,
      call.arguments as unknown as readonly ts.Expression[]
    );
    // Should return the original call expression
    expect(result).toBe(call);
  });

  it("passes through for unsupported intermediate operations", () => {
    const source = `fused(arr.flatMap(x => [x]).toArray())`;
    const call = parseExpr(source);
    const ctx = createStubContext();
    const result = fusedMacro.expand(
      ctx,
      call,
      call.arguments as unknown as readonly ts.Expression[]
    );
    // flatMap is not supported as intermediate in compile-time fusion, should pass through
    expect(result).toBe(call);
  });

  it("passes through when no arguments", () => {
    const source = `fused()`;
    const call = parseExpr(source);
    const ctx = createStubContext();
    const result = fusedMacro.expand(
      ctx,
      call,
      call.arguments as unknown as readonly ts.Expression[]
    );
    expect(result).toBe(call);
  });

  // --------------------------------------------------------------------------
  // take as intermediate step
  // --------------------------------------------------------------------------

  it("fuses map + take + toArray into a single loop with break", () => {
    const output = expandFused(`fused(arr.map(x => x * 2).take(3).toArray())`);
    expect(output).toContain("for (const __el0 of arr)");
    // Map step
    expect(output).toContain("const __v0_0 =");
    // Take counter declaration (printer may strip literal from detached AST nodes)
    expect(output).toContain("let __take0_1");
    // Take check and break
    expect(output).toContain("break");
    expect(output).toContain("__take0_1--");
    // Array accumulation
    expect(output).toContain("__arr0.push");
    expect(output).toContain("return __arr0");
  });

  it("fuses filter + take + reduce into a single loop", () => {
    const output = expandFused(`fused(arr.filter(x => x > 0).take(5).reduce((a, b) => a + b, 0))`);
    expect(output).toContain("for (const __el0 of arr)");
    // Filter with continue
    expect(output).toContain("continue");
    // Take counter
    expect(output).toContain("__take0_0");
    expect(output).toContain("break");
    // Reduce accumulator
    expect(output).toContain("let __acc0 =");
    expect(output).toContain("return __acc0");
  });

  it("fuses map + take + sum into a single loop", () => {
    const output = expandFused(`fused(nums.map(x => x * x).take(10).sum())`);
    expect(output).toContain("for (const __el0 of nums)");
    expect(output).toContain("break");
    expect(output).toContain("let __sum0 = 0");
    expect(output).toContain("return __sum0");
  });

  // --------------------------------------------------------------------------
  // Multiple maps chained
  // --------------------------------------------------------------------------

  it("fuses multiple maps into a single loop", () => {
    const output = expandFused(`fused(arr.map(x => x + 1).map(x => x * 2).toArray())`);
    expect(output).toContain("for (const __el0 of arr)");
    // Two intermediate variables
    expect(output).toContain("const __v0_0 =");
    expect(output).toContain("const __v0_1 =");
    expect(output).toContain("__arr0.push(__v0_1)");
  });

  // --------------------------------------------------------------------------
  // filter + map + filter + reduce (multiple filters)
  // --------------------------------------------------------------------------

  it("fuses multiple filters into a single loop", () => {
    const output = expandFused(
      `fused(arr.filter(x => x > 0).map(x => x * 2).filter(x => x < 100).toArray())`
    );
    expect(output).toContain("for (const __el0 of arr)");
    // Two continue statements for two filters
    const continueCount = (output.match(/continue/g) || []).length;
    expect(continueCount).toBe(2);
  });
});
