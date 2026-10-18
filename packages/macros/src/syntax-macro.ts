/**
 * Pattern-Based / Declarative Macros (macro_rules! equivalent) — EXPERIMENTAL
 *
 * Provides a declarative API for defining simple EXPRESSION macros via
 * capture patterns and template expansion, without writing AST manipulation
 * code. The API is experimental: it may change before it is stabilised.
 *
 * Inspired by: Rust `macro_rules!`, Racket `syntax-rules`, C++ `#define`
 *
 * What it does (and doesn't):
 * - A pattern is a list of captures matched POSITIONALLY against the call's
 *   arguments: `"name($a:expr, $b:ident)"` or the bare `"$a:expr, $b:ident"`.
 *   Any other literal syntax in a pattern (`{ $body }`, `+`, ...) is rejected
 *   when the macro is defined — it could never be matched.
 * - An arm matches only a call with exactly as many arguments as captures.
 * - The expansion is a single EXPRESSION. Captures are substituted as whole
 *   AST nodes (parenthesised as needed), so `$x * $x` with `1 + 2` is
 *   `(1 + 2) * (1 + 2)`, and macros inside a capture are still expanded.
 *   A `$name` inside a string or template literal is replaced with the
 *   capture's source text (stringification).
 * - There is NO hygiene: names introduced by the template can shadow or
 *   capture user names. Prefer passing captures as arguments to an arrow
 *   function (see `dbg` below) over declaring locals that wrap them.
 *
 * @example
 * ```typescript
 * import { defineSyntaxMacro } from "typesugar";
 *
 * defineSyntaxMacro("unless", {
 *   pattern: "unless($cond:expr, $then:expr, $else:expr)",
 *   expand: "!($cond) ? $then : $else",
 * });
 *
 * // Multiple arms, tried in order
 * defineSyntaxMacro("dbg", {
 *   arms: [
 *     {
 *       pattern: "dbg($e:expr)",
 *       expand: "((__dbg_value) => (console.log(`[$e] =`, __dbg_value), __dbg_value))($e)",
 *     },
 *   ],
 * });
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext, ExpressionMacro } from "@typesugar/core";
import { getDummySourceFile, getPrinter, isSyntheticNode } from "@typesugar/core";

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
export function parsePattern(pattern: string): {
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

const CAPTURE_KINDS: ReadonlySet<string> = new Set(["expr", "ident", "literal", "type", "stmts"]);

/** One capture token, `$name` or `$name:kind`, with optional surrounding spaces. */
const CAPTURE_TOKEN_RE = /^\s*\$(\w+)(?::(\w+))?\s*$/;

/**
 * Check that a pattern is something an expression macro can actually match:
 * a comma-separated capture list, optionally wrapped as `macroName(...)`.
 * Anything else (`unless($c) { $body }`, `$a + $b`) used to be accepted and
 * its literal text silently ignored (deep review #12d). Throws a descriptive
 * Error at definition time.
 */
export function validatePattern(macroName: string, pattern: string): void {
  let inner = pattern.trim();
  const open = inner.indexOf("(");
  if (open !== -1) {
    const callee = inner.slice(0, open).trim();
    if (callee !== macroName || !inner.endsWith(")")) {
      throw new Error(
        `Syntax macro '${macroName}': unsupported pattern "${pattern}". A pattern must be ` +
          `"${macroName}($a, $b, ...)" or a bare capture list "$a, $b, ..." — syntax macros ` +
          `match call arguments positionally and cannot match other literal syntax.`
      );
    }
    inner = inner.slice(open + 1, -1);
  }
  if (inner.trim() === "") return;
  for (const part of inner.split(",")) {
    const m = CAPTURE_TOKEN_RE.exec(part);
    if (!m) {
      throw new Error(
        `Syntax macro '${macroName}': unsupported pattern "${pattern}" — "${part.trim()}" is ` +
          `not a capture. Each argument position must be a single $name or $name:kind.`
      );
    }
    const kind = m[2] ?? "expr";
    if (!CAPTURE_KINDS.has(kind)) {
      throw new Error(
        `Syntax macro '${macroName}': unknown capture kind '${kind}' in "${pattern}" ` +
          `(expected one of: expr, ident, literal, type)`
      );
    }
    if (kind === "stmts") {
      throw new Error(
        `Syntax macro '${macroName}': '$${m[1]}:stmts' can't be used — syntax macros are ` +
          `expression macros and their arguments are always expressions`
      );
    }
  }
}

/**
 * Extract captures from a macro call's arguments based on the pattern.
 *
 * For expression macros, the pattern's captures map to the call arguments
 * positionally. E.g., `myMacro($a:expr, $b:expr)` maps args[0] → $a, args[1] → $b.
 */
