/**
 * Pattern-Based / Declarative Macros (macro_rules! equivalent)
 *
 * Provides a declarative API for defining simple macros via pattern matching
 * and template expansion, without writing AST manipulation code.
 *
 * Inspired by: Rust `macro_rules!`, Racket `syntax-rules`, C++ `#define`
 *
 * @example
 * ```typescript
 * import { defineSyntaxMacro } from "typesugar";
 *
 * // Simple pattern → replacement
 * defineSyntaxMacro("unless", {
 *   pattern: "unless($cond:expr) { $body }",
 *   expand: "if (!($cond)) { $body }",
 * });
 *
 * // Multiple arms
 * defineSyntaxMacro("dbg", {
 *   arms: [
 *     {
 *       pattern: "dbg($e:expr)",
 *       expand: "(() => { const __v = $e; console.log(`[$e] =`, __v); return __v; })()",
 *     },
 *   ],
 * });
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "../core/registry.js";
import { MacroContext, ExpressionMacro } from "../core/types.js";
import { getDummySourceFile, getPrinter } from "../core/ast-utils.js";

// =============================================================================
// Pattern Types
// =============================================================================

/** A capture in a pattern: $name:kind */
export interface PatternCapture {
  /** The capture variable name (e.g., "cond" in $cond:expr) */
  name: string;

  /** The kind of node to capture */
  kind: CaptureKind;
}

export type CaptureKind =
  | "expr" // Any expression
  | "ident" // An identifier
  | "literal" // A literal value
  | "type" // A type annotation
  | "stmts"; // One or more statements

/** A parsed pattern arm */
export interface PatternArm {
  /** The pattern string (for display/debugging) */
  patternSource: string;

  /** Captures extracted from the pattern */
  captures: PatternCapture[];

  /** The expansion template */
  expandTemplate: string;

  /** Optional validation function */
  validate?: (ctx: MacroContext, captures: Map<string, ts.Node>) => boolean;
}

// =============================================================================
// Syntax Macro Definition Options
// =============================================================================

/** Options for a single-arm syntax macro */
export interface SyntaxMacroSingleArm {
  /** The pattern to match (e.g., "unless($cond:expr) { $body }") */
  pattern: string;

  /** The expansion template (e.g., "if (!($cond)) { $body }") */
  expand: string;

  /** Optional validation */
  validate?: (ctx: MacroContext, captures: Map<string, ts.Node>) => boolean;
}

/** Options for a multi-arm syntax macro */
export interface SyntaxMacroMultiArm {
  /** Multiple pattern arms, tried in order */
  arms: Array<{
    pattern: string;
    expand: string;
    validate?: (ctx: MacroContext, captures: Map<string, ts.Node>) => boolean;
  }>;
}

export type SyntaxMacroOptions = SyntaxMacroSingleArm | SyntaxMacroMultiArm;

// =============================================================================
// Pattern Parser
// =============================================================================

/** Regex to match capture groups: $name:kind or $name */
const CAPTURE_RE = /\$(\w+)(?::(\w+))?/g;

/**
 * Parse a pattern string into a list of captures and a regex-like matcher.
 *
 * Pattern syntax:
 * - `$name:expr` — capture an expression
 * - `$name:ident` — capture an identifier
 * - `$name:literal` — capture a literal
 * - `$name:type` — capture a type
 * - `$name` — shorthand for `$name:expr`
 * - Everything else is literal syntax
 */
function parsePattern(pattern: string): {
  captures: PatternCapture[];
  captureNames: string[];
} {
  const captures: PatternCapture[] = [];
  const captureNames: string[] = [];

  let match: RegExpExecArray | null;
  const re = new RegExp(CAPTURE_RE.source, "g");

  while ((match = re.exec(pattern)) !== null) {
    const name = match[1];
    const kind = (match[2] ?? "expr") as CaptureKind;

    captures.push({ name, kind });
    captureNames.push(name);
  }

  return { captures, captureNames };
}

/**
 * Extract captures from a macro call's arguments based on the pattern.
 *
 * For expression macros, the pattern's captures map to the call arguments
 * positionally. E.g., `myMacro($a:expr, $b:expr)` maps args[0] → $a, args[1] → $b.
 */
