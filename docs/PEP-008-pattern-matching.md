# PEP-008: Scala-Style Pattern Matching

**Status:** Done (All waves complete)
**Date:** 2026-03-15
**Author:** Dean Povey

## Context

TypeScript has no first-class pattern matching. Developers use chains of `if`/`else`, `switch` statements, or ternary expressions to destructure and dispatch on values. This is verbose, error-prone, and lacks exhaustiveness checking.

The existing `match()` macro in `@typesugar/std` handles discriminated unions and literal dispatch well, but lacks structural pattern matching — the ability to match on shape (arrays, objects, nested structures) with variable binding, guards, and extractors.

Scala's pattern matching is the gold standard:

```scala
val result = x match {
  case List(first, _, _) if first > 0 => first
  case (a, b) => a + b
  case Some(v) if v > 0 => v * 2
  case None => 0
  case s: String => s.length
  case p @ Point(x, y) if x > 0 => p
}
```

We want equivalent expressiveness in TypeScript, with two syntaxes:

1. **Preprocessor syntax** (`.sts` files) — Scala-like with `|` separators
2. **Macro-only syntax** (`.ts` files) — Fluent `.case().if().then()` chains

### Key Insight (Verified)

Pattern variables like `first` in `.case([first, _, _])` don't need to be pre-declared. TypeScript's parser (`ts.createSourceFile()`) produces a complete AST with zero parse errors for undefined identifiers. The macro transformer runs on this AST and rewrites patterns into properly scoped code before the type checker sees it.

Verified empirically:

- **Parse diagnostics:** 0 errors
- **AST integrity:** All `.case()`, `.if()`, `.then()` nodes fully accessible
- **Transformer:** Successfully extracts bindings and rewrites
- **Generated output:** 0 type errors after transformation

Build tools (Vite/esbuild/Rollup) never type-check — the macro transforms and the bundler strips types. For IDE, the language service plugin suppresses known pattern-match diagnostics.

## Syntax Design

### Preprocessor Syntax (`.sts`)

```typescript
const y = match(x)
| [first, _, _] if first > 0 => first
| [_, second, _] => second
| _ => 0
```

### Macro Syntax (`.ts`)

```typescript
const y = match(x)
  .case([first, _, _])
  .if(first > 0)
  .then(first)
  .case([_, second, _])
  .then(second)
  .else(0);
```

Both compile to identical optimized output. No `$` prefix or pre-declaration needed.

## Pattern Catalogue

### 1. Literals

```typescript
// Preprocessor
match(x)
| 42 => "the answer"
| "hello" => "greeting"
| true => "yes"
| null => "nothing"
| undefined => "missing"
| _ => "other"

// Macro
match(x)
  .case(42).then("the answer")
  .case("hello").then("greeting")
  .case(true).then("yes")
  .case(null).then("nothing")
  .case(undefined).then("missing")
  .else("other")
```

**Compilation:** Direct `===` comparison. Strings/numbers above 6 arms use switch statement.

### 2. Variable Binding

```typescript
// Preprocessor
match(x)
| n if n > 0 => n * 2
| n => -n

// Macro
match(x)
  .case(n).if(n > 0).then(n * 2)
  .case(n).then(-n)
```

**Compilation:** `const n = __m; if (n > 0) return n * 2; return -n;`

### 3. Wildcard (`_`)

```typescript
match(x)
| _ => "anything"

match(x)
  .case(_).then("anything")
  // or
  .else("anything")
```

**Compilation:** No check, direct return. `_` is never bound.

### 4. Array / Tuple Patterns

```typescript
// Preprocessor
match(arr)
| [] => "empty"
| [x] => `singleton: ${x}`
| [a, b] => `pair: ${a + b}`
| [first, _, _] if first > 0 => first
| [head, ...tail] if tail.length > 0 => `${head} + ${tail.length} more`
| _ => "other"

// Macro
match(arr)
  .case([]).then("empty")
  .case([x]).then(`singleton: ${x}`)
  .case([a, b]).then(`pair: ${a + b}`)
  .case([first, _, _]).if(first > 0).then(first)
  .case([head, ...tail]).if(tail.length > 0).then(`${head} + ${tail.length} more`)
  .else("other")
```

**Compilation:**

```typescript
if (Array.isArray(__m) && __m.length === 0) return "empty";
if (Array.isArray(__m) && __m.length === 1) {
  const x = __m[0];
  return `singleton: ${x}`;
}
if (Array.isArray(__m) && __m.length === 2) {
  const [a, b] = __m;
  return `pair: ${a + b}`;
}
if (Array.isArray(__m) && __m.length >= 3) {
  const first = __m[0];
  if (first > 0) return first;
}
if (Array.isArray(__m) && __m.length >= 1) {
  const [head, ...tail] = __m;
  if (tail.length > 0) return `${head} + ${tail.length} more`;
}
```

**Pattern semantics:**

- `[a, b]` — exact length 2
- `[a, b, c]` — exact length 3
- `[a, _, _]` — exact length 3, only `a` bound
- `[head, ...tail]` — length >= 1, rest captured
- `[_, ...rest]` — length >= 1, head discarded
- `[]` — exactly empty

### 5. Object Patterns

```typescript
// Preprocessor
match(obj)
| { a, b } if a > 0 => a + b
| { name: n, age } if age >= 18 => `Adult: ${n}`
| { name } => name
| { ...rest } => Object.keys(rest).length

// Macro
match(obj)
  .case({ a, b }).if(a > 0).then(a + b)
  .case({ name: n, age }).if(age >= 18).then(`Adult: ${n}`)
  .case({ name }).then(name)
  .case({ ...rest }).then(Object.keys(rest).length)
```

**Compilation:**

```typescript
if (typeof __m === "object" && __m !== null && "a" in __m && "b" in __m) {
  const { a, b } = __m;
  if (a > 0) return a + b;
}
```

**Pattern semantics:**

- `{ a, b }` — has properties `a` and `b` (partial match, extra props allowed)
- `{ name: n }` — has `name`, binds to `n`
- `{ kind: "circle" }` — literal property value (no binding)
- `{ kind: "circle", radius: r }` — literal + binding
- `{ ...rest }` — bind all remaining properties

### 6. Discriminated Union Patterns

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number }
  | { kind: "rect"; w: number; h: number }

// Preprocessor
match(shape)
| { kind: "circle", radius: r } => Math.PI * r ** 2
| { kind: "square", side: s } => s ** 2
| { kind: "rect", w, h } => w * h

