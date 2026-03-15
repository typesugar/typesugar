# Pattern Matching

Scala-style pattern matching for TypeScript — structural patterns, extractors, exhaustiveness, and zero-cost compilation.

```typescript
import { match } from "@typesugar/std";

const area = match(shape)
  .case({ kind: "circle", radius: r })
  .then(Math.PI * r ** 2)
  .case({ kind: "square", side: s })
  .then(s ** 2)
  .case({ kind: "rect", w, h })
  .then(w * h);
// Compile error if you miss a variant. Zero runtime overhead.
```

## Two Syntaxes

typesugar offers two ways to write pattern matches. Pick whichever fits your project.

### Fluent API (`.ts` files)

Works in any TypeScript file — no preprocessor needed. Uses `.case().if().then()` chains:

```typescript
const y = match(x)
  .case([first, _, _])
  .if(first > 0)
  .then(first)
  .case([_, second, _])
  .then(second)
  .else(0);
```

### Preprocessor Syntax (`.sts` files)

Scala-like syntax with `|` separators — needs the preprocessor (automatic for `.sts` files):

```typescript
const y = match(x)
| [first, _, _] if first > 0 => first
| [_, second, _] => second
| _ => 0
```

Both compile to identical optimized output. The preprocessor syntax rewrites to the fluent API before the macro runs.

**When to use which:**

| Syntax       | File extension | Best for                                        |
| ------------ | -------------- | ----------------------------------------------- |
| Fluent API   | `.ts`          | Broad compatibility, no build config changes    |
| Preprocessor | `.sts`         | Maximum readability, Scala/Rust-like experience |

---

## Pattern Catalogue

### Literals

Match exact values — numbers, strings, booleans, `null`, `undefined`:

```typescript
// Fluent
match(x)
  .case(42).then("the answer")
  .case("hello").then("greeting")
  .case(true).then("yes")
  .case(null).then("nothing")
  .else("other")

// Preprocessor
match(x)
| 42 => "the answer"
| "hello" => "greeting"
| true => "yes"
| null => "nothing"
| _ => "other"
```

**Compiles to:** direct `===` comparisons. 7+ literal arms get a `switch` statement for V8 optimization.

### Variable Binding

Bind the matched value to a name, optionally with a guard:

```typescript
// Fluent
match(x)
  .case(n).if(n > 0).then(n * 2)
  .case(n).then(-n)

// Preprocessor
match(x)
| n if n > 0 => n * 2
| n => -n
```

Pattern variables don't need pre-declaration — the macro creates properly scoped bindings.

**Compiles to:**

```typescript
const __m = x;
const n = __m;
if (n > 0) return n * 2;
return -n;
```

### Wildcard (`_`)

Match anything without binding:

```typescript
match(x)
  .case(_)
  .then("anything")
  // or, more commonly:
  .else("anything");
```

`_` is never bound. `.else(value)` is syntactic sugar for a final `_ => value` case.

### Array / Tuple Patterns

Destructure arrays by position, with optional rest:

```typescript
// Fluent
match(arr)
  .case([]).then("empty")
  .case([x]).then(`singleton: ${x}`)
  .case([a, b]).then(`pair: ${a + b}`)
  .case([first, _, _]).if(first > 0).then(first)
  .case([head, ...tail]).if(tail.length > 0).then(`${head} + ${tail.length} more`)
  .else("other")

// Preprocessor
match(arr)
| [] => "empty"
| [x] => `singleton: ${x}`
| [a, b] => `pair: ${a + b}`
| [first, _, _] if first > 0 => first
| [head, ...tail] if tail.length > 0 => `${head} + ${tail.length} more`
| _ => "other"
```

**Pattern semantics:**

| Pattern           | Matches                          |
| ----------------- | -------------------------------- |
| `[]`              | Exactly empty                    |
| `[a, b]`          | Exactly length 2                 |
| `[a, _, _]`       | Exactly length 3, only `a` bound |
| `[head, ...tail]` | Length >= 1, rest captured       |

**Compiles to:**

