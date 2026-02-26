/**
 * @typesugar/parser Showcase
 *
 * Self-documenting examples of PEG parser combinators and grammar DSL.
 * Inspired by Boost.Spirit — build type-safe parsers from composable
 * primitives, or define grammars with a PEG notation.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import {
  // Primitive parsers
  literal, char, charRange, anyChar, regex, eof,

  // Combinators
  seq, seq3, alt, many, many1, optional, not, map,
  sepBy, sepBy1, between, lazy,

  // Convenience parsers
  digit, letter, whitespace, token, integer, float, quotedString,

  // Grammar DSL
  parseGrammarDef, buildParser,

  // Error class
  ParseError,

  // Types
  type Parser, type ParseResult, type Grammar,
} from "../src/index.js";

// ============================================================================
// 1. PRIMITIVE PARSERS — Matching Literals and Characters
// ============================================================================

// literal: match an exact string
const hello = literal("hello");
const r1 = hello.parse("hello world");
assert(r1.ok && r1.value === "hello", "literal matches exact string");
assert(r1.ok && r1.pos === 5, "position advances past match");

const r2 = hello.parse("goodbye");
assert(!r2.ok, "literal fails on non-matching input");

// char: match a single specific character
const comma = char(",");
assert(comma.parse(",").ok);
assert(!comma.parse(";").ok);

// charRange: match characters in a range
const lowerCase = charRange("a", "z");
assert(lowerCase.parse("m").ok);
assert(!lowerCase.parse("M").ok, "charRange is case-sensitive");

// anyChar: match any single character
const any = anyChar();
assert(any.parse("x").ok);
assert(!any.parse("").ok, "anyChar fails on empty input");

// regex: anchored regex match
const identifier = regex(/[a-zA-Z_][a-zA-Z0-9_]*/);
const idResult = identifier.parse("myVar_42 + 1");
assert(idResult.ok && idResult.value === "myVar_42");

// eof: match end of input
assert(eof().parse("").ok);
assert(!eof().parse("leftover").ok);

// ============================================================================
// 2. SEQUENCE & ALTERNATION — Composing Parsers
// ============================================================================

// seq: parse two things in order, returning a tuple
const assignment = seq(identifier, seq(token(char("=")), integer()));
const assignResult = assignment.parse("x = 42");
assert(assignResult.ok, "seq parses sequential elements");
if (assignResult.ok) {
  assert(assignResult.value[0] === "x");
  assert(assignResult.value[1][1] === 42);
}

// seq3: three-element sequence
const triple = seq3(integer(), token(char("+")), integer());
const tripleResult = triple.parse("3 + 5");
assert(tripleResult.ok);
if (tripleResult.ok) {
  assert(tripleResult.value[0] === 3 && tripleResult.value[2] === 5);
}

// alt: ordered alternation (PEG semantics — first match wins)
const boolOrNum = alt(
  map(literal("true"), () => true as boolean | number),
  map(integer(), n => n as boolean | number)
);
assert(boolOrNum.parseAll("true") === true);
assert(boolOrNum.parseAll("42") === 42);

// ============================================================================
// 3. REPETITION — Many, Many1, Optional, SepBy
// ============================================================================

// many: zero or more
const digits = many(digit());
const digitsResult = digits.parse("123abc");
assert(digitsResult.ok && digitsResult.value.length === 3);
assert(digitsResult.ok && digitsResult.value.join("") === "123");

// many also succeeds with zero matches
const noDigits = digits.parse("abc");
assert(noDigits.ok && noDigits.value.length === 0);

// many1: one or more (fails if zero matches)
const digits1 = many1(digit());
assert(!digits1.parse("abc").ok, "many1 requires at least one match");
assert(digits1.parse("42").ok);

// optional: succeed with null if parser fails
const maybeSign = optional(char("-"));
const withSign = maybeSign.parse("-5");
assert(withSign.ok && withSign.value === "-");
const noSign = maybeSign.parse("5");
assert(noSign.ok && noSign.value === null);

// sepBy: items separated by a delimiter
const csvNumbers = sepBy(integer(), token(char(",")));
const csvResult = csvNumbers.parseAll("1, 2, 3");
assert(csvResult.length === 3);
assert(csvResult[0] === 1 && csvResult[1] === 2 && csvResult[2] === 3);