// Macro
match(shape)
  .case({ kind: "circle", radius: r }).then(Math.PI * r ** 2)
  .case({ kind: "square", side: s }).then(s ** 2)
  .case({ kind: "rect", w, h }).then(w * h)
  // No .else() needed — exhaustive by default, compile error if a variant is missing
```

**Compilation:** Optimized switch on discriminant field (existing `match()` strategy).

### 7. Type Patterns

```typescript
// Preprocessor
match(value)
| s: string => `string: ${s}`
| n: number if n > 0 => `positive: ${n}`
| n: number => `number: ${n}`
| a: Array<unknown> => `array[${a.length}]`
| d: Date => d.toISOString()
| e: TypeError => `type error: ${e.message}`
| _ => "unknown"

// Macro — same syntax as extractors: Constructor(binding)
match(value)
  .case(String(s)).then(`string: ${s}`)
  .case(Number(n)).if(n > 0).then(`positive: ${n}`)
  .case(Number(n)).then(`number: ${n}`)
  .case(Array(a)).then(`array[${a.length}]`)
  .case(Date(d)).then(d.toISOString())
  .case(TypeError(e)).then(`type error: ${e.message}`)
  .else("unknown")
```

**Compilation:**

```typescript
if (typeof __m === "string") {
  const s = __m;
  return `string: ${s}`;
}
if (typeof __m === "number") {
  const n = __m;
  if (n > 0) return `positive: ${n}`;
}
if (typeof __m === "number") {
  const n = __m;
  return `number: ${n}`;
}
if (Array.isArray(__m)) {
  const a = __m;
  return `array[${a.length}]`;
}
if (__m instanceof Date) {
  const d = __m;
  return d.toISOString();
}
if (__m instanceof TypeError) {
  const e = __m;
  return `type error: ${e.message}`;
}
```

**Type check strategy:**

Type patterns use the same `Constructor(binding)` syntax as extractor patterns. The macro distinguishes built-in type constructors (mapped to `typeof`/`Array.isArray`) from user-defined ones (`instanceof` or Destructure typeclass).

| Pattern                         | Runtime Check                             |
| ------------------------------- | ----------------------------------------- |
| `String(s)`                     | `typeof __m === "string"`                 |
| `Number(n)`                     | `typeof __m === "number"`                 |
| `Boolean(b)`                    | `typeof __m === "boolean"`                |
| `BigInt(n)`                     | `typeof __m === "bigint"`                 |
| `Symbol(s)`                     | `typeof __m === "symbol"`                 |
| `Function(f)`                   | `typeof __m === "function"`               |
| `Object(o)`                     | `typeof __m === "object" && __m !== null` |
| `null`                          | `__m === null`                            |
| `undefined`                     | `__m === undefined`                       |
| `Array(a)`                      | `Array.isArray(__m)`                      |
| `Date(d)`, `RegExp(r)`, etc.    | `__m instanceof Ctor`                     |
| User classes: `MyClass(v)`      | `__m instanceof Ctor`                     |
| Destructure instance: `Some(v)` | `Destructure.extract(__m)`                |

### 8. Regex Patterns

```typescript
// Preprocessor
match(str)
| /^(\w+)@(\w+)\.(\w+)$/ as [_, user, domain, tld] => { user, domain, tld }
| /^https?:\/\/(.+)$/ as [_, url] => fetch(url)
| /^\d+$/ as [num] => parseInt(num)
| s => s

// Macro
match(str)
  .case(/^(\w+)@(\w+)\.(\w+)$/).as([_, user, domain, tld]).then({ user, domain, tld })
  .case(/^https?:\/\/(.+)$/).as([_, url]).then(fetch(url))
  .case(/^\d+$/).as([num]).then(parseInt(num))
  .case(s).then(s)
```

**Compilation:**

```typescript
{
  const __r = __m.match(/^(\w+)@(\w+)\.(\w+)$/);
  if (__r !== null) {
    const [_, user, domain, tld] = __r;
    return { user, domain, tld };
  }
}
```

### 9. OR Patterns

```typescript
// Preprocessor
match(status)
| 200 | 201 | 204 => "success"
| 400 | 401 | 403 | 404 => "client error"
| 500 | 502 | 503 => "server error"
| code => `status: ${code}`

// Macro — .or() chaining
match(status)
  .case(200).or(201).or(204).then("success")
  .case(400).or(401).or(403).or(404).then("client error")
  .case(500).or(502).or(503).then("server error")
  .case(code).then(`status: ${code}`)
```

**Compilation:** `(__m === 200 || __m === 201 || __m === 204) ? "success" : ...`

**Note:** OR patterns bind no variables (Scala restriction). Each alternative must be a non-binding pattern.

### 10. AS Patterns (Bind Whole While Destructuring)

```typescript
// Preprocessor
match(point)
| p @ [x, y] if x > 0 && y > 0 => { point: p, quadrant: 1 }
| p @ [x, y] => { point: p, quadrant: 0 }

// Macro
match(point)
  .case([x, y]).as(p).if(x > 0 && y > 0).then({ point: p, quadrant: 1 })
  .case([x, y]).as(p).then({ point: p, quadrant: 0 })
```

**Compilation:**

```typescript
if (Array.isArray(__m) && __m.length === 2) {
  const p = __m;
  const [x, y] = __m;
  if (x > 0 && y > 0) return { point: p, quadrant: 1 };
}
```

### 11. Nested Patterns

```typescript
// Preprocessor
match(data)
| { user: { name, scores: [first, ...rest] } } if first > 90 =>
    `${name} aced it with ${first}`
| { user: { name }, active: true } => `Active: ${name}`
| { user: Some({ name }) } => name
| _ => "unknown"

// Macro
match(data)
  .case({ user: { name, scores: [first, ...rest] } }).if(first > 90)
    .then(`${name} aced it with ${first}`)
  .case({ user: { name }, active: true }).then(`Active: ${name}`)
  .case({ user: Some({ name }) }).then(name)
  .else("unknown")
```

**Compilation:** Nested structural checks with early exit. Each nesting level adds an `in` check and destructuring.

### 12. Extractor Patterns (Destructure Typeclass)

```typescript
// Preprocessor
match(option)
| Some(v) if v > 0 => v * 2
| Some(v) => v
| None => 0

