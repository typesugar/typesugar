/**
 * Tests for static-assert.ts — Compile-time assertion and diagnostic macros.
 *
 * Covers:
 * - staticAssertMacro: truthy/falsy comptime conditions, comparisons, runtime
 *   expressions, missing/extra args, message argument variations.
 * - compileErrorMacro: emits an error diagnostic with the supplied message.
 * - compileWarningMacro: emits a warning diagnostic (vs. error severity).
 * - printConditionBrief (indirect, via the `staticAssert(…) ✓` comment):
 *   identifier, binary op, call, long expression truncation.
 * - extractStringArg (indirect, via compileError/compileWarning message):
 *   string literal, no-substitution template, non-string arg.
 * - comptimeToBoolean (indirect, via staticAssert outcome): number, string,
 *   boolean, null/undefined, array/object truthy, no diagnostic on truthy,
 *   diagnostic on falsy.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  createMacroContext,
  getRemoveComment,
  isRemoveExpression,
  type MacroContext,
  type MacroDiagnostic,
} from "@typesugar/core";
import { staticAssertMacro, compileErrorMacro, compileWarningMacro } from "./static-assert.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Harness {
  ctx: MacroContext;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

/** Build a real MacroContext over a tmp source file. */
function makeHarness(source = "export {};"): Harness {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-assert-test-"));
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

  let captured: MacroContext | undefined;
  const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
    captured = createMacroContext(program, sourceFile, transformContext);
    return (sf) => sf;
  };
  ts.transform(sourceFile, [transformerFactory]);

  if (!captured) {
    throw new Error("Failed to capture MacroContext");
  }

  return {
    ctx: captured,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Find the first call expression to `name` in the source file. The macros
 * use `printConditionBrief`, which calls `node.getSourceFile()` — so we must
 * use a node that comes from a real parse, not a synthetic factory call.
 */
function findCall(sf: ts.SourceFile, name: string): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) {
    throw new Error(`No call to ${name} found`);
  }
  return found;
}

/** Build a harness whose source has one `staticAssert(...)` call. */
function withStaticAssert<T>(
  args: string,
  fn: (h: {
    ctx: MacroContext;
    callExpr: ts.CallExpression;
    diagnostics: () => MacroDiagnostic[];
  }) => T
): T {
  const h = makeHarness(`staticAssert(${args});`);
  try {
    const callExpr = findCall(h.sourceFile, "staticAssert");
    return fn({
      ctx: h.ctx,
      callExpr,
      diagnostics: () => h.ctx.getDiagnostics(),
    });
  } finally {
    h.cleanup();
  }
}

function withCompileError<T>(
  args: string,
  fn: (h: {
    ctx: MacroContext;
    callExpr: ts.CallExpression;
    diagnostics: () => MacroDiagnostic[];
  }) => T
): T {
  const h = makeHarness(`compileError(${args});`);
  try {
    const callExpr = findCall(h.sourceFile, "compileError");
    return fn({
      ctx: h.ctx,
      callExpr,
      diagnostics: () => h.ctx.getDiagnostics(),
    });
  } finally {
    h.cleanup();
  }
}

function withCompileWarning<T>(
  args: string,
  fn: (h: {
    ctx: MacroContext;
    callExpr: ts.CallExpression;
    diagnostics: () => MacroDiagnostic[];
  }) => T
): T {
  const h = makeHarness(`compileWarning(${args});`);
  try {
    const callExpr = findCall(h.sourceFile, "compileWarning");
    return fn({
      ctx: h.ctx,
      callExpr,
      diagnostics: () => h.ctx.getDiagnostics(),
    });
  } finally {
    h.cleanup();
  }
}

// ===========================================================================
// Macro registration metadata
// ===========================================================================

describe("static-assert macros — registration metadata", () => {
  it("staticAssertMacro has the expected name/kind/module/cacheable flag", () => {
    expect(staticAssertMacro.kind).toBe("expression");
    expect(staticAssertMacro.name).toBe("staticAssert");
    expect(staticAssertMacro.module).toBe("typesugar");
    expect(staticAssertMacro.cacheable).toBe(false);
  });

  it("compileErrorMacro has the expected name/kind/module/cacheable flag", () => {
    expect(compileErrorMacro.kind).toBe("expression");
    expect(compileErrorMacro.name).toBe("compileError");
    expect(compileErrorMacro.module).toBe("typesugar");
    expect(compileErrorMacro.cacheable).toBe(false);
  });

  it("compileWarningMacro has the expected name/kind/module/cacheable flag", () => {
    expect(compileWarningMacro.kind).toBe("expression");
    expect(compileWarningMacro.name).toBe("compileWarning");
    expect(compileWarningMacro.module).toBe("typesugar");
    expect(compileWarningMacro.cacheable).toBe(false);
  });
});

// ===========================================================================
// staticAssertMacro — truthy comptime values
// ===========================================================================

