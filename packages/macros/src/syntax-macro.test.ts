/**
 * Tests for syntax-macro.ts — Pattern-based / declarative macros.
 *
 * Covers:
 * - parsePattern: capture extraction from patterns ($x, $x:expr, $x:ident, $x:type),
 *   ordering, defaulting to "expr" when no kind given, no-captures, empty pattern,
 *   malformed pattern.
 * - extractCaptures: arity match/mismatch, expr accepts any, ident only identifiers,
 *   literal accepts numeric/string/true/false/null, type permissive, stmts rejected.
 * - nodeToText: produces source text for parsed and synthetic nodes (identifier,
 *   call, binary op, type reference).
 * - expandTemplate: single-capture shortcut returns AST node directly; multi-capture
 *   strings round-trip through printer; missing capture references are left in place.
 * - defineSyntaxMacro single-arm: registers + expands a matching call.
 * - defineSyntaxMacro multi-arm: tries arms in order, fallthrough produces error.
 * - defineRewrite: convenience wrapper, metadata + expansion.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, globalRegistry, type MacroContext } from "@typesugar/core";
import {
  defineSyntaxMacro,
  defineRewrite,
  parsePattern,
  extractCaptures,
  nodeToText,
  expandTemplate,
  type PatternCapture,
} from "./syntax-macro.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testCounter = 0;
function uniqueName(base: string): string {
  return `${base}_${process.pid}_${Date.now()}_${testCounter++}`;
}

interface TestCtx {
  ctx: MacroContext;
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

function makeContext(source = "export {};"): TestCtx {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syntax-macro-test-"));
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

  if (!captured) throw new Error("Failed to capture MacroContext");

  return {
    ctx: captured,
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function withCtx<T>(fn: (ctx: MacroContext, sf: ts.SourceFile) => T, source?: string): T {
  const { ctx, sourceFile, cleanup } = makeContext(source);
  try {
    return fn(ctx, sourceFile);
  } finally {
    cleanup();
  }
}

/** Find the first call expression matching the given callee name. */
function findCall(sf: ts.SourceFile, name: string): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      found = n;
      return;
    }
    n.forEachChild(visit);
  };
  visit(sf);
  if (!found) throw new Error(`Call to '${name}' not found`);
  return found;
}

/**
 * Expand a registered macro against a source file containing the call.
 * Returns the expanded node + any diagnostics emitted on the context.
 */