match(either)
| Left(err) => `Error: ${err}`
| Right(val) if val > 0 => `Positive: ${val}`
| Right(val) => `Value: ${val}`

// Macro
match(option)
  .case(Some(v)).if(v > 0).then(v * 2)
  .case(Some(v)).then(v)
  .case(None).then(0)

match(either)
  .case(Left(err)).then(`Error: ${err}`)
  .case(Right(val)).if(val > 0).then(`Positive: ${val}`)
  .case(Right(val)).then(`Value: ${val}`)
```

These work via the **Destructure typeclass** (see below).

## Destructure Typeclass

### Design

Scala's `unapply` method on companion objects returns `Option[T]` to attempt extraction. We adopt the same pattern with a more TypeScript-friendly name: `Destructure`.

```typescript
/** @typeclass */
interface Destructure<Pattern, Input, Output> {
  /**
   * Attempt to extract a value from the input.
   * Returns the extracted value on match, or undefined on failure.
   *
   * Analogous to Scala's unapply: Option[T] → T | undefined
   */
  extract(input: Input): Output | undefined;
}
```

We use `T | undefined` instead of `Option<T>` to avoid a circular dependency (Option itself needs Destructure) and to align with TypeScript conventions where `undefined` signals absence.

### Auto-Derivation via Product/Sum

The key insight: **Destructure auto-derives for any type with a Product or Sum generic instance.** This mirrors how Scala case classes automatically get `unapply`.

**Product types** (interfaces, classes, records):

```typescript
interface Point { x: number; y: number }
// Auto-derived:
// Destructure<typeof Point, Point, [number, number]>
// extract(p) → [p.x, p.y]

// Use in patterns:
match(point)
| Point(x, y) if x > 0 => `positive x: ${x}`
```

The derived `extract` for a product returns a tuple of field values in declaration order.

**Sum types** (discriminated unions):

```typescript
type Option<T> = { _tag: "Some"; value: T } | { _tag: "None" };
// Auto-derived for each variant:
// Destructure<typeof Some, Option<T>, T>     — extract(o) → o._tag === "Some" ? o.value : undefined
// Destructure<typeof None, Option<T>, void>  — extract(o) → o._tag === "None" ? undefined as void : undefined
```

The derived `extract` for a sum variant checks the discriminant and returns the variant's payload.

### Derivation Rules

| Type Kind                            | Has Generic?       | Destructure Derived? | Extract Returns       |
| ------------------------------------ | ------------------ | -------------------- | --------------------- |
| Product (interface/class)            | Yes (fields)       | Auto                 | Tuple of field values |
| Sum variant                          | Yes (discriminant) | Auto per variant     | Variant payload       |
| Primitive (`number`, `string`, etc.) | Identity           | Identity             | The value itself      |
| Newtype / branded type               | Via unwrap         | Via unwrap           | Inner value           |
| Class with explicit `extract`        | N/A                | Manual instance      | Custom                |
| Regex pattern                        | Built-in           | Built-in             | `RegExpMatchArray`    |

### Manual Instances

For types without Product/Sum representation, provide manual Destructure instances:

```typescript
/** @impl Destructure<typeof Email, string, { user: string; domain: string }> */
const emailDestructure = {
  extract(input: string): { user: string; domain: string } | undefined {
    const m = input.match(/^([^@]+)@(.+)$/);
    return m ? { user: m[1], domain: m[2] } : undefined;
  }
};

// Now works in patterns:
match(str)
| Email({ user, domain }) => `${user} at ${domain}`
| _ => "not an email"
```

### Variadic Extractors (unapplySeq)

Scala supports `unapplySeq` for variable-length extraction. We support this with rest patterns in the extract output:

```typescript
/** @impl Destructure<typeof CSV, string, string[]> */
const csvDestructure = {
  extract(input: string): string[] | undefined {
    const parts = input.split(",");
    return parts.length > 0 ? parts : undefined;
  }
};

match(line)
| CSV([first, second, ...rest]) => `${first}, ${second}, +${rest.length}`
| _ => "empty"
```

### Boolean Extractors

For patterns that only test membership without extracting data:

```typescript
/** @impl Destructure<typeof Even, number, void> */
const evenDestructure = {
  extract(input: number): void | undefined {
    return input % 2 === 0 ? undefined : undefined; // void = matched, undefined = not
  },
};
```

Wait — `void` vs `undefined` is ambiguous. Instead, use a sentinel:

```typescript
/** @impl Destructure<typeof Even, number, true> */
const evenDestructure = {
  extract(input: number): true | undefined {
    return input % 2 === 0 ? true : undefined;
  }
};

