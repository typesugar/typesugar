/**
 * @typesugar/parser — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime `grammar` tagged-template fallback lives in the package's
 * `.` entry. See PEP-050.
 *
 * Registers a `grammar` tagged template macro with @typesugar/core.
 * Generates an inline recursive-descent parser at compile time (no runtime
 * grammar interpretation), built as `ts.factory` AST (see codegen-ast.ts).
 */

import * as ts from "typescript";
import {
  type TaggedTemplateMacroDef,
  type MacroContext,
  defineTaggedTemplateMacro,
  globalRegistry,
  isSyntheticNode,
  typeToPortableTypeNode,
} from "@typesugar/core";
import { parseGrammarDef } from "./grammar.js";
import { generateParserAst } from "./codegen-ast.js";
import type { GrammarRule } from "./types.js";

/**
 * The `grammar` tagged template macro definition.
 *
 * Usage:
 * ```ts
 * import { grammar } from "@typesugar/parser";
 *
 * const json = grammar`
 *   value   = string | number | object | array | "true" | "false" | "null"
 *   string  = '"' (!'"' .)* '"'
 *   number  = '-'? '0'..'9'+ ('.' '0'..'9'+)?
 *   object  = '{' pair (',' pair)* '}'
 *   pair    = string ':' value
 *   array   = '[' value (',' value)* ']'
 * `;
 * ```
 *
 * Generates an inlined recursive-descent parser at compile time. Template
 * interpolation is not supported and is reported as an error.
 */
export const grammarMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "grammar",
  module: "@typesugar/parser",
  description: "Define a PEG grammar and generate a parser",
  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const template = node.template;

    // Interpolation is not supported (TSP-9): the grammar is compiled from the
    // template text at build time, so a `${...}` value can't be part of it. The
    // runtime `grammar` tag rejects it too, so both paths agree.
    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(
        node,
        "grammar template interpolation (${...}) is not supported; write the grammar " +
          "as a plain template, or build it at runtime with buildParser(parseGrammarDef(text))"
      );
      return node;
    }

    // Validate/parse the grammar at compile time
    let rules: Map<string, GrammarRule>;
    try {
      rules = parseGrammarDef(template.text);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid grammar: ${msg}`);
      return node;
    }

    // Phase 2: build the inline recursive-descent parser directly as AST.
    // parseAll throws the runtime `ParseError` class (imported if the file
    // doesn't already import it), so `instanceof ParseError` holds whether or
    // not the transformer ran.
    const parser = generateParserAst(ctx.factory, rules, undefined, () =>
      ctx.ensureImport("ParseError", "@typesugar/parser")
    );
    // The generated parser is untyped inside (codegen-ast.ts); its public
    // type is the runtime tag's, `Grammar<unknown>`, asserted here so the
    // declaration emitted for `export const g = grammar`...` and the type
    // of `g.parse(...)` are what they are without the transformer (review 8:
    // they were a structural object of `any` members). Erased.
    return ctx.factory.createParenthesizedExpression(
      ctx.factory.createAsExpression(parser, grammarTypeNode(ctx, node))
    );
  },
});

/**
 * The type of the `grammar` call `node` as a type node valid where it is:
 * the checker's (`Grammar<unknown>`, from the runtime tag's signature),
 * named for this file by core's `typeToPortableTypeNode` (through the file's
 * own import of the tag, e.g. `import("@typesugar/parser").Grammar<unknown>`).
 * When the checker has no such name (a synthetic node, a tag it couldn't
 * resolve), the same type named through `@typesugar/parser`, the module the
 * expansion already imports `ParseError` from.
 */
function grammarTypeNode(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.TypeNode {
  const f = ctx.factory;
  if (!isSyntheticNode(node)) {
    try {
      const checker = ctx.typeChecker;
      const type = checker.getTypeAtLocation(node);
      const named =
        type.flags & ts.TypeFlags.Any
          ? undefined
          : typeToPortableTypeNode(ctx.program, checker, ctx.sourceFile, type, node);
      if (named && (ts.isImportTypeNode(named) || ts.isTypeReferenceNode(named))) return named;
    } catch (error) {
      ctx.reportWarning(
        node,
        `typesugar typed the grammar parser as @typesugar/parser's Grammar<unknown>: ` +
          `the type checker failed on the call (${error}).`
      );
    }
  }
  return f.createImportTypeNode(
    f.createLiteralTypeNode(f.createStringLiteral("@typesugar/parser")),
    undefined,
    f.createIdentifier("Grammar"),
    [f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)],
    false
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the grammar macro with the global registry. */
export function register(): void {
  globalRegistry.register(grammarMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
