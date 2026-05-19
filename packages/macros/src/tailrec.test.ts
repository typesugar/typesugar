/**
 * Tests for tailrec.ts — @tailrec attribute macro.
 *
 * Covers:
 * - Macro metadata (kind, name, validTargets, module).
 * - Successful TCO transformations (factorial-style, if-return, ternary).
 * - Diagnostic emission for non-tail recursion, missing recursion, try/catch.
 * - Unsupported declaration shapes (arrow function, function expression, class
 *   method, default-export anonymous function, missing body).
 * - Structural AST assertions on the rewritten body: presence of a
 *   `while (true) { ... }`, parameter rebinding `let _p = p`, replacement of
 *   recursive `return f(...)` with `continue`, lifting of ternaries to
 *   `if/else`, and handling of `await`/`as` wrappers.
 *
 * Assertions walk the produced AST (no string-matching of printed output)
 * with the exception of a couple of cross-checks on printed output to detect
 * leaked recursion.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { tailrecAttribute } from "./tailrec.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailrec-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Run `tailrecAttribute.expand` against the first matching target in the
 * source file. The selector picks the target node (typically a function
 * declaration).
 */
function runTailrec(
  source: string,
  pick: (sf: ts.SourceFile) => ts.Declaration | undefined
): {
  result: ts.Node;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
  printed: string;
  sourceFile: ts.SourceFile;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    const target = pick(sourceFile);
    if (!target) {
      throw new Error("Test target not found in source");
    }

    let collected: ts.Node = target;
    let diags: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];
    let printed = "";
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      const dummyDecorator = ts.factory.createDecorator(ts.factory.createIdentifier("tailrec"));
      const result = tailrecAttribute.expand(ctx, dummyDecorator, target, []);
      collected = Array.isArray(result) ? result[0] : result;
      printed = printer.printNode(ts.EmitHint.Unspecified, collected, sourceFile);
      diags = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);

    return { result: collected, diagnostics: diags, printed, sourceFile };
  } finally {
    cleanup();
  }
}

/** Recursively count nodes matching a predicate. */
function countNodes(root: ts.Node, pred: (n: ts.Node) => boolean): number {
  let count = 0;
  function visit(n: ts.Node): void {
    if (pred(n)) count++;
    n.forEachChild(visit);
  }
  visit(root);
  return count;
}

/** Find the first node matching a predicate. */
function findFirst<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T | undefined {
  let found: T | undefined;
  function visit(n: ts.Node): void {
    if (found) return;
    if (pred(n)) {
      found = n;
      return;
    }
    n.forEachChild(visit);
  }
  visit(root);
  return found;
}

/** Pick the first FunctionDeclaration with the given name from the source file. */
function pickFunc(name: string) {
  return (sf: ts.SourceFile): ts.FunctionDeclaration | undefined =>
    sf.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name
    );
}

/** Get the transformed function body block. */
function getBody(result: ts.Node): ts.Block {
  expect(ts.isFunctionDeclaration(result)).toBe(true);
  const fn = result as ts.FunctionDeclaration;
  expect(fn.body).toBeDefined();
  return fn.body!;
}

/** Get the inner while-statement of a successfully transformed function. */
function getWhileLoop(result: ts.Node): ts.WhileStatement {
  const body = getBody(result);
  const whileStmt = findFirst(body, ts.isWhileStatement);
  expect(whileStmt).toBeDefined();
  return whileStmt!;
}

// ===========================================================================
// Macro metadata
// ===========================================================================

describe("tailrecAttribute metadata", () => {
  it("is registered as an attribute macro named 'tailrec'", () => {
    expect(tailrecAttribute.kind).toBe("attribute");
    expect(tailrecAttribute.name).toBe("tailrec");
  });

  it("is sourced from the 'typesugar' module", () => {
    expect(tailrecAttribute.module).toBe("typesugar");
    expect(tailrecAttribute.exportName).toBe("tailrec");
  });

  it("validTargets is ['function']", () => {
    expect(tailrecAttribute.validTargets).toEqual(["function"]);
  });

  it("has a non-empty description mentioning Scala or tail-recursive semantics", () => {
    expect(typeof tailrecAttribute.description).toBe("string");
    expect(tailrecAttribute.description!.length).toBeGreaterThan(0);
    expect(tailrecAttribute.description!.toLowerCase()).toMatch(/tail|scala|stack/);
  });
});

// ===========================================================================
// Successful transformations
// ===========================================================================