match(n)
| Even => "even"   // No binding needed
| _ => "odd"
```

### Built-in Destructure Instances

The following are provided out of the box:

| Extractor        | Input          | Output             | Check              |
| ---------------- | -------------- | ------------------ | ------------------ |
| `Some(v)`        | `Option<T>`    | `T`                | `_tag === "Some"`  |
| `None`           | `Option<T>`    | `true`             | `_tag === "None"`  |
| `Left(v)`        | `Either<L, R>` | `L`                | `_tag === "Left"`  |
| `Right(v)`       | `Either<L, R>` | `R`                | `_tag === "Right"` |
| `Ok(v)`          | `Result<T, E>` | `T`                | `ok === true`      |
| `Err(e)`         | `Result<T, E>` | `E`                | `ok === false`     |
| `Cons(h, t)`     | `List<T>`      | `[T, List<T>]`     | `_tag === "Cons"`  |
| `Nil`            | `List<T>`      | `true`             | `_tag === "Nil"`   |
| `Regex(pattern)` | `string`       | `RegExpMatchArray` | `.match(pattern)`  |

### Compilation of Extractor Patterns

```typescript
// Input:
match(option)
  .case(Some(v))
  .if(v > 0)
  .then(v * 2)(
  // Compiled:
  () => {
    const __m = option;
    {
      const __e = Destructure_Some.extract(__m);
      if (__e !== undefined) {
        const v = __e;
        if (v > 0) return v * 2;
      }
    }
    // ...
  }
)();
```

For auto-derived instances (Product/Sum), the extractor call is inlined (zero-cost):

```typescript
// Auto-derived Some extractor inlined:
if (__m !== null && typeof __m === "object" && __m._tag === "Some") {
  const v = __m.value;
  if (v > 0) return v * 2;
}
```

## TypeScript Type Coverage

Every TypeScript type should have a sensible pattern matching story:

| TS Type               | Pattern Syntax                 | Structural Check                  |
| --------------------- | ------------------------------ | --------------------------------- |
| `string`              | `s: string` or literal `"foo"` | `typeof === "string"`             |
| `number`              | `n: number` or literal `42`    | `typeof === "number"`             |
| `boolean`             | `b: boolean` or `true`/`false` | `typeof === "boolean"`            |
| `bigint`              | `n: bigint`                    | `typeof === "bigint"`             |
| `symbol`              | `s: symbol`                    | `typeof === "symbol"`             |
| `null`                | `null`                         | `=== null`                        |
| `undefined`           | `undefined`                    | `=== undefined`                   |
| `void`                | `undefined` (same at runtime)  | `=== undefined`                   |
| `object`              | `{ ... }` patterns             | `typeof === "object" && !== null` |
| Array / tuple         | `[a, b, ...]` patterns         | `Array.isArray()` + length        |
| Function              | `f: Function`                  | `typeof === "function"`           |
| Class instance        | `d: Date`                      | `instanceof`                      |
| Discriminated union   | `{ kind: "x", ... }`           | Discriminant check                |
| Tagged union (`_tag`) | `Some(v)` / `Left(e)`          | Destructure typeclass             |
| Enum (string)         | Literal values                 | `===` comparison                  |
| Enum (numeric)        | Literal values                 | `===` comparison                  |
| `unknown`             | Any pattern (type narrows)     | Pattern determines check          |
| `any`                 | Any pattern                    | Pattern determines check          |
| `never`               | No valid pattern               | Compile error if reached          |
| Template literal      | Regex pattern                  | `.match()`                        |
| Intersection `A & B`  | Object pattern with all props  | Combined `in` checks              |
| Union `A \| B`        | OR patterns or separate cases  | Per-variant checks                |
| Mapped types          | Object pattern                 | Property checks                   |
| Conditional types     | Resolved at type level         | Underlying type's check           |
| Branded/newtype       | Destructure instance           | Custom extractor                  |
| `Record<K, V>`        | `{ key: v }` or `{ ...rest }`  | `in` / spread                     |
| `Map<K, V>`           | Destructure instance           | Custom extractor                  |
| `Set<T>`              | Destructure instance           | Custom extractor                  |
| `Promise<T>`          | Not matched (async)            | Await first, then match           |
| `ReadonlyArray<T>`    | Same as `Array<T>`             | `Array.isArray()`                 |
| Tuple `[A, B, C]`     | `[a, b, c]`                    | `Array.isArray() + length`        |
| Named tuple `[x: A]`  | `[x]`                          | Same as positional                |

## Exhaustiveness

Match is **always exhaustive** — like Rust, not like Scala (which warns but compiles). Every `match()` expression must provably handle all possible inputs at compile time. There is no `.exhaustive()` opt-in; it's the default and only mode.

### How It Works

| Pattern Domain                | Exhaustiveness Strategy                                 |
| ----------------------------- | ------------------------------------------------------- |
| Discriminated unions          | All variants covered                                    |
| Literal unions (`"a" \| "b"`) | All values covered                                      |
| Boolean                       | Both `true` and `false`                                 |
| `null \| T`                   | Both `null` and non-null                                |
| Sum types (Destructure)       | All variant extractors present                          |
| `string`, `number`, etc.      | **Not finitely enumerable** — `_` or `.else()` required |
| Arrays                        | **Not finitely enumerable** — `_` or `.else()` required |
| Objects                       | **Open types** — `_` or `.else()` required              |
| Type patterns                 | **Open** — `_` or `.else()` required                    |
| `unknown` / `any`             | `_` or `.else()` required                               |

### Compile-Time Errors

```typescript
type Color = "red" | "green" | "blue";

// ERROR: Non-exhaustive match — missing case "blue"
match(color).case("red").then(0xff0000).case("green").then(0x00ff00);

// OK: all cases covered
match(color).case("red").then(0xff0000).case("green").then(0x00ff00).case("blue").then(0x0000ff);

// OK: wildcard covers remaining cases
match(color).case("red").then(0xff0000).case(_).then(0x000000);
```

### `.else()` as Catch-All

`.else(value)` is syntactic sugar for a final `_ => value` case. It satisfies exhaustiveness for any type:

```typescript
// Only handle 3 of 20 variants, explicit about the rest
match(bigUnion)
  .case({ kind: "a" })
  .then(handleA())
  .case({ kind: "b" })
  .then(handleB())
  .case({ kind: "c" })
  .then(handleC())
  .else(undefined); // Explicitly: everything else is undefined
```

### Runtime Safety Net

Even with compile-time exhaustiveness, the generated code includes a terminal throw as a safety net (e.g. if the type is widened at runtime via `any` or external data):

```typescript
// Generated code always ends with:
throw new MatchError(__m); // "Non-exhaustive match: <value>"
```

This mirrors Scala's `scala.MatchError`.

## Pattern Grammar

```
MatchExpr     ::= "match" "(" Expr ")" (BlockCases | FluentCases)

// Preprocessor syntax
BlockCases    ::= ("|" Case)+
Case          ::= Pattern Guard? "=>" Expr

// Macro syntax
FluentCases   ::= ("." "case" "(" Pattern ")" AsClause? Guard? "." "then" "(" Expr ")")+
                   ("." "else" "(" Expr ")")?
AsClause      ::= "." "as" "(" Identifier | ArrayPat ")"
Guard         ::= "." "if" "(" Expr ")"

// Shared patterns
Pattern       ::= LiteralPat | WildcardPat | VarPat | ArrayPat | ObjectPat
               | ExtractorPat | RegexPat | OrPat | AsPat | TypePat

LiteralPat    ::= Number | String | "true" | "false" | "null" | "undefined"
WildcardPat   ::= "_"
VarPat        ::= Identifier
ArrayPat      ::= "[" (Pattern ("," Pattern)* ("," "..." Identifier)?)? "]"
ObjectPat     ::= "{" PropPat ("," PropPat)* ("," "..." Identifier)? "}"
PropPat       ::= Identifier                    // shorthand: { name }
               | Identifier ":" Pattern          // rename: { name: n }
               | Identifier ":" LiteralPat       // literal match: { kind: "circle" }
ExtractorPat  ::= Identifier "(" Pattern* ")"   // Some(v), Point(x, y)
               | Identifier                      // None (zero-arg extractor)
