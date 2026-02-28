/**
 * Tests for the @tailrec macro
 *
 * Tests macro definition, registration, tail-position analysis, error
 * reporting for non-tail calls, and the transformation into while loops.
 *
 * Categories:
 * 1. Registration & metadata
 * 2. Tail-position analysis (valid patterns)
 * 3. Error detection (invalid patterns — following Scala rules)
 * 4. Transformation correctness (while-loop output)
 * 5. Runtime placeholder behavior
 * 6. Edge cases
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import { globalRegistry } from "@typesugar/core";

// Import to register the tailrec macro
import "@typesugar/macros";

// Import the macro definition directly
import { tailrecAttribute } from "@typesugar/macros";

// Import the runtime placeholder
import { tailrec } from "typesugar";

// ============================================================================
// Helper: Create a macro context for testing
// ============================================================================

function createTestContext(sourceText = "const x = 1;"): MacroContextImpl {
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
    strict: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

  // Use ts.transform to get a real TransformationContext that has all
  // required methods (including startBlockScope for iteration statements).
  let capturedContext: ts.TransformationContext | undefined;
  const dummySf = ts.createSourceFile("__ctx.ts", "", ts.ScriptTarget.Latest, false);
  const transformResult = ts.transform(dummySf, [
    (context) => {
      capturedContext = context;
      return (sf) => sf;
    },
  ]);
  transformResult.dispose();
  const transformContext = capturedContext!;

  return createMacroContext(program, sourceFile, transformContext);
}

/** Print an AST node to a string for assertion */
function printNode(node: ts.Node): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest, false);
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

/**
 * Parse source code and extract the first function declaration.
 * Returns the function declaration and its source file.
 */
function parseFunctionDecl(source: string): {
  fn: ts.FunctionDeclaration;
  sourceFile: ts.SourceFile;
} {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  let fn: ts.FunctionDeclaration | undefined;
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && !fn) {
      fn = node;
    }
  });

  if (!fn) throw new Error("No function declaration found in source");
  return { fn, sourceFile };
}

/**
 * Expand the @tailrec macro on a function declaration source string.
 * Returns the expanded result and any diagnostics.
 */
function expandTailrec(source: string): {
  result: ts.Node | ts.Node[];
  diagnostics: Array<{ severity: string; message: string }>;
  output: string;
} {
  const ctx = createTestContext(source);
  const { fn } = parseFunctionDecl(source);

  // Create a dummy decorator node
  const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("tailrec"));

  const result = tailrecAttribute.expand(ctx, decorator, fn, []);
  const diagnostics = ctx.getDiagnostics();

  const output = Array.isArray(result)
    ? result.map((n) => printNode(n)).join("\n")
    : printNode(result);

  return { result, diagnostics, output };
}

// ============================================================================
// 1. Registration & Metadata
// ============================================================================

describe("tailrec macro registration", () => {
  it("should register tailrec as an attribute macro", () => {
    const macro = globalRegistry.getAttribute("tailrec");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("tailrec");
    expect(macro!.kind).toBe("attribute");
    expect(macro!.module).toBe("typesugar");
  });

  it("should have correct metadata", () => {
    expect(tailrecAttribute.name).toBe("tailrec");
    expect(tailrecAttribute.kind).toBe("attribute");
    expect(tailrecAttribute.validTargets).toContain("function");
    expect(tailrecAttribute.description).toContain("tail-recursive");
  });

  it("should be discoverable by module export", () => {
    const macro = globalRegistry.getByModuleExport("typesugar", "tailrec");
    expect(macro).toBeDefined();
    expect(macro!.name).toBe("tailrec");
  });
});

// ============================================================================
// 2. Valid Tail-Recursive Patterns (should compile successfully)
// ============================================================================

