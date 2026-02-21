# @typesugar/parser

Compile-time parser generation from PEG grammars. Think Boost.Spirit, but for TypeScript.

Define grammars with tagged templates or programmatic combinators, get zero-overhead recursive-descent parsers.

## Quick Start

### Grammar template

```typescript
import { grammar } from "@typesugar/parser";

const ident = grammar`
  ident  = letter (letter | digit)*
  letter = 'a'..'z' | 'A'..'Z' | '_'
  digit  = '0'..'9'
`;

ident.parseAll("hello_42"); // succeeds
ident.parseAll("42nope"); // throws ParseError
```

### Combinator API

```typescript
import {
  literal,
  char,
  charRange,
  many,
  many1,
  alt,
  seq,
  map,
  sepBy,
  between,
  lazy,
  integer,
  token,
} from "@typesugar/parser";

// CSV row: comma-separated integers
const row = sepBy(integer(), char(","));
row.parseAll("1,2,3"); // [1, 2, 3]

// Arithmetic with correct precedence
const expr = lazy(() =>
  map(seq(term, many(seq(token(alt(char("+"), char("-"))), term))), ([first, rest]) =>
    rest.reduce((a, [op, b]) => (op === "+" ? a + b : a - b), first)
  )
);
const term = lazy(() =>
  map(seq(factor, many(seq(token(alt(char("*"), char("/"))), factor))), ([first, rest]) =>
    rest.reduce((a, [op, b]) => (op === "*" ? a * b : a / b), first)
  )
);
const factor = lazy(() => alt(between(char("("), expr, char(")")), token(integer())));

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

**Phase 1 (current):** The `grammar` tagged template parses the PEG definition at runtime into a grammar IR, then builds a recursive-descent parser from that IR. The combinator API builds parsers directly.

**Phase 2 (future):** The `grammar` macro will generate inlined recursive-descent parser code at compile time via the typesugar transformer, producing zero-overhead parsers with no runtime grammar interpretation.

## Error Reporting

Parse failures include the position (line/col) and what was expected:

```
Parse error at line 3, col 5: expected "}" or ","
```

The parser tracks the "furthest failure" position across all alternation branches, so error messages point to the most likely problem location.

## Comparison to PEG.js / Peggy

| Feature            | PEG.js / Peggy         | @typesugar/parser                     |
| ------------------ | ---------------------- | ------------------------------------- |
| Grammar definition | Separate `.pegjs` file | Inline tagged template or combinators |
| Code generation    | Separate build step    | Compile-time macro (Phase 2)          |
| Type safety        | Manual typing          | Full TypeScript inference             |
| Runtime overhead   | Pre-generated parser   | Phase 1: interpreted; Phase 2: zero   |
| Integration        | Standalone tool        | Part of your TypeScript build         |
