/**
 * @typesugar/strings — runtime entry (Case-2, PEP-050).
 *
 * Compile-time validated/transformed string literals, inspired by Scala's string
 * interpolators: `regex`, `html`, `fmt`, `raw`.
 *
 * This `.` entry is **runtime-only** and does NOT import `typescript`. It exposes:
 * - the tagged-template stubs (typed signatures; they throw if the transformer
 *   didn't run), and
 * - `__typesugar_escapeHtml`, the runtime helper the `html` macro emits calls to.
 *
 * The macro *definitions* (which import `typescript`) live in the `./macros` entry,
 * loaded by the transformer at build time. Note: For SQL queries, use
 * @typesugar/sql instead.
 */

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
// Runtime Helper (the html macro emits calls to this)
// ============================================================================

/**
 * HTML escape function — referenced by code the `html` macro generates.
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