// sepBy handles empty input
const emptyList = sepBy(integer(), char(","));
const emptyResult = emptyList.parse("");
assert(emptyResult.ok && emptyResult.value.length === 0);

// sepBy1: requires at least one item
const csvRequired = sepBy1(integer(), token(char(",")));
assert(!csvRequired.parse("").ok, "sepBy1 requires at least one element");

// ============================================================================
// 4. BETWEEN & TRANSFORMATION — Brackets, Map
// ============================================================================

// between: parse something surrounded by delimiters
const parens = between(char("("), integer(), char(")"));
assert(parens.parseAll("(42)") === 42, "between extracts inner value");

const brackets = between(
  token(char("[")),
  sepBy(integer(), token(char(","))),
  token(char("]"))
);
const arrResult = brackets.parseAll("[1, 2, 3]");
assert(arrResult.length === 3);
assert(arrResult[0] === 1 && arrResult[2] === 3);

// map: transform parser results
const uppercaseLetter = map(letter(), ch => ch.toUpperCase());
assert(uppercaseLetter.parseAll("a") === "A");

// Combine map with seq for structured parsing
const keyValue = map(
  seq3(identifier, token(char(":")), quotedString()),
  ([key, , value]) => ({ key, value })
);
const kvResult = keyValue.parseAll('name: "Alice"');
assert(kvResult.key === "name" && kvResult.value === "Alice");

// ============================================================================
// 5. LOOKAHEAD & NEGATION — Peeking Without Consuming
// ============================================================================

// not: negative lookahead (succeeds only if inner parser fails)
const notDigit = seq(not(digit()), anyChar());
assert(notDigit.parse("a").ok, "not(digit) passes on non-digits");
assert(!notDigit.parse("5").ok, "not(digit) fails on digits");

// Useful for matching "everything except X" patterns
const nonQuote = seq(not(char('"')), anyChar());
assert(nonQuote.parse("a").ok);
assert(!nonQuote.parse('"').ok);

// ============================================================================
// 6. CONVENIENCE PARSERS — Common Patterns Built In
// ============================================================================

// integer: optional minus, digits
assert(integer().parseAll("42") === 42);
assert(integer().parseAll("-7") === -7);

// float: decimal numbers
assert(float().parseAll("3.14") === 3.14);
assert(float().parseAll("-0.5") === -0.5);
assert(float().parseAll("1e3") === 1000);

// quotedString: double-quoted with escape support
assert(quotedString().parseAll('"hello world"') === "hello world");
assert(quotedString().parseAll('"line\\nbreak"') === "line\nbreak");
assert(quotedString().parseAll('"escaped\\"quote"') === 'escaped"quote');

// whitespace: one or more whitespace chars
assert(whitespace().parse("  \t").ok);
assert(!whitespace().parse("abc").ok);

// token: wraps a parser in optional whitespace
const tokenNum = token(integer());
const spaced = tokenNum.parse("  42  ");
assert(spaced.ok && spaced.value === 42, "token handles surrounding whitespace");

// digit / letter: single-character matchers
assert(digit().parseAll("7") === "7");
assert(letter().parseAll("Z") === "Z");

// ============================================================================
// 7. RECURSIVE PARSERS — Handling Nested Structures
// ============================================================================

// lazy() enables recursive grammar definitions
type SExpr = string | SExpr[];

// S-expression parser: atoms (identifiers) or lists in parentheses
// We use token() wrappers uniformly to handle whitespace, avoiding
// the sepBy+whitespace conflict that occurs when sepBy's separator
// competes with token()'s whitespace consumption
const sExprAtom: Parser<SExpr> = map(many1(letter()), chars => chars.join(""));
const sExprList: Parser<SExpr> = lazy(() =>
  map(
    seq3(
      token(char("(")),
      many(token(sExpr)),
      token(char(")"))
    ),
    ([, items]) => items
  )
);
const sExpr: Parser<SExpr> = lazy(() => alt(sExprAtom, sExprList));

