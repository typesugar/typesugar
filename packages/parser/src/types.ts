/**
 * Core types for @typesugar/parser
 *
 * Defines the parse result, parser interface, grammar IR, and grammar type.
 */

/** Result of a parse attempt — either success with a value or failure with expected description. */
export type ParseResult<T> =
  | { ok: true; value: T; pos: number }
  | { ok: false; pos: number; expected: string };

/** A parser is a function from (input, position) to ParseResult. */
export interface Parser<T> {
  /** Attempt to parse starting at `pos` (default 0). */
  parse(input: string, pos?: number): ParseResult<T>;
  /** Parse the full input, throwing if not consumed entirely. */
  parseAll(input: string): T;
}

/** Grammar rule IR nodes — the intermediate representation for PEG grammars. */
export type GrammarRule =
  | { type: "literal"; value: string }
  | { type: "charRange"; from: string; to: string }
  | { type: "sequence"; rules: GrammarRule[] }
  | { type: "alternation"; rules: GrammarRule[] }
  | { type: "repetition"; rule: GrammarRule; min: number; max: number | null }
  | { type: "optional"; rule: GrammarRule }
  | { type: "negation"; rule: GrammarRule; then: GrammarRule }
  | { type: "reference"; name: string }
  | { type: "any" }
  | { type: "action"; rule: GrammarRule; transform: string };

/** A compiled grammar with named rules and a start rule. */
export interface Grammar<T> extends Parser<T> {
  /** All named rules in the grammar. */
  readonly rules: Map<string, GrammarRule>;
  /** The name of the start rule (first rule defined). */
  readonly startRule: string;
}
