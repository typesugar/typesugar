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
 * @param exprs - Template literal interpolated expressions (currently unused)
 * @returns A Grammar that can parse input strings
 */
export function grammar(strings: TemplateStringsArray, ...exprs: unknown[]): Grammar<unknown> {
  const source = strings.join("");
  const rules = parseGrammarDef(source);
  return buildParser(rules);
}