describe("tailrec valid patterns", () => {
  it("should accept simple tail-recursive factorial", () => {
    const { diagnostics, output } = expandTailrec(`
      function factorial(n: number, acc: number): number {
        if (n <= 1) return acc;
        return factorial(n - 1, n * acc);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
    expect(output).toContain("continue");
    // The output should not contain recursive calls (only the function declaration has "factorial")
    const bodyLines = output.split("\n").slice(1); // skip function declaration line
    const hasRecursiveCall = bodyLines.some((line) => /\bfactorial\s*\(/.test(line));
    expect(hasRecursiveCall).toBe(false);
  });

  it("should accept tail-recursive GCD", () => {
    const { diagnostics, output } = expandTailrec(`
      function gcd(a: number, b: number): number {
        if (b === 0) return a;
        return gcd(b, a % b);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });

  it("should accept tail call in both if/else branches", () => {
    const { diagnostics, output } = expandTailrec(`
      function collatz(n: number, steps: number): number {
        if (n === 1) return steps;
        if (n % 2 === 0) return collatz(n / 2, steps + 1);
        return collatz(3 * n + 1, steps + 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });

  it("should accept tail call in else branch with base case in if", () => {
    const { diagnostics, output } = expandTailrec(`
      function sum(list: number[], acc: number): number {
        if (list.length === 0) return acc;
        return sum(list.slice(1), acc + list[0]);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });

  it("should accept tail call in nested if/else", () => {
    const { diagnostics, output } = expandTailrec(`
      function classify(n: number, result: string): string {
        if (n <= 0) return result;
        if (n % 2 === 0) {
          return classify(n - 1, result + "even,");
        } else {
          return classify(n - 1, result + "odd,");
        }
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });

  it("should accept tail call in ternary expression", () => {
    const { diagnostics, output } = expandTailrec(`
      function countdown(n: number): number {
        return n <= 0 ? n : countdown(n - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });

  it("should accept tail call in both branches of ternary", () => {
    const { diagnostics, output } = expandTailrec(`
      function bounce(n: number, up: boolean): number {
        if (n >= 100 || n <= 0) return n;
        return up ? bounce(n + 1, true) : bounce(n - 1, false);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });

  it("should accept tail call as last expression statement", () => {
    const { diagnostics, output } = expandTailrec(`
      function loop(n: number): void {
        if (n <= 0) return;
        console.log(n);
        return loop(n - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
  });
});

// ============================================================================
// 3. Error Detection (invalid patterns — Scala rules)
// ============================================================================

describe("tailrec error detection", () => {
  it("should reject function with no recursive calls", () => {
    const { diagnostics } = expandTailrec(`
      function notRecursive(n: number): number {
        return n + 1;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("no recursive calls");
  });

  it("should reject non-tail recursive call (n * factorial(n-1))", () => {
    const { diagnostics } = expandTailrec(`
      function factorial(n: number): number {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call wrapped in addition", () => {
    const { diagnostics } = expandTailrec(`
      function sum(n: number): number {
        if (n <= 0) return 0;
        return sum(n - 1) + n;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call as argument to another function", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        return Math.abs(f(n - 1));
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call inside try/catch", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        try {
          if (n <= 0) return 0;
          return f(n - 1);
        } catch (e) {
          return -1;
        }
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("try/catch");
  });

  it("should reject recursive call inside catch block", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        try {
          throw new Error();
        } catch (e) {
          if (n <= 0) return 0;
          return f(n - 1);
        }
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("try/catch");
  });

  it("should reject recursive call inside finally block", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        try {
          return 0;
        } finally {
          return f(n - 1);
        }
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("try/catch");
  });

  it("should reject recursive call used as operand of binary expression", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): boolean {
        if (n <= 0) return true;
        return f(n - 1) && true;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject when some calls are tail and some are not", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        if (n === 1) return 1 + f(0);
        return f(n - 1);
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call as loop condition", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        const x = f(n - 1) + 1;
        return x;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call assigned to a variable", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        const result = f(n - 1);
        return result + 1;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call in non-tail position of ternary", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        return (f(n - 1) > 0) ? 1 : 0;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });

  it("should reject recursive call as LHS of arithmetic binary expression", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        return f(n - 1) - 1;
      }
    `);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("not in tail position");
  });
});

// ============================================================================
// 4. Transformation Correctness
// ============================================================================

describe("tailrec transformation", () => {
  it("should produce while(true) loop", () => {
    const { output } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        return f(n - 1);
      }
    `);

    expect(output).toContain("while (true)");
  });

  it("should create mutable variables for parameters", () => {
    const { output } = expandTailrec(`
      function f(n: number, acc: number): number {
        if (n <= 0) return acc;
        return f(n - 1, acc + n);
      }
    `);

    // Should have let declarations for mutable copies (hygienic names)
    expect(output).toMatch(/let __typesugar_tr_n_\d+__ = n/);
    expect(output).toMatch(/let __typesugar_tr_acc_\d+__ = acc/);
  });

  it("should use temporaries for argument evaluation", () => {
    const { output } = expandTailrec(`
      function f(a: number, b: number): number {
        if (a <= 0) return b;
        return f(b, a);
      }
    `);

    // Should use temporaries to avoid order-of-evaluation issues
    // when parameters reference each other (swap pattern) - hygienic names
    expect(output).toMatch(/__typesugar_tr_next_a_\d+__/);
    expect(output).toMatch(/__typesugar_tr_next_b_\d+__/);
  });

  it("should replace parameter references in the body", () => {
    const { output } = expandTailrec(`
      function f(n: number, acc: number): number {
        if (n <= 0) return acc;
        return f(n - 1, acc + n);
      }
    `);

    // The body should reference hygienic variable names
    expect(output).toMatch(/__typesugar_tr_n_\d+__/);
    expect(output).toMatch(/__typesugar_tr_acc_\d+__/);
    expect(output).toMatch(/return __typesugar_tr_acc_\d+__/);
  });

  it("should end trampoline block with continue", () => {
    const { output } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        return f(n - 1);
      }
    `);

    expect(output).toContain("continue;");
  });

  it("should preserve the function signature (params, return type)", () => {
    const { output } = expandTailrec(`
      function factorial(n: number, acc: number): number {
        if (n <= 1) return acc;
        return factorial(n - 1, n * acc);
      }
    `);

    expect(output).toContain("function factorial(n: number, acc: number): number");
  });

  it("should not contain any recursive calls in the output", () => {
    const { output } = expandTailrec(`
      function factorial(n: number, acc: number): number {
        if (n <= 1) return acc;
        return factorial(n - 1, n * acc);
      }
    `);

    // The transformed output should not contain "factorial(" as a call
    // (it will contain "function factorial" in the declaration)
    const lines = output.split("\n");
    const bodyLines = lines.slice(1); // skip the function declaration line
    const hasRecursiveCall = bodyLines.some(
      (line) => line.includes("factorial(") && !line.includes("function factorial")
    );
    expect(hasRecursiveCall).toBe(false);
  });

  it("should handle ternary tail calls by lifting to if/else", () => {
    const { diagnostics, output } = expandTailrec(`
      function f(n: number): number {
        return n <= 0 ? 0 : f(n - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    // The ternary should be lifted to an if statement
    expect(output).toContain("if");
    expect(output).toContain("continue");
  });
});

// ============================================================================
// 5. Runtime Placeholder
// ============================================================================

describe("tailrec runtime placeholder", () => {
  it("should be a function", () => {
    expect(typeof tailrec).toBe("function");
  });

  it("should act as a no-op decorator (return the target)", () => {
    const target = function myFn() {};
    const result = tailrec(target);
    expect(result).toBe(target);
  });
});

// ============================================================================
// 6. Edge Cases
// ============================================================================

describe("tailrec edge cases", () => {
  it("should handle single-parameter function", () => {
    const { diagnostics, output } = expandTailrec(`
      function countdown(n: number): void {
        if (n <= 0) return;
        return countdown(n - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
    expect(output).toMatch(/__typesugar_tr_n_\d+__/);
  });

  it("should handle many parameters", () => {
    const { diagnostics, output } = expandTailrec(`
      function f(a: number, b: number, c: number, d: number): number {
        if (a <= 0) return b + c + d;
        return f(a - 1, b + 1, c + 2, d + 3);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toMatch(/__typesugar_tr_a_\d+__/);
    expect(output).toMatch(/__typesugar_tr_b_\d+__/);
    expect(output).toMatch(/__typesugar_tr_c_\d+__/);
    expect(output).toMatch(/__typesugar_tr_d_\d+__/);
  });

  it("should handle multiple return points with tail calls", () => {
    const { diagnostics, output } = expandTailrec(`
      function f(n: number, acc: number): number {
        if (n <= 0) return acc;
        if (n % 2 === 0) return f(n - 2, acc + n);
        return f(n - 1, acc + n);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
    // Should have two continue statements (one for each tail call)
    const continueCount = (output.match(/continue;/g) || []).length;
    expect(continueCount).toBe(2);
  });

  it("should handle parameter swap pattern correctly", () => {
    // This is a critical test: f(b, a) must use temporaries to avoid
    // clobbering `a` before `b` reads it (or vice versa)
    const { diagnostics, output } = expandTailrec(`
      function gcd(a: number, b: number): number {
        if (b === 0) return a;
        return gcd(b, a % b);
      }
    `);

    expect(diagnostics).toHaveLength(0);
    // Must use temporaries for correct swap semantics (hygienic names)
    expect(output).toMatch(/__typesugar_tr_next_a_\d+__/);
    expect(output).toMatch(/__typesugar_tr_next_b_\d+__/);
  });

  it("should accept recursive call in RHS of logical && (tail position)", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): boolean {
        if (n <= 0) return true;
        return true && f(n - 1);
      }
    `);

    // RHS of && is in tail position (following Scala rules)
    expect(diagnostics).toHaveLength(0);
  });

  it("should accept recursive call in RHS of logical || (tail position)", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): boolean {
        if (n <= 0) return false;
        return false || f(n - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
  });

  it("should accept recursive call in RHS of ?? (tail position)", () => {
    const { diagnostics } = expandTailrec(`
      function f(n: number): number {
        if (n <= 0) return 0;
        return null ?? f(n - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
  });

  it("should handle deeply nested if/else chains", () => {
    const { diagnostics, output } = expandTailrec(`
      function f(n: number, acc: string): string {
        if (n <= 0) return acc;
        if (n % 3 === 0) {
          return f(n - 1, acc + "fizz");
        } else if (n % 5 === 0) {
          return f(n - 1, acc + "buzz");
        } else if (n % 15 === 0) {
          return f(n - 1, acc + "fizzbuzz");
        } else {
          return f(n - 1, acc + String(n));
        }
      }
    `);

    expect(diagnostics).toHaveLength(0);
    expect(output).toContain("while (true)");
    const continueCount = (output.match(/continue;/g) || []).length;
    expect(continueCount).toBe(4);
  });

  it("should handle mix of base cases and recursive calls across branches", () => {
    const { diagnostics } = expandTailrec(`
      function search(arr: number[], target: number, lo: number, hi: number): number {
        if (lo > hi) return -1;
        const mid = Math.floor((lo + hi) / 2);
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) return search(arr, target, mid + 1, hi);
        return search(arr, target, lo, mid - 1);
      }
    `);

    expect(diagnostics).toHaveLength(0);
  });
});

// ============================================================================
// 7. Functional Correctness (run the transformed code mentally)
// ============================================================================

describe("tailrec functional correctness", () => {
  // These tests verify the transformation produces code that would
  // compute the correct result by checking the structure of the output.

  it("transformed factorial should preserve computation structure", () => {
    const { output } = expandTailrec(`
      function factorial(n: number, acc: number): number {
        if (n <= 1) return acc;
        return factorial(n - 1, n * acc);
      }
    `);

    // The output should use hygienic variable names:
    // 1. Initialize mutable vars = original params
    // 2. Check condition, return if so
    // 3. Compute new values with _tr_next_* temporaries
    // 4. Assign and continue
    // Names are now hygienic: __typesugar_tr_<name>_<counter>__
    expect(output).toMatch(/let __typesugar_tr_n_\d+__ = n/);
    expect(output).toMatch(/let __typesugar_tr_acc_\d+__ = acc/);
    expect(output).toMatch(/return __typesugar_tr_acc_\d+__/);
    expect(output).toMatch(/__typesugar_tr_next_n_\d+__/);
    expect(output).toMatch(/__typesugar_tr_next_acc_\d+__/);
    expect(output).toMatch(/__typesugar_tr_n_\d+__ \* __typesugar_tr_acc_\d+__/);
    expect(output).toContain("continue");
  });

  it("transformed GCD should preserve computation structure", () => {
    const { output } = expandTailrec(`
      function gcd(a: number, b: number): number {
        if (b === 0) return a;
        return gcd(b, a % b);
      }
    `);

    // Names are now hygienic: __typesugar_tr_<name>_<counter>__
    expect(output).toMatch(/let __typesugar_tr_a_\d+__ = a/);
    expect(output).toMatch(/let __typesugar_tr_b_\d+__ = b/);
    expect(output).toMatch(/return __typesugar_tr_a_\d+__/);
    // New values for the recursive step
    expect(output).toMatch(/__typesugar_tr_next_a_\d+__/);
    expect(output).toMatch(/__typesugar_tr_next_b_\d+__/);
    expect(output).toMatch(/__typesugar_tr_a_\d+__ % __typesugar_tr_b_\d+__/); // new b = old a % old b
  });
});