export function extractCaptures(
  captures: PatternCapture[],
  args: readonly ts.Expression[],
  ctx: MacroContext
): Map<string, ts.Node> | null {
  const result = new Map<string, ts.Node>();

  // Exact arity: a one-capture arm used to match a two-argument call and
  // silently drop the second argument (deep review #12b).
  if (args.length !== captures.length) {
    return null;
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
        // Type captures in expression position: accept any node for flexibility.
        // The capture text will be used as-is in the template. Proper type-position
        // validation would require a fundamentally different matching approach.
        break;
      case "stmts":
        // Statements cannot appear in expression position.
        // Reject the match — the macro should use a different mechanism.
        return null;
    }

    result.set(capture.name, arg);
  }

  return result;
}

/**
 * Print a captured AST node to its source text representation.
 */
export function nodeToText(node: ts.Node, ctx: MacroContext): string {
  const printer = getPrinter();

  // For nodes from a real source file, getText() works.
  // For synthetic nodes, we must use the printer.
  if (!isSyntheticNode(node)) {
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
}

/**
 * Expand a template by substituting captures.
 *
 * Replaces `$name` references in the template with the printed source text
 * of the captured nodes, then re-parses the result.
 *
 * Known limitations of the string round-trip approach:
 * - Source positions from the original nodes are lost in the expansion.
 * - Expressions containing unbalanced delimiters or template-like syntax
 *   (e.g., `$foo` in a string literal) may produce incorrect expansions.
 * - For robust AST manipulation, use `defineExpressionMacro` directly.
 *
 * As an optimisation, if the template is exactly `$name` (a single capture
 * substitution with no surrounding text), the captured node is returned
 * directly, avoiding the print→reparse cycle entirely.
 */
export function expandTemplate(
  template: string,
  captures: Map<string, ts.Node>,
  ctx: MacroContext
): ts.Expression | string {
  // Optimisation: if the template is a single capture reference with no
  // surrounding text, return the captured node directly (skip string round-trip).
  const singleCaptureMatch = template.match(/^\$(\w+)(?::(\w+))?$/);
  if (singleCaptureMatch) {
    const node = captures.get(singleCaptureMatch[1]);
    if (node && ts.isExpression(node)) {
      return node;
    }
  }

  const expanded = template.replace(CAPTURE_RE, (match, name) => {
    const node = captures.get(name);
    if (!node) return match; // Leave unmatched captures as-is
    const text = nodeToText(node, ctx);
    // Keep the capture a single operand wherever it lands (deep review #12a).
    return ts.isExpression(node) && needsParentheses(node) ? `(${text})` : text;
  });

  return expanded;
}

/**
 * Whether substituting `expr` into an arbitrary expression slot could change
 * how it parses (`1 + 2` under `*`). Primary/member/call expressions never
 * need parentheses; everything else gets them.
 */
export function needsParentheses(expr: ts.Expression): boolean {
  return !(
    ts.isIdentifier(expr) ||
    ts.isPrivateIdentifier(expr) ||
    ts.isStringLiteral(expr) ||
    ts.isNumericLiteral(expr) ||
    ts.isBigIntLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    ts.isTemplateExpression(expr) ||
    ts.isRegularExpressionLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword ||
    expr.kind === ts.SyntaxKind.ThisKeyword ||
    ts.isParenthesizedExpression(expr) ||
    ts.isCallExpression(expr) ||
    ts.isPropertyAccessExpression(expr) ||
    ts.isElementAccessExpression(expr) ||
    ts.isArrayLiteralExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isTaggedTemplateExpression(expr) ||
    (ts.isNewExpression(expr) && expr.arguments !== undefined)
  );
}

const PLACEHOLDER_PREFIX = "__typesugar_syntax_capture_";
const PLACEHOLDER_RE = /__typesugar_syntax_capture_(\d+)__/g;

/** Identifier slots that name something rather than evaluate an expression. */
function isNameSlot(id: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(parent)) return parent.name === id;
  if (ts.isLabeledStatement(parent)) return parent.label === id;
  if (ts.isBreakOrContinueStatement(parent)) return parent.label === id;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isShorthandPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isBindingElement(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isQualifiedName(parent)
  ) {
    return true;
  }
  return false;
}

class TemplateSubstitutionError extends Error {}

/**
 * Expand a template into an expression AST.
 *
 * The template TEXT is parsed once with each `$name` replaced by a unique
 * placeholder identifier (string→AST parsing of the template is this
 * module's documented purpose — see CLAUDE.md), and then the placeholders
 * are replaced with the CAPTURED NODES themselves. Captures are never
 * printed and re-parsed: precedence is preserved (non-primary captures are
 * parenthesised) and, because the captured nodes keep their real source
 * positions, macros nested inside a capture are still expanded by the
 * transformer (a print/re-parse made them synthetic, which the visitor
 * skips). Placeholders inside string/template literals become the capture's
 * source text.
 */