describe("simple tail-recursive factorial", () => {
  const source = `
    function factorial(n: number, acc: number): number {
      if (n <= 1) return acc;
      return factorial(n - 1, n * acc);
    }
  `;

  it("emits no diagnostics", () => {
    const { diagnostics } = runTailrec(source, pickFunc("factorial"));
    expect(diagnostics).toEqual([]);
  });

  it("preserves the function name and parameter list", () => {
    const { result } = runTailrec(source, pickFunc("factorial"));
    const fn = result as ts.FunctionDeclaration;
    expect(fn.name?.text).toBe("factorial");
    expect(fn.parameters.length).toBe(2);
    expect((fn.parameters[0].name as ts.Identifier).text).toBe("n");
    expect((fn.parameters[1].name as ts.Identifier).text).toBe("acc");
  });

  it("wraps the body in a single while(true) loop", () => {
    const { result } = runTailrec(source, pickFunc("factorial"));
    const body = getBody(result);
    // The body should have: 2 let-decls + 1 while-statement at the top level.
    expect(body.statements.length).toBe(3);
    expect(ts.isVariableStatement(body.statements[0])).toBe(true);
    expect(ts.isVariableStatement(body.statements[1])).toBe(true);
    expect(ts.isWhileStatement(body.statements[2])).toBe(true);
    const whileStmt = body.statements[2] as ts.WhileStatement;
    expect(whileStmt.expression.kind).toBe(ts.SyntaxKind.TrueKeyword);
  });

  it("introduces let-bound mutable shadows _n and _acc", () => {
    const { result } = runTailrec(source, pickFunc("factorial"));
    const body = getBody(result);
    const letDecls = body.statements
      .filter(ts.isVariableStatement)
      .filter((s) => (s.declarationList.flags & ts.NodeFlags.Let) !== 0);
    expect(letDecls.length).toBe(2);

    const names = letDecls.map(
      (s) => (s.declarationList.declarations[0].name as ts.Identifier).text
    );
    expect(names.sort()).toEqual(["_acc", "_n"]);

    // Each let-binding initialises from the original parameter identifier.
    for (const decl of letDecls) {
      const d = decl.declarationList.declarations[0];
      expect(d.initializer).toBeDefined();
      expect(ts.isIdentifier(d.initializer!)).toBe(true);
    }
  });

  it("inserts at least one continue statement and removes recursive call sites", () => {
    const { result } = runTailrec(source, pickFunc("factorial"));
    const fn = result as ts.FunctionDeclaration;
    const continues = countNodes(fn.body!, ts.isContinueStatement);
    expect(continues).toBeGreaterThanOrEqual(1);

    // No CallExpression to 'factorial' should remain inside the body.
    const remaining = countNodes(
      fn.body!,
      (n) =>
        ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "factorial"
    );
    expect(remaining).toBe(0);
  });

  it("rewrites parameter references in the surviving return to use the _-shadowed names", () => {
    const { result } = runTailrec(source, pickFunc("factorial"));
    const ret = findFirst(getBody(result), ts.isReturnStatement);
    expect(ret).toBeDefined();
    expect(ret!.expression).toBeDefined();
    expect(ts.isIdentifier(ret!.expression!)).toBe(true);
    expect((ret!.expression as ts.Identifier).text).toBe("_acc");
  });
});

// ===========================================================================
// if-statement tail call
// ===========================================================================

describe("if-statement tail call (base case + recursive return)", () => {
  const source = `
    function down(n: number): number {
      if (n <= 0) return 0;
      return down(n - 1);
    }
  `;

  it("is transformed without diagnostics", () => {
    const { diagnostics } = runTailrec(source, pickFunc("down"));
    expect(diagnostics).toEqual([]);
  });

  it("produces a while-loop containing the base case and a continue", () => {
    const { result } = runTailrec(source, pickFunc("down"));
    const whileStmt = getWhileLoop(result);
    expect(countNodes(whileStmt, ts.isContinueStatement)).toBeGreaterThanOrEqual(1);
    // The base case `return 0;` is still present.
    const ret = findFirst(
      whileStmt,
      (n): n is ts.ReturnStatement =>
        ts.isReturnStatement(n) &&
        n.expression !== undefined &&
        ts.isNumericLiteral(n.expression) &&
        n.expression.text === "0"
    );
    expect(ret).toBeDefined();
  });
});

// ===========================================================================
// Ternary tail call (lifted to if/else)
// ===========================================================================