TypePat       ::= Identifier ":" TypeName        // preprocessor only
RegexPat      ::= RegexLiteral ("as" ArrayPat)?
OrPat         ::= Pattern ("|" Pattern)+
AsPat         ::= Identifier "@" Pattern         // preprocessor: p @ [x, y]
```

## Compilation Strategy

### Overall Structure

```typescript
// Input:
const y = match(expr)
  .case(P1).if(G1).then(R1)
  .case(P2).then(R2)
  .else(D)

// Output:
const y = (() => {
  const __m = expr;         // Evaluate scrutinee once
  /* case 1 */ { const bindings...; if (structural_check && guard) return result; }
  /* case 2 */ { const bindings...; if (structural_check) return result; }
  /* default */ return D;           // from .else(D)
  // or if no .else():
  throw new MatchError(__m);        // always-exhaustive safety net
})();
```

### Optimization Strategies

**Dead arm elimination (type-driven):**

Before generating any runtime code, the macro uses `ctx.getTypeOf()` and `ctx.isAssignableTo()` to prune impossible arms:

| Scrutinee Type                  | Effect                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| Single literal (`"ok"`)         | Only the matching arm is emitted — zero branching                 |
| Narrow union (`"ok" \| "fail"`) | Impossible arms removed; last remaining arm emits unconditionally |
| After each arm                  | Remaining type narrows (successive elimination)                   |
| Incompatible pattern            | Compile error: "pattern can never match"                          |

```typescript
// Input:
const x: "ok" = getStatus();
match(x).case("ok").then(200).else(500);

// Output (dead arm eliminated):
200;
```

```typescript
// Input:
const x: "ok" | "fail" = getStatus();
match(x).case("ok").then(200).case("fail").then(500);

// Output (last arm unconditional — type fully narrowed after "ok"):
x === "ok" ? 200 : 500;
```

**Runtime code generation (surviving arms):**

| Pattern Kind            | Arms ≤ 6            | Arms > 6               |
| ----------------------- | ------------------- | ---------------------- |
| All literal (same type) | Ternary chain       | Switch statement       |
| All discriminant        | Ternary chain       | Switch statement       |
| Sparse integers         | Ternary chain       | Binary search tree     |
| Dense integers          | Ternary chain       | Switch (V8 jump table) |
| Mixed structural        | Sequential checks   | Sequential checks      |
| Single extractor        | Inline extract call | Inline extract call    |

### Decision Tree Optimization (Future)

For complex nested patterns, compile to a decision tree that avoids redundant checks:

```typescript
// Two patterns both check __m.kind first:
// case { kind: "circle", radius: r } => ...
// case { kind: "square", side: s } => ...