export function expandTemplateToExpression(
  template: string,
  captures: Map<string, ts.Node>,
  ctx: MacroContext
): ts.Expression {
  const singleCaptureMatch = template.match(/^\s*\$(\w+)(?::(\w+))?\s*$/);
  if (singleCaptureMatch) {
    const node = captures.get(singleCaptureMatch[1]);
    if (node && ts.isExpression(node)) return node;
  }

  const slots: ts.Node[] = [];
  const slotOf = new Map<string, number>();
  const text = template.replace(CAPTURE_RE, (match, name: string) => {
    const node = captures.get(name);
    if (!node) return match;
    let idx = slotOf.get(name);
    if (idx === undefined) {
      idx = slots.length;
      slots.push(node);
      slotOf.set(name, idx);
    }
    return `${PLACEHOLDER_PREFIX}${idx}__`;
  });

  const parsed = ctx.parseExpression(text);
  const factory = ctx.factory;
  const literalText = (t: string) =>
    t.replace(PLACEHOLDER_RE, (_m, i: string) => nodeToText(slots[Number(i)], ctx));

  const visitWithParent =
    (parent: ts.Node) =>
    (node: ts.Node): ts.Node => {
      if (ts.isIdentifier(node) && node.text.startsWith(PLACEHOLDER_PREFIX)) {
        const m = /^__typesugar_syntax_capture_(\d+)__$/.exec(node.text);
        const capture = m ? slots[Number(m[1])] : undefined;
        if (capture) {
          if (ts.isIdentifier(capture)) return capture;
          if (isNameSlot(node, parent)) {
            throw new TemplateSubstitutionError(
              `capture '${nodeToText(capture, ctx)}' is used where a name is required; use an $name:ident capture there`
            );
          }
          if (ts.isExpression(capture) && needsParentheses(capture)) {
            return factory.createParenthesizedExpression(capture);
          }
          return capture;
        }
      }
      if (ts.isStringLiteral(node) && node.text.includes(PLACEHOLDER_PREFIX)) {
        return factory.createStringLiteral(literalText(node.text));
      }
      if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes(PLACEHOLDER_PREFIX)) {
        return factory.createNoSubstitutionTemplateLiteral(literalText(node.text));
      }
      if (ts.isTemplateHead(node) && node.text.includes(PLACEHOLDER_PREFIX)) {
        return factory.createTemplateHead(literalText(node.text));
      }
      if (ts.isTemplateMiddle(node) && node.text.includes(PLACEHOLDER_PREFIX)) {
        return factory.createTemplateMiddle(literalText(node.text));
      }
      if (ts.isTemplateTail(node) && node.text.includes(PLACEHOLDER_PREFIX)) {
        return factory.createTemplateTail(literalText(node.text));
      }
      return ts.visitEachChild(node, visitWithParent(node), ctx.transformContext);
    };

  return visitWithParent(parsed)(parsed) as ts.Expression;
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
  macroModule?: string
): ExpressionMacro {
  // Normalize to multi-arm format
  const arms: PatternArm[] = [];

  if ("arms" in options) {
    for (const arm of options.arms) {
      validatePattern(name, arm.pattern);
      const { captures } = parsePattern(arm.pattern);
      arms.push({
        patternSource: arm.pattern,
        captures,
        expandTemplate: arm.expand,
        validate: arm.validate,
      });
    }
  } else {
    validatePattern(name, options.pattern);
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
      args: readonly ts.Expression[]
    ): ts.Expression {
      // Try each arm in order
      for (const arm of arms) {
        const captures = extractCaptures(arm.captures, args, ctx);
        if (!captures) continue;

        // Run validation if provided
        if (arm.validate && !arm.validate(ctx, captures)) {
          continue;
        }

        try {
          return expandTemplateToExpression(arm.expandTemplate, captures, ctx);
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          ctx.reportError(
            callExpr,
            e instanceof TemplateSubstitutionError
              ? `Syntax macro '${name}': ${reason}`
              : `Syntax macro '${name}': Failed to parse expansion: ${arm.expandTemplate}\n  ${reason}`
          );
          return callExpr;
        }
      }

      // No arm matched
      ctx.reportError(
        callExpr,
        `Syntax macro '${name}': No pattern arm matched the arguments. ` +
          `Expected one of:\n${arms.map((a) => `  - ${a.patternSource}`).join("\n")}`
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
  macroModule?: string
): ExpressionMacro {
  return defineSyntaxMacro(name, { pattern, expand }, macroModule);
}
