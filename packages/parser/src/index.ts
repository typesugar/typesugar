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

// Compile-time codegen (Phase 2)
export { generateParserCode, resetVarCounter } from "./codegen.js";

// Runtime `grammar` tagged-template fallback.
// The macro *definition* lives in the `./macros` entry (build-time only).
export { grammar } from "./grammar-macro.js";
