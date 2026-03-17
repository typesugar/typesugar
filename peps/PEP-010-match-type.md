# PEP-010: Type-Level Pattern Matching

**Status:** Draft
**Date:** 2026-03-15
**Author:** Dean Povey
**Depends on:** PEP-008 (Pattern Matching), `specialize()` infrastructure

## Context

TypeScript has conditional types for type-level dispatch:

```typescript
type Unwrap<T> = T extends Promise<infer U> ? U : T extends Array<infer U> ? U : T;
```

And typesugar has `specialize()` for monomorphization — generating specialized code per call site:

```typescript
const sortNumbers = specialize(sort, [numericOrd]);
```

But there's no ergonomic way to:

1. **Write complex conditional types** without deeply nested ternaries
2. **Generate different code per type** with pattern matching ergonomics

This PEP introduces `matchType` in two forms:

- **Type-level** — ergonomic sugar for conditional types (replaces nested ternaries)
- **Expression-level** — compile-time type dispatch that monomorphizes per call site

Both use the same pattern syntax from PEP-008, applied to types instead of values.

### Why Separate from `match()`

`match()` (PEP-008) operates on **runtime values** — it always produces runtime checks, even if dead arms are eliminated via type narrowing. `matchType` operates on **types** — it resolves entirely at compile time. Mixing them would be confusing: does `.case(String)` check `typeof` at runtime, or resolve `T` at compile time? Keeping them separate makes the semantics unambiguous.

|            | `match(value)`                           | `matchType<T>`                   |
| ---------- | ---------------------------------------- | -------------------------------- |
| Input      | Runtime value                            | Type parameter                   |
| Resolution | Runtime (with compile-time optimization) | Compile time only                |
| Output     | Runtime expression with checks           | Type or monomorphized expression |
| Dead arms  | Eliminated as optimization               | Never emitted                    |

## Part 1: Type-Level matchType (Conditional Type Sugar)

### The Problem

Complex conditional types are unreadable:

```typescript
type Serialize<T> = T extends string
  ? string
  : T extends number
    ? string
    : T extends boolean
      ? string
      : T extends Array<infer U>
        ? Serialize<U>[]
        : T extends Map<infer K, infer V>
          ? Record<string, Serialize<V>>
          : T extends Set<infer U>
            ? Serialize<U>[]
            : T extends Date
              ? string
              : T extends { toJSON(): infer R }
                ? Serialize<R>
                : T extends object
                  ? { [K in keyof T]: Serialize<T[K]> }
                  : never;
```

Deeply nested, no visual structure, easy to break with a misplaced `:`.

### The Solution

Preprocessor syntax (`.sts`):

```typescript
type Serialize<T> = matchType<T>
  | string => string
  | number => string
  | boolean => string
  | Array<infer U> => Serialize<U>[]
  | Map<infer K, infer V> => Record<string, Serialize<V>>
  | Set<infer U> => Serialize<U>[]
  | Date => string
  | { toJSON(): infer R } => Serialize<R>
  | object => { [K in keyof T]: Serialize<T[K]> }
  | _ => never
```

Macro syntax (`.ts`):

```typescript
type Serialize<T> = MatchType<
  T,
  [string, string],
  [number, string],
  [boolean, string],
  [Array<infer U>, Serialize<U>[]],
  [Map<infer K, infer V>, Record<string, Serialize<V>>],
  [Set<infer U>, Serialize<U>[]],
  [Date, string],
  [{ toJSON(): infer R }, Serialize<R>],
  [object, { [K in keyof T]: Serialize<T[K]> }],
  [unknown, never]
>;
```

### Compilation

Both forms compile to the same nested conditional type:

```typescript
type Serialize<T> =
  T extends string ? string
  : T extends number ? string
  // ...same as before, just generated
```

### Pattern Types Supported

| Pattern                         | Conditional Type Generated                      |
| ------------------------------- | ----------------------------------------------- |
| `string`, `number`, etc.        | `T extends string ? ...`                        |
| `Array<infer U>`                | `T extends Array<infer U> ? ...`                |
| `{ key: infer V }`              | `T extends { key: infer V } ? ...`              |
| `[infer A, infer B]`            | `T extends [infer A, infer B] ? ...`            |
| `Map<infer K, infer V>`         | `T extends Map<infer K, infer V> ? ...`         |
| `Promise<infer T>`              | `T extends Promise<infer T> ? ...`              |
| `(...args: infer A) => infer R` | `T extends (...args: infer A) => infer R ? ...` |
| `_` or `unknown`                | Terminal else branch (no `extends` check)       |