describe("ternary tail call lifting", () => {
  const source = `
    function ten(n: number): number {
      return n <= 0 ? 0 : ten(n - 1);
    }
  `;

  it("emits no diagnostics", () => {
    const { diagnostics } = runTailrec(source, pickFunc("ten"));
    expect(diagnostics).toEqual([]);
  });

  it("lifts the ternary into an if-statement with a continue in the recursive arm", () => {
    const { result } = runTailrec(source, pickFunc("ten"));
    const whileStmt = getWhileLoop(result);
    // No ConditionalExpression should survive in the loop body.
    expect(countNodes(whileStmt, ts.isConditionalExpression)).toBe(0);

    // An if-statement with both branches must be present.
    const ifStmt = findFirst(whileStmt, ts.isIfStatement);
    expect(ifStmt).toBeDefined();
    expect(ifStmt!.thenStatement).toBeDefined();
    expect(ifStmt!.elseStatement).toBeDefined();

    // At least one continue is reachable from the if.
    expect(countNodes(ifStmt!, ts.isContinueStatement)).toBeGreaterThanOrEqual(1);
  });

  it("removes all recursive call sites after lifting", () => {
    const { result } = runTailrec(source, pickFunc("ten"));
    const remaining = countNodes(
      getBody(result),
      (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "ten"
    );
    expect(remaining).toBe(0);
  });
});

describe("ternary with recursive calls in BOTH arms", () => {
  const source = `
    function pick(n: number, flag: boolean): number {
      return flag ? pick(n - 1, false) : pick(n + 1, true);
    }
  `;

  it("transforms both arms into trampoline blocks", () => {
    const { result, diagnostics } = runTailrec(source, pickFunc("pick"));
    expect(diagnostics).toEqual([]);
    const whileStmt = getWhileLoop(result);
    // Two continues, one per arm.
    expect(countNodes(whileStmt, ts.isContinueStatement)).toBe(2);
    expect(
      countNodes(
        whileStmt,
        (n) =>
          ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "pick"
      )
    ).toBe(0);
  });
});

// ===========================================================================
// Mutually exclusive if branches with two recursive calls
// ===========================================================================

describe("two recursive calls in mutually exclusive if-branches", () => {
  const source = `
    function bounce(n: number): number {
      if (n > 100) return 100;
      if (n < 0) return bounce(n + 10);
      return bounce(n - 1);
    }
  `;

  it("transforms both recursive sites with continue", () => {
    const { result, diagnostics } = runTailrec(source, pickFunc("bounce"));
    expect(diagnostics).toEqual([]);
    expect(countNodes(getBody(result), ts.isContinueStatement)).toBe(2);
    expect(
      countNodes(
        getBody(result),
        (n) =>
          ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "bounce"
      )
    ).toBe(0);
  });
});

// ===========================================================================
// Diagnostic: non-tail-position recursion
// ===========================================================================

describe("non-tail-position recursion", () => {
  it("emits an error for `return f(n - 1) + 1` (call inside a binary op)", () => {
    const source = `
      function f(n: number): number {
        if (n === 0) return 0;
        return f(n - 1) + 1;
      }
    `;
    const { result, diagnostics } = runTailrec(source, pickFunc("f"));
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(diagnostics[0].message).toMatch(/tail position|could not optimize/i);

    // The macro returns the original function untouched on failure.
    expect(ts.isFunctionDeclaration(result)).toBe(true);
    // No while loop synthesised — the body is the original.
    const whileStmt = findFirst(getBody(result), ts.isWhileStatement);
    expect(whileStmt).toBeUndefined();
  });

  it("emits an error for a recursive call inside try/catch", () => {
    const source = `
      function safe(n: number): number {
        try { return safe(n - 1); } catch { return 0; }
      }
    `;
    const { diagnostics, result } = runTailrec(source, pickFunc("safe"));
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/try.*catch|tail position/i);
    expect(findFirst(getBody(result), ts.isWhileStatement)).toBeUndefined();
  });

  /**
   * BUG (tailrec.ts): `findRecursiveCalls` treats the expression of any
   * `ReturnStatement` as a tail position unconditionally — even when the
   * `return` is itself nested inside a `for` / `while` / `do-while` body
   * (which is NOT a tail position). The function then proceeds to
   * `transformTailRecursion`, where `rewriteParamRefs` crashes inside
   * `ts.visitEachChild` with "Cannot start a block scope during
   * initialization" while descending into the loop.
   *
   * Expected behaviour: emit a diagnostic that the recursive call inside the
   * loop is not in tail position, leave the function untouched.
   *
   * Pinning the current (broken) behaviour as an `expect().toThrow` so the
   * test fails the day the bug is fixed and prompts an update.
   */
  it("BUG: recursive return inside a loop body crashes the macro instead of emitting a tail-position diagnostic", () => {
    const source = `
      function loopy(n: number): number {
        while (n > 10) {
          return loopy(n - 1);
        }
        return n;
      }
    `;
    expect(() => runTailrec(source, pickFunc("loopy"))).toThrow(
      /Cannot start a block scope|block scope/i
    );
  });
});