```typescript
if (Array.isArray(__m) && __m.length === 0) return "empty";
if (Array.isArray(__m) && __m.length === 1) {
  const x = __m[0];
  return `singleton: ${x}`;
}
// ... etc
```

### Object Patterns

Match on property presence and values:

```typescript
// Fluent
match(obj)
  .case({ a, b }).if(a > 0).then(a + b)
  .case({ name: n, age }).if(age >= 18).then(`Adult: ${n}`)
  .case({ name }).then(name)
  .case({ ...rest }).then(Object.keys(rest).length)

// Preprocessor
match(obj)
| { a, b } if a > 0 => a + b
| { name: n, age } if age >= 18 => `Adult: ${n}`
| { name } => name
| { ...rest } => Object.keys(rest).length
```

**Pattern semantics:**

| Pattern                 | Meaning                            |
| ----------------------- | ---------------------------------- |
| `{ a, b }`              | Has props `a` and `b` (open match) |
| `{ name: n }`           | Has `name`, binds to `n`           |
| `{ kind: "circle" }`    | Literal property check (no bind)   |
| `{ kind: "circle", r }` | Literal check + binding            |
| `{ ...rest }`           | Bind all remaining properties      |

### Discriminated Union Patterns

The most common pattern — match on a discriminant field:

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number }
  | { kind: "rect"; w: number; h: number };

// Fluent — exhaustive by default, compile error if a variant is missing
match(shape)
  .case({ kind: "circle", radius: r }).then(Math.PI * r ** 2)
  .case({ kind: "square", side: s }).then(s ** 2)
  .case({ kind: "rect", w, h }).then(w * h)

// Preprocessor
match(shape)
| { kind: "circle", radius: r } => Math.PI * r ** 2
| { kind: "square", side: s } => s ** 2
| { kind: "rect", w, h } => w * h
```

**Compiles to:** optimized switch on the discriminant field. No IIFE for small unions.

### Type Patterns

Match on runtime type using constructor syntax:

```typescript
// Fluent
match(value)
  .case(String(s)).then(`string: ${s}`)
  .case(Number(n)).if(n > 0).then(`positive: ${n}`)
  .case(Number(n)).then(`number: ${n}`)
  .case(Array(a)).then(`array[${a.length}]`)
  .case(Date(d)).then(d.toISOString())
  .case(TypeError(e)).then(`type error: ${e.message}`)
  .else("unknown")

// Preprocessor
match(value)
| s: string => `string: ${s}`
| n: number if n > 0 => `positive: ${n}`
| n: number => `number: ${n}`
| a: Array<unknown> => `array[${a.length}]`
| d: Date => d.toISOString()
| e: TypeError => `type error: ${e.message}`
| _ => "unknown"
```

**Type check mapping:**

| Pattern      | Runtime Check                     |
| ------------ | --------------------------------- |
| `String(s)`  | `typeof __m === "string"`         |
| `Number(n)`  | `typeof __m === "number"`         |
| `Boolean(b)` | `typeof __m === "boolean"`        |
| `Array(a)`   | `Array.isArray(__m)`              |
| `Date(d)`    | `__m instanceof Date`             |
| `MyClass(v)` | `__m instanceof MyClass`          |
| `Some(v)`    | Destructure typeclass (see below) |

### OR Patterns

Match multiple alternatives with the same handler:

```typescript
// Fluent — .or() chaining
match(status)
  .case(200).or(201).or(204).then("success")
  .case(400).or(401).or(403).or(404).then("client error")
  .case(500).or(502).or(503).then("server error")
  .case(code).then(`status: ${code}`)

// Preprocessor — pipe separator
match(status)
| 200 | 201 | 204 => "success"
| 400 | 401 | 403 | 404 => "client error"
| 500 | 502 | 503 => "server error"
| code => `status: ${code}`
```

OR patterns bind no variables (same restriction as Scala).

**Compiles to:** `(__m === 200 || __m === 201 || __m === 204) ? "success" : ...`

### AS Patterns (Bind Whole While Destructuring)

Bind the whole matched value to an alias alongside destructured bindings:

```typescript
// Fluent
match(point)
  .case([x, y]).as(p).if(x > 0 && y > 0).then({ point: p, quadrant: 1 })
  .case([x, y]).as(p).then({ point: p, quadrant: 0 })