function expandMacroIn(
  source: string,
  callName: string
): {
  expanded: ts.Expression;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
  printed: string;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syntax-macro-run-"));
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

  try {
    const callExpr = findCall(sourceFile, callName);
    const macro = globalRegistry.getExpression(callName);
    if (!macro) throw new Error(`Macro '${callName}' not registered`);

    let expanded: ts.Expression = ts.factory.createVoidZero();
    let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      expanded = macro.expand(ctx, callExpr, callExpr.arguments);
      diagnostics = ctx.getDiagnostics();
      return (sf) => sf;
    };
    ts.transform(sourceFile, [transformerFactory]);

    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const printed = printer.printNode(ts.EmitHint.Expression, expanded, sourceFile);
    return { expanded, diagnostics, printed };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ===========================================================================
// parsePattern
// ===========================================================================

describe("parsePattern", () => {
  it("extracts a single $x capture defaulting to kind 'expr'", () => {
    const { captures, captureNames } = parsePattern("$x");
    expect(captures).toEqual<PatternCapture[]>([{ name: "x", kind: "expr" }]);
    expect(captureNames).toEqual(["x"]);
  });

  it("extracts two captures from '$x + $y'", () => {
    const { captures } = parsePattern("$x + $y");
    expect(captures).toEqual<PatternCapture[]>([
      { name: "x", kind: "expr" },
      { name: "y", kind: "expr" },
    ]);
  });

  it("respects explicit kinds: expr, ident, literal, type, stmts", () => {
    const { captures } = parsePattern("$a:expr $b:ident $c:literal $d:type $e:stmts");
    expect(captures.map((c) => c.kind)).toEqual(["expr", "ident", "literal", "type", "stmts"]);
    expect(captures.map((c) => c.name)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("parses captures embedded in a call-like pattern '$f($args)'", () => {
    const { captures } = parsePattern("$f($args)");
    expect(captures).toEqual<PatternCapture[]>([
      { name: "f", kind: "expr" },
      { name: "args", kind: "expr" },
    ]);
  });

  it("parses captures inside an if-pattern 'if ($cond) { $body }'", () => {
    const { captures } = parsePattern("if ($cond) { $body }");
    expect(captures).toEqual<PatternCapture[]>([
      { name: "cond", kind: "expr" },
      { name: "body", kind: "expr" },
    ]);
  });

  it("parses '$x as $type' with mixed kinds", () => {
    const { captures } = parsePattern("$x as $type:type");
    expect(captures).toEqual<PatternCapture[]>([
      { name: "x", kind: "expr" },
      { name: "type", kind: "type" },
    ]);
  });

  it("returns no captures for an empty pattern", () => {
    const { captures, captureNames } = parsePattern("");
    expect(captures).toEqual([]);
    expect(captureNames).toEqual([]);
  });

  it("returns no captures for a pattern with no $ markers", () => {
    const { captures } = parsePattern("just literal text");
    expect(captures).toEqual([]);
  });

  it("ignores a lone '$' with no following identifier (malformed)", () => {
    // The CAPTURE_RE requires \w+ after $; a bare '$' should NOT produce a capture.
    const { captures } = parsePattern("foo $ bar");
    expect(captures).toEqual([]);
  });

  it("preserves capture order with duplicates (each occurrence recorded)", () => {
    const { captures, captureNames } = parsePattern("$x + $x");
    expect(captureNames).toEqual(["x", "x"]);
    expect(captures).toHaveLength(2);
  });
});

// ===========================================================================
// extractCaptures
// ===========================================================================

describe("extractCaptures", () => {
  it("returns null when there are fewer args than captures", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [
        { name: "a", kind: "expr" },
        { name: "b", kind: "expr" },
      ];
      const args = [ts.factory.createNumericLiteral("1")] as readonly ts.Expression[];
      expect(extractCaptures(captures, args, ctx)).toBeNull();
    });
  });

  it("matches expr captures against any expression and binds them by name", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [
        { name: "a", kind: "expr" },
        { name: "b", kind: "expr" },
      ];
      const a = ts.factory.createNumericLiteral("1");
      const b = ts.factory.createIdentifier("x");
      const result = extractCaptures(captures, [a, b], ctx);
      expect(result).not.toBeNull();
      expect(result!.get("a")).toBe(a);
      expect(result!.get("b")).toBe(b);
    });
  });

  it("accepts extra trailing args beyond the pattern (ignored)", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "a", kind: "expr" }];
      const a = ts.factory.createNumericLiteral("1");
      const extra = ts.factory.createNumericLiteral("2");
      const result = extractCaptures(captures, [a, extra], ctx);
      expect(result).not.toBeNull();
      expect(result!.size).toBe(1);
      expect(result!.get("a")).toBe(a);
    });
  });

  it("rejects ident captures when the arg is not an Identifier", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "i", kind: "ident" }];
      const lit = ts.factory.createNumericLiteral("1");
      expect(extractCaptures(captures, [lit], ctx)).toBeNull();
    });
  });

  it("accepts an Identifier for an ident capture", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "i", kind: "ident" }];
      const id = ts.factory.createIdentifier("foo");
      const result = extractCaptures(captures, [id], ctx);
      expect(result).not.toBeNull();
      expect(result!.get("i")).toBe(id);
    });
  });

  it("accepts numeric, string, true, false, null for a literal capture", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "l", kind: "literal" }];
      const variants: ts.Expression[] = [
        ts.factory.createNumericLiteral("3"),
        ts.factory.createStringLiteral("hi"),
        ts.factory.createTrue(),
        ts.factory.createFalse(),
        ts.factory.createNull(),
      ];
      for (const v of variants) {
        const result = extractCaptures(captures, [v], ctx);
        expect(result).not.toBeNull();
        expect(result!.get("l")).toBe(v);
      }
    });
  });

  it("rejects a literal capture when the arg is an identifier", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "l", kind: "literal" }];
      const id = ts.factory.createIdentifier("foo");
      expect(extractCaptures(captures, [id], ctx)).toBeNull();
    });
  });

  it("accepts arbitrary expressions for a 'type' capture (permissive)", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "t", kind: "type" }];
      const id = ts.factory.createIdentifier("Foo");
      const result = extractCaptures(captures, [id], ctx);
      expect(result).not.toBeNull();
      expect(result!.get("t")).toBe(id);
    });
  });

  it("rejects 'stmts' captures in expression position", () => {
    withCtx((ctx) => {
      const captures: PatternCapture[] = [{ name: "s", kind: "stmts" }];
      const id = ts.factory.createIdentifier("foo");
      expect(extractCaptures(captures, [id], ctx)).toBeNull();
    });
  });
});

// ===========================================================================
// nodeToText
// ===========================================================================

