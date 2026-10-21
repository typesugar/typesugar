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

## The Fluent API

Pattern matches use a `.case().if().then()` chain that works in any TypeScript file:

```typescript
const y = match(x)
  .case([first, _, _])
  .if(first > 0)
  .then(first)
  .case([_, second, _])
  .then(second)
  .else(0);
```

Matches compile to optimized output with zero runtime overhead.

---

## Pattern Catalogue

### Literals

Match exact values — numbers, strings, booleans, `null`, `undefined`, `NaN`, `Infinity`:

```typescript
match(x)
  .case(42)
  .then("the answer")
  .case("hello")
  .then("greeting")
  .case(true)
  .then("yes")
  .case(null)
  .then("nothing")
  .else("other");
```

**Compiles to:** direct `===` comparisons (`Number.isNaN(x)` for `.case(NaN)`). 7+ plain literal arms (no guards, `.or()` or `.as()`) get a `switch` statement for V8 optimization.

### Variable Binding

Bind the matched value to a name, optionally with a guard:

```typescript
match(x)
  .case(n)
  .if(n > 0)
  .then(n * 2)
  .case(n)
  .then(-n);
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
match(arr)
  .case([])
  .then("empty")
  .case([x])
  .then(`singleton: ${x}`)
  .case([a, b])
  .then(`pair: ${a + b}`)
  .case([first, _, _])
  .if(first > 0)
  .then(first)
  .case([head, ...tail])
  .if(tail.length > 0)
  .then(`${head} + ${tail.length} more`)
  .else("other");
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
match(obj)
  .case({ a, b })
  .if(a > 0)
  .then(a + b)
  .case({ name: n, age })
  .if(age >= 18)
  .then(`Adult: ${n}`)
  .case({ name })
  .then(name)
  .case({ ...rest })
  .then(Object.keys(rest).length)
  .else(-1);
```

An object or tuple scrutinee isn't enumerable, so these matches need a final `.else()`
(or `_`) even when the last arm looks like a catch-all.

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

// Exhaustive by default — compile error if a variant is missing
match(shape)
  .case({ kind: "circle", radius: r })
  .then(Math.PI * r ** 2)
  .case({ kind: "square", side: s })
  .then(s ** 2)
  .case({ kind: "rect", w, h })
  .then(w * h);
```

**Compiles to:** a `switch` on the discriminant field inside the match IIFE. Each arm is still tested in full inside its `case` — extra literal/array/nested sub-patterns and guards included — and an arm that doesn't match falls through to the next arm with the same tag, then to the catch-all / `.else()` / `MatchError`. Every arm's bindings live in their own block, so two arms may bind the same name.

### Type Patterns

Match on runtime type using constructor syntax:

```typescript
match(value)
  .case(String(s))
  .then(`string: ${s}`)
  .case(Number(n))
  .if(n > 0)
  .then(`positive: ${n}`)
  .case(Number(n))
  .then(`number: ${n}`)
  .case(Array(a))
  .then(`array[${a.length}]`)
  .case(Date(d))
  .then(d.toISOString())
  .case(TypeError(e))
  .then(`type error: ${e.message}`)
  .else("unknown");
```

**Type check mapping:**

| Pattern         | Runtime Check                                                           |
| --------------- | ----------------------------------------------------------------------- |
| `String(s)`     | `typeof __m === "string"`                                               |
| `Number(n)`     | `typeof __m === "number"`                                               |
| `Boolean(b)`    | `typeof __m === "boolean"`                                              |
| `Array(a)`      | `Array.isArray(__m)`                                                    |
| `Array([x, y])` | `Array.isArray(__m)` plus the inner pattern's own test (`length === 2`) |
| `Date(d)`       | `__m instanceof Date`                                                   |
| `MyClass(v)`    | `__m instanceof MyClass`                                                |
| `Some(v)`       | Built-in extractor (see below)                                          |

### OR Patterns

Match multiple alternatives with the same handler:

```typescript
// .or() chaining
match(status)
  .case(200)
  .or(201)
  .or(204)
  .then("success")
  .case(400)
  .or(401)
  .or(403)
  .or(404)
  .then("client error")
  .case(500)
  .or(502)
  .or(503)
  .then("server error")
  .case(code)
  .then(`status: ${code}`);
