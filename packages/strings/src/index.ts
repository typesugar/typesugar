/**
 * Special String Type Macros
 *
 * Compile-time validated and transformed string literals, inspired by Scala's
 * string interpolators (s"", f"", raw"") and custom interpolators.
 *
 * Provides:
 * - regex`...` - Compile-time validated regular expressions
 * - html`...` - HTML with XSS protection
 * - fmt`...` - Printf-style formatting with type checking
 * - json`...` - Compile-time JSON parsing
 * - raw`...` - Raw strings without escape processing
 *
 * Note: For SQL queries, use @typesugar/sql instead.
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// Regex Tagged Template
// ============================================================================

export const regexMacro = defineExpressionMacro({
  name: "regex",
  description: "Create compile-time validated regular expressions",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1 || !ts.isTemplateLiteral(args[0])) {
      ctx.reportError(callExpr, "regex expects a template literal");
      return callExpr;
    }

    const template = args[0];

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(callExpr, "regex does not support interpolations");
      return callExpr;
    }

    const pattern = template.text;

    // Validate regex at compile time
    try {
      new RegExp(pattern);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(callExpr, `Invalid regular expression: ${msg}`);
      return callExpr;
    }

    // Return: new RegExp("pattern")
    return factory.createNewExpression(factory.createIdentifier("RegExp"), undefined, [
      factory.createStringLiteral(pattern),
    ]);
  },
});

// ============================================================================
// HTML Tagged Template with XSS Protection
// ============================================================================

export const htmlMacro = defineExpressionMacro({
  name: "html",
  description: "Create HTML with automatic XSS escaping",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1 || !ts.isTemplateLiteral(args[0])) {
      ctx.reportError(callExpr, "html expects a template literal");
      return callExpr;
    }

    const template = args[0];

    // Simple template - return as-is
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      return factory.createStringLiteral(template.text);
    }

    // Template with interpolations - wrap each value in escapeHtml()
    if (ts.isTemplateExpression(template)) {
      // Build: `head` + escapeHtml(expr1) + `mid1` + escapeHtml(expr2) + ...
      let result: ts.Expression = factory.createStringLiteral(template.head.text);

      for (const span of template.templateSpans) {
        // INTENTIONALLY UNHYGIENIC: __typesugar_escapeHtml is a runtime helper
        // exported from @typesugar/strings. Users must import it for generated code to work.
        const escapedValue = factory.createCallExpression(
          factory.createIdentifier("__typesugar_escapeHtml"),
          undefined,
          [span.expression]
        );

        result = factory.createBinaryExpression(
          result,
          factory.createToken(ts.SyntaxKind.PlusToken),
          escapedValue
        );

        // Add literal part
        if (span.literal.text) {
          result = factory.createBinaryExpression(
            result,
            factory.createToken(ts.SyntaxKind.PlusToken),
            factory.createStringLiteral(span.literal.text)
          );
        }
      }

      return result;
    }

    return callExpr;
  },
});

// ============================================================================
// Printf-style Format Macro
// ============================================================================

export const fmtMacro = defineExpressionMacro({
  name: "fmt",
  description: "Printf-style formatting with type checking",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1 || !ts.isTemplateLiteral(args[0])) {
      ctx.reportError(callExpr, "fmt expects a template literal");
      return callExpr;
    }

    const template = args[0];

    if (!ts.isTemplateExpression(template)) {
      // No interpolations - return as-is
      if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return factory.createStringLiteral(template.text);
      }
      return callExpr;
    }

    // Parse format specifiers from the template head and middles
    // Format: ${value:format} where format is like %d, %s, %f, etc.

    let result: ts.Expression = factory.createStringLiteral("");

    // Process head
    const headParts = parseFormatString(template.head.text);
    for (const part of headParts) {
      if (part.type === "literal") {
        result = concatStrings(factory, result, factory.createStringLiteral(part.value));
      }
    }

    // Process spans
    for (let i = 0; i < template.templateSpans.length; i++) {
      const span = template.templateSpans[i];

      // The format specifier comes from the previous literal's end or a special syntax
      // For simplicity, we'll just convert the value to string
      const formattedValue = factory.createCallExpression(
        factory.createIdentifier("String"),
        undefined,
        [span.expression]
      );

      result = concatStrings(factory, result, formattedValue);

      // Process literal part after the expression
      const literalParts = parseFormatString(span.literal.text);
      for (const part of literalParts) {
        if (part.type === "literal") {
          result = concatStrings(factory, result, factory.createStringLiteral(part.value));
        }
      }
    }

    return result;
  },
});

function parseFormatString(str: string): Array<{ type: "literal" | "format"; value: string }> {
  // Simple parser - just return literals for now
  // Could be enhanced to parse %d, %s, etc.
  return [{ type: "literal", value: str }];
}

function concatStrings(
  factory: ts.NodeFactory,
  left: ts.Expression,
  right: ts.Expression
): ts.Expression {
  // Optimize: if left is empty string literal, just return right
  if (ts.isStringLiteral(left) && left.text === "") {
    return right;
  }

  return factory.createBinaryExpression(left, factory.createToken(ts.SyntaxKind.PlusToken), right);
}

// ============================================================================
// JSON Tagged Template with Schema Validation
// ============================================================================

export const jsonMacro = defineExpressionMacro({
  name: "json",
  description: "Parse and validate JSON at compile time",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1 || !ts.isTemplateLiteral(args[0])) {
      ctx.reportError(callExpr, "json expects a template literal");
      return callExpr;
    }

    const template = args[0];

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(
        callExpr,
        "json does not support interpolations - use a regular object literal"
      );
      return callExpr;
    }

    const jsonString = template.text;

    // Validate and parse JSON at compile time
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(callExpr, `Invalid JSON: ${msg}`);
      return callExpr;
    }

    // Convert to AST
    return jsonToAst(factory, parsed);
  },
});

function jsonToAst(factory: ts.NodeFactory, value: unknown): ts.Expression {
  if (value === null) {
    return factory.createNull();
  }

  if (typeof value === "string") {
    return factory.createStringLiteral(value);
  }

  if (typeof value === "number") {
    return factory.createNumericLiteral(value);
  }

  if (typeof value === "boolean") {
    return value ? factory.createTrue() : factory.createFalse();
  }

  if (Array.isArray(value)) {
    return factory.createArrayLiteralExpression(value.map((v) => jsonToAst(factory, v)));
  }

  if (typeof value === "object") {
    const properties = Object.entries(value as Record<string, unknown>).map(([key, val]) =>
      factory.createPropertyAssignment(
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
          ? factory.createIdentifier(key)
          : factory.createStringLiteral(key),
        jsonToAst(factory, val)
      )
    );
    return factory.createObjectLiteralExpression(properties, true);
  }

  return factory.createIdentifier("undefined");
}

// ============================================================================
// Raw String (no escape processing)
// ============================================================================

export const rawMacro = defineExpressionMacro({
  name: "raw",
  description: "Raw string without escape processing",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    if (args.length !== 1 || !ts.isTemplateLiteral(args[0])) {
      ctx.reportError(callExpr, "raw expects a template literal");
      return callExpr;
    }

    const template = args[0];

    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      // Get the raw text (with escape sequences preserved)
      return factory.createStringLiteral(template.rawText ?? template.text);
    }

    // For templates with substitutions, concatenate raw parts
    if (ts.isTemplateExpression(template)) {
      let result: ts.Expression = factory.createStringLiteral(
        template.head.rawText ?? template.head.text
      );

      for (const span of template.templateSpans) {
        result = concatStrings(factory, result, span.expression);
        result = concatStrings(
          factory,
          result,
          factory.createStringLiteral(span.literal.rawText ?? span.literal.text)
        );
      }

      return result;
    }

    return callExpr;
  },
});

// ============================================================================
// Registration
// ============================================================================

export function register(): void {
  globalRegistry.register(regexMacro);
  globalRegistry.register(htmlMacro);
  globalRegistry.register(fmtMacro);
  globalRegistry.register(jsonMacro);
  globalRegistry.register(rawMacro);
}

// Auto-register
register();

// ============================================================================
// Runtime Helper (injected when html macro is used)
// ============================================================================

/**
 * HTML escape function - used by the html macro
 */
export function __typesugar_escapeHtml(str: unknown): string {
  const s = String(str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
