/**
 * @typesugar/parser
 *
 * Compile-time parser generation from PEG grammars — Boost.Spirit for TypeScript.
 *
 * Provides:
 * - PEG grammar definitions via tagged templates or programmatic combinators
 * - Runtime parser generation (Phase 1)
 * - Compile-time inlined parser generation (Phase 2)
 *
 * @module
 */

// Core types
export type { ParseResult, Parser, GrammarRule, Grammar } from "./types.js";

// Combinator API
export {
  ParseError,
  literal,
  char,
  charRange,
  anyChar,
  regex,
  eof,
  seq,
  seq3,
  alt,
  many,
  many1,
  optional,
  not,
  map,
  sepBy,
  sepBy1,
  between,
  lazy,
  digit,
  letter,
  whitespace,
  token,
  integer,
  float,
  quotedString,
} from "./combinators.js";

// Grammar DSL
export { parseGrammarDef, buildParser } from "./grammar.js";

// Compile-time codegen (Phase 2) is intentionally NOT re-exported here. Since
// PEP-057, `codegen.ts` builds parser AST via `ts.factory` and therefore imports
// `typescript`; per PEP-050 the runtime `.` entry must stay typescript-free, so
// `generateParserCode` lives only on the build-time `./macros` path (macros.ts).

// Runtime `grammar` tagged-template fallback.
// The macro *definition* lives in the `./macros` entry (build-time only).
export { grammar } from "./grammar-macro.js";
