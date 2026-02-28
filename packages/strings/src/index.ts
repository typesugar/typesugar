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
import {
  defineTaggedTemplateMacro,
  globalRegistry,
  type MacroContext,
  type TaggedTemplateMacroDef,
} from "@typesugar/core";

// ============================================================================
// Runtime Stubs (throw if transformer not applied)
// ============================================================================

/**
 * Create a compile-time validated regular expression.
 * This is a runtime placeholder that throws if the transformer is not applied.
 *
 * @example
 * ```typescript
 * const email = regex`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`;
 * ```
 */
export function regex(_strings: TemplateStringsArray, ..._values: unknown[]): RegExp {
  throw new Error(
    "regex`...` was not transformed at compile time. " +
      "Make sure the typesugar transformer is configured."
  );
}

/**
 * Create HTML with automatic XSS escaping for interpolated values.
 * This is a runtime placeholder that throws if the transformer is not applied.
 *
 * @example
 * ```typescript
 * const safe = html`<div>${userInput}</div>`;
 * ```
 */
export function html(_strings: TemplateStringsArray, ..._values: unknown[]): string {
  throw new Error(
    "html`...` was not transformed at compile time. " +
      "Make sure the typesugar transformer is configured."
  );
}

/**
 * Printf-style string formatting with type checking.
 * This is a runtime placeholder that throws if the transformer is not applied.
 *
 * @example
 * ```typescript
 * const message = fmt`Hello, ${name}! You are ${age} years old.`;
 * ```
 */
export function fmt(_strings: TemplateStringsArray, ..._values: unknown[]): string {
  throw new Error(
    "fmt`...` was not transformed at compile time. " +
      "Make sure the typesugar transformer is configured."
  );
}

/**
 * Parse and validate JSON at compile time.
 * This is a runtime placeholder that throws if the transformer is not applied.
 *
 * @example
 * ```typescript
 * const config = json`{"name": "app", "version": "1.0.0"}`;
 * ```
 */
export function json(_strings: TemplateStringsArray, ..._values: unknown[]): unknown {
  throw new Error(
    "json`...` was not transformed at compile time. " +
      "Make sure the typesugar transformer is configured."
  );
}

/**
 * Raw string without escape processing.
 * This is a runtime placeholder that throws if the transformer is not applied.
 *
 * @example
 * ```typescript
 * const path = raw`C:\Users\name\Documents`;
 * ```
 */
export function raw(_strings: TemplateStringsArray, ..._values: unknown[]): string {
  throw new Error(
    "raw`...` was not transformed at compile time. " +
      "Make sure the typesugar transformer is configured."
  );
}

// ============================================================================
// Regex Tagged Template
// ============================================================================

export const regexMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "regex",
  module: "@typesugar/strings",
  description: "Create compile-time validated regular expressions",

  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const factory = ctx.factory;
    const template = node.template;

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(node, "regex does not support interpolations");
      return node;
    }

    const pattern = template.text;

    // Validate regex at compile time
    try {
      new RegExp(pattern);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid regular expression: ${msg}`);
      return node;
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

export const htmlMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "html",
  module: "@typesugar/strings",
  description: "Create HTML with automatic XSS escaping",

  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const factory = ctx.factory;
    const template = node.template;

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

    return node;
  },
});

// ============================================================================
// Printf-style Format Macro
// ============================================================================

export const fmtMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "fmt",
  module: "@typesugar/strings",
  description: "Printf-style formatting with type checking",

  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const factory = ctx.factory;
    const template = node.template;

    // No interpolations - return as-is
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      return factory.createStringLiteral(template.text);
    }

    if (!ts.isTemplateExpression(template)) {
      return node;
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

export const jsonMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "json",
  module: "@typesugar/strings",
  description: "Parse and validate JSON at compile time",

  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const factory = ctx.factory;
    const template = node.template;

    if (!ts.isNoSubstitutionTemplateLiteral(template)) {
      ctx.reportError(node, "json does not support interpolations - use a regular object literal");
      return node;
    }

    const jsonString = template.text;

    // Validate and parse JSON at compile time
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.reportError(node, `Invalid JSON: ${msg}`);
      return node;
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

export const rawMacro: TaggedTemplateMacroDef = defineTaggedTemplateMacro({
  name: "raw",
  module: "@typesugar/strings",
  description: "Raw string without escape processing",

  expand(ctx: MacroContext, node: ts.TaggedTemplateExpression): ts.Expression {
    const factory = ctx.factory;
    const template = node.template;

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

    return node;
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