// Preprocessor
match(point)
| p @ [x, y] if x > 0 && y > 0 => { point: p, quadrant: 1 }
| p @ [x, y] => { point: p, quadrant: 0 }
```

### Regex Patterns

Match strings against regular expressions and destructure capture groups:

```typescript
// Fluent
match(str)
  .case(/^(\w+)@(\w+)\.(\w+)$/).as([_, user, domain, tld]).then({ user, domain, tld })
  .case(/^https?:\/\/(.+)$/).as([_, url]).then(fetch(url))
  .case(/^\d+$/).as([num]).then(parseInt(num))
  .case(s).then(s)

// Preprocessor
match(str)
| /^(\w+)@(\w+)\.(\w+)$/ as [_, user, domain, tld] => { user, domain, tld }
| /^https?:\/\/(.+)$/ as [_, url] => fetch(url)
| /^\d+$/ as [num] => parseInt(num)
| s => s
```

**Compiles to:**

```typescript
{
  const __r = __m.match(/^(\w+)@(\w+)\.(\w+)$/);
  if (__r !== null) {
    const [_, user, domain, tld] = __r;
    return { user, domain, tld };
  }
}
```

### Nested Patterns

Patterns compose at arbitrary depth:

```typescript
// Fluent
match(data)
  .case({ user: { name, scores: [first, ...rest] } }).if(first > 90)
    .then(`${name} aced it with ${first}`)
  .case({ user: { name }, active: true }).then(`Active: ${name}`)
  .else("unknown")

// Preprocessor
match(data)
| { user: { name, scores: [first, ...rest] } } if first > 90 =>
    `${name} aced it with ${first}`
| { user: { name }, active: true } => `Active: ${name}`
| _ => "unknown"
```

### Extractor Patterns (Destructure Typeclass)

Match using custom extractors via the `Destructure` typeclass — typesugar's equivalent of Scala's `unapply`:

```typescript
import { match } from "@typesugar/std";
import { Some, None, Left, Right } from "@typesugar/fp";

// Option matching
match(option)
  .case(Some(v))
  .if(v > 0)
  .then(v * 2)
  .case(Some(v))
  .then(v)
  .case(None)
  .then(0);

// Either matching
match(either)
  .case(Left(err))
  .then(`Error: ${err}`)
  .case(Right(val))
  .if(val > 0)
  .then(`Positive: ${val}`)
  .case(Right(val))
  .then(`Value: ${val}`);
```

Built-in extractors:

| Extractor   | Input          | Extracts        |
| ----------- | -------------- | --------------- |
| `Some(v)`   | `Option<T>`    | `T`             |
| `None`      | `Option<T>`    | (boolean match) |
| `Left(v)`   | `Either<L, R>` | `L`             |
| `Right(v)`  | `Either<L, R>` | `R`             |
| `Ok(v)`     | `Result<T, E>` | `T`             |
| `Err(e)`    | `Result<T, E>` | `E`             |
| `Cons(h,t)` | `List<T>`      | `[T, List<T>]`  |
| `Nil`       | `List<T>`      | (boolean match) |

---

## Exhaustiveness

Every `match()` is **always exhaustive** — like Rust, not like Scala. Missing cases produce a compile error:

```
error[TS9401]: Non-exhaustive match — missing cases: "blue"
  --> src/colors.ts:5:1
   |
 5 | match(color)
   | ^^^^^ missing case "blue"
   |
   = help: Add .case("blue").then(...) or .else(...) to handle remaining cases