function extractCaptures(
  captures: PatternCapture[],
  args: readonly ts.Expression[],
  ctx: MacroContext,
): Map<string, ts.Node> | null {
  const result = new Map<string, ts.Node>();

  if (args.length < captures.length) {
    return null; // Not enough arguments
  }

  for (let i = 0; i < captures.length; i++) {
    const capture = captures[i];
    const arg = args[i];

    // Validate the capture kind
    switch (capture.kind) {
      case "ident":
        if (!ts.isIdentifier(arg)) return null;
        break;
      case "literal":
        if (
          !ts.isNumericLiteral(arg) &&
          !ts.isStringLiteral(arg) &&
          arg.kind !== ts.SyntaxKind.TrueKeyword &&
          arg.kind !== ts.SyntaxKind.FalseKeyword &&
          arg.kind !== ts.SyntaxKind.NullKeyword
        ) {
          return null;
        }
        break;
      case "expr":
        // Any expression is valid
        break;
      case "type":
        // Type captures are tricky in expression position — accept any node
        break;
      case "stmts":
        // Statements can't appear in expression position directly
        break;
    }

    result.set(capture.name, arg);
  }

  return result;
}

/**
 * Expand a template by substituting captures.
 *
 * Replaces `$name` references in the template with the printed source text
 * of the captured nodes.
 */
function expandTemplate(
  template: string,
  captures: Map<string, ts.Node>,
  ctx: MacroContext,
): string {
  const printer = getPrinter();

  return template.replace(CAPTURE_RE, (match, name) => {
    const node = captures.get(name);
    if (!node) return match; // Leave unmatched captures as-is

    // For nodes from a real source file, getText() works.
    // For synthetic nodes (pos === -1), we must use the printer.
    if (node.pos >= 0 && node.end >= 0) {
      try {
        const text = node.getText(ctx.sourceFile);
        if (text) return text;
      } catch {
        // Fall through to printer
      }
    }

    // Use printer with a dummy source file for synthetic nodes
    const sf = getDummySourceFile();
    if (ts.isExpression(node)) {
      return printer.printNode(ts.EmitHint.Expression, node, sf);
    }
    return printer.printNode(ts.EmitHint.Unspecified, node, sf);
  });
}

// =============================================================================
// defineSyntaxMacro — Register a pattern-based macro
// =============================================================================

/**
 * Define a pattern-based macro that matches call arguments against patterns
 * and expands using template substitution.
 *
 * @param name - The macro name (used as the function call identifier)
 * @param options - Pattern and expansion configuration
 * @param macroModule - Optional module specifier for import-scoped activation
 * @returns The registered ExpressionMacro
 */
export function defineSyntaxMacro(
  name: string,
  options: SyntaxMacroOptions,
  macroModule?: string,
): ExpressionMacro {
  // Normalize to multi-arm format
  const arms: PatternArm[] = [];

  if ("arms" in options) {
    for (const arm of options.arms) {
      const { captures } = parsePattern(arm.pattern);
      arms.push({
        patternSource: arm.pattern,
        captures,
        expandTemplate: arm.expand,
        validate: arm.validate,
      });
    }
  } else {
    const { captures } = parsePattern(options.pattern);
    arms.push({
      patternSource: options.pattern,
      captures,
      expandTemplate: options.expand,
      validate: options.validate,
    });
  }

  const macro = defineExpressionMacro({
    name,
    module: macroModule,
    description: `Pattern-based macro: ${arms.map((a) => a.patternSource).join(" | ")}`,

    expand(
      ctx: MacroContext,
      callExpr: ts.CallExpression,
      args: readonly ts.Expression[],
    ): ts.Expression {
      // Try each arm in order
      for (const arm of arms) {
        const captures = extractCaptures(arm.captures, args, ctx);
        if (!captures) continue;

        // Run validation if provided
        if (arm.validate && !arm.validate(ctx, captures)) {
          continue;
        }

        // Expand the template
        const expanded = expandTemplate(arm.expandTemplate, captures, ctx);

        try {
          return ctx.parseExpression(expanded);
        } catch (e) {
          ctx.reportError(
            callExpr,
            `Syntax macro '${name}': Failed to parse expansion: ${expanded}\n  ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          return callExpr;
        }
      }

      // No arm matched
      ctx.reportError(
        callExpr,
        `Syntax macro '${name}': No pattern arm matched the arguments. ` +
          `Expected one of:\n${arms.map((a) => `  - ${a.patternSource}`).join("\n")}`,
      );
      return callExpr;
    },
  });

  globalRegistry.register(macro);
  return macro;
}

// =============================================================================
// Convenience: Common Pattern Macros
// =============================================================================

/**
 * Define a simple expression rewrite macro.
 * Shorthand for defineSyntaxMacro with a single arm.
 *
 * @example
 * ```typescript
 * defineRewrite("todo", "$msg:expr", "(() => { throw new Error($msg) })()");
 * // Usage: todo("implement this") → (() => { throw new Error("implement this") })()
 * ```
 */
export function defineRewrite(
  name: string,
  pattern: string,
  expand: string,
  macroModule?: string,
): ExpressionMacro {
  return defineSyntaxMacro(name, { pattern, expand }, macroModule);
}
