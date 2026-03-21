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

    // No interpolations - just process %% escapes in the static string
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
      const parts = parseFormatString(template.text);
      const text = parts
        .filter((p): p is { type: "literal"; value: string } => p.type === "literal")
        .map((p) => p.value)
        .join("");
      return factory.createStringLiteral(text);
    }

    if (!ts.isTemplateExpression(template)) {
      return node;
    }

    // Parse format specifiers from the literal portions of the template.
    // A format specifier at the END of a literal part applies to the NEXT
    // interpolated expression.  E.g.  fmt`Value: %d${x} done`
    //   literal "Value: " has trailing %d -> applied to ${x}

    let result: ts.Expression = factory.createStringLiteral("");

    /**
     * Process a literal string, returning any trailing format specifier
     * that should be applied to the next interpolation.
     */
    const emitLiteralParts = (
      parts: Array<{ type: "literal"; value: string } | { type: "format"; value: string }>
    ): string | null => {
      let trailingFormat: string | null = null;

      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        if (part.type === "literal" && part.value) {
          result = concatStrings(factory, result, factory.createStringLiteral(part.value));
        } else if (part.type === "format") {
          // If this is the last part, it's a trailing specifier for the next interpolation
          if (j === parts.length - 1) {
            trailingFormat = part.value;
          } else {
            // Format specifier not followed by interpolation - treat as literal text
            result = concatStrings(factory, result, factory.createStringLiteral(part.value));
          }
        }
      }

      return trailingFormat;
    };

    // Process head
    const headParts = parseFormatString(template.head.text);
    let pendingFormat = emitLiteralParts(headParts);

    // Process spans
    for (let i = 0; i < template.templateSpans.length; i++) {
      const span = template.templateSpans[i];

      // Apply format specifier (from preceding literal) to this expression
      const formattedValue = applyFormatSpecifier(factory, span.expression, pendingFormat);
      result = concatStrings(factory, result, formattedValue);

      // Process literal part after the expression
      const literalParts = parseFormatString(span.literal.text);
      pendingFormat = emitLiteralParts(literalParts);
    }

    // If there's an unused trailing format specifier, emit it as literal text
    if (pendingFormat) {
      result = concatStrings(factory, result, factory.createStringLiteral(pendingFormat));
    }

    return result;
  },
});

/**
 * Generate a TS AST expression that formats `expr` according to a printf-style
 * format specifier.  When `specifier` is null the value is converted via String().
 */
export function applyFormatSpecifier(
  factory: ts.NodeFactory,
  expr: ts.Expression,
  specifier: string | null
): ts.Expression {
  if (!specifier) {
    // Default: String(expr)
    return factory.createCallExpression(factory.createIdentifier("String"), undefined, [expr]);
  }

  // %.Nf  - toFixed(N)
  const precisionMatch = specifier.match(/^%\.(\d+)f$/);
  if (precisionMatch) {
    const n = precisionMatch[1];
    // String(Number(expr).toFixed(N))
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createCallExpression(factory.createIdentifier("Number"), undefined, [expr]),
        "toFixed"
      ),
      undefined,
      [factory.createNumericLiteral(n)]
    );
  }

  switch (specifier) {
    case "%d":
    case "%i":
      // String(Math.floor(Number(expr)))
      return factory.createCallExpression(factory.createIdentifier("String"), undefined, [
        factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier("Math"), "floor"),
          undefined,
          [factory.createCallExpression(factory.createIdentifier("Number"), undefined, [expr])]
        ),
      ]);

    case "%f":
      // String(Number(expr))
      return factory.createCallExpression(factory.createIdentifier("String"), undefined, [
        factory.createCallExpression(factory.createIdentifier("Number"), undefined, [expr]),
      ]);

    case "%s":
      // String(expr)
      return factory.createCallExpression(factory.createIdentifier("String"), undefined, [expr]);

    case "%x":
      // Number(expr).toString(16)
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createCallExpression(factory.createIdentifier("Number"), undefined, [expr]),
          "toString"
        ),
        undefined,
        [factory.createNumericLiteral("16")]
      );

    case "%o":
      // Number(expr).toString(8)
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createCallExpression(factory.createIdentifier("Number"), undefined, [expr]),
          "toString"
        ),
        undefined,
        [factory.createNumericLiteral("8")]
      );

    case "%b":
      // Number(expr).toString(2)
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createCallExpression(factory.createIdentifier("Number"), undefined, [expr]),
          "toString"
        ),
        undefined,
        [factory.createNumericLiteral("2")]
      );

    default:
      // Unknown specifier - just use String()
      return factory.createCallExpression(factory.createIdentifier("String"), undefined, [expr]);
  }
}

/**
 * Parse a format string into literal and format specifier parts.
 *
 * Recognized specifiers:
 *   %d / %i  - integer (Math.floor)
 *   %f       - float (Number)
 *   %.Nf     - float with N decimal places (toFixed(N))
 *   %s       - string (String)
 *   %x       - hex (toString(16))
 *   %o       - octal (toString(8))
 *   %b       - binary (toString(2))
 *   %%       - literal percent sign
 */
export function parseFormatString(
  str: string
): Array<{ type: "literal"; value: string } | { type: "format"; value: string }> {
  const parts: Array<{ type: "literal"; value: string } | { type: "format"; value: string }> = [];
  let current = "";
  let i = 0;

  while (i < str.length) {
    if (str[i] === "%" && i + 1 < str.length) {
      const next = str[i + 1];

      if (next === "%") {
        // Escaped percent - emit as literal %
        current += "%";
        i += 2;
        continue;
      }

      if (
        next === "d" ||
        next === "i" ||
        next === "f" ||
        next === "s" ||
        next === "x" ||
        next === "o" ||
        next === "b"
      ) {
        // Push any accumulated literal
        if (current) {
          parts.push({ type: "literal", value: current });
          current = "";
        }
        parts.push({ type: "format", value: "%" + next });
        i += 2;
        continue;
      }

      // Check for %.Nf (precision specifier)
      if (next === ".") {
        const precisionMatch = str.slice(i).match(/^%\.(\d+)f/);
        if (precisionMatch) {
          if (current) {
            parts.push({ type: "literal", value: current });
            current = "";
          }
          parts.push({ type: "format", value: `%.${precisionMatch[1]}f` });
          i += precisionMatch[0].length;
          continue;
        }
      }

      // Not a recognized specifier - treat as literal
      current += str[i];
      i++;
    } else {
      current += str[i];
      i++;
    }
  }

  if (current) {
    parts.push({ type: "literal", value: current });
  }

  return parts;
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
