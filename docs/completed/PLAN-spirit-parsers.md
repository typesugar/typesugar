# Plan: Compile-Time Parser Generation (Spirit-Style)

## Status: PHASE 1 IMPLEMENTED

Phase 1 (runtime combinators + grammar DSL + tagged template macro) is implemented in `packages/parser/`. Phase 2 (compile-time inlined parser generation) is future work.

## Inspiration

C++ Boost.Spirit lets you define grammars as expression templates that compile into hand-rolled recursive descent parsers. No parser combinator overhead at runtime — the grammar DSL is purely a compile-time specification, and the output is what you'd write by hand.

typesugar already has tagged template macros, which makes this uniquely feasible in TypeScript. No other TS tool compiles grammars to zero-cost parsers at build time.

## Design

### User-Facing API

```typescript
import { grammar, Parser } from "@typesugar/parser";

// Define a grammar with a tagged template macro
const json = grammar`
  value   = string | number | array | object | bool | "null"
  string  = '"' (!'"' .)* '"'
  number  = '-'? digit+ ('.' digit+)?
  array   = '[' (value (',' value)*)? ']'
  object  = '{' (pair (',' pair)*)? '}'
  pair    = string ':' value
  bool    = "true" | "false"
  digit   = '0'..'9'
`;

// Compile-time: grammar is parsed and a recursive descent parser is generated
// Runtime: just the generated parser function — no grammar object, no combinator overhead
const result = json.parse('{"name": "typesugar", "version": 1}');
// result: { ok: true, value: { name: "typesugar", version: 1 } }
```

### Typed Output via Semantic Actions

```typescript
interface JsonValue {
  type: "string" | "number" | "boolean" | "null" | "array" | "object";
  value: unknown;
}

const typedJson = grammar<JsonValue>`
  value   = string  => ${{ type: "string", value: $0 }}
          | number  => ${{ type: "number", value: Number($0) }}
          | array   => ${{ type: "array", value: $0 }}
          | object  => ${{ type: "object", value: Object.fromEntries($0) }}
          | "true"  => ${{ type: "boolean", value: true }}
          | "false" => ${{ type: "boolean", value: false }}
          | "null"  => ${{ type: "null", value: null }}
  // ...
`;
```

### Combinator API (Programmatic Alternative)

For when tagged templates are too restrictive:

```typescript
import { seq, alt, many, many1, map, char, string, digit, lazy } from "@typesugar/parser";

const number = map(many1(digit), (digits) => Number(digits.join("")));
const csv = seq(number, many(seq(char(","), number).map(([, n]) => n)));

// macro: compiles combinator tree into fused parser at build time
const parser = compile(csv);
```

### Grammar Features

| Feature         | Syntax                | Compiles To                            |
| --------------- | --------------------- | -------------------------------------- |
| Sequence        | `a b c`               | Nested if-checks with early return     |
| Alternation     | `a \| b \| c`         | Sequential try-parse with backtracking |
| Repetition      | `a*`, `a+`, `a?`      | While-loop                             |
| Character class | `'a'..'z'`            | Charcode range check                   |
| Negation        | `!a b`                | Negative lookahead                     |
| Semantic action | `a => ${expr}`        | Inline transform                       |
| Named capture   | `name:rule`           | Local variable binding                 |
| Left recursion  | Detected and reported | Compile error with fix suggestion      |

## Implementation

### Phase 1: Grammar DSL + Parser Generation

**Package:** `@typesugar/parser`

**Macro type:** Tagged template macro (like `units`)

**Compile-time steps:**

1. Parse the grammar string at compile time using `ctx.evaluate()`
2. Build an internal grammar IR (rules, alternatives, sequences, repetitions)
3. Detect left recursion and report compile errors
4. Generate a recursive descent parser as TypeScript AST
5. Emit the parser function — no grammar object in output

**Generated code shape:**

```typescript
// Input: grammar`value = "true" | "false" | number`
// Output:
function parse(input: string, pos: number): ParseResult {
  // try "true"
  if (input.startsWith("true", pos)) return { ok: true, value: true, pos: pos + 4 };
  // try "false"
  if (input.startsWith("false", pos)) return { ok: true, value: false, pos: pos + 5 };
  // try number
  return parseNumber(input, pos);
}
```

### Phase 2: Combinator Compilation

The `compile()` macro takes a combinator expression tree and fuses it:

- `seq(a, b)` → inline both parsers sequentially
- `alt(a, b)` → try `a`, on failure try `b`
- `many(a)` → while loop
- `map(a, f)` → inline `f` after `a` succeeds

This reuses the `specialize()` infrastructure for inlining.

### Phase 3: Error Recovery + Diagnostics

- Track furthest failure position for good error messages
- `expected("number")` annotations in grammar for human-readable errors
- Source location mapping back to grammar definition

### Phase 4: Streaming / Incremental Parsing

- `parser.feed(chunk)` for streaming input
- Pause/resume state as a plain object (serializable)

## Zero-Cost Verification

The output should match what a developer would write by hand:

```typescript
// grammar`number = '-'? digit+ ('.' digit+)?`
// Should compile to approximately:
function parseNumber(input: string, pos: number): ParseResult<number> {
  let p = pos;
  let negative = false;
  if (p < input.length && input.charCodeAt(p) === 45) {
    negative = true;
    p++;
  }
  const start = p;
  while (p < input.length && input.charCodeAt(p) >= 48 && input.charCodeAt(p) <= 57) p++;
  if (p === start) return { ok: false, pos, expected: "digit" };
  let num = Number(input.slice(start, p));
  if (p < input.length && input.charCodeAt(p) === 46) {
    p++;
    const fracStart = p;
    while (p < input.length && input.charCodeAt(p) >= 48 && input.charCodeAt(p) <= 57) p++;
    if (p === fracStart) return { ok: false, pos, expected: "digit after '.'" };
    num = Number(input.slice(start, p));
  }
  return { ok: true, value: negative ? -num : num, pos: p };
}
```

No combinator objects, no function pointer chasing, no closure allocation.

## Inspirations

- **Boost.Spirit** — expression template parser generation
- **PEG.js / Peggy** — PEG grammar syntax (but those generate at npm-install time, not compile time)
- **nom (Rust)** — zero-copy combinator parsers (our streaming phase)
- **Menhir (OCaml)** — LR parser generator with semantic actions

## Dependencies

- `@typesugar/core` — tagged template macro infrastructure
- `@typesugar/macros` — `specialize()` / `inlineMethod()` for combinator fusion

## Open Questions

1. Should we support PEG semantics (ordered alternation, no ambiguity) or CFG (with ambiguity reporting)?
   PEG is simpler and matches Spirit's behavior.
2. How to handle unicode? Charcode ranges work for ASCII, but grapheme clusters need ICU.
3. Should the combinator API be a separate package (`@typesugar/parser-combinators`) or unified?