```

### How It Works

| Pattern Domain                   | Exhaustiveness Rule            |
| -------------------------------- | ------------------------------ |
| Discriminated union              | All variants must be covered   |
| Literal union (`"a" \| "b"`)     | All values must be covered     |
| Boolean                          | Both `true` and `false`        |
| Sum types (Destructure)          | All variant extractors present |
| `string`, `number`, arrays, etc. | Requires `_` or `.else()`      |
| `unknown` / `any`                | Requires `_` or `.else()`      |

### The `.else()` Escape Hatch

`.else(value)` satisfies exhaustiveness for any type. Use it when you only care about a few cases:

```typescript
match(bigUnion)
  .case({ kind: "a" })
  .then(handleA())
  .case({ kind: "b" })
  .then(handleB())
  .else(undefined); // Explicitly: everything else is undefined
```

### Runtime Safety Net

Even with compile-time exhaustiveness, the generated code includes a terminal throw:

```typescript
throw new MatchError(__m); // "Non-exhaustive match: <value>"
```

`MatchError` extends `Error` and has a `.value` property with the unmatched value. This catches cases where the type is widened at runtime (e.g. via `any` or external data).

---

## Custom Extractors (Destructure Typeclass)

Define your own extractors by providing a `Destructure` instance:

```typescript
/** @impl Destructure<typeof Email, string, { user: string; domain: string }> */
const emailDestructure = {
  extract(input: string): { user: string; domain: string } | undefined {
    const m = input.match(/^([^@]+)@(.+)$/);
    return m ? { user: m[1], domain: m[2] } : undefined;
  },
};

// Now works in patterns:
match(str).case(Email({ user, domain })).then(`${user} at ${domain}`).else("not an email");
```

### Auto-Derivation

For product types (interfaces, classes), `Destructure` auto-derives. You don't write anything:

```typescript
interface Point {
  x: number;
  y: number;
}

// Auto-derived: extract(p) → [p.x, p.y]
match(point)
  .case(Point(x, y))
  .if(x > 0)
  .then(`positive x: ${x}`)
  .else("non-positive");
```

For sum types (discriminated unions), each variant gets its own extractor automatically.

### Boolean Extractors

For patterns that test membership without extracting data:

```typescript
/** @impl Destructure<typeof Even, number, true> */
const evenDestructure = {
  extract(input: number): true | undefined {
    return input % 2 === 0 ? true : undefined;
  },
};

match(n).case(Even).then("even").else("odd");
```

---

## Optimization

The match macro compiles to the most efficient code possible.

### Dead Arm Elimination

The macro uses the TypeScript type checker to prune impossible arms before generating any code:

```typescript
const x: "ok" = getStatus();
match(x).case("ok").then(200).else(500);
// Compiles to just: 200
// The .else() arm is dead — x can only be "ok"
```

For unions, the type narrows after each arm:

```typescript
const x: "ok" | "fail" = getStatus();
match(x).case("ok").then(200).case("fail").then(500);
// Compiles to: x === "ok" ? 200 : 500
// Second arm needs no check — after excluding "ok", only "fail" remains
```

Impossible patterns produce a compile error:

```
error[TS9402]: Pattern "pending" can never match type "ok" | "fail"
```

### Code Generation Strategies

| Pattern Kind     | Arms <= 6         | Arms > 6               |
| ---------------- | ----------------- | ---------------------- |
| All literals     | Ternary chain     | Switch statement       |
| Discriminant     | Ternary chain     | Switch statement       |
| Sparse integers  | Ternary chain     | Binary search tree     |
| Dense integers   | Ternary chain     | Switch (V8 jump table) |
| Mixed structural | Sequential checks | Sequential checks      |

### Unreachable Pattern Warnings

Arms dominated by earlier patterns produce warnings:

```
warning: Unreachable pattern — previous arm already covers this case
```

---

## Migration: Old API → New Fluent API

The old `match()` with object handlers continues to work. The new fluent API adds structural patterns on top.

### Before (object handler form)

```typescript
import { match, when, otherwise, P } from "@typesugar/std";

// Discriminated union
const area = match(shape, {
  circle: ({ radius }) => Math.PI * radius ** 2,
  square: ({ side }) => side ** 2,
  _: () => 0,
});

// Guard-based matching
const category = match(age, [
  when(
    (n) => n < 13,
    () => "child"
  ),
  when(
    (n) => n < 18,
    () => "teen"
  ),
  otherwise(() => "adult"),
]);