### Advanced: OR Patterns

```typescript
type Category<T> = matchType<T>
  | string | number | boolean => "primitive"
  | Array<any> | Set<any> => "collection"
  | Map<any, any> | Record<string, any> => "mapping"
  | _ => "other"

// Compiles to:
type Category<T> =
  T extends string ? "primitive"
  : T extends number ? "primitive"
  : T extends boolean ? "primitive"
  : T extends Array<any> ? "collection"
  // ...
```

### Advanced: Recursive Types

```typescript
type DeepReadonly<T> = matchType<T>
  | Array<infer U> => ReadonlyArray<DeepReadonly<U>>
  | Map<infer K, infer V> => ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  | Set<infer U> => ReadonlySet<DeepReadonly<U>>
  | object => { readonly [K in keyof T]: DeepReadonly<T[K]> }
  | _ => T

type DeepPartial<T> = matchType<T>
  | Array<infer U> => Array<DeepPartial<U>>
  | object => { [K in keyof T]?: DeepPartial<T[K]> }
  | _ => T
```

### Advanced: Guards via Intersections

TypeScript conditional types don't have guards, but intersections can express constraints:

```typescript
type StringKeys<T> = matchType<T>
  | { [K in keyof T as K extends string ? K : never]: any } => keyof T & string
  | _ => never
```

## Part 2: Expression-Level matchType (Monomorphization)

### The Problem

Generic functions often contain type-dependent logic that could be resolved at compile time:

```typescript
function serialize<T>(value: T): string {
  // At runtime, we don't know what T is — types are erased
  // So we resort to typeof/instanceof chains
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((x) => serialize(x)).join(",");
  return JSON.stringify(value);
}
```

The runtime checks are wasteful when the call site knows exactly what `T` is.

### The Solution

```typescript
function serialize<T>(value: T): string {
  return matchType<T>(value)
    .case(String)
    .then(value)
    .case(Number)
    .then(String(value))
    .case(Boolean)
    .then(String(value))
    .case(Array)
    .then(value.map((x) => serialize(x)).join(","))
    .case(Date)
    .then(value.toISOString())
    .else(JSON.stringify(value));
}
```

At each call site, the macro resolves `T` and emits only the matching branch:

```typescript
serialize("hello"); // → "hello"                     (String branch)
serialize(42); // → String(42)                   (Number branch)
serialize([1, 2, 3]); // → [1,2,3].map(x => serialize(x)).join(",")  (Array branch)
```

### How It Works

1. **Definition site:** The macro records the `matchType<T>(value)` expression and its arms, but doesn't emit code yet. Instead, it emits a **generic fallback** (the else branch or a runtime typeof chain) for contexts where `T` can't be resolved.

2. **Call site:** When the macro encounters a call to a function containing `matchType<T>`, it checks if `T` is resolvable via `ctx.typeChecker.getTypeAtLocation()`. If so, it:
   - Determines which arm matches
   - Inlines only that arm's expression
   - Substitutes `value` with the call site argument

3. **Unresolvable `T`:** If `T` is still generic at the call site (e.g., passed through from another generic), the fallback is used. The fallback can be:
   - An explicit `.else()` branch
   - An auto-generated runtime typeof chain (the macro knows the arms and can emit runtime checks as a safety net)

### Integration with `specialize()`

The existing `specialize()` infrastructure already handles call-site monomorphization. `matchType<T>()` builds on this:

```typescript
// matchType<T>(value) is conceptually:
// specialize(genericFn, [resolvedType]) where the specialization
// strategy is "pick the matching arm"
```

The key difference: `specialize()` works with typeclass dictionaries (replacing method calls). `matchType<T>()` works with type patterns (selecting code branches). They share the call-site resolution mechanism.

### Preprocessor Syntax

```typescript
function serialize<T>(value: T): string {
  return matchType<T>(value)
  | String => value
  | Number => String(value)
  | Boolean => String(value)
  | Array => value.map(x => serialize(x)).join(",")
  | Date => value.toISOString()
  | _ => JSON.stringify(value)
}
```