// ===========================================================================
// Diagnostic: no recursion at all
// ===========================================================================

describe("function with no recursive calls", () => {
  it("emits an error explaining that @tailrec requires a self-call", () => {
    const source = `
      function plain(n: number): number {
        return n + 1;
      }
    `;
    const { diagnostics, result } = runTailrec(source, pickFunc("plain"));
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/no recursive calls|requires at least one/i);

    // Function is returned unmodified.
    expect(ts.isFunctionDeclaration(result)).toBe(true);
    expect(findFirst(getBody(result), ts.isWhileStatement)).toBeUndefined();
  });
});

// ===========================================================================
// Wrapping: await / as / parentheses / non-null
// ===========================================================================

describe("wrapping unwrappers (parens, as, non-null assert)", () => {
  it("treats `return (f(n - 1))` (parenthesised) as a tail call", () => {
    const source = `
      function p(n: number): number {
        if (n <= 0) return 0;
        return (p(n - 1));
      }
    `;
    const { diagnostics, result } = runTailrec(source, pickFunc("p"));
    expect(diagnostics).toEqual([]);
    expect(findFirst(getBody(result), ts.isWhileStatement)).toBeDefined();
  });

  it("treats `return f(n - 1) as number` (as-cast) as a tail call", () => {
    const source = `
      function c(n: number): number {
        if (n <= 0) return 0;
        return c(n - 1) as number;
      }
    `;
    const { diagnostics, result } = runTailrec(source, pickFunc("c"));
    expect(diagnostics).toEqual([]);
    expect(findFirst(getBody(result), ts.isWhileStatement)).toBeDefined();
  });

  it("treats `return f(n - 1)!` (non-null) as a tail call", () => {
    const source = `
      function nn(n: number): number {
        if (n <= 0) return 0;
        return nn(n - 1)!;
      }
    `;
    const { diagnostics } = runTailrec(source, pickFunc("nn"));
    expect(diagnostics).toEqual([]);
  });

  it("rejects `return await f(n - 1)` (await wraps the call, so it isn't a direct tail call)", () => {
    // await is NOT in the unwrap list — it's an operation that runs *after* the
    // call completes, so the recursive call is not in tail position. The macro
    // should reject this.
    const source = `
      async function aw(n: number): Promise<number> {
        if (n <= 0) return 0;
        return await aw(n - 1);
      }
    `;
    const { diagnostics } = runTailrec(source, pickFunc("aw"));
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].severity).toBe("error");
  });
});

// ===========================================================================
// Logical && / || RHS as tail position
// ===========================================================================

describe("logical operators with tail-position RHS", () => {
  it("accepts `return cond && f(n - 1)` as a tail call", () => {
    const source = `
      function la(n: number): unknown {
        return n > 0 && la(n - 1);
      }
    `;
    const { diagnostics } = runTailrec(source, pickFunc("la"));
    expect(diagnostics).toEqual([]);
  });

  it("accepts `return cond || f(n - 1)` as a tail call", () => {
    const source = `
      function lo(n: number): unknown {
        return n > 0 || lo(n - 1);
      }
    `;
    const { diagnostics } = runTailrec(source, pickFunc("lo"));
    expect(diagnostics).toEqual([]);
  });
});

// ===========================================================================
// Unsupported declaration shapes
// ===========================================================================

describe("unsupported declaration shapes", () => {
  it("rejects an arrow function assigned to a variable (not a FunctionDeclaration)", () => {
    const source = `const arrow = (n: number): number => n <= 0 ? 0 : arrow(n - 1);`;
    const { diagnostics, result } = runTailrec(source, (sf) => {
      const v = sf.statements.find(ts.isVariableStatement)!;
      return v.declarationList.declarations[0];
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/function declarations/);
    // The original target is returned unmodified.
    expect(ts.isVariableDeclaration(result)).toBe(true);
  });

  it("rejects a class method declaration", () => {
    const source = `
      class C {
        m(n: number): number {
          if (n <= 0) return 0;
          return this.m(n - 1);
        }
      }
    `;
    const { diagnostics } = runTailrec(source, (sf) => {
      const cls = sf.statements.find(ts.isClassDeclaration)!;
      return cls.members.find(ts.isMethodDeclaration);
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/function declarations/);
  });

  it("rejects a function declaration with no name (export-default anonymous)", () => {
    // `export default function (n) { ... }` is a FunctionDeclaration with no
    // identifier — the macro requires a name in order to detect recursive calls.
    const source = `export default function (n: number): number { return n; }`;
    const { diagnostics } = runTailrec(source, (sf) =>
      sf.statements.find(ts.isFunctionDeclaration)
    );
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/must have a name|no recursive calls/i);
  });

  it("rejects an ambient function declaration (no body)", () => {
    // `declare function f(): void;` has no body — the macro requires one.
    const source = `declare function noBody(n: number): number;`;
    const { diagnostics } = runTailrec(source, pickFunc("noBody"));
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/must have a body/);
  });
});

