import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { grammarMacro } from "../macros.js";
import type { Grammar } from "../types.js";

// ---------------------------------------------------------------------------
// This test drives the REAL compile-time macro-expansion path
// (`grammarMacro.expand`) — the `generateParserCode` → AST splice point that
// replaced the old `ctx.parseExpression(...)` round-trip (PEP-057). It confirms
// the expander returns a working parser AST end-to-end, not just that
// `generateParserCode` produces good output in isolation.
// ---------------------------------------------------------------------------

/** Parse `grammar`...`` source into its TaggedTemplateExpression node. */
function parseGrammarTag(source: string): ts.TaggedTemplateExpression {
  const sf = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  const stmt = sf.statements[0];
  if (!ts.isExpressionStatement(stmt)) throw new Error("Expected ExpressionStatement");
  const expr = stmt.expression;
  if (!ts.isTaggedTemplateExpression(expr)) throw new Error("Expected TaggedTemplateExpression");
  return expr;
}

/** Minimal MacroContext stub: only what `grammarMacro.expand` touches. */
function createStubContext() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    factory: ts.factory,
    sourceFile: ts.createSourceFile("test.ts", "", ts.ScriptTarget.Latest),
    reportWarning: (_node: ts.Node, msg: string) => warnings.push(msg),
    reportError: (_node: ts.Node, msg: string) => errors.push(msg),
    warnings,
    errors,
  };
}

function print(node: ts.Node): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sf = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest);
  return printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

/** Run the real macro expander and eval the resulting parser AST. */
function expandToParser(source: string): {
  parser: Grammar<unknown>;
  ctx: ReturnType<typeof createStubContext>;
} {
  const node = parseGrammarTag(source);
  const ctx = createStubContext();
  const result = grammarMacro.expand(ctx as never, node);
  const code = print(result);
  const parser = new Function(`return ${code}`)() as Grammar<unknown>;
  return { parser, ctx };
}

describe("grammar macro expansion (compile-time path)", () => {
  it("expands a grammar into a runnable parser (sequence + alternation + repetition)", () => {
    // csv = cell ("," cell)*   → sequence containing a repetition of a sequence
    // cell = "a" | "b" | "c"   → alternation
    const { parser, ctx } = expandToParser(
      'grammar`\n  csv  = cell ("," cell)*\n  cell = "a" | "b" | "c"\n`'
    );

    expect(ctx.errors).toEqual([]);
    expect(ctx.warnings).toEqual([]);

    // Grammar interface is populated from the compiled AST.
    expect(parser.startRule).toBe("csv");
    expect(parser.rules).toBeInstanceOf(Map);
    expect(parser.rules.get("cell")).toEqual({
      type: "alternation",
      rules: [
        { type: "literal", value: "a" },
        { type: "literal", value: "b" },
        { type: "literal", value: "c" },
      ],
    });

    // Runtime behavior: full parse consumes all input.
    const ok = parser.parse("a,b,c");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.pos).toBe(5);
    expect(() => parser.parseAll("a,b,c")).not.toThrow();

    // Single cell (repetition matches zero times).
    expect(parser.parse("a").ok).toBe(true);

    // A rejected input fails to fully consume.
    const bad = parser.parse("z");
    expect(bad.ok).toBe(false);
    expect(() => parser.parseAll("a,")).toThrow();
  });

  it("reports an error for an invalid grammar and returns the original node", () => {
    const node = parseGrammarTag("grammar`= = =`");
    const ctx = createStubContext();
    const result = grammarMacro.expand(ctx as never, node);
    expect(ctx.errors.length).toBeGreaterThan(0);
    // On failure the expander returns the original tagged-template node unchanged.
    expect(result).toBe(node);
  });
});