### Type Narrowing in Arms

Within each arm, `value` is automatically narrowed to the matched type:

```typescript
matchType<T>(value)
  .case(String)
  .then(value.toUpperCase()) // value: string — .toUpperCase() is valid
  .case(Array)
  .then(value.length) // value: T[] — .length is valid
  .case(Map)
  .then(value.size) // value: Map<K,V> — .size is valid
  .else(String(value)); // value: T — generic fallback
```

The macro generates appropriate type assertions in the output to satisfy the type checker.

### Nested Type Parameters

```typescript
function deepClone<T>(value: T): T {
  return matchType<T>(value)
    .case(Array)
    .then(value.map((x) => deepClone(x)) as T)
    .case(Map)
    .then(new Map([...value].map(([k, v]) => [deepClone(k), deepClone(v)])) as T)
    .case(Set)
    .then(new Set([...value].map((x) => deepClone(x))) as T)
    .case(Date)
    .then(new Date(value.getTime()) as T)
    .case(Object)
    .then(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepClone(v)])) as T)
    .else(value); // primitives are immutable
}
```

At `deepClone<number[]>([1,2,3])`, only the Array arm is emitted:

```typescript
[1, 2, 3].map((x) => deepClone(x));
```

### Typeclass Dispatch: `.has()`

The most powerful feature of expression-level `matchType`: dispatch based on whether a typeclass instance exists for `T`. The macro resolves this at compile time via instance lookup — no runtime cost.

**Syntax:**

```typescript
function format<T>(value: T): string {
  return matchType<T>(value)
    .case(String)
    .then(value)
    .case(Number)
    .then(String(value))
    .has(Show)
    .then(show(value))
    .else(JSON.stringify(value));
}
```

Preprocessor:

```typescript
function format<T>(value: T): string {
  return matchType<T>(value)
  | String => value
  | Number => String(value)
  | has Show => show(value)
  | _ => JSON.stringify(value)
}
```

**How it works:**

1. At each call site, the macro resolves `T` (e.g., `T = Color`)
2. For `.has(Show)`, it checks: does a `Show<Color>` instance exist in scope?
3. If yes, the arm matches — `show(value)` is inlined with the concrete instance
4. If no, the arm is skipped and the next arm is tried

This composes with `specialize()` — the `show(value)` call within the arm uses the resolved typeclass instance, exactly as `specialize()` would.

**Arm priority:** First match wins. If `T = string` and both `.case(String)` and `.has(Show)` would match (since string has a Show instance), the `.case(String)` arm wins because it appears first. This gives users explicit control over dispatch priority.

**Multiple typeclass constraints:**

```typescript
matchType<T>(value)
  .has(Show, Ord)
  .then(/* T has both Show and Ord */)
  .has(Show)
  .then(/* T has Show but maybe not Ord */)
  .else(fallback);
```

Preprocessor:

```typescript
matchType<T>(value)
  | has Show & Ord => /* both */
  | has Show => /* Show only */
  | _ => fallback
```

The macro checks that ALL listed typeclasses have instances. This is equivalent to Haskell's `(Show a, Ord a) =>` constraint, but resolved at the call site rather than carried as dictionaries.

**Real-world example — generic serialization with typeclass priority:**

```typescript
function toJSON<T>(value: T): unknown {
  return matchType<T>(value)
    .case(String)
    .then(value)
    .case(Number)
    .then(value)
    .case(Boolean)
    .then(value)
    .has(Serialize)
    .then(serialize(value))
    .has(Show)
    .then(show(value))
    .case(Array)
    .then(value.map((x) => toJSON(x)))
    .else(Object.fromEntries(Object.entries(value as any).map(([k, v]) => [k, toJSON(v)])));
}
```

At `toJSON(myColor)` where `Color` has `Serialize` but not `Show`:

```typescript
serialize(myColor); // Serialize arm — resolved at compile time
```

At `toJSON(myPoint)` where `Point` has `Show` but not `Serialize`:

```typescript
show(myPoint); // Show arm — Serialize was skipped
```

At `toJSON("hello")`:

```typescript
"hello"; // String arm — type match wins over typeclass match (first-match)
```

**Using typeclass methods in the arm body:**

