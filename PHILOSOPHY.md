# ttfx Philosophy

**Zero-cost abstractions through compile-time transformation.**

This document captures the design principles that guide ttfx development, distilled from building real systems and learning what works.

---

## Core Principle: Zero-Cost Abstractions

The central philosophy: **abstractions should have no runtime cost**.

TypeScript developers often face a choice between expressive, type-safe code and fast, minimal code. ttfx eliminates this trade-off. Write beautiful, abstract code; the macro system compiles it down to what you would have written by hand.

### What "zero-cost" means

- **No dictionary passing** -- Typeclass methods are inlined at call sites, not looked up through objects
- **No wrapper types** -- HKT encoding exists only in the type system; at runtime, `$<OptionF, number>` is just `Option<number>`
- **No indirection** -- Generic code compiles to direct calls, not chains of `.map()` and `.flatMap()` on wrapper objects
- **No closure allocation** -- Comprehension macros emit flat code, not nested callbacks

### The `specialize` macro as embodiment

```typescript
// You write:
function double<F>(F: Monad<F>, fa: $<F, number>): $<F, number> {
  return F.map(fa, (x) => x * 2);
}
const result = specialize(double, optionMonad)(Some(21));

// Compiles to:
const result = isSome(Some(21)) ? Some(Some(21).value * 2) : None;
```

The abstraction (Monad, generic F) exists at author-time. At runtime, it's gone.

---

## Compile-Time Over Runtime

Macros can do things that runtime code cannot:

1. **Read the type system** -- `ctx.typeChecker` gives access to TypeScript's full type information
2. **Generate optimal code** -- Different code paths for different types, with no runtime branching
3. **Eliminate impossible states** -- Catch errors before the code ever runs
4. **Inline everything** -- No function call overhead for hot paths

### When to use a macro vs runtime code

| Use a macro when...                      | Use runtime code when...              |
| ---------------------------------------- | ------------------------------------- |
| The information is known at compile time | The information comes from user input |
| You're eliminating boilerplate           | You're implementing business logic    |
| You need to inspect types                | Types don't affect behavior           |
| Performance is critical                  | Readability trumps performance        |

---

## Native TypeScript Over Encoding Tricks

TypeScript's type system is more capable than it appears. Before reaching for complex encodings, ask: "Does TypeScript already do this?"

### The HKT lesson

**Old approach** (URI branding):

```typescript
interface HKTRegistry {}
type Kind<F, A> = F extends { __hkt_uri__: infer URI }
  ? URI extends keyof HKTRegistry
    ? (HKTRegistry[URI] & { __arg__: A })["type"]
    : never
  : never;

interface OptionHKT {
  readonly __hkt_uri__: "Option";
}
declare module "./hkt" {
  interface HKTRegistry {
    Option: { type: Option<any> };
  }
}
```

This required: brand interfaces, module augmentation, registry population, `as unknown as` casts everywhere.

**New approach** (indexed access):

```typescript
type $<F, A> = (F & { readonly _: A })["_"];

interface OptionF {
  _: Option<this["_"]>;
}
```

This is:

- Natively understood by TypeScript
- Zero runtime overhead
- No casts needed -- `$<OptionF, number>` _is_ `Option<number>`
- No registry to maintain

**Lesson**: Complex encoding often means we're fighting TypeScript instead of using it. The simpler solution usually exists.

---

## Reflection Over Boilerplate

With compile-time type checker access, the macro can figure out what the programmer would otherwise have to specify manually.

### Pattern matching without tags

Traditional discriminated unions require manual tags:

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number };
```

With reflection, the macro can:

1. Inspect the union type via `type.isUnion()` and `type.types`
2. Find distinguishing features (unique properties, class constructors, literal types)
3. Generate optimal dispatch (`instanceof`, `in`, `typeof`, `===`)

The programmer writes:

```typescript
match(shape, {
  Circle: s => ...,
  Rect: s => ...,
});
```

The macro figures out how to discriminate.

### Auto-derivation

Instead of manually implementing Eq, Show, Clone for every type, reflect on the structure and generate implementations:

```typescript
@derive(Eq, Show, Clone)
class Point {
  x: number;
  y: number;
}

// Macro reads fields via typeChecker.getPropertiesOfType()
// Generates: Eq compares x and y; Show prints them; Clone copies them
```

---

## Implicit Resolution Over Explicit Dictionary Passing

The most ergonomic FP code doesn't require manually threading typeclass dictionaries.

### The problem with explicit dictionaries

```typescript
function double<F>(F: Monad<F>, fa: $<F, number>): $<F, number> {
  return F.map(fa, (x) => x * 2);
}

// Every call site must provide the dictionary:
double(optionMonad, Some(21));
double(arrayMonad, [1, 2, 3]);
```

### Implicit resolution + auto-specialization

```typescript
function double<F>(fa: $<F, number>, F: Monad<F>): $<F, number> {
  return F.map(fa, (x) => x * 2);
}

// Macro infers F from the argument type, summons the instance, specializes:
double(Some(21)); // Compiles to: isSome(Some(21)) ? Some(Some(21).value * 2) : None
```

The dictionary parameter exists for the type checker. The macro eliminates it, summons the correct instance, and inlines the methods.

---

## Drop What Doesn't Deliver

Not every abstraction earns its keep. Be willing to remove code that:

- Claims to do something it doesn't actually accomplish
- Duplicates functionality that exists elsewhere
- Adds complexity without proportional value

### The GADT lesson

The `gadt.ts` module claimed to provide Generalized Algebraic Data Types. GADTs are valuable because they narrow type parameters when you match on variants -- when you see `tag: "Num"` in an `Expr<A>`, the type system should know `A = number`.

The implementation:

- Did not actually narrow type parameters
- Required wrapper types and manual registration
- Duplicated the `match` macro from `@ttfx/fp`
- Was strictly less capable than native TypeScript discriminated unions

**Decision**: Drop it entirely. Document real GADTs (with type-parameter narrowing via type-checker integration) as a future project worth doing properly.

The lesson isn't "don't build ambitious features." It's "be honest about what you've built, and delete what doesn't work."

---

## Design Heuristics

### Before adding a feature, ask:

1. **Can TypeScript do this natively?** If yes, use TypeScript.
2. **Does this have runtime cost?** If yes, can a macro eliminate it?
3. **Does this require boilerplate?** If yes, can reflection generate it?
4. **Is the abstraction zero-cost?** If no, reconsider the design.
5. **Does this actually work?** If no, don't ship it.

### The ideal macro:

- **Invisible when correct** -- Users write natural code; the macro handles the rest
- **Loud when wrong** -- Compile-time errors with clear messages, not runtime surprises
- **Zero runtime footprint** -- All the magic happens before the code runs
- **Composable** -- Works with other macros and TypeScript features

---

## Summary

ttfx exists to prove that TypeScript developers don't have to choose between expressiveness and performance. Through compile-time transformation:

- **Abstract code becomes concrete** -- Generics resolve, dictionaries inline
- **Type information drives code generation** -- Reflection replaces boilerplate
- **The type system does more work** -- Native encodings over complex tricks
- **What runs is what you'd write by hand** -- If you had infinite patience

Zero-cost abstractions aren't a feature. They're the philosophy.
