/**
 * Runtime `grammar` tagged template (Case-1, PEP-050).
 *
 * This is the **runtime** fallback used when the compile-time macro is not active
 * (e.g., in tests, REPL, or when the transformer is not configured). It does NOT
 * import `typescript` — the macro *definition* (which does) lives in the `./macros`
 * entry (`src/macros.ts`), loaded by the transformer at build time.
 */

import type { Grammar } from "./types.js";
import { parseGrammarDef, buildParser } from "./grammar.js";

/**
 * Runtime `grammar` tagged template function.
 *
 * @param strings - Template literal string parts
 * @param exprs - Interpolated expressions. Interpolation is not supported: any
 *   `${...}` in the template throws, rather than silently dropping the value
 *   and parsing a different grammar.
 * @returns A Grammar that can parse input strings
 */
export function grammar(strings: TemplateStringsArray, ...exprs: unknown[]): Grammar<unknown> {
  if (exprs.length > 0 || strings.length !== 1) {
    throw new Error(
      "grammar template interpolation (${...}) is not supported; " +
        "write the grammar as a plain template, or build it with parseGrammarDef(text)"
    );
  }
  const source = strings[0];
  const rules = parseGrammarDef(source);
  return buildParser(rules);
}