Within a `.has(TC)` arm, the macro makes the typeclass methods available on `value`. This is because the macro knows the concrete instance and can inline the method calls:

```typescript
matchType<T>(value)
  .has(Ord)
  .then(sort([value, other])) // sort uses Ord<T> — instance resolved
  .has(Eq)
  .then(value === other ? "eq" : "ne") // Eq<T> resolved
  .else("incomparable");
```

The generated code for `T = number` with `Ord<number>`:

```typescript
sort([value, other]); // sort inlined with numericOrd comparator
```

**Why this matters:**

No other language combines type patterns and typeclass dispatch in one expression:

| Language      | Type Dispatch              | Typeclass Dispatch    | Combined            |
| ------------- | -------------------------- | --------------------- | ------------------- |
| Haskell       | Type families              | Typeclass constraints | Separate mechanisms |
| Scala 3       | Match types / inline match | Given instances       | Separate mechanisms |
| Rust          | Monomorphization           | Trait bounds          | Separate mechanisms |
| **typesugar** | **`.case(Type)`**          | **`.has(Typeclass)`** | **Same expression** |

This unification means you can write a single function that handles built-in types via type patterns AND user-defined types via typeclass instances, with the compiler resolving everything at compile time.

### Compile-Time Only vs Runtime Fallback

By default, `matchType<T>()` produces both:

- Monomorphized code at call sites where `T` is known
- A runtime fallback for generic call sites

To require compile-time resolution (error if `T` is unresolvable):

```typescript
// Strict mode — compile error if T can't be resolved
matchType<T>(value, { strict: true })
  .case(String).then(...)
  .case(Number).then(...)
  // No .else() needed — if T is String | Number, it's exhaustive at the type level
```

## Pattern Syntax Alignment with PEP-008

Both type-level and expression-level `matchType` use the `Constructor(binding)` syntax from PEP-008:

| PEP-008 (runtime match) | PEP-010 (type-level matchType) | Meaning               |
| ----------------------- | ------------------------------ | --------------------- |
| `.case(String(s))`      | `.case(String)`                | Value is a string     |
| `.case(Array(a))`       | `.case(Array)`                 | Value is an array     |
| `.case(Some(v))`        | `.case(Some)`                  | Value is Some variant |
| `.case({ name })`       | `{ name: infer N }`            | Has property name     |

In expression-level `matchType`, bindings aren't needed — the whole value is already bound and narrowed. In type-level `matchType`, `infer` plays the role of pattern variables.

## Waves

### Wave 1: Type-Level matchType — Preprocessor (~3 files)

**Tasks:**

- [ ] Add `matchType<T> | pattern => result` syntax to preprocessor scanner
  - Detect `type X = matchType<T>` followed by `|` arms
  - Parse each `| TypePattern => ResultType` clause
  - Handle `infer` keywords in patterns
  - Handle OR patterns (`| string | number => "primitive"`)
- [ ] Transform to nested conditional types:
  - Each `| Pattern => Result` becomes `T extends Pattern ? Result : ...`
  - `_` or `unknown` becomes the terminal else branch
  - OR patterns expand to multiple `extends` checks with the same result
- [ ] Source map generation for transforms
- [ ] Tests: simple patterns, infer, OR, recursive, deeply nested

**Gate:**

- [ ] `matchType<T> | string => "s" | number => "n" | _ => "?"` compiles to correct conditional
- [ ] `infer` works: `| Array<infer U> => U[]` produces `T extends Array<infer U> ? U[] : ...`
- [ ] Recursive types work: `DeepReadonly<T>` compiles and resolves correctly
- [ ] Source maps accurate

### Wave 2: Type-Level matchType — Macro Syntax (~2 files)

**Depends on:** Wave 1

**Tasks:**

- [ ] Implement `MatchType<T, ...Cases>` as a type-level macro in `.ts` files
  - Input: `MatchType<T, [Pattern, Result], [Pattern, Result], ...>`
  - Output: nested conditional type (same as Wave 1)
  - Detect tuple pairs in type arguments, generate `extends` checks
- [ ] Handle `infer` in tuple pattern positions
- [ ] Tests: all patterns from Wave 1 in macro syntax

**Gate:**

- [ ] `MatchType<T, [string, "s"], [number, "n"], [unknown, "?"]>` works
- [ ] Equivalent output to preprocessor syntax