```

Alternatives inside `.or()` can't bind variables (same restriction as Scala) — doing so is a compile error. Bind the matched value with `.as()` instead: `.case(200).or(201).as(code).then(code)`.

**Compiles to:** `if (__m === 200 || __m === 201 || __m === 204) return "success";` inside the match IIFE.

### AS Patterns (Bind Whole While Destructuring)

Bind the whole matched value to an alias alongside destructured bindings:

```typescript
match(point)
  .case([x, y])
  .as(p)
  .if(x > 0 && y > 0)
  .then({ point: p, quadrant: 1 })
  .case([x, y])
  .as(p)
  .then({ point: p, quadrant: 0 })
  .else(undefined); // tuples need .else(), as above
```

### Regex Patterns

Match strings against regular expressions and destructure capture groups:

```typescript
match(str)
  .case(/^(\w+)@(\w+)\.(\w+)$/)
  .as([_, user, domain, tld])
  .then({ user, domain, tld })
  .case(/^https?:\/\/(.+)$/)
  .as([_, url])
  .then(fetch(url))
  .case(/^\d+$/)
  .as([num])
  .then(parseInt(num))
  .case(s)
  .then(s);
```

**Compiles to:**

```typescript
{
  const __r = typeof __m === "string" ? __m.match(/^(\w+)@(\w+)\.(\w+)$/) : null;
  if (__r !== null) {
    const [_, user, domain, tld] = __r;
    return { user, domain, tld };
  }
}
```

### Nested Patterns

Patterns compose at arbitrary depth:

```typescript
match(data)
  .case({ user: { name, scores: [first, ...rest] } })
  .if(first > 90)
  .then(`${name} aced it with ${first}`)
  .case({ user: { name }, active: true })
  .then(`Active: ${name}`)
  .else("unknown");
```

### Extractor Patterns

Match `@typesugar/fp`'s `Option`, `Either` and `List` with the built-in extractors —
typesugar's equivalent of Scala's `unapply`. They test fp's real representations:
`Some(v)` matches a non-null value and binds it, `None` matches `null`, `Left(e)` /
`Right(v)` test for a `left` / `right` field.

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
// eith(Left("bad")) → "Error: bad", eith(Right(3)) → "Positive: 3"
```

Some + None, Left + Right and Cons + Nil each cover their type, so these matches need no
`.else()`.

Built-in extractors:

| Extractor   | Input                     | Extracts        |
| ----------- | ------------------------- | --------------- |
| `Some(v)`   | `Option<T>`               | `T`             |
| `None`      | `Option<T>`               | (boolean match) |
| `Left(v)`   | `Either<L, R>`            | `L`             |
| `Right(v)`  | `Either<L, R>`            | `R`             |
| `Cons(h,t)` | `List<T>`                 | `T`, `List<T>`  |
| `Nil`       | `List<T>`                 | (boolean match) |
| `Ok(v)`     | `{ ok: true; value: T }`  | `T`             |
| `Err(e)`    | `{ ok: false; error: E }` | `E`             |

When the scrutinee's type has a `_tag` property (Effect's `Option`/`Either`, or your own
`{ _tag: "Some"; value }` union), `Some`/`None`/`Left`/`Right`/`Cons`/`Nil` test `_tag`
instead and read the payload from `value` (`head`/`tail` for `Cons`).

---

## Statement form: `match: switch`

`match()` is an expression, so an arm can't loop, `return` from the enclosing function,
`break`, `continue` or `throw`. For code like that, put a `match:` label on a `switch`. The
arm bodies stay where they are, with plain switch control flow, and the macro adds the
exhaustiveness check and patterns:

```typescript
import "@typesugar/std/syntax/match"; // activates match: in this file

match: switch (geom.type) {
  case "Point":
    callback(geom.coordinates);
    break;
  case "LineString":
  case "MultiPoint":
    for (const c of geom.coordinates) if (callback(c) === false) return false;
    break;
  case "Polygon":
    return polygon(geom);
}
// error TS9226: Non-exhaustive match — missing cases: "MultiLineString", "MultiPolygon", ...
```