// ===========================================================================
// Decorator stripping (the @tailrec decorator should not survive)
// ===========================================================================

describe("decorator stripping on the transformed function", () => {
  it("does not retain the @tailrec decorator on the rewritten function", () => {
    const source = `
      function dec(n: number): number {
        if (n <= 0) return 0;
        return dec(n - 1);
      }
    `;
    const { result } = runTailrec(source, pickFunc("dec"));
    const fn = result as ts.FunctionDeclaration;
    const decorators = (fn.modifiers ?? []).filter((m) => ts.isDecorator(m));
    expect(decorators.length).toBe(0);
  });
});

// ===========================================================================
// Switch-statement tail call (tail-position branches)
// ===========================================================================

describe("switch-statement tail call", () => {
  it("transforms recursive calls in the last position of case clauses", () => {
    const source = `
      function sw(n: number): number {
        switch (n) {
          case 0: return 0;
          default: return sw(n - 1);
        }
      }
    `;
    const { diagnostics, result } = runTailrec(source, pickFunc("sw"));
    expect(diagnostics).toEqual([]);
    const whileStmt = getWhileLoop(result);
    expect(countNodes(whileStmt, ts.isContinueStatement)).toBeGreaterThanOrEqual(1);
    expect(
      countNodes(
        whileStmt,
        (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "sw"
      )
    ).toBe(0);
  });
});

// ===========================================================================
// Parameter rebinding: tail call uses _next_ temporaries before assigning
// ===========================================================================

describe("parameter rebinding uses _next_ temporaries before reassignment", () => {
  it("introduces const _next_<param> = <new value> for each updated parameter", () => {
    const source = `
      function swap(a: number, b: number): number {
        if (a >= b) return a;
        return swap(b, a + 1);
      }
    `;
    const { result, diagnostics } = runTailrec(source, pickFunc("swap"));
    expect(diagnostics).toEqual([]);
    const whileStmt = getWhileLoop(result);

    // Find the inner block containing the trampoline (created by createTrampolineAssignment).
    // It contains 2 const decls (_next_a, _next_b), 2 assignments, and a continue.
    const constDecls: ts.VariableDeclaration[] = [];
    function visit(n: ts.Node): void {
      if (ts.isVariableStatement(n) && (n.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const d of n.declarationList.declarations) constDecls.push(d);
      }
      n.forEachChild(visit);
    }
    visit(whileStmt);

    const names = constDecls
      .map((d) => (d.name as ts.Identifier).text)
      .filter((s) => s.startsWith("_next_"))
      .sort();
    expect(names).toEqual(["_next_a", "_next_b"]);

    // The values assigned to the mutable shadows should use the temporaries —
    // verify by finding 2 assignment expressions `_a = _next_a` and `_b = _next_b`.
    const assignments: ts.BinaryExpression[] = [];
    function visitA(n: ts.Node): void {
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left) &&
        ts.isIdentifier(n.right)
      ) {
        assignments.push(n);
      }
      n.forEachChild(visitA);
    }
    visitA(whileStmt);

    const pairs = assignments.map((a) => [
      (a.left as ts.Identifier).text,
      (a.right as ts.Identifier).text,
    ]);
    expect(pairs).toContainEqual(["_a", "_next_a"]);
    expect(pairs).toContainEqual(["_b", "_next_b"]);
  });
});

// ===========================================================================
// Cross-check: the printed output of a successful transform contains no
// recursive call to the function name.
// ===========================================================================

describe("printed output sanity check", () => {
  it("the rewritten factorial does not call itself in the printed source", () => {
    const source = `
      function fact2(n: number, acc: number): number {
        if (n <= 1) return acc;
        return fact2(n - 1, n * acc);
      }
    `;
    const { printed, diagnostics, result } = runTailrec(source, pickFunc("fact2"));
    expect(diagnostics).toEqual([]);
    expect(printed).toContain("function fact2");
    expect(printed).toMatch(/while\s*\(\s*true\s*\)/);

    // Structural check: no recursive CallExpression to fact2 survives in the body.
    const remaining = countNodes(
      getBody(result),
      (n) =>
        ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fact2"
    );
    expect(remaining).toBe(0);
  });
});