describe("staticAssertMacro — truthy conditions", () => {
  it("`true` expands to a remove sentinel and emits no diagnostic", () => {
    withStaticAssert(`true, "msg"`, ({ ctx, callExpr, diagnostics }) => {
      const result = staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(isRemoveExpression(result)).toBe(true);
      expect(diagnostics()).toEqual([]);
    });
  });

  it("non-zero number is truthy — no diagnostic", () => {
    withStaticAssert(`1, "n is truthy"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(diagnostics()).toEqual([]);
    });
  });

  it("non-empty string is truthy — no diagnostic", () => {
    withStaticAssert(`"x", "s is truthy"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(diagnostics()).toEqual([]);
    });
  });

  it("array literal is truthy — no diagnostic", () => {
    withStaticAssert(`[1, 2], "arr"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(diagnostics()).toEqual([]);
    });
  });

  it("object literal is truthy — no diagnostic", () => {
    withStaticAssert(`{ a: 1 }, "obj"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(diagnostics()).toEqual([]);
    });
  });
});

// ===========================================================================
// staticAssertMacro — falsy comptime values
// ===========================================================================

describe("staticAssertMacro — falsy conditions emit TS9217", () => {
  it("`false` literal emits TS9217 with the supplied message", () => {
    withStaticAssert(`false, "must be true"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("Static assertion failed");
      expect(diags[0].message).toContain("must be true");
    });
  });

  it("numeric `0` is falsy → error diagnostic", () => {
    withStaticAssert(`0, "n must be nonzero"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("n must be nonzero");
    });
  });

  it("empty string is falsy → error diagnostic", () => {
    withStaticAssert(`"", "no empties"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("no empties");
    });
  });

  it("`null` is falsy → error diagnostic", () => {
    withStaticAssert(`null, "no null"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("no null");
    });
  });

  it("uses the default message when none is supplied", () => {
    withStaticAssert(`false`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("Static assertion failed");
    });
  });
});

// ===========================================================================
// staticAssertMacro — binary comparisons
// ===========================================================================

describe("staticAssertMacro — binary comparisons", () => {
  it("`1 === 1` passes (no diagnostic)", () => {
    withStaticAssert(`1 === 1, "math"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(diagnostics()).toEqual([]);
    });
  });

  it("`1 === 2` fails → TS9217 with message", () => {
    withStaticAssert(`1 === 2, "1 must equal 2"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("1 must equal 2");
    });
  });

  it("`(1 + 1) === 2` passes (folded arithmetic)", () => {
    withStaticAssert(`1 + 1 === 2, "addition"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      expect(diagnostics()).toEqual([]);
    });
  });

  it("`2 > 5` fails (folded comparison)", () => {
    withStaticAssert(`2 > 5, "gt"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("gt");
    });
  });
});

// ===========================================================================
// staticAssertMacro — non-comptime conditions
// ===========================================================================