// Naive: check kind twice
// Optimized: single switch on kind, then extract fields per branch
```

## Waves

### Wave 1: Fluent API + Primitive Patterns (~8 files)

Core macro infrastructure: parse `.case().if().then()` chains, extract pattern variables, generate IIFE output.

**Tasks:**

- [x] Define `Destructure` typeclass interface in `packages/std/src/typeclasses/destructure.ts`
- [x] Create `packages/std/src/macros/match-v2.ts` — new fluent match macro
  - Parse `.case().if().then().else()` chains from AST
  - Extract pattern variables: walk `.case()` argument, collect `Identifier` nodes not in outer scope
  - Track variable flow from `.case()` through `.if()` and `.then()`
  - Generate IIFE with proper scoping
- [x] Implement literal patterns: number, string, boolean, null, undefined
- [x] Implement wildcard pattern: `_`
- [x] Implement variable binding pattern: bare identifier
- [x] Implement `.else()` catch-all and `MatchError` throw when no `.else()` present
- [x] Register macro in `packages/std/src/macros/index.ts`
- [x] Tests: all primitive patterns, guards, variable binding, error cases
- [x] Verify: undefined identifiers parse cleanly, macro transforms before type check

**Implementation Notes (Wave 1):**

- Added `chainable: boolean` to `ExpressionMacro` interface (`packages/core/src/types.ts`) — allows macros to intercept full fluent chains before bottom-up expansion
- Added `tryExpandChainMacro`, `findChainRoot`, `isOutermostChainCall` to transformer (`packages/transformer/src/index.ts`) — detects chains rooted in a chainable macro and passes the outermost `CallExpression` to the macro's expand function
- Ternary optimization: single literal + else compiles to `scrutinee === literal ? result : elseResult` (no IIFE)
- IIFE output uses hygiene-safe name `__typesugar_m_N__` via `ctx.generateUniqueName`
- 21 unit tests covering all primitive patterns, guards, variable binding, `.else()`/`MatchError`, ternary optimization, scrutinee evaluation, and all gate criteria

**Gate:**

- [x] `match(x).case(42).then("yes").else("no")` compiles to correct ternary
- [x] `match(x).case(n).if(n > 0).then(n).else(0)` binds `n` correctly
- [x] `match(x).case(_).then("any")` generates no check
- [x] Variables in `.if()` and `.then()` resolve to `.case()` bindings
- [x] `pnpm test` passes

### Wave 2: Array + Object Patterns (~4 files)

**Depends on:** Wave 1

**Tasks:**

- [x] Array patterns: `[a, b]`, `[a, _, _]`, `[head, ...tail]`, `[]`
  - Detect `ArrayLiteralExpression` in `.case()` argument
  - Generate `Array.isArray()` + length check + destructuring
  - Handle `_` as non-binding position
  - Handle `SpreadElement` for rest patterns
- [x] Object patterns: `{ a, b }`, `{ name: n }`, `{ kind: "circle", radius: r }`
  - Detect `ObjectLiteralExpression` in `.case()` argument
  - `ShorthandPropertyAssignment` → binding (check `in` + destructure)
  - `PropertyAssignment` with identifier value → renamed binding
  - `PropertyAssignment` with literal value → structural check (no binding)
  - Handle `SpreadAssignment` for rest patterns
- [x] Nested patterns: `{ user: { name, age } }`, `[{ x }, { y }]`
  - Recursive pattern extraction at arbitrary depth
- [x] Tests: all array/object shapes, nesting, rest patterns, mixed literal+binding

**Gate:**

- [x] `match(arr).case([first, _, _]).if(first > 0).then(first)` works
- [x] `match(obj).case({ name, age }).if(age > 18).then(name)` works
- [x] `match(data).case({ user: { name } }).then(name)` works with nesting
- [x] `match(arr).case([head, ...tail]).then(tail.length)` works with rest

### Wave 3: Type Patterns + OR Patterns + AS Patterns (~4 files)

**Depends on:** Wave 2

**Tasks:**

- [x] Type patterns via `Constructor(binding)`: `.case(String(s)).then(s.length)`
  - Detect `CallExpression` where callee is a known type constructor
  - Map constructor names to runtime checks (typeof / instanceof / Array.isArray)
  - Known constructors: `String`, `Number`, `Boolean`, `BigInt`, `Symbol`, `Array`, `Function`, `Object`
  - All other constructors: `instanceof` check
  - Narrow the binding type in `.if()` and `.then()`
  - This uses the same AST shape as extractor patterns (Wave 4), just with built-in dispatch
- [x] OR patterns via `.or()`: `.case(200).or(201).or(204).then("ok")`
  - Collect alternatives into `||` chain
  - Verify no variable bindings in OR alternatives
- [x] AS patterns via `.as()`: `.case([x, y]).as(p).then(p)`
  - Bind whole matched value to alias alongside destructured bindings
- [x] Regex patterns: `.case(/regex/).as([_, g1, g2]).then(...)`
  - Detect `RegularExpressionLiteral` in `.case()` argument
  - Generate `.match()` call, bind capture groups via `.as()` array pattern
- [x] Tests: all type patterns, OR combinations, AS with arrays/objects, regex captures

**Gate:**

- [x] `.case(String(s)).then(s.length)` generates `typeof === "string"`
- [x] `.case(Date(d)).then(d.toISOString())` generates `instanceof Date`
- [x] `.case(Array(a)).then(a.length)` generates `Array.isArray()`
- [x] `.case(200).or(201).or(204).then("ok")` generates OR chain
- [x] `.case([x, y]).as(p).then(p)` binds both `p` and `x`, `y`
- [x] `.case(/^(\w+)@(\w+)$/).as([_, user, domain]).then(...)` extracts captures

### Wave 4: Destructure Typeclass + Extractor Patterns (~8 files)

**Depends on:** Wave 3, existing Generic/Product/Sum infrastructure

**Tasks:**

- [x] Implement Destructure typeclass in `packages/std/src/typeclasses/destructure.ts`:
  - Type definition with `extract(input: Input): Output | undefined`
  - JSDoc `@typeclass` annotation for typeclass machinery
  - Register in typeclass registry with `canDeriveProduct: true`, `canDeriveSum: true`
- [x] Auto-derivation for Product types in `packages/macros/src/typeclass.ts`:
  - `deriveProduct`: generate `extract(input) → [field1, field2, ...] | undefined`
  - Structural check: verify all required fields exist
  - Return tuple of field values in declaration order
  - Implemented via `registerProductExtractor()` in match macro — inlines structural checks at compile time
- [x] Auto-derivation for Sum types:
  - `deriveSum`: generate one Destructure instance per variant
  - Each variant's `extract` checks the discriminant and returns the variant payload
  - Built-in sum variants (Option, Either, Result, List) hardcoded with zero-cost inline checks
- [x] Built-in Destructure instances:
  - `Option<T>`: `Some(v)` → `v`, `None` → `true`
  - `Either<L, R>`: `Left(l)` → `l`, `Right(r)` → `r`
  - `List<T>`: `Cons(h, t)` → `[h, t]`, `Nil` → `true`
  - Also: `Result<T, E>`: `Ok(v)` → `v`, `Err(e)` → `e`
- [x] Extractor pattern compilation in match macro:
  - Detect `CallExpression` in `.case()` argument: `Some(v)`, `Point(x, y)`
  - Resolve Destructure instance for the extractor name
  - Generate `extract()` call + null check + binding
  - For auto-derived instances: inline the structural check (zero-cost)
- [x] Zero-arg extractors: `None`, `Nil` — detect bare identifier with registered Destructure
- [x] Tests: Some/None, Left/Right, custom extractors, auto-derived Product/Sum

**Gate:**

- [x] `match(opt).case(Some(v)).then(v)` works with Option
- [x] `match(either).case(Left(err)).then(err)` works with Either
- [x] `match(point).case(Point(x, y)).then(x + y)` works with auto-derived Product
- [x] Custom Destructure instance works: `Email({ user, domain })`
- [x] Inlined extraction for auto-derived types: no runtime Destructure call

### Wave 5: Exhaustiveness Analysis + Optimization (~4 files)

**Depends on:** Wave 4

Match is always exhaustive — this wave implements the compile-time verification.

**Tasks:**

- [x] Exhaustiveness analysis (always on, no opt-in):
  - For discriminated unions: verify all variants covered, report missing cases
  - For Sum types: verify all variant extractors present
  - For literal unions: verify all values covered
  - For boolean: verify true and false
  - For non-enumerable types (string, number, arrays, objects, unknown): require `_` or `.else()`
  - Report clear error: "Non-exhaustive match — missing cases: blue, green"
- [x] `MatchError` runtime class in `@typesugar/std`
  - Extends `Error` with `.value` property (the unmatched value)
  - Generated as terminal throw in every match without `.else()`
- [x] Dead arm elimination via type narrowing:
  - Get scrutinee type via `ctx.getTypeOf(scrutinee)`
  - For each `.case(pattern)`, compute the pattern's type domain
  - If the pattern's domain has zero overlap with the scrutinee type → compile error:
    "Pattern `"pending"` can never match type `"ok" | "fail"`"
  - If the scrutinee is a single literal type (e.g. `const x: "ok" = "ok"`), all
    non-matching arms are provably dead → emit only the matching arm's result expression
    directly, with no IIFE, no checks, no branching
  - For union scrutinees, narrow remaining type after each arm (successive elimination):
    after matching `"ok"`, remaining type is `"fail"` — if next arm covers `"fail"`,
    it can be emitted as an unconditional return (no check needed)
  - Uses same infrastructure as exhaustiveness (inverse of the same analysis)
- [x] Optimization: switch/binary-search for large literal arms (reuse existing strategies)
- [ ] Optimization: merge redundant structural checks for same-shape patterns (deferred to Wave 6)
- [x] Optimization: scrutinee evaluated exactly once (IIFE parameter)
- [x] Warning: unreachable patterns (dominated by earlier pattern)
- [ ] Warning: redundant guards (guard always true) (deferred — requires comptime eval of guards)
- [x] Tests: exhaustiveness, dead arm elimination, optimization output shapes, warnings

**Gate:**

- [x] Missing discriminated union variant produces compile error with named missing cases
- [x] Adding `_` or `.else()` satisfies exhaustiveness for any type
- [x] Match on `string` without `_` or `.else()` produces compile error
- [x] Pattern incompatible with scrutinee type produces compile error
- [x] `match(x)` where `x: "ok"` with `.case("ok").then(1).else(2)` compiles to just `1`
- [x] Match on `"ok" | "fail"` with two arms: second arm emits no runtime check (type fully narrowed)
- [x] 7+ literal arms compile to switch statement
- [x] Unreachable pattern warning fires
- [x] Runtime `MatchError` thrown with descriptive message

**Implementation notes:**

- Type analysis uses `ctx.getTypeOf()` and `ctx.typeChecker` for type-driven features
- Gracefully degrades when type info is unavailable (e.g., `any`/`unknown` types)
- `analyzeScrutineeType()` classifies types as literal-union, boolean, discriminated-union, or non-enumerable
- `findDiscriminant()` detects common literal-typed properties across union members
- Switch optimization threshold: 7+ pure literal arms (no guards, no OR, no AS)
- `MatchError` class in `packages/std/src/data/match-error.ts` with `.value` property
- 39 unit tests in `tests/match-v2-exhaustive.test.ts`
- Two items deferred: redundant structural check merging and redundant guard detection (require deeper analysis)

### Wave 6: Preprocessor Syntax (~6 files)

**Depends on:** Wave 5

**Tasks:**

- [x] Add `match ... | pattern => expr` to preprocessor scanner in `packages/preprocessor/src/scanner.ts`
  - Detect `match(expr)` followed by `|`
  - Parse each `| pattern guard? => expr` clause
  - Handle multi-line expressions (brace blocks, parenthesized expressions)
  - Handle `=>` disambiguation (pattern result vs arrow function)
- [x] Transform preprocessor syntax to fluent macro syntax:
  - `| [first, _, _] if first > 0 => first` → `.case([first, _, _]).if(first > 0).then(first)`
  - `| s: string => s.length` → `.case(String(s)).then(s.length)`
  - `| p @ [x, y] => p` → `.case([x, y]).as(p).then(p)`
  - `| 200 | 201 => "ok"` → `.case(200).or(201).then("ok")`
- [x] Source map generation for preprocessor transforms
- [x] Tests: all pattern types through preprocessor, source map accuracy

**Gate:**

- [x] `match(x) | [a, b] => a + b | _ => 0` compiles correctly in `.sts` files
- [x] Source maps point to original pattern positions
- [x] All pattern types from Waves 1-5 work through preprocessor syntax

### Wave 7: Documentation + Migration (~10 files)

**Depends on:** Wave 6

**Tasks:**

- [x] Create `docs/guides/pattern-matching.md` — comprehensive guide with examples
- [x] Update `docs/reference/packages.md` — new exports from `@typesugar/std`
- [x] Update `packages/std/README.md` — pattern matching section
- [x] Update `AGENTS.md` — pattern matching conventions
- [x] Add pattern matching examples to `sandbox/error-showcase.ts`
- [x] Migration guide: old `match()` → new fluent `match()`
  - Old object-handler form still works (backwards compatible)
  - New fluent form adds structural patterns
- [x] Deprecation notices on old `when()`, `otherwise()`, `P.*` helpers
  - Keep working for backwards compat
  - Suggest new fluent syntax in deprecation message

**Gate:**

- [x] Documentation shows compelling examples for all pattern types
- [x] Existing `match()` usage continues to work
- [x] New patterns documented with before/after comparisons

### Wave 8: Legacy API Removal (~2 files)

Remove deprecated `matchLiteral` and `matchGuard` shims that now delegate to the unified `match()`.

**Tasks:**

- [ ] Search codebase for any usages of `matchLiteral` or `matchGuard`
- [ ] Update any usages to use unified `match()` syntax
- [ ] Remove `matchLiteral()` runtime function (lines 354-363)
- [ ] Remove `matchGuard()` runtime function (lines 366-374)
- [ ] Remove `matchLiteralMacro` definition (lines 1439-1444)
- [ ] Remove `matchGuardMacro` definition (lines 1446-1451)
- [ ] Remove legacy macro registrations from global registry (lines 1453-1455)
- [ ] Remove exports from `packages/std/src/macros/index.ts` and `packages/std/src/index.ts`
- [ ] Remove legacy tests from `tests/match.test.ts`
- [ ] Update `packages/fp/README.md` to remove legacy references

**Gate:**

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] No references to `matchLiteral` or `matchGuard` remain
- [ ] Unified `match()` API continues to work for all existing use cases

### Wave 9: Internal Dogfooding (~15 files)

Adopt `match()` throughout typesugar's own codebase to validate the API and demonstrate best practices.

**Note:** Build infrastructure packages (`transformer`, `macros`, `parser`, `preprocessor`) cannot use `match()` due to bootstrapping — they must compile before any macro expansion can happen.

**High-Value Targets (expression tree traversal):**

- [ ] `packages/symbolic/src/eval.ts` — `switch (expr.kind)` over 11 variants
- [ ] `packages/symbolic/src/simplify/simplify.ts` — recursive simplification rules
- [ ] `packages/symbolic/src/pattern.ts` — pattern matching on patterns (meta!)
- [ ] `packages/symbolic/src/render/latex.ts` — LaTeX rendering dispatch
- [ ] `packages/symbolic/src/render/text.ts` — text rendering dispatch
- [ ] `packages/symbolic/src/render/mathml.ts` — MathML rendering dispatch
- [ ] `packages/symbolic/src/calculus/diff.ts` — differentiation rules
- [ ] `packages/symbolic/src/calculus/integrate.ts` — integration rules
- [ ] `packages/symbolic/src/solve.ts` — equation solving logic
- [ ] `packages/symbolic/src/expression.ts` — tree traversal utilities

**Interpreter Patterns:**

- [ ] `packages/fp/src/io/io.ts` — `switch (current._tag)` over IO operations
- [ ] `packages/sql/src/connection-io.ts` — `switch (op._tag)` over SQL operations
- [ ] `packages/fusion/src/lazy.ts` — `switch (step.type)` over iterator steps

**Conversion Pattern:**

```typescript
// Before
switch (expr.kind) {
  case "constant": return expr.value;
  case "variable": return evalVariable(expr.name, bindings, opts);
  case "binary": return evalBinary(expr.op, ...);
}