describe("nodeToText", () => {
  it("prints a synthetic identifier verbatim", () => {
    withCtx((ctx) => {
      const id = ts.factory.createIdentifier("hello");
      expect(nodeToText(id, ctx)).toBe("hello");
    });
  });

  it("prints a synthetic binary expression with whitespace", () => {
    withCtx((ctx) => {
      const bin = ts.factory.createBinaryExpression(
        ts.factory.createIdentifier("a"),
        ts.factory.createToken(ts.SyntaxKind.PlusToken),
        ts.factory.createIdentifier("b")
      );
      expect(nodeToText(bin, ctx)).toBe("a + b");
    });
  });

  it("prints a synthetic call expression", () => {
    withCtx((ctx) => {
      const call = ts.factory.createCallExpression(ts.factory.createIdentifier("f"), undefined, [
        ts.factory.createNumericLiteral("1"),
        ts.factory.createNumericLiteral("2"),
      ]);
      const text = nodeToText(call, ctx);
      expect(text).toBe("f(1, 2)");
    });
  });

  it("prints a synthetic type reference using EmitHint.Unspecified path", () => {
    withCtx((ctx) => {
      const tref = ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Array"), [
        ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
      ]);
      const text = nodeToText(tref, ctx);
      expect(text).toBe("Array<number>");
    });
  });

  it("uses getText() for nodes parsed from a real source file", () => {
    withCtx((ctx, sf) => {
      // The third var statement is `const v = a + b;` — grab the binary expr
      // and verify nodeToText returns the original source text directly.
      const stmts = sf.statements.filter(ts.isVariableStatement);
      const target = stmts.find(
        (s) => (s.declarationList.declarations[0].name as ts.Identifier).text === "v"
      )!;
      const init = target.declarationList.declarations[0].initializer!;
      expect(nodeToText(init, ctx)).toBe("a + b");
    }, "const a = 0; const b = 0; const v = a + b;");
  });
});

// ===========================================================================
// expandTemplate
// ===========================================================================

describe("expandTemplate", () => {
  it("returns the captured node directly for a single-capture template (no string round-trip)", () => {
    withCtx((ctx) => {
      const node = ts.factory.createNumericLiteral("42");
      const captures = new Map<string, ts.Node>([["x", node]]);
      const result = expandTemplate("$x", captures, ctx);
      expect(result).toBe(node); // identity — fast path
    });
  });

  it("falls back to string expansion when template has surrounding text", () => {
    withCtx((ctx) => {
      const node = ts.factory.createIdentifier("z");
      const captures = new Map<string, ts.Node>([["x", node]]);
      const result = expandTemplate("($x) + 1", captures, ctx);
      expect(typeof result).toBe("string");
      expect(result).toBe("(z) + 1");
    });
  });

  it("substitutes multiple captures into the template", () => {
    withCtx((ctx) => {
      const captures = new Map<string, ts.Node>([
        ["a", ts.factory.createIdentifier("first")],
        ["b", ts.factory.createIdentifier("second")],
      ]);
      const result = expandTemplate("$a + $b", captures, ctx);
      expect(result).toBe("first + second");
    });
  });

  it("substitutes the same capture in multiple positions", () => {
    withCtx((ctx) => {
      const captures = new Map<string, ts.Node>([["x", ts.factory.createIdentifier("v")]]);
      const result = expandTemplate("$x + $x * $x", captures, ctx);
      expect(result).toBe("v + v * v");
    });
  });

  it("leaves $name references with no matching capture untouched", () => {
    withCtx((ctx) => {
      const captures = new Map<string, ts.Node>([["x", ts.factory.createIdentifier("ok")]]);
      const result = expandTemplate("$x and $missing", captures, ctx);
      // $missing has no capture; it is preserved verbatim in the output.
      expect(result).toBe("ok and $missing");
    });
  });
});

// ===========================================================================
// defineSyntaxMacro — single-arm
// ===========================================================================

describe("defineSyntaxMacro single-arm", () => {
  it("registers an expression macro with the given name", () => {
    const name = uniqueName("unless");
    const macro = defineSyntaxMacro(name, {
      pattern: "$cond:expr",
      expand: "!$cond",
    });
    expect(macro.kind).toBe("expression");
    expect(macro.name).toBe(name);
    expect(globalRegistry.getExpression(name)).toBe(macro);
  });

  it("expands a matching call by substituting the capture into the template", () => {
    const name = uniqueName("neg");
    defineSyntaxMacro(name, {
      pattern: "$x:expr",
      expand: "(-($x))",
    });

    const source = `declare function ${name}(x: any): any; ${name}(7);`;
    const { expanded, diagnostics, printed } = expandMacroIn(source, name);
    expect(diagnostics).toEqual([]);
    expect(ts.isExpression(expanded)).toBe(true);
    expect(printed).toContain("-(7)");
  });

  it("returns the captured node directly when the template is exactly $name", () => {
    const name = uniqueName("identity");
    defineSyntaxMacro(name, {
      pattern: "$x:expr",
      expand: "$x",
    });

    const source = `declare function ${name}(x: any): any; ${name}(42);`;
    const { expanded, diagnostics } = expandMacroIn(source, name);
    expect(diagnostics).toEqual([]);
    // The fast path means the original numeric literal node should be returned.
    expect(ts.isNumericLiteral(expanded)).toBe(true);
    expect((expanded as ts.NumericLiteral).text).toBe("42");
  });

  it("reports an error when the expansion fails to parse", () => {
    const name = uniqueName("bad");
    defineSyntaxMacro(name, {
      pattern: "$x:expr",
      expand: "const = $x", // syntactically invalid as an expression
    });

    const source = `declare function ${name}(x: any): any; ${name}(1);`;
    const { diagnostics } = expandMacroIn(source, name);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/Failed to parse expansion/);
  });
});

