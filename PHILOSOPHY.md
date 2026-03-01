# typesugar Philosophy

**Zero-cost abstractions through compile-time transformation.**

This document captures the design principles that guide typesugar development, distilled from building real systems and learning what works.

---

## Core Principle: Zero-Cost Abstractions

The central philosophy: **abstractions should have no runtime cost**.

TypeScript developers often face a choice between expressive, type-safe code and fast, minimal code. typesugar eliminates this trade-off. Write beautiful, abstract code; the macro system compiles it down to what you would have written by hand.

### What "zero-cost" means

- **No dictionary passing** -- Typeclass methods are inlined at call sites, not looked up through objects
- **No wrapper types** -- HKT encoding exists only in the type system; at runtime, `$<OptionF, number>` is just `Option<number>`
- **No indirection** -- Generic code compiles to direct calls, not chains of `.map()` and `.flatMap()` on wrapper objects
- **No closure allocation** -- Comprehension macros emit flat code, not nested callbacks

### What it looks like in practice

```typescript
interface Point {
  x: number;
  y: number;
}

const p1: Point = { x: 1, y: 2 };
const p2: Point = { x: 1, y: 2 };

// You write:
p1 === p2;

// Compiles to:
p1.x === p2.x && p1.y === p2.y;
```

No `Eq` instance was declared. No `@derive` annotation was written. The compiler saw `===` on a `Point`, auto-derived structural equality from the type's fields, and inlined the comparison directly. The typeclass abstraction exists at author-time. At runtime, it's gone.

The same applies to generic code:

```typescript
// You write:
function double<F>(fa: $<F, number>, F: Monad<F>): $<F, number> {
  return F.map(fa, (x) => x * 2);
}
double(Some(21));

// Compiles to:
isSome(Some(21)) ? Some(Some(21).value * 2) : None;
```

The generic function, the Monad dictionary, the `map` method -- all gone. What remains is the concrete option check you would have written by hand.

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

HKT encoding in typesugar has evolved through three generations, each simpler than the last.

**First generation** (URI branding -- fp-ts style):

```typescript
interface HKTRegistry {}
type Kind<F, A> = F extends { __hkt_uri__: infer URI }
  ? URI extends keyof HKTRegistry
    ? (HKTRegistry[URI] & { __arg__: A })["type"]
    : never
  : never;
```

This required brand interfaces, module augmentation, registry population, and `as unknown as` casts everywhere.

**Second generation** (indexed access):

```typescript
type $<F, A> = (F & { readonly _: A })["_"];

interface OptionF {
  _: Option<this["_"]>;
}
```

Simpler -- no registry, no module augmentation. But `$<F, A>` forced TypeScript to eagerly compute the result type via indexed access, which slowed down type checking on large codebases.

**Current generation** (phantom kind markers):

```typescript
type Kind<F, A> = F & { readonly __kind__: A };
```

`Kind<F, A>` is just an intersection type. TypeScript stores it without recursive computation -- no indexed access, no conditional types, no registry. The preprocessor resolves known type functions (`Kind<OptionF, number>` → `Option<number>`) while leaving generic usages unchanged.

The type-level functions look similar but use the phantom marker:

```typescript
interface OptionF extends TypeFunction {
  _: Option<this["__kind__"]>;
}
```

And users write natural `F<A>` syntax that the preprocessor converts to `Kind<F, A>`:

```typescript
// You write:
interface Functor<F<_>> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

// Preprocessor emits:
interface Functor<F> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}
```

**Lesson**: Each generation fought TypeScript less. The current design is just an intersection type -- the simplest possible encoding. Complex encodings usually mean we're fighting the language instead of using it.

---

## Reflection Over Boilerplate

With compile-time type checker access, the macro can figure out what the programmer would otherwise have to specify manually.

### Pattern matching without tags

Traditional discriminated unions require manual tags:

```typescript
type Shape = { kind: "circle"; radius: number } | { kind: "rect"; width: number; height: number };
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

### Auto-derivation as the default

In Haskell and Scala 3, deriving typeclass instances requires explicit annotation (`deriving` clauses, `derives` keywords). typesugar goes further: **auto-derivation is the default, not opt-in**.

The compiler treats every type as derivable unless told otherwise. When it sees `p1 === p2` on a `Point`, it doesn't look for an explicit `Eq<Point>` instance first and give up if there isn't one. Instead:

1. Check for an explicit `@instance` -- use it if found (custom behavior wins)
2. Check for an explicit `@deriving` -- use the generated instance if found
3. **Auto-derive via the type checker** -- inspect the type's fields, verify all fields have instances, synthesize an implementation on the spot
4. Report a compile error with a resolution trace if derivation is impossible

Step 3 is what makes typesugar feel different. The programmer never writes `@derive(Eq)` on `Point`. They just use `===`, and the compiler figures it out:

```typescript
interface Point {
  x: number;
  y: number;
}

p1 === p2; // Auto-derived: p1.x === p2.x && p1.y === p2.y
p1.show(); // Auto-derived: `Point(x = ${p1.x}, y = ${p1.y})`
p1.clone(); // Auto-derived: { x: p1.x, y: p1.y }
```

`@derive(Eq, Show, Clone)` still exists, but its role is **documentation**, not activation. It says "this type supports these capabilities" to human readers. The compiler would derive them anyway.

This is the Scala 3 Mirror model taken to its logical conclusion: if the type checker can see the structure of a type, and all its constituent parts have the required instances, the compiler should just do it.

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

### Auto-specialization as the default

Auto-derivation answers "where does the instance come from?" Auto-specialization answers "what happens to it at the call site?"

In a traditional dictionary-passing FP system, even after resolving the correct instance, the runtime still calls methods through an object: `eqPoint.equals(p1, p2)`. The object allocation exists. The method dispatch is indirect. The abstraction has a cost.

typesugar's default is to **inline the method body at every call site**. When the compiler resolves `Eq<Point>`, it doesn't emit a reference to an `eqPoint` object -- it emits the comparison directly:

```typescript
// What the compiler resolves:     Eq<Point> with equals = (a, b) => a.x === b.x && a.y === b.y
// What it emits:                  p1.x === p2.x && p1.y === p2.y
```

This is the zero-cost guarantee made concrete. The typeclass system is a compile-time organizational tool -- it determines _what_ code to generate. But the generated code contains no trace of the typeclass abstraction. No dictionary objects. No method lookups. No indirection.

The same principle applies to generic code. When `double(Some(21))` is compiled, the compiler doesn't just fill in the `Monad<OptionF>` dictionary -- it inlines `map`, sees the concrete `Option` type, and emits the `isSome` check directly. The generic function ceases to exist at runtime.

This is what Rust calls monomorphization, applied to typeclass dispatch. The abstraction is real at author-time and gone at run-time.

### Progressive disclosure

The defaults (auto-derive, auto-specialize, implicit resolution) mean most users never think about the machinery. But for library authors or performance-sensitive code, every layer is accessible:

| Level                     | What you write                      | Who it's for                          |
| ------------------------- | ----------------------------------- | ------------------------------------- |
| Just use it               | `p1 === p2`, `p1.show()`            | Everyone                              |
| Explicit derivation       | `@deriving(Eq, Show)`               | Documentation, making intent explicit |
| Explicit instance         | `@instance const eq: Eq<T> = {...}` | Custom behavior                       |
| Explicit specialization   | `fn.specialize(dict)`               | Named specialized functions           |
| Manual dictionary passing | `double(optionMonad, x)`            | Full control, no magic                |

Each level adds visibility into what the compiler is doing. None of them are required -- the system defaults to the most automatic option and lets you take control when you want to.

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
- Duplicated the `match` macro from `@typesugar/std`
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

typesugar exists to prove that TypeScript developers don't have to choose between expressiveness and performance. Through compile-time transformation:

- **Everything works by default** -- Auto-derivation and auto-specialization mean you write `p1 === p2` and the compiler handles the rest. No annotations, no imports, no ceremony.
- **Abstract code becomes concrete** -- Generics resolve, dictionaries inline, method bodies are substituted at call sites. The abstraction exists at author-time and is gone at runtime.
- **Type information drives code generation** -- The compiler reads your types and generates optimal code from their structure. Reflection replaces boilerplate.
- **The type system does more work** -- Native encodings over complex tricks. If TypeScript already handles it, don't build machinery around it.
- **What runs is what you'd write by hand** -- If you had infinite patience and perfect knowledge of every type in your program.

Zero-cost abstractions aren't a feature. They're the philosophy.