const atom = sExpr.parseAll("hello");
assert(atom === "hello");

const nested = sExpr.parseAll("(add x y)");
assert(Array.isArray(nested));
if (Array.isArray(nested)) {
  assert(nested[0] === "add" && nested[1] === "x" && nested[2] === "y");
}

// Deeply nested
const deep = sExpr.parseAll("(mul (add a b) c)");
assert(Array.isArray(deep));
if (Array.isArray(deep)) {
  assert(deep[0] === "mul");
  assert(Array.isArray(deep[1]));
}

// ============================================================================
// 8. ERROR HANDLING — ParseError with Position Info
// ============================================================================

// parseAll throws ParseError on failure
let caught = false;
try {
  integer().parseAll("not-a-number");
} catch (e) {
  caught = true;
  assert(e instanceof ParseError, "Throws ParseError");
  assert(e.pos === 0, "Error position is at failure point");
  assert(e.expected.length > 0, "Expected description is provided");
}
assert(caught, "ParseError was thrown");

// parse() returns a result without throwing
const safeResult = integer().parse("abc");
assert(!safeResult.ok);
if (!safeResult.ok) {
  assert(safeResult.expected.length > 0, "Failure includes expected description");
}

// ============================================================================
// 9. GRAMMAR DSL — PEG Notation for Complex Grammars
// ============================================================================

// parseGrammarDef + buildParser create a parser from PEG notation
const rules = parseGrammarDef(`
  number = '-'? '0'..'9'+ ('.' '0'..'9'+)?
`);

const numberParser = buildParser(rules);
assert(numberParser.startRule === "number", "First rule is the start rule");

// The grammar produces a Grammar<T> which is also a Parser<T>
const numResult = numberParser.parse("42");
assert(numResult.ok, "Grammar-based parser works on valid input");

const numResult2 = numberParser.parse("-3.14");
assert(numResult2.ok, "Grammar handles negative decimals");

// ============================================================================
// 10. REAL-WORLD EXAMPLE — JSON-Subset Parser
// ============================================================================

// Build a JSON value parser entirely from combinators
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

const jsonValue: Parser<JsonValue> = lazy(() =>
  alt(
    alt(
      alt(
        map(quotedString(), s => s as JsonValue),
        map(float(), n => n as JsonValue)
      ),
      alt(
        map(literal("true"), () => true as JsonValue),
        alt(
          map(literal("false"), () => false as JsonValue),
          map(literal("null"), () => null as JsonValue)
        )
      )
    ),
    alt(jsonArray, jsonObject)
  )
);

const jsonArray: Parser<JsonValue> = lazy(() =>
  between(
    token(char("[")),
    sepBy(token(jsonValue), token(char(","))),
    token(char("]"))
  )
);

const jsonPair: Parser<[string, JsonValue]> = lazy(() =>
  map(
    seq3(token(quotedString()), token(char(":")), token(jsonValue)),
    ([key, , value]) => [key, value] as [string, JsonValue]
  )
);

const jsonObject: Parser<JsonValue> = lazy(() =>
  map(
    between(
      token(char("{")),
      sepBy(jsonPair, token(char(","))),
      token(char("}"))
    ),
    pairs => {
      const obj: { [k: string]: JsonValue } = {};
      for (const [k, v] of pairs) {
        obj[k] = v;
      }
      return obj as JsonValue;
    }
  )
);

// Parse a JSON string
const jsonStr = '{"name": "Alice", "age": 30, "active": true}';
const parsed = jsonValue.parseAll(jsonStr) as Record<string, JsonValue>;
assert(parsed["name"] === "Alice");
assert(parsed["age"] === 30);
assert(parsed["active"] === true);

// Parse JSON arrays
const jsonArr = "[1, 2, 3]";
const parsedArr = jsonValue.parseAll(jsonArr) as JsonValue[];
assert(parsedArr.length === 3);
assert(parsedArr[0] === 1 && parsedArr[2] === 3);

// Nested JSON
const nestedJson = '{"data": [1, {"nested": true}]}';
const parsedNested = jsonValue.parseAll(nestedJson) as Record<string, JsonValue>;
assert(Array.isArray(parsedNested["data"]));