// ===========================================================================
// defineSyntaxMacro — multi-arm
// ===========================================================================

describe("defineSyntaxMacro multi-arm", () => {
  it("matches the first arm when its capture kind succeeds", () => {
    const name = uniqueName("multi1");
    // Use distinct call wrappers to identify which arm fired (comments get
    // stripped by parseExpression so cannot be used as markers).
    defineSyntaxMacro(name, {
      arms: [
        { pattern: "$x:ident", expand: "armIdent($x)" },
        { pattern: "$x:expr", expand: "armExpr($x)" },
      ],
    });
    const source = `declare function ${name}(x: any): any; const foo = 1; ${name}(foo);`;
    const { diagnostics, printed } = expandMacroIn(source, name);
    expect(diagnostics).toEqual([]);
    expect(printed).toContain("armIdent");
    expect(printed).not.toContain("armExpr");
  });

  it("falls through to the second arm when the first arm's kind doesn't match", () => {
    const name = uniqueName("multi2");
    defineSyntaxMacro(name, {
      arms: [
        { pattern: "$x:ident", expand: "armIdent($x)" },
        { pattern: "$x:expr", expand: "armExpr($x)" },
      ],
    });
    // 1 + 2 is an expression but not an identifier — first arm rejects, second wins.
    const source = `declare function ${name}(x: any): any; ${name}(1 + 2);`;
    const { diagnostics, printed } = expandMacroIn(source, name);
    expect(diagnostics).toEqual([]);
    expect(printed).toContain("armExpr");
    expect(printed).not.toContain("armIdent");
  });

  it("reports an error when no arm matches the call arguments", () => {
    const name = uniqueName("multi3");
    defineSyntaxMacro(name, {
      arms: [
        { pattern: "$x:ident", expand: "$x" },
        { pattern: "$x:literal", expand: "$x" },
      ],
    });
    // `a + b` is neither an Identifier nor a literal.
    const source = `declare function ${name}(x: any): any; const a = 0; const b = 0; ${name}(a + b);`;
    const { expanded, diagnostics } = expandMacroIn(source, name);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/No pattern arm matched/);
    // On failure the original call expression is returned.
    expect(ts.isCallExpression(expanded)).toBe(true);
  });

  it("invokes the validate hook and skips the arm when it returns false", () => {
    const name = uniqueName("multi4");
    let firstCalled = 0;
    let secondCalled = 0;
    defineSyntaxMacro(name, {
      arms: [
        {
          pattern: "$x:expr",
          expand: "arm1($x)",
          validate: () => {
            firstCalled += 1;
            return false;
          },
        },
        {
          pattern: "$x:expr",
          expand: "arm2($x)",
          validate: () => {
            secondCalled += 1;
            return true;
          },
        },
      ],
    });
    const source = `declare function ${name}(x: any): any; ${name}(1);`;
    const { diagnostics, printed } = expandMacroIn(source, name);
    expect(diagnostics).toEqual([]);
    expect(firstCalled).toBe(1);
    expect(secondCalled).toBe(1);
    expect(printed).toContain("arm2");
    expect(printed).not.toContain("arm1");
  });
});

// ===========================================================================
// defineRewrite
// ===========================================================================

describe("defineRewrite", () => {
  it("registers an expression macro with the supplied pattern + expansion", () => {
    const name = uniqueName("todo");
    const macro = defineRewrite(name, "$msg:expr", "(() => { throw new Error($msg) })()");
    expect(macro.kind).toBe("expression");
    expect(macro.name).toBe(name);
    expect(globalRegistry.getExpression(name)).toBe(macro);
    expect(macro.description).toContain("$msg");
  });

  it("expands a registered rewrite by substituting the capture", () => {
    const name = uniqueName("dbl");
    defineRewrite(name, "$x:expr", "($x) * 2");
    const source = `declare function ${name}(x: any): any; ${name}(5);`;
    const { diagnostics, printed } = expandMacroIn(source, name);
    expect(diagnostics).toEqual([]);
    expect(printed.replace(/\s+/g, " ")).toContain("(5) * 2");
  });
});