**Literal cases** (literals, `const`s, enum members) compile to the same switch with the
label removed. Nothing is added, so the JavaScript is byte-for-byte the hand-written
switch, and the activation import is removed from the output too. `break`, `return`,
`continue`, `throw` and fallthrough mean what they always mean.

**`default:`** covers the remaining values and turns the check off, as `.else()` does. A
`default:` that only `throw`s is a safety net for values outside the type (untyped input),
so it keeps the check on: a member added to the union later is still a compile error, not a
runtime throw. A `default:` that does more, after cases that already cover the type, is
reported as unreachable (a warning).

### Destructuring cases

Switch on the whole value and write a pattern in each `case`:

```typescript
match: switch (geom) {
  case { type: "Point", coordinates: [x, y] }:
    draw(x, y);
    break;
  case { type: "LineString", coordinates }:
    for (const [x, y] of coordinates) draw(x, y);
    break;
  case { type: "Polygon" }:
    fill(geom);
    break;
}
```

Patterns that share a discriminant compile to a switch on it, with the bindings in a block
per case:

```typescript
switch (geom.type) {
  case "Point": {
    const [x, y] = geom.coordinates;
    draw(x, y);
    break;
  }
  case "LineString": {
    const coordinates = geom.coordinates;
    for (const [x, y] of coordinates) draw(x, y);
    break;
  }
  case "Polygon":
    fill(geom);
    break;
}
```

- The discriminant is the only thing tested. The rest of the pattern **destructures**:
  `coordinates: [x, y]` reads the first two elements whatever the length, as
  `const [x, y] = …` does. So a literal below the top level (`{ kind: "a", inner: { tag: "x" } }`)
  is an error; test it in the case body, or use the fluent `match()`, which tests every
  sub-pattern.
- Several names, rest and nesting go in one declaration: `case { kind: "rect", w, h, style: { fill } }:`
  becomes `const { w, h, style: { fill } } = s;`, and `{ kind: "circle", ...rest }` binds the
  properties other than `kind`.
- Bindings are scoped to their case. A case that binds names must have its own statements
  (one that falls through with no body would never see them).
- A scrutinee that isn't an identifier or `this` is read once into a `const` first
  (`match: switch (feature.geometry)` → `const _geometry = feature.geometry;`).
- There are no guards: `case P if cond` isn't valid syntax, and `case P: if (!cond) break;`
  would leave the switch rather than try the next case. Test the condition in the body.

**Built-in extractors** work as in the fluent form: `case Some(v):` / `case None:`,
`Left`/`Right`, `Ok`/`Err`, `Cons`/`Nil`. A tagged representation (`_tag`, `ok`) uses the
discriminant switch. fp's untagged ones (Option is `A | null`) have no discriminant, and
neither do patterns mixed with `case null:` or patterns with no shared literal property.
Those compile to `switch (true)`, an if/else chain that keeps switch semantics:

```typescript
match: switch (opt) {
  case Some(v):
    use(v);
    break;
  case None:
    skip();
    break;
}
// switch (true) { case opt != null: { const v = opt; use(v); break; } case opt == null: skip(); break; }
```

Extractors for your own types (`case Point(x, y):`) are not supported yet; use an object
pattern. Array patterns at the top level (test a length) and type tests (`String(s)`) are
fluent-only.

The label without the import is an ordinary JavaScript label on a plain switch, and the
transformer warns (TS9224). Plain `tsc` accepts the literal form as written (a labelled
switch is valid JavaScript; under `allowUnusedLabels: false` it reports TS7028). Names bound
by destructuring cases are undeclared to plain `tsc` (TS2304), as in the fluent form; the
editor plugin and `typesugar check` don't report them.

---

## Exhaustiveness

Every `match()` is **always exhaustive** — like Rust, not like Scala. Missing cases produce a compile error:

```
error TS9226: [typesugar] [TS9226] Non-exhaustive match — missing cases: "blue"
  = help: Add the missing cases or use .else() / _ to handle remaining values.
```

### How It Works

| Pattern Domain                   | Exhaustiveness Rule            |
| -------------------------------- | ------------------------------ |
| Discriminated union              | All variants must be covered   |
| Literal union (`"a" \| "b"`)     | All values must be covered     |
| Boolean                          | Both `true` and `false`        |
| Option / Either / List           | All variant extractors present |
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

When the patterns can't prove a value matched, the generated code ends in a terminal throw:

```typescript
throw new MatchError(__m); // "Non-exhaustive match: <value>"
```

`MatchError` extends `Error` and has a `.value` property with the unmatched value. This catches cases where the type is widened at runtime (e.g. via `any` or external data). It is imported from `@typesugar/std`, so code that keeps the throw depends on that package at runtime.

A literal union that literal arms cover completely gets no throw: the last arm is unconditional, as in `x === "ok" ? 200 : 500` below, so a value outside the type takes that arm. Discriminated-union matches and the 7+ literal `switch` keep the throw.

---

## Custom Extractors

An extractor is a `Destructure` instance (`@typesugar/std`; Scala's `unapply`) for a
constructor. `Name(...)` in a pattern resolves the instance for `Name` by its symbol, from
the current file, the modules it imports, or the module that declares `Name` itself, so an
instance that ships next to its type needs no import of its own:

```typescript
export interface Point {
  readonly x: number;
  readonly y: number;
}
export function Point(x: number, y: number): Point {
  return { x, y };
}

/**
 * @impl Destructure<typeof Point, Point, [number, number]>
 * @destructure always -> x, y
 */
export const destructurePoint = { extract: (p: Point): [number, number] => [p.x, p.y] };

match(p)
  .case(Point(x, y))
  .then(x + y);
// const x = _p.x; const y = _p.y; return x + y;  (no extract() call)
```

**`@destructure`** tells the macro what `extract` does, so it inlines the test and the
field reads and never calls the instance. It is data in a JSDoc tag, so it survives `.d.ts`
emit and works for a library's instances, whose bodies a consumer's build can't see:

| Descriptor             | Test                  | Binds                    |
| ---------------------- | --------------------- | ------------------------ |
| `not-null -> self`     | `v != null`           | the value itself         |
| `null`                 | `v == null`           | nothing (`None`)         |
| `has left -> left`     | `"left" in v`         | `v.left`                 |
| `kind = "circle" -> r` | `v.kind === "circle"` | `v.r`                    |
| `ok = true -> value`   | `v.ok === true`       | `v.value`                |
| `always -> x, y`       | none                  | `v.x`, `v.y` (a product) |

The descriptor must agree with `extract`: the macro trusts it.

**Without a descriptor** the instance's `extract` is called once, and the result is
destructured (a tuple for several arguments, the value itself for one):

```typescript
/** @impl Destructure<typeof Email, string, { user: string; domain: string }> */
export const destructureEmail = {
  extract(s: string) {
    const at = s.indexOf("@");
    return at > 0 ? { user: s.slice(0, at), domain: s.slice(at + 1) } : undefined;
  },
};

match(input).case(Email({ user, domain })).then(`${user} at ${domain}`).else("invalid");
// const _ext = destructureEmail.extract(_input); if (_ext !== undefined) { const user = _ext.user; ... }
```

The instance is imported where it is needed. A name with no instance in scope is a type
pattern (`instanceof Name`), as before. Both forms work in a `match:` switch.

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

Direct emit only happens when it is provably equivalent: the scrutinee has no side effects (an identifier or a property-access chain — `match(next())` still calls `next()`), and every arm up to the chosen one is a plain literal or `_` with no guard, `.or()` or `.as()`. Otherwise the normal code is generated.

Impossible patterns produce a compile error:

```
error: Pattern "pending" can never match type "ok" | "fail"
```

### Code Generation Strategies

| Shape                                                                                            | Output                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Scrutinee type is a single literal (see above)                                                   | The chosen arm's expression, nothing else                      |
| Plain literal arms (`.or()` allowed) ending in `.else()`, `_` or full coverage, on an identifier | Conditional chain: `x === a ? r1 : x === b ? r2 : r3`, no IIFE |
| 7+ plain literal arms                                                                            | `switch` in an IIFE                                            |
| Object patterns sharing one literal discriminant property                                        | `switch` on the discriminant in an IIFE                        |
| Anything else                                                                                    | `if` chain in an IIFE (scrutinee evaluated once)               |

The conditional chain needs an identifier (or `this`) scrutinee when it tests more than one literal, because it reads the scrutinee once per test; a property access could be a getter, so `match(obj.kind)` with several literal arms keeps the IIFE, which reads it once. Bind it to a local first (`const k = obj.kind`) to get the chain.

If any arm, guard, `.else()` or the scrutinee contains `await`, the IIFE becomes `await (async () => { ... })()`. A `yield` can't be moved into an arrow function, so a `yield` in a match that needs an IIFE is a compile error — compute the value before the match.

### Unreachable Pattern Warnings

Arms dominated by earlier patterns produce warnings:

```
warning: Unreachable pattern — value "ok" is already matched by an earlier arm
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

| Old API               | New Fluent API                 | Notes                                                    |
| --------------------- | ------------------------------ | -------------------------------------------------------- |
| `match(v, { ... })`   | `match(v).case(...).then(...)` | Object form still supported (see [match.md](./match.md)) |
| `when(pred, handler)` | `.case(n).if(pred).then(...)`  | `when()` removed                                         |
| `otherwise(handler)`  | `.else(value)`                 | `otherwise()` removed                                    |
| `P.empty`             | `.case([])`                    | `P.*` removed                                            |
| `P.length(n)`         | `.case([a, b, ...])`           | Array patterns are first-class                           |
| `isType("string")`    | `.case(String(s))`             | Constructor syntax replaces `isType()`                   |

### Migration

Only `when()`, `otherwise()`, `P.*`, and `isType()` were removed. The object-handler
form `match(value, { variant: handler })` is **preserved** (see the dedicated
[runtime-form guide](./match.md)); the fluent API shown above adds structural patterns
on top of it. Use whichever form fits — the fluent API for structural/guard patterns,
the object-handler form for simple discriminated-union dispatch.

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

---

## Editors and tools that read unexpanded source

With typesugar's language-service plugin, the editor checks the expanded code, so pattern
variables (`r`, `s`, `w`, `h` above) are declared bindings there: no red squiggles, and
hover shows their types. `typesugar check` and `typesugar build` hide the same errors.

Plain `tsc`, typescript-eslint, typedoc and similar tools type-check the source **as
written**. For them `@typesugar/std` types the fluent chain, so that:

- a match with literal arms and `.else()` type-checks, and its value is the union of the
  arm results (literal for a `const`, widened for a `let`, as for the conditional the
  macro emits);
- a chain that ends in `.then()` is typed `R & FluentMatch<…>`, because TypeScript can't
  tell which `.then()` is the last. It is assignable wherever `R` is. A `null` or
  `undefined` result stays in the type, so `match(t).case("A").then("a").case("B").then(undefined)`
  is `… | undefined`;
- after an arm whose result may be `null` or `undefined`, the next `.case()` is "possibly
  null" (TS2531 / TS18047) to plain `tsc`. Put that arm last, or end with `.else()`;
- names bound by a pattern are undeclared identifiers to plain `tsc` (TS2304), whatever the
  types say. Exhaustiveness is checked only by the macro.

So code that plain `tsc` must accept should use literal arms and `.else()`. Check code with
binding patterns with `typesugar check`, and check a library's public types against its
emitted `.d.ts` rather than its source.

## Learn More

- [PEP-008: Pattern Matching](https://github.com/typesugar/typesugar/blob/main/peps/PEP-008-pattern-matching.md) — Full spec with compilation details
- [API Reference](/reference/packages#std)
- [Package README](https://github.com/typesugar/typesugar/tree/main/packages/std)
