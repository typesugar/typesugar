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
// Compile error if you miss a variant. No runtime library does the matching.
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

Matches compile to plain conditionals, `switch`es and field reads; [Code Generation Strategies](#code-generation-strategies) shows what each shape becomes.

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

**Compiles to:** `if (__m === 200 || __m === 201 || __m === 204) return "success";` inside an IIFE (this match needs one because its last arm binds `code`; an `.or()` match whose arms bind nothing becomes a conditional chain, see [Code Generation Strategies](#code-generation-strategies)).

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

Match `@typesugar/fp`'s `Option`, `Either`, `List` and `Validated` with their
constructors — typesugar's equivalent of Scala's `unapply`. Each constructor's extractor
is a `Destructure` instance that fp ships next to the type (see
[Custom Extractors](#custom-extractors)), so it tests fp's real representation: `Some(v)`
matches a non-null value and binds it, `None` matches `null`, `Left(e)` / `Right(v)` test
for a `left` / `right` field. The test is inlined; nothing is called at run time.

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

Some + None, Left + Right, Cons + Nil and Valid + Invalid each cover their type, so these
matches need no `.else()`.

`@typesugar/fp`'s extractors:

| Extractor    | Input             | Test           | Extracts       |
| ------------ | ----------------- | -------------- | -------------- |
| `Some(v)`    | `Option<T>`       | `v != null`    | `T`            |
| `None`       | `Option<T>`       | `v == null`    | (nothing)      |
| `Left(e)`    | `Either<E, A>`    | `"left" in v`  | `E`            |
| `Right(a)`   | `Either<E, A>`    | `"right" in v` | `A`            |
| `Cons(h, t)` | `List<T>`         | `v != null`    | `T`, `List<T>` |
| `Nil`        | `List<T>`         | `v == null`    | (nothing)      |
| `Valid(a)`   | `Validated<E, A>` | `"value" in v` | `A`            |
| `Invalid(e)` | `Validated<E, A>` | `"error" in v` | `E`            |

The extractor follows the constructor, not its name: a `Some` from another library (or
your own) needs its own instance, and a name with no instance in scope is a type pattern
(`instanceof Some`). For a `_tag` union (Effect-style) or an `{ ok: true; value }` result,
declare instances with `@destructure _tag = "Some" -> value` or
`@destructure ok = true -> value`, or use an object pattern (`{ _tag: "Some", value: v }`).

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

**Extractors** work as in the fluent form: `case Some(v):` / `case None:`, `Left`/`Right`,
`Cons`/`Nil`, `Valid`/`Invalid`, and your own instances. One whose descriptor tests a
discriminant (`_tag = "Some"`, `ok = true`) uses the
discriminant switch. fp's untagged ones (Option is `A | null`) have no discriminant, and
neither do patterns mixed with `case null:` or patterns with no shared literal property.
Those compile to `switch (true)`, an if/else chain that keeps switch semantics:

```typescript
// opt: Option<number>
match: switch (opt) {
  case Some(v):
    use(v);
    break;
  case None:
    skip();
    break;
}
// switch (true) { case opt != null: { const v = opt as unknown as number; use(v); break; } case opt == null: skip(); break; }
```

fp's `Option` is `@opaque`: to the type checker it is an interface, which `opt != null`
doesn't narrow, so `Some(v)` asserts `v` to the payload type that the instance's `extract`
declares (`number` here). Without that, `v` would be an `Option<number>` in the expanded
code and `v * 2` would fail strict type-checking.

`case Point(x, y):` works for any constructor with a `Destructure` instance in scope (see
[Custom Extractors](#custom-extractors)); one without a descriptor has its `extract` called
once per test. Array patterns at the top level (test a length) and type tests (`String(s)`)
are fluent-only.

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

When the patterns can't prove that every value of the type matched, the generated code ends in a terminal throw:

```typescript
throw new MatchError(__m); // "Non-exhaustive match: <value>"
```

`MatchError` extends `Error` and has a `.value` property with the unmatched value. This catches cases where the type is widened at runtime (e.g. via `any` or external data). It is imported from `@typesugar/std`, so code that keeps the throw depends on that package at runtime.

Arms that cover the type get no throw: the arm that completes the coverage has no test and nothing follows it, so a value outside the type takes that arm. That covers a literal union matched by literal arms (`x === "ok" ? 200 : 500` below; in the 7+ literal `switch` the last arm is the `default:`) and extractors that cover their type: `Some`/`None`, `Left`/`Right`, `Cons`/`Nil`, `Valid`/`Invalid`, and one derived extractor per variant of a union. For example:

```typescript
match(o)
  .case(Some(v))
  .then(v * 2)
  .case(None)
  .then(0);
// (() => { const _o = o; if (_o != null) { const v = _o as unknown as number; return v * 2; } return 0; })()
```

Object patterns on a discriminated union (`{ kind: "circle", r }`, compiled to the discriminant switch) keep the throw: each arm still tests its named properties with `in`.

---

## Custom Extractors

An extractor is a `Destructure` instance (`@typesugar/std`; Scala's `unapply`) for a
constructor. `Name(...)` in a pattern resolves the instance for `Name` by its symbol, from
the current file, the modules it imports, or the module that declares `Name` itself, so an
instance that ships next to its type needs no import of its own.

### Deriving them: `@derive(Destructure)`

For your own types, derive the extractors:

```typescript
/** @derive(Destructure) */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** @derive(Destructure) */
export type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number }
  | { kind: "empty" };

const area = (s: Shape) =>
  match(s)
    .case(Circle(r))
    .then(Math.PI * r * r)
    .case(Rect(w, h))
    .then(w * h)
    .case(Empty)
    .then(0);

const p = Point(1, 2); // the extractor also builds one
```

The derive adds, next to the type, a **constructor function** per extractor (the value the
pattern names, like a Scala case class's `apply`) and its `Destructure` instance:

```typescript
export function Point(x: number, y: number): Point {
  return { x, y };
}
/**
 * @impl Destructure<typeof Point, Point, [number, number]>
 * @destructure always -> x, y
 */
export const destructurePoint = { extract: (v: Point): [number, number] => [v.x, v.y] };

export function Circle(r: number): { kind: "circle"; r: number } {
  return { kind: "circle", r };
}
/**
 * @impl Destructure<typeof Circle, Shape, number>
 * @destructure kind = "circle" -> r
 */
export const destructureCircle = { extract: (v: Shape): number | undefined => ... };
// ... Rect(w, h), Empty()
```

Patterns compile to the field reads and discriminant tests, and never reference the
function or the instance, so a bundler drops both when only patterns use them:

```typescript
// match(s).case(Circle(r)).then(...)        →  if (_s.kind === "circle") { const r = _s.r; ... }
// match: switch (s) { case Circle(r): ... }  →  switch (s.kind) { case "circle": { const r = s.r; ... } }
```

The rules:

- **A product** (an interface or an object type alias) gets one extractor named after the
  type, binding its fields in declaration order. Methods aren't fields: a type with methods
  is an error, since a constructor function couldn't build one.
- **A discriminated union** gets one extractor per variant, binding the variant's fields
  other than the discriminant, in declaration order. A variant declared as its own
  interface (`type Result = Ok | Err`) keeps its name. An inline variant is named from its
  tag in PascalCase: `"circle"` is `Circle`, `"line-string"` and `"line_string"` are
  `LineString`.
- **The discriminant** is the one field that has a different string or boolean literal type
  in every variant.
- Matches over the union are exhaustive without `.else()` when every variant has a case.

Anything ambiguous is a compile error, not a guess:

- two discriminant candidates (`kind` and `type`);
- an inline variant with a boolean tag (name it with an interface), or a tag that makes no
  name (`"2d"`), or two tags that make the same name;
- an `extends` clause (do inherited fields come first?);
- a name that something already has, including a global: a variant `{ kind: "error" }`
  would shadow `Error` in the module;
- a named variant with `@derive`s of its own declared before the union: TypeScript requires
  the function to come before the namespace those derives add (TS2434), so declare the
  union first;
- a class (it has a constructor already: write its instance by hand, below).

The function merges with the type and with the companion namespace other derives add
(`@derive(Eq, Destructure)` gives `Point(1, 2)` and `Point.Eq`). The extractors work from
other files (`import { Circle } from "./shape"`), and a library's `.d.ts` declares the
functions and the instances with their `@destructure` tags, so its consumers' patterns
are inlined too.

**Types you don't own** (a library's `Feature`, `Point`, ...) can't take a derive, and
`derived<Destructure<T>>()` doesn't apply: an extractor needs a value to name in the
pattern and a descriptor on that value's declaration, which an expression can't provide.
Write the instance by hand instead.

### Writing them by hand

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
| `not-null -> self`     | `v != null`           | the value itself¹        |
| `null`                 | `v == null`           | nothing (`None`)         |
| `has left -> left`     | `"left" in v`         | `v.left`                 |
| `kind = "circle" -> r` | `v.kind === "circle"` | `v.r`                    |
| `ok = true -> value`   | `v.ok === true`       | `v.value`                |
| `always -> x, y`       | none                  | `v.x`, `v.y` (a product) |

¹ Asserted to the payload type `extract` returns (`v as unknown as A`) when the value's
own type doesn't narrow to it, as with an `@opaque` type like fp's `Option`.

The descriptor must agree with `extract`: the macro trusts it.

For a type from another package, name the extractor yourself:

```typescript
import type { Geometry, Point, Position } from "geojson";

export function GeoPoint(coordinates: Position): Point {
  return { type: "Point", coordinates };
}
/**
 * @impl Destructure<typeof GeoPoint, Geometry, Position>
 * @destructure type = "Point" -> coordinates
 */
export const destructureGeoPoint = {
  extract: (g: Geometry) => (g.type === "Point" ? g.coordinates : undefined),
};

match(geometry)
  .case(GeoPoint([x, y]))
  .then(x + y)
  .else(0);
```

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

| Shape                                                                               | Output                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Scrutinee type is a single literal (see above)                                      | The chosen arm's expression, nothing else                      |
| Arms that bind nothing, ending in `.else()`, `_` or full coverage, on an identifier | Conditional chain: `x === a ? r1 : x === b ? r2 : r3`, no IIFE |
| 7+ plain literal arms                                                               | `switch` in an IIFE                                            |
| Object patterns sharing one literal discriminant property                           | `switch` on the discriminant in an IIFE                        |
| Anything else                                                                       | `if` chain in an IIFE (scrutinee evaluated once)               |

"Arms that bind nothing" are plain literals (`.or()` allowed) and extractors with no bindings (`None`, `Nil`, `Some(_)`), with no guard or `.as()`: `match(o).case(None).then("none").case(Some(_)).then("some")` compiles to `o == null ? "none" : "some"`. An arm that binds a name needs a block for its `const`, so it keeps the IIFE.

The conditional chain needs an identifier (or `this`) scrutinee when it tests more than one literal, or tests an extractor at all (an extractor's test may read it more than once), because it reads the scrutinee once per test; a property access could be a getter, so `match(obj.kind)` with several literal arms keeps the IIFE, which reads it once. Bind it to a local first (`const k = obj.kind`) to get the chain.

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