// Array pattern helpers
const result = match(list, [
  when(P.empty, () => "empty"),
  when(P.length(1), ([x]) => `one: ${x}`),
  otherwise(() => "default"),
]);
```

### After (fluent form)

```typescript
import { match } from "@typesugar/std";

// Discriminated union — same expressiveness, exhaustive by default
const area = match(shape)
  .case({ kind: "circle", radius: r })
  .then(Math.PI * r ** 2)
  .case({ kind: "square", side: s })
  .then(s ** 2)
  .else(0);

// Guard-based — no separate when()/otherwise() needed
const category = match(age)
  .case(n)
  .if(n < 13)
  .then("child")
  .case(n)
  .if(n < 18)
  .then("teen")
  .else("adult");

// Array patterns — first-class, no P.* helpers needed
const result = match(list).case([]).then("empty").case([x]).then(`one: ${x}`).else("default");
```

### What Changed

| Old API               | New Fluent API                 | Notes                                  |
| --------------------- | ------------------------------ | -------------------------------------- |
| `match(v, { ... })`   | `match(v).case(...).then(...)` | Object form still works                |
| `when(pred, handler)` | `.case(n).if(pred).then(...)`  | `when()` still works, but deprecated   |
| `otherwise(handler)`  | `.else(value)`                 | `otherwise()` still works, deprecated  |
| `P.empty`             | `.case([])`                    | `P.*` still works, deprecated          |
| `P.length(n)`         | `.case([a, b, ...])`           | Array patterns are first-class         |
| `isType("string")`    | `.case(String(s))`             | Constructor syntax replaces `isType()` |

### Backwards Compatibility

The old API is fully backwards compatible:

- `match(value, { ... })` — object handler form works unchanged
- `match(value, [when(...), otherwise(...)])` — guard form works unchanged
- `when()`, `otherwise()`, `P.*`, `isType()` — all still exported and functional

The old helpers have `@deprecated` notices suggesting the fluent alternative.

---

## Full Example

Putting it all together — a real-world expression evaluator:

```typescript
import { match } from "@typesugar/std";

type Expr =
  | { kind: "num"; value: number }
  | { kind: "add"; left: Expr; right: Expr }
  | { kind: "mul"; left: Expr; right: Expr }
  | { kind: "neg"; expr: Expr }
  | { kind: "var"; name: string };

function evaluate(expr: Expr, env: Record<string, number>): number {
  return match(expr)
    .case({ kind: "num", value: v })
    .then(v)
    .case({ kind: "add", left: l, right: r })
    .then(evaluate(l, env) + evaluate(r, env))
    .case({ kind: "mul", left: l, right: r })
    .then(evaluate(l, env) * evaluate(r, env))
    .case({ kind: "neg", expr: e })
    .then(-evaluate(e, env))
    .case({ kind: "var", name: n })
    .then(env[n] ?? 0);
  // No .else() needed — all 5 variants covered
}
```

The same in preprocessor syntax:

```typescript
function evaluate(expr: Expr, env: Record<string, number>): number {
  return match(expr)
  | { kind: "num", value: v } => v
  | { kind: "add", left: l, right: r } => evaluate(l, env) + evaluate(r, env)
  | { kind: "mul", left: l, right: r } => evaluate(l, env) * evaluate(r, env)
  | { kind: "neg", expr: e } => -evaluate(e, env)
  | { kind: "var", name: n } => env[n] ?? 0
}
```

---

## IDE Experience

The fluent API uses compile-time macros, so your editor's TypeScript language service won't recognise pattern variables (`r`, `s`, `w`, `h` in the examples above) as declared bindings. **You'll see red squiggles on those identifiers — this is expected.** The macro rewrites them into valid JavaScript at build time.

If the squiggles bother you, use the preprocessor `.sts` syntax instead — the preprocessor emits valid TypeScript that the language service can check. See [Two Syntaxes](#two-syntaxes) above.

---

## Learn More

- [PEP-008: Pattern Matching](../PEP-008-pattern-matching.md) — Full spec with compilation details
- [API Reference](/reference/packages#std)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/std)