describe("staticAssertMacro — non-comptime conditions emit TS9219", () => {
  it("a runtime call expression emits TS9219 and a 'note' carrying the message", () => {
    withStaticAssert(`fetchData(), "data must be present"`, ({ ctx, callExpr, diagnostics }) => {
      const result = staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      // TS9219 messageTemplate is the canonical "must be a compile-time
      // constant" message; the user-supplied message is attached as a note.
      expect(diags[0].message).toMatch(/compile-time constant/i);
      // The remove sentinel carries an "(unverified — not a compile-time…)" comment.
      expect(isRemoveExpression(result)).toBe(true);
      expect(getRemoveComment(result)).toContain("unverified");
      expect(getRemoveComment(result)).toContain("data must be present");
    });
  });

  it("an unresolved identifier (no value binding) emits TS9219", () => {
    withStaticAssert(`someUnknownVar, "x"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
    });
  });
});

// ===========================================================================
// staticAssertMacro — arity errors
// ===========================================================================

describe("staticAssertMacro — arity errors", () => {
  it("zero arguments → reportError", () => {
    withStaticAssert(``, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("staticAssert expects 1-2 arguments");
    });
  });

  it("three arguments → reportError", () => {
    withStaticAssert(`true, "a", "b"`, ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("staticAssert expects 1-2 arguments");
    });
  });
});

// ===========================================================================
// staticAssertMacro — sentinel comment behavior (exercises printConditionBrief)
// ===========================================================================

describe("staticAssertMacro — sentinel comment (printConditionBrief)", () => {
  it("includes the message text in the comment when a message is provided", () => {
    withStaticAssert(`true, "hello world"`, ({ ctx, callExpr }) => {
      const result = staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const comment = getRemoveComment(result);
      expect(comment).toBeDefined();
      expect(comment).toContain("hello world");
    });
  });

  it("renders an identifier brief in the no-message variant", () => {
    // Bind `flag` to a comptime const so the condition evaluates.
    const h = makeHarness(`const flag = true;\nstaticAssert(flag);`);
    try {
      const callExpr = findCall(h.sourceFile, "staticAssert");
      const result = staticAssertMacro.expand(h.ctx, callExpr, callExpr.arguments);
      expect(h.ctx.getDiagnostics()).toEqual([]);
      const comment = getRemoveComment(result);
      expect(comment).toBeDefined();
      expect(comment).toContain("staticAssert(flag)");
    } finally {
      h.cleanup();
    }
  });

  it("renders a binary-op brief in the no-message variant", () => {
    withStaticAssert(`1 + 1 === 2`, ({ ctx, callExpr }) => {
      const result = staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const comment = getRemoveComment(result);
      expect(comment).toBeDefined();
      // Printer strips whitespace differently; just check the operands/operator land.
      expect(comment).toMatch(/1 \+ 1/);
      expect(comment).toContain("===");
    });
  });

  it("truncates a very long condition to <= 60 chars + ellipsis", () => {
    // Build a long binary chain. 30 ones joined by " + " is ~120 chars,
    // well over the 60-char budget.
    const long = Array(30).fill("1").join(" + ") + " === 30";
    withStaticAssert(long, ({ ctx, callExpr }) => {
      const result = staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const comment = getRemoveComment(result);
      expect(comment).toBeDefined();
      // Comment shape: ` staticAssert(<brief>) ✓` — extract the brief.
      const m = /staticAssert\((.*)\) ✓/.exec(comment!);
      expect(m).not.toBeNull();
      const brief = m![1];
      expect(brief.length).toBeLessThanOrEqual(60);
      expect(brief.endsWith("...")).toBe(true);
    });
  });

  it("accepts a no-substitution template literal as the message", () => {
    withStaticAssert("false, `template message`", ({ ctx, callExpr, diagnostics }) => {
      staticAssertMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("template message");
    });
  });
});

// ===========================================================================
// compileErrorMacro
// ===========================================================================

describe("compileErrorMacro", () => {
  it("emits an error diagnostic with the literal-string message", () => {
    withCompileError(`"boom"`, ({ ctx, callExpr, diagnostics }) => {
      const result = compileErrorMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toBe("boom");
      expect(isRemoveExpression(result)).toBe(true);
    });
  });

  it("accepts a no-substitution template literal as the message", () => {
    withCompileError("`template only`", ({ ctx, callExpr, diagnostics }) => {
      compileErrorMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toBe("template only");
    });
  });

  it("falls back to a placeholder when the message is not statically known", () => {
    withCompileError(`getMessage()`, ({ ctx, callExpr, diagnostics }) => {
      compileErrorMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("compileError");
      expect(diags[0].message).toContain("could not evaluate");
    });
  });

  it("reports an arity error when called with zero arguments", () => {
    withCompileError(``, ({ ctx, callExpr, diagnostics }) => {
      compileErrorMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("compileError expects exactly one argument");
    });
  });

  it("reports an arity error when called with two arguments", () => {
    withCompileError(`"a", "b"`, ({ ctx, callExpr, diagnostics }) => {
      compileErrorMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("compileError expects exactly one argument");
    });
  });
});

// ===========================================================================
// compileWarningMacro
// ===========================================================================

describe("compileWarningMacro", () => {
  it("emits a warning (not error) diagnostic with the literal message", () => {
    withCompileWarning(`"deprecated"`, ({ ctx, callExpr, diagnostics }) => {
      const result = compileWarningMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("warning");
      expect(diags[0].message).toBe("deprecated");
      expect(isRemoveExpression(result)).toBe(true);
    });
  });

  it("severity differs from compileError on identical input", () => {
    // Build two contexts, one per macro, and confirm the severity diverges.
    withCompileWarning(`"x"`, ({ ctx, callExpr, diagnostics }) => {
      compileWarningMacro.expand(ctx, callExpr, callExpr.arguments);
      const warn = diagnostics()[0];
      expect(warn.severity).toBe("warning");
    });

    withCompileError(`"x"`, ({ ctx, callExpr, diagnostics }) => {
      compileErrorMacro.expand(ctx, callExpr, callExpr.arguments);
      const err = diagnostics()[0];
      expect(err.severity).toBe("error");
    });
  });

  it("reports an arity error when called with no arguments", () => {
    withCompileWarning(``, ({ ctx, callExpr, diagnostics }) => {
      compileWarningMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toContain("compileWarning expects exactly one argument");
    });
  });

  it("falls back to a placeholder when the message is non-evaluable", () => {
    withCompileWarning(`computeMsg()`, ({ ctx, callExpr, diagnostics }) => {
      compileWarningMacro.expand(ctx, callExpr, callExpr.arguments);
      const diags = diagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe("warning");
      expect(diags[0].message).toContain("compileWarning");
      expect(diags[0].message).toContain("could not evaluate");
    });
  });
});
