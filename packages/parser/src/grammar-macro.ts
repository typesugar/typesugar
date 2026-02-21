/**
 * Tagged template macro for PEG grammar definitions.
 *
 * Registers a `grammar` tagged template macro with @typesugar/core.
 * Phase 1: emits a runtime call to `parseGrammarDef` + `buildParser`.
 * Phase 2 (future): generates inline recursive-descent parser code at compile time.
 */

import * as ts from "typescript";
import {
  type TaggedTemplateMacroDef,
  type MacroContext,
  defineTaggedTemplateMacro,
  globalRegistry,
} from "@typesugar/core";
import type { Grammar } from "./types.js";
import { parseGrammarDef, buildParser } from "./grammar.js";

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
 * In Phase 1, this falls back to runtime grammar parsing.
 * In Phase 2, the macro will generate inlined recursive-descent parser code.
 */
export const grammarMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "grammar",
  module: "@typesugar/parser",
  description: "Define a PEG grammar and generate a parser",
  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    // Phase 1: emit runtime fallback
    // Generates: __parsesugar_grammar_runtime("<grammar source>")
    // which is resolved to the runtime `grammar` function

    const { factory } = ctx;
    const template = node.template;

    // Extract the raw grammar text from the template
    let grammarText: string;
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      grammarText = template.text;
    } else {
      // For templates with interpolations, concatenate the parts.
      // Full interpolation support is a Phase 2 feature.
      grammarText = template.head.text;
      for (const span of template.templateSpans) {
        grammarText += "???" + span.literal.text;
      }
      ctx.reportWarning(
        node,
        "grammar template interpolation is not yet supported; " +
          "interpolated values are replaced with '???'"
      );
    }

    // Validate the grammar at compile time for early error reporting
    try {
      parseGrammarDef(grammarText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid grammar: ${msg}`);
      return node;
    }

    // Emit runtime code:
    // (function() {
    //   const __rules = parseGrammarDef("<source>");
    //   return buildParser(__rules);
    // })()
    //
    // Phase 1 keeps it simple. The import of parseGrammarDef/buildParser
    // is assumed to be available at runtime via @typesugar/parser.

    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("__typesugar_parser"),
        factory.createIdentifier("grammar")
      ),
      undefined,
      [factory.createNoSubstitutionTemplateLiteral(grammarText, grammarText)]
    );
  },
  validate(ctx: MacroContext, node: ts.TaggedTemplateExpression): boolean {
    const template = node.template;
    let grammarText: string;
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      grammarText = template.text;
    } else {
      grammarText = template.head.text;
      for (const span of template.templateSpans) {
        grammarText += span.literal.text;
      }
    }

    try {
      parseGrammarDef(grammarText);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid grammar: ${msg}`);
      return false;
    }
  },
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the grammar macro with the global registry. */
export function register(): void {
  globalRegistry.register(grammarMacro);
}

// Auto-register on import
register();

// ---------------------------------------------------------------------------
// Runtime fallback
// ---------------------------------------------------------------------------

/**
 * Runtime `grammar` tagged template function.
 *
 * This is the runtime fallback used when the compile-time macro is not active
 * (e.g., in tests, REPL, or when the transformer is not configured).
 *
 * @param strings - Template literal string parts
 * @param exprs - Template literal interpolated expressions (currently unused)
 * @returns A Grammar that can parse input strings
 */
export function grammar(strings: TemplateStringsArray, ...exprs: unknown[]): Grammar<unknown> {
  const source = strings.join("");
  const rules = parseGrammarDef(source);
  return buildParser(rules);
}
