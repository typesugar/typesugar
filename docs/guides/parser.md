# Parser Combinators

Compile-time parser generation from PEG grammars — define grammars inline with tagged templates or build parsers programmatically with combinators.

## Quick Start

```bash
npm install @typesugar/parser
```

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

## Grammar Syntax Reference

The `grammar` tagged template accepts PEG (Parsing Expression Grammar) syntax. The first rule is the start rule.

| Syntax               | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `rule = expr`        | Rule definition                                            |
| `a b c`              | Sequence — match a, then b, then c                         |
| `a \| b`             | Ordered alternation — try a first, then b                  |
| `a*`                 | Zero or more                                               |
| `a+`                 | One or more                                                |
| `a?`                 | Optional                                                   |
| `"text"` or `'text'` | String literal                                             |
| `'a'..'z'`           | Character range (inclusive)                                |
| `.`                  | Any single character                                       |
| `!a b`               | Negative lookahead — succeed only if a fails, then match b |
| `(group)`            | Grouping                                                   |
| `ruleName`           | Reference to another rule                                  |
| `// comment`         | Line comment                                               |

PEG alternation is **ordered** — `a | b` tries `a` first. If it matches, `b` is never tried. No ambiguity, no backtracking surprises.

## Combinator API

For cases where you want programmatic control, build parsers from functions:

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
  optional,
} from "@typesugar/parser";

// Match a comma-separated list of integers
const csvRow = sepBy(integer(), char(","));
csvRow.parseAll("1,2,3"); // [1, 2, 3]

// Match a quoted string
const quoted = between(char('"'), many(charRange(" ", "~")), char('"'));

// Optional prefix
const signed = seq(optional(char("-")), integer());
```

### Primitives

| Function              | Description                     |
| --------------------- | ------------------------------- |
| `literal(s)`          | Exact string match              |
| `char(c)`             | Single character                |
| `charRange(from, to)` | Character in range `[from, to]` |
| `anyChar()`           | Any single character            |
| `regex(pattern)`      | Regex at current position       |
| `eof()`               | End of input                    |

### Combinators

| Function                                 | Description                   |
| ---------------------------------------- | ----------------------------- |
| `seq(a, b)` / `seq3(a, b, c)`            | Sequence, returns tuple       |
| `alt(a, b)`                              | Ordered alternation           |
| `many(p)` / `many1(p)`                   | Zero/one or more              |
| `optional(p)`                            | Returns `T \| null`           |
| `not(p)`                                 | Negative lookahead            |
| `map(p, f)`                              | Transform result              |
| `sepBy(item, sep)` / `sepBy1(item, sep)` | Separated list                |
| `between(open, p, close)`                | Parse between delimiters      |
| `lazy(f)`                                | Lazy evaluation for recursion |

### Convenience Parsers

`digit()`, `letter()`, `whitespace()`, `token(p)`, `integer()`, `float()`, `quotedString()`

## Building a JSON Parser

Here's a step-by-step JSON value parser showing how combinators compose:

```typescript
import {
  literal,
  char,
  many,
  alt,
  seq,
  map,
  sepBy,
  between,
  lazy,
  token,
  integer,
  float,
  quotedString,
} from "@typesugar/parser";

const jsonValue = lazy(() =>
  alt(alt(alt(jsonString, jsonNumber), alt(jsonBool, jsonNull)), alt(jsonArray, jsonObject))
);

const jsonString = token(quotedString());
const jsonNumber = token(float());
const jsonBool = alt(
  map(token(literal("true")), () => true),
  map(token(literal("false")), () => false)
);
const jsonNull = map(token(literal("null")), () => null);

const jsonArray = between(token(char("[")), sepBy(jsonValue, token(char(","))), token(char("]")));

const jsonPair = map(
  seq3(token(quotedString()), token(char(":")), jsonValue),
  ([key, , value]) => [key, value] as const
);

const jsonObject = map(
  between(token(char("{")), sepBy(jsonPair, token(char(","))), token(char("}"))),
  (pairs) => Object.fromEntries(pairs)
);

jsonValue.parseAll('{"name": "Alice", "scores": [1, 2, 3]}');
```

Key pattern: `lazy()` breaks the circular reference between `jsonValue` and the containers that reference it.

## Error Handling

Parse failures include position and what was expected:

```
Parse error at line 3, col 5: expected "}" or ","
```

The parser tracks the "furthest failure" across all alternation branches, so errors point to the most likely problem — not just the first branch that failed.

```typescript
import { ParseError } from "@typesugar/parser";

try {
  myParser.parseAll(input);
} catch (err) {
  if (err instanceof ParseError) {
    console.log(`${err.message} at ${err.line}:${err.col}`);
  }
}
```

## Grammar DSL vs Combinators

|                  | Grammar DSL                       | Combinators                 |
| ---------------- | --------------------------------- | --------------------------- |
| Best for         | Declarative grammars, readability | Dynamic parser construction |
| Recursive rules  | Automatic by name reference       | Requires `lazy()`           |
| Type inference   | Limited (string-based)            | Full TypeScript inference   |
| Semantic actions | Not yet (Phase 2)                 | `map()` on any parser       |

Use the grammar DSL when the structure is known upfront and readability matters. Use combinators when you need to build parsers dynamically or want full type inference on results.

## What's Next

- [API Reference](/reference/packages#parser)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/parser)