### Wave 3: Expression-Level matchType — Core (~6 files)

**Depends on:** Wave 2, `specialize()` infrastructure

**Tasks:**

- [ ] Implement `matchType<T>(value)` expression macro in `packages/std/src/macros/match-type.ts`
  - Parse `.case(Constructor).then(expr)` chain (subset of PEP-008 fluent API)
  - At definition site: record arms and their type patterns
  - At definition site: emit runtime fallback (typeof/instanceof chain from arm patterns)
- [ ] Call-site monomorphization:
  - Detect calls to functions containing `matchType<T>`
  - Resolve `T` at the call site via `ctx.typeChecker.getTypeAtLocation()`
  - Determine matching arm via `ctx.isAssignableTo(resolvedType, patternType)`
  - Inline only the matching arm's expression, substituting `value`
- [ ] Type narrowing in arms:
  - Generate type assertions so `value` has the narrowed type within each arm
- [ ] Fallback for unresolvable `T`:
  - Auto-generate runtime typeof/instanceof chain from the arms
  - This is essentially PEP-008's type patterns, applied as a safety net
- [ ] Tests: monomorphization at call sites, generic fallback, type narrowing

**Gate:**

- [ ] `matchType<string>(value).case(String).then(value)` at call site emits just `value`
- [ ] `matchType<T>(value)` in generic context emits runtime typeof chain
- [ ] Type narrowing: `.then(value.toUpperCase())` type-checks when case is `String`
- [ ] Exhaustive type-level check: all members of a union are covered

### Wave 4: Typeclass Dispatch — `.has()` (~4 files)

**Depends on:** Wave 3, typeclass infrastructure

**Tasks:**

- [ ] Implement `.has(Typeclass)` arm type in expression-level matchType
  - Parse `.has(TC).then(expr)` in the fluent API
  - At call site: resolve `T`, look up typeclass instance registry for `TC<T>`
  - If instance exists: arm matches, inline body with resolved instance
  - If no instance: skip arm, try next
- [ ] Multiple typeclass constraints: `.has(Show, Ord)`
  - All listed typeclasses must have instances for the arm to match
- [ ] Typeclass method resolution within arm bodies:
  - When arm matches, typeclass method calls in the body (e.g., `show(value)`) are
    resolved to the concrete instance, same as `specialize()` would
- [ ] Preprocessor syntax: `| has Show => ...` and `| has Show & Ord => ...`
  - Extend matchType preprocessor extension to recognise `has` keyword in arms
- [ ] Fallback for unresolvable instances:
  - If `T` is still generic and `.has()` arms exist, the fallback includes
    runtime typeclass dictionary lookup (if available) or skips the arm
- [ ] Tests: single typeclass, multiple typeclasses, priority with type arms,
      instance method inlining, missing instance skips arm

**Gate:**

- [ ] `.has(Show).then(show(value))` inlines concrete `show` at call site where `Show<T>` exists
- [ ] `.has(Show)` arm skipped when `T` has no `Show` instance
- [ ] `.has(Show, Ord)` requires BOTH instances
- [ ] Type arms and typeclass arms compose: first match wins
- [ ] Preprocessor `| has Show => ...` works in `.sts` files

### Wave 5: Strict Mode + Optimization (~3 files)

**Depends on:** Wave 4

**Tasks:**

- [ ] Strict mode: `matchType<T>(value, { strict: true })`
  - Compile error if `T` cannot be resolved at every call site
  - No runtime fallback generated
- [ ] Union splitting: if `T = A | B | C`, verify all members have matching arms
      (type arms and typeclass arms both count)
- [ ] Dead code elimination: if `T = string`, only String arm emitted (no IIFE, no checks)
- [ ] Integration test with `specialize()`: functions using both mechanisms
- [ ] Tests: strict mode errors, union splitting, dead code elimination

**Gate:**

- [ ] Strict mode errors on unresolvable `T` at a call site
- [ ] `matchType<"ok" | "fail">(value)` with two matching arms emits optimal code
- [ ] Functions with both `specialize()` and `matchType<T>()` work correctly

### Wave 6: Documentation (~5 files)

**Depends on:** Wave 5

**Tasks:**