// After
match(expr, {
  constant: ({ value }) => value,
  variable: ({ name }) => evalVariable(name, bindings, opts),
  binary: ({ op, left, right }) => evalBinary(op, ...),
});
```

**Gate:**

- [ ] All symbolic package switches converted (~10 files)
- [ ] Interpreter patterns converted (io.ts, connection-io.ts, lazy.ts)
- [ ] All converted code passes `pnpm build` and `pnpm test`
- [ ] No regressions in affected modules

## Files Changed (All Waves)

### Code (~35 files modified, ~4 new)

| File                                          | Wave   | Change                                       |
| --------------------------------------------- | ------ | -------------------------------------------- |
| `packages/std/src/typeclasses/destructure.ts` | 1, 4   | **New** — Destructure typeclass definition   |
| `packages/std/src/macros/match-v2.ts`         | 1–5    | **New** — Fluent match macro (core engine)   |
| `packages/std/src/macros/match.ts`            | 7, 8   | Add deprecation notices; remove legacy shims |
| `packages/std/src/macros/index.ts`            | 8      | Remove legacy exports                        |
| `packages/std/src/index.ts`                   | 1, 8   | Export new match; remove legacy exports      |
| `packages/macros/src/typeclass.ts`            | 4      | Add Destructure derivation rules             |
| `packages/macros/src/generic.ts`              | 4      | Destructure via Product/Sum                  |
| `packages/preprocessor/src/scanner.ts`        | 6      | Add `match \| pattern =>` syntax             |
| `packages/transformer/src/index.ts`           | 1      | Register new macro                           |
| `packages/symbolic/src/eval.ts`               | 9      | Convert switch to match                      |
| `packages/symbolic/src/simplify/simplify.ts`  | 9      | Convert switch to match                      |
| `packages/symbolic/src/pattern.ts`            | 9      | Convert switch to match                      |
| `packages/symbolic/src/render/*.ts`           | 9      | Convert switch to match                      |
| `packages/symbolic/src/calculus/*.ts`         | 9      | Convert switch to match                      |
| `packages/symbolic/src/solve.ts`              | 9      | Convert switch to match                      |
| `packages/symbolic/src/expression.ts`         | 9      | Convert switch to match                      |
| `packages/fp/src/io/io.ts`                    | 9      | Convert switch to match                      |
| `packages/sql/src/connection-io.ts`           | 9      | Convert switch to match                      |
| `packages/fusion/src/lazy.ts`                 | 9      | Convert switch to match                      |
| `packages/fp/README.md`                       | 8      | Remove legacy references                     |

### Tests (~4 new files, ~1 modified)

| File                                  | Wave | Coverage                                     |
| ------------------------------------- | ---- | -------------------------------------------- |
| `tests/match-v2.test.ts`              | 1–5  | **New** — All fluent match patterns          |
| `tests/match-v2-destructure.test.ts`  | 4    | **New** — Destructure typeclass + extractors |
| `tests/match-v2-preprocessor.test.ts` | 6    | **New** — Preprocessor syntax                |
| `tests/match-v2-exhaustive.test.ts`   | 5    | **New** — Always-exhaustive verification     |
| `tests/match.test.ts`                 | 8    | Remove legacy `matchLiteral`/`matchGuard` tests |

### Documentation (~8 files)

| File                              | Wave | Change                        |
| --------------------------------- | ---- | ----------------------------- |
| `docs/guides/pattern-matching.md` | 7    | **New** — Comprehensive guide |
| `docs/reference/packages.md`      | 7    | Update std exports            |
| `packages/std/README.md`          | 7    | Pattern matching section      |
| `AGENTS.md`                       | 7    | Pattern matching conventions  |
| `sandbox/error-showcase.ts`       | 7    | Pattern matching examples     |

## Consequences

### Benefits

1. **Scala-level expressiveness** — structural, type, and extractor patterns with guards
2. **Two syntax tiers** — preprocessor for maximum ergonomics, macro for broad compatibility
3. **Zero runtime cost** — all patterns compile to optimized JS checks; impossible arms eliminated at compile time via type narrowing
4. **Always exhaustive** — compile-time safety for all types, no opt-in needed (Rust-style)
5. **Extensible via Destructure** — user-defined extractors for any type
6. **Auto-derivation** — Product and Sum types get Destructure for free
7. **Backwards compatible** — existing `match()` with object handlers still works
8. **No special syntax required** — macro version is valid TypeScript (modulo type errors on pattern vars, which the macro resolves)

### Trade-offs

1. **IDE red squiggles** — Pattern variables show "Cannot find name" in IDE until language service plugin suppresses them. Build tools are unaffected.
2. **Two syntaxes to learn** — Preprocessor `|` syntax and fluent `.case().then()`. Users choose one.
3. **Pattern variable scoping is implicit** — Variables appear in `.if()` and `.then()` without declaration. May confuse developers unfamiliar with pattern matching.
4. **Nested pattern complexity** — Deep nesting (3+ levels) generates complex structural checks. Decision tree optimization deferred.
5. **No async patterns** — Match is synchronous. Await before matching.

### Risk Assessment

| Risk                                               | Likelihood | Impact | Mitigation                                                              |
| -------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------- |
| Pattern vars cause IDE confusion                   | Medium     | Low    | Language service suppresses diagnostics for recognized `match().case()` |
| Preprocessor `=>` conflicts with arrow functions   | Medium     | Medium | Context-sensitive: `=>` only after pattern+guard, not after `(params)`  |
| Exhaustiveness too strict                          | Medium     | Low    | `.else(undefined)` is always available as explicit opt-out              |
| Performance of deep nested patterns                | Low        | Low    | Sequential checks are fast; decision trees deferred                     |
| Destructure derivation incorrect for complex types | Low        | Medium | Product/Sum infrastructure already tested; add targeted tests           |

### Future Work

- Decision tree optimization for complex nested patterns
- Async pattern matching (`matchAsync`)
- View patterns (transform before matching, like Haskell)
- Active patterns (F#-style partial active patterns)
- Pattern matching in `let` bindings: `const [Some(x), y] = [opt, 42]`
- Integration with `let:`/`yield:` do-notation
- LSP completion for pattern variables and extractor names
