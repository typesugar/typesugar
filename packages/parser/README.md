# @typesugar/parser

> 📖 **Full documentation:** [Parser Combinators guide](https://typesugar.org/guides/parser). The microsite is the canonical reference; this README is a quickstart.

> Status: experimental — API may change before 1.0.

Compile-time parser generation from PEG grammars. Think Boost.Spirit, but for TypeScript.

Define grammars with tagged templates or programmatic combinators, get recursive-descent parsers.

> **Current Status:** with the typesugar transformer, `grammar` templates are compiled to inline parsers at build time; without it, they are interpreted at runtime.

## Installation

```bash
npm install @typesugar/parser
```

## Quick Start

### Grammar template

```typescript
import { grammar, ParseError } from "@typesugar/parser";

const ident = grammar`
  ident  = letter (letter | digit)*
  letter = 'a'..'z' | 'A'..'Z' | '_'
  digit  = '0'..'9'
`;

ident.parseAll("hello_42"); // succeeds

try {
  ident.parseAll("42nope");
} catch (err) {
  if (err instanceof ParseError) {
    console.log(`${err.line}:${err.col} expected ${err.expected}`); // 1:1 expected 'a'..'z'
  }
}
```

`ParseError` is thrown both by the parser the transformer inlines and by the runtime
interpreter.

### Combinator API

```typescript
import {
  char,
  many,
  alt,
  seq,
  map,
  sepBy,
  between,
  lazy,
  integer,
  token,
  type Parser,
} from "@typesugar/parser";

// CSV row: comma-separated integers
const row = sepBy(integer(), char(","));
row.parseAll("1,2,3"); // [1, 2, 3]

// Arithmetic with correct precedence. Mutually recursive parsers need explicit
// Parser<T> annotations (TypeScript can't infer a type that refers to itself).
const expr: Parser<number> = lazy(() =>
  map(seq(term, many(seq(token(alt(char("+"), char("-"))), term))), ([first, rest]) =>
    rest.reduce((a, [op, b]) => (op === "+" ? a + b : a - b), first)
  )
);
const term: Parser<number> = lazy(() =>
  map(seq(factor, many(seq(token(alt(char("*"), char("/"))), factor))), ([first, rest]) =>
    rest.reduce((a, [op, b]) => (op === "*" ? a * b : a / b), first)
  )
);
const factor: Parser<number> = lazy(() =>
  alt(between(char("("), expr, char(")")), token(integer()))
);

expr.parseAll("2 + 3 * 4"); // 14
expr.parseAll("(2 + 3) * 4"); // 20
```

## Grammar Syntax

PEG grammar definitions support these constructs:

| Syntax               | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| `rule = expr`        | Rule definition                                               |
| `a b c`              | Sequence                                                      |
| `a \| b`             | Ordered alternation (first match wins)                        |
| `a*`                 | Zero or more                                                  |
| `a+`                 | One or more                                                   |
| `a?`                 | Optional                                                      |
| `"text"` or `'text'` | String literal                                                |
| `'a'..'z'`           | Character range (inclusive)                                   |
| `.`                  | Any single character                                          |
| `!a b`               | Negative lookahead: succeed only if `a` fails, then match `b` |
| `(group)`            | Grouping                                                      |
| `ruleName`           | Reference to another rule                                     |
| `// comment`         | Line comment                                                  |

The first rule defined is the start rule by default.

String literals accept the escapes `\n \r \t \b \f \v \0 \\ \" \' \xHH \uHHHH \u{H…}`; any other escape is a grammar error. A newline ends a rule's sequence, except inside a parenthesized group (which may span lines) or before a `|` continuation. Template interpolation (`${...}`) is not supported and is an error, both at build time and at runtime.

## Combinator Reference

### Primitives

| Function              | Description                           |
| --------------------- | ------------------------------------- |
| `literal(s)`          | Match exact string `s`                |
| `char(c)`             | Match single character `c`            |
| `charRange(from, to)` | Match character in range `[from, to]` |
| `anyChar()`           | Match any single character            |
| `regex(pattern)`      | Match regex at current position       |
| `eof()`               | Match end of input                    |

### Combinators

| Function                  | Description                                   |
| ------------------------- | --------------------------------------------- |
| `seq(a, b)`               | Sequence: match `a` then `b`, return `[A, B]` |
| `seq3(a, b, c)`           | Sequence of three, return `[A, B, C]`         |
| `alt(a, b)`               | Ordered alternation: try `a`, then `b`        |
| `many(p)`                 | Zero or more repetitions                      |
| `many1(p)`                | One or more repetitions                       |
| `optional(p)`             | Optional: returns `T \| null`                 |
| `not(p)`                  | Negative lookahead (no consumption)           |
| `map(p, f)`               | Transform result with function `f`            |
| `sepBy(item, sep)`        | Zero or more items separated by `sep`         |
| `sepBy1(item, sep)`       | One or more items separated by `sep`          |
| `between(open, p, close)` | Parse `p` between delimiters                  |
| `lazy(f)`                 | Lazy parser for recursive grammars            |

### Convenience

| Function         | Description                              |
| ---------------- | ---------------------------------------- |
| `digit()`        | ASCII digit `[0-9]`                      |
| `letter()`       | ASCII letter `[a-zA-Z]`                  |
| `whitespace()`   | One or more whitespace characters        |
| `token(p)`       | Parse `p`, skip surrounding whitespace   |
| `integer()`      | Integer with optional leading `-`        |
| `float()`        | Floating-point number                    |
| `quotedString()` | Double-quoted string with escape support |

## PEG vs CFG

This package uses PEG (Parsing Expression Grammar) semantics:

- **Ordered alternation**: `a | b` tries `a` first. If `a` succeeds, `b` is never tried. No ambiguity.
- **Greedy repetition**: `a*` matches as many as possible.
- **No left recursion**: PEG parsers cannot handle left-recursive rules. The grammar parser detects this and throws a helpful error suggesting how to rewrite.

## How It Works

**With the typesugar transformer:** the `grammar` macro parses and validates the PEG definition at build time and replaces the template with an inline recursive-descent parser (no runtime grammar interpretation). Grammar errors, including left recursion, are build errors.

**Without the transformer:** the runtime `grammar` tag parses the PEG definition into a grammar IR and builds a recursive-descent parser from it (`buildParser(parseGrammarDef(text))`). `generateParserCode(rules)` returns the same inline parser as source text. The combinator API builds parsers directly.

## Error Reporting

Parse failures throw `ParseError`, with `pos` (0-based offset), `line` and `col` (1-based)
and `expected` fields. The message names the position and what was expected, followed by
a snippet of the input:

```
Parse error at line 1, col 1: expected 'a'..'z'
  ...42nope...
```

The parser tracks the "furthest failure" position across all alternation branches, so error messages point to the most likely problem location.

## Comparison to PEG.js / Peggy

| Feature            | PEG.js / Peggy         | @typesugar/parser                                                    |
| ------------------ | ---------------------- | -------------------------------------------------------------------- |
| Grammar definition | Separate `.pegjs` file | Inline tagged template or combinators                                |
| Code generation    | Separate build step    | Compile-time macro (with the transformer)                            |
| Type safety        | Manual typing          | Full TypeScript inference                                            |
| Runtime overhead   | Pre-generated parser   | Inlined at compile time with the transformer; interpreted without it |
| Integration        | Standalone tool        | Part of your TypeScript build                                        |