- [ ] Create `docs/guides/match-type.md` with real-world examples:
  - Conditional type sugar (DeepReadonly, Serialize, etc.)
  - Monomorphized generic functions (serialize, deepClone)
  - Typeclass dispatch patterns (format with Show, sort with Ord)
  - Combined type + typeclass dispatch in one function
  - Strict mode for performance-critical code
  - Comparison: when to use `match()` vs `matchType<T>()`
- [ ] Update PEP-008 pattern matching guide to cross-reference `matchType`
- [ ] Update `packages/std/README.md` with matchType exports
- [ ] Add typeclass dispatch examples to typeclass documentation

**Gate:**

- [ ] Documentation covers type-level, expression-level, and typeclass dispatch
- [ ] Cross-references with PEP-008 are clear
- [ ] Typeclass dispatch examples show real advantage over plain type matching

## Files Changed

| File                                                 | Wave | Change                                                                                     |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| `packages/preprocessor/src/extensions/match-type.ts` | 1, 4 | **New** — matchType preprocessor extension (type-level + expression-level + `has` keyword) |
| `packages/std/src/types/match-type.ts`               | 2    | **New** — `MatchType<T, ...Cases>` utility type                                            |
| `packages/std/src/macros/match-type.ts`              | 3–5  | **New** — Expression-level matchType macro (type dispatch + typeclass dispatch)            |
| `packages/std/src/index.ts`                          | 2    | Export MatchType                                                                           |
| `packages/macros/src/specialize.ts`                  | 3    | Integrate matchType with specialization call-site resolution                               |
| `tests/match-type-conditional.test.ts`               | 1–2  | **New** — Type-level matchType tests                                                       |
| `tests/match-type-expression.test.ts`                | 3–5  | **New** — Expression-level matchType tests (incl. typeclass dispatch)                      |
| `docs/guides/match-type.md`                          | 6    | **New** — Guide                                                                            |

## Consequences

### Benefits

1. **Readable conditional types** — flat list of patterns vs deeply nested ternaries
2. **Zero-cost type dispatch** — monomorphized code per call site, no runtime checks
3. **Unified syntax** — same pattern language as PEP-008 runtime match
4. **Typeclass dispatch** — `.has(Show)` resolves typeclass instances at compile time, combining type patterns and typeclass constraints in one expression. No other language does this.
5. **Graceful degradation** — auto-generates runtime fallback for unresolvable generics
6. **Strict mode** — opt-in guarantee that all dispatch is compile-time

### Trade-offs

1. **Two `match` concepts** — users must understand when to use `match(value)` vs `matchType<T>(value)`. Rule of thumb: if the value's type is known at the call site and you want zero-cost dispatch, use `matchType`. If you're matching on runtime data (user input, API responses, dynamic values), use `match`.
2. **Monomorphization code size** — each call site may get a different inlined version. For functions called in many places with many types, this increases bundle size. Mitigated by the runtime fallback (one generic version shared).
3. **Call-site analysis complexity** — the macro must trace call sites and resolve type parameters. This adds compilation time proportional to the number of call sites.
4. **Strict mode adoption** — strict mode is opt-in. Without it, generic call sites silently fall back to runtime checks, which defeats the purpose. Documentation should strongly recommend strict mode for performance-critical code.

### Comparison with Other Languages

| Language      | Type-Level                           | Expression-Level          | Typeclass Dispatch         |
| ------------- | ------------------------------------ | ------------------------- | -------------------------- |
| TypeScript    | Conditional types (nested ternaries) | N/A (types erased)        | N/A                        |
| Scala 3       | Match types                          | Inline match              | Separate (`given`/`using`) |
| Rust          | N/A                                  | Monomorphization          | Separate (trait bounds)    |
| C++           | Template specialization              | `if constexpr`            | Separate (concepts/SFINAE) |
| Haskell       | Type families                        | N/A (dictionary passing)  | Separate (constraints)     |
| **typesugar** | **`matchType<T>`**                   | **`matchType<T>(value)`** | **`.has(TC)` — unified**   |

Scala 3's `inline match` is the closest analogue for expression-level dispatch. But no language unifies type patterns and typeclass instance checks in a single match expression. In Haskell, Scala, and Rust, you either match on types OR constrain by typeclasses — they're separate mechanisms with separate syntax. typesugar's `.has()` makes them peers in the same dispatch chain, resolved at compile time.
