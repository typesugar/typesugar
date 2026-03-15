# typesugar Philosophy

**Zero-cost abstractions through compile-time transformation.**

This document captures the design principles that guide typesugar development, distilled from building real systems and learning what works.

---

## Core Principle: Zero-Cost Abstractions

The central philosophy: **abstractions should have no runtime cost**.

TypeScript developers often face a choice between expressive, type-safe code and fast, minimal code. typesugar eliminates this trade-off. Write beautiful, abstract code; the macro system compiles it down to what you would have written by hand.

### What "zero-cost" means

- **No dictionary passing** -- Typeclass methods are inlined at call sites, not looked up through objects
- **No wrapper types** -- HKT encoding exists only in the type system; at runtime, `Kind<OptionF, number>` is just `Option<number>`
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
function double<F>(fa: Kind<F, number>, F: Monad<F>): Kind<F, number> {
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

TypeScript lacks higher-kinded types. `Option` is `* -> *` (a type constructor that takes one type argument), but TypeScript has no way to express "a type parameter that itself takes type arguments." You can't write `F<A>` where `F` is a type parameter.

Or can you?

### The key insight: `F<A>` is valid syntax

`F<A>` where `F` is a type parameter **parses correctly** in TypeScript. It produces a clean AST with zero parse errors. TypeScript's type checker will later reject it with TS2315 ("Type 'F' is not generic"), but by then the AST is fully formed.

The type error IS the signal. If a `TypeReferenceNode`'s identifier matches a type parameter of any enclosing scope and has type arguments, it's an HKT usage. The transformer rewrites it before the type checker sees it.

This means users write natural code:

```typescript
/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}
```

The transformer rewrites `F<A>` to `Kind<F, A>` -- the internal encoding. Users never see or think about `Kind`.

### The encoding underneath

The encoding has evolved through three generations, each fighting TypeScript less:

1. **URI branding** (fp-ts style) -- Registry interfaces, module augmentation, `as unknown as` casts everywhere. Complex and fragile.

2. **Indexed access** -- `type Kind<F, A> = (F & { readonly _: A })["_"]`. Simpler, but forced TypeScript to eagerly compute result types. Slow on large codebases.

3. **Phantom kind markers** (current) -- `type Kind<F, A> = F & { readonly __kind__: A }`. Just an intersection type. No computation, no recursion, no registry. TypeScript stores it lazily.

The current encoding is the simplest possible: an intersection type that tags the type constructor with its argument. The preprocessor resolves known applications (`Kind<OptionF, number>` → `Option<number>`) while leaving generic usages unchanged.

### The tier system

HKT usage falls into tiers, from most automatic to most manual:

| Tier | What you write                                          | What happens                                                           |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0    | `F<A>` in typeclass bodies                              | Transformer rewrites to `Kind<F, A>` (pure syntax, no TypeChecker)     |
| 1    | `@impl Functor<Option>`                                 | Macro resolves `Option` via TypeChecker, generates encoding internally |
| 2    | `/** @hkt */ type OptionF = Option<_>`                  | Macro generates the `TypeFunction` interface from a one-liner          |
| 3    | Manual `interface OptionF extends TypeFunction { ... }` | Full control, escape hatch                                             |

Most users stay at Tier 0 and 1. They write `F<A>` in typeclass definitions and `@impl Functor<Option>` for instances. No `OptionF`, no `TypeFunction`, no `Kind`, no `_` marker. The machinery is invisible.

Tier 2 and 3 exist for library authors who need to define type-level functions for new types. Even there, the `@hkt` macro reduces it to a single line.

**Lesson**: The encoding matters (it determines type-checking performance), but the user should never see it. Each tier is an escape hatch that progressively reveals the machinery -- but the default is full automation.

### The build-tooling trade-off

typesugar's HKT workflow requires build tooling -- the `F<A>` rewriting and `@impl` resolution happen in the transformer. Libraries like fp-ts and Effect-TS work in vanilla TypeScript with no preprocessing.

However, the setup cost is minimal for production codebases with existing build systems (Vite, esbuild, webpack). And the ergonomic payoff is significant -- compare:

```typescript
// typesugar: just write it
/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

/** @impl Functor<Option> */
const optionFunctor = { map: (fa, f) => fa === null ? null : f(fa) };

// fp-ts: manual URI branding + module augmentation
declare module "fp-ts/HKT" { interface URItoKind<A> { Option: Option<A> } }
const URI = "Option";
type URI = typeof URI;
interface Functor<F extends URIS> { map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B> }
const Functor: Functor1<URI> = { URI, map: (fa, f) => ... };
```

The `F<A>` rewrite works in IDE, bundlers, and `tsc` + ts-patch. For `.sts` files, the preprocessor handles `F<_>` syntax. For raw `tsc` without ts-patch, users can write `Kind<F, A>` directly.

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
function double<F>(F: Monad<F>, fa: Kind<F, number>): Kind<F, number> {
  return F.map(fa, (x) => x * 2);
}

// Every call site must provide the dictionary:
double(optionMonad, Some(21));
double(arrayMonad, [1, 2, 3]);
```

### Implicit resolution + auto-specialization

```typescript
function double<F>(fa: Kind<F, number>, F: Monad<F> = implicit()): Kind<F, number> {
  return F.map(fa, (x) => x * 2);
}

// Macro infers F from the argument type, summons the instance, specializes:
double(Some(21)); // Compiles to: isSome(Some(21)) ? Some(Some(21).value * 2) : None
```

The `= implicit()` default parameter marker is typesugar's equivalent of Scala 2's `implicit` keyword on individual parameters. TypeScript doesn't support multiple parameter lists (Scala 3's `using` clauses), so `= implicit()` is the natural encoding -- it's valid TypeScript, self-documenting, and the transformer resolves it at compile time. Callers can always override by passing the argument explicitly.

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

## Extension Methods: UFCS for TypeScript

Scala 3's extension methods let you call `xs.second` instead of `second(xs)`. typesugar brings this to TypeScript with zero overhead.

### The rule is simple

Any function whose first parameter matches the receiver type can be called as a method:

```typescript
import { clamp, isEven } from "@typesugar/std";

// These are just functions: clamp(n: number, min: number, max: number): number
// But you can call them as methods:
n.clamp(0, 100); // → clamp(n, 0, 100)
(7).isEven(); // → isEven(7)
```

The transformer rewrites `n.clamp(0, 100)` to `clamp(n, 0, 100)` -- a direct function call. No method lookup, no prototype pollution, no monkey patching.

### "use extension" for library authors

Mark a file so all its exports become extension methods:

```typescript
"use extension";

export function distance(p: Point, other: Point): number {
  return Math.sqrt((p.x - other.x) ** 2 + (p.y - other.y) ** 2);
}

// Users can now write: p1.distance(p2)
```

This is opt-in at the module level. The directive says "all functions here are designed to be called as methods on their first parameter."

### Resolution order

When you write `x.foo()`:

1. **Native property** -- If `x` has a property `foo`, use it
2. **Extension functions** -- If an imported function `foo` takes `x`'s type as its first param, rewrite to `foo(x)`
3. **Typeclass methods** -- If a typeclass provides `foo` for `x`'s type, use the derived instance

Extensions take priority over typeclasses because concrete functions (like `head(arr: A[])`) are more specific than generic typeclass versions (like `head(s: S, SQ: Seq<S, A>)`).

### Why this matters

JavaScript has a tradition of extending prototypes:

```javascript
Array.prototype.head = function () {
  return this[0];
};
```

This is dangerous -- it modifies globals, breaks encapsulation, and causes conflicts between libraries. typesugar's extension methods achieve the same ergonomics without these problems:

- **Scoped** -- Extensions only work where imported
- **Conflict-free** -- Two libraries can define `head` differently
- **Zero-cost** -- Compiles to direct function calls
- **Type-safe** -- The type checker verifies the first parameter matches

This is Scala 3's `extension` syntax, adapted to TypeScript's module system.

---

## SFINAE: Substitution Failure Is Not An Error

typesugar's macro system rewrites code at compile time, but TypeScript's type checker runs on the original source. This creates a gap: the type checker reports errors that the transformer will resolve. These are phantom errors -- valid from TypeScript's perspective, invalid from typesugar's.

C++ templates solved the same class of problem with SFINAE: when template argument substitution produces an invalid type, the compiler silently removes that candidate instead of reporting an error. The substitution "failed," but it's not an error -- it's information that guides resolution.

typesugar applies the same principle. When TypeScript reports an error at a site where the macro system has a valid rewrite, the error is suppressed:

```typescript
import { clamp } from "@typesugar/std";

// TypeScript: "Property 'clamp' does not exist on type 'number'" (TS2339)
// typesugar:  clamp(n, ...) is imported and its first param matches → not an error
n.clamp(0, 100);
```

```typescript
type UserId = Newtype<number, "UserId">;

// TypeScript: "Type 'number' is not assignable to type 'UserId'" (TS2322)
// typesugar:  UserId is a newtype over number → runtime identity → not an error
const id: UserId = 42;
```

### What makes this principled

SFINAE is not blanket diagnostic suppression. Each suppression is justified by a specific rewrite rule:

1. **Extension methods** -- A function with matching first parameter is in scope → TS2339 suppressed
2. **Newtype assignment** -- Source matches the newtype's base type → TS2322/TS2345 suppressed
3. **Opaque type boundaries** -- Source matches the opaque type's underlying representation → TS2322/TS2345 suppressed
4. **Macro-generated code** -- Diagnostic position doesn't map to original source → suppressed

If no rule matches, the error stands. The system is auditable: `--show-sfinae` prints every suppressed diagnostic with its justification.

### Why not just fix the types?

For some cases, we can. Global augmentations (`interface Number { clamp(): number }`) make TypeScript happy about extension methods on concrete types. Type macros (`@opaque`) make TypeScript happy about methods on FP types.

But there will always be edges where the type checker and the transformer disagree. SFINAE is the general safety net that bridges those edges without ad-hoc workarounds.

---

## Type Macros: Rich Types, Cheap Runtime

typesugar's existing macros operate on expressions and declarations. Type macros extend this to types themselves: define how a type appears to the type checker while controlling its runtime representation.

### The problem

Zero-cost types face a fundamental tension. `Option<A> = A | null` is zero-cost at runtime (no wrapper allocation), but it loses all methods -- you can't write `x.map(f)` because `null` has no properties. Making `Option` a class gives you methods but costs a wrapper allocation for every value.

Other languages resolve this:

- **Scala 3** -- `opaque type` aliases are transparent inside the companion, opaque outside, with extension methods adding the API surface
- **Rust** -- `newtype` pattern with `Deref` and trait implementations
- **Haskell** -- `newtype` with automatic coercions

### The solution

A type macro annotates a type definition and registers a rewrite:

```typescript
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>;
  flatMap<B>(f: (a: A) => Option<B>): Option<B>;
  getOrElse(defaultValue: () => A): A;
  // ...
}
```

TypeScript sees an interface with methods. Type inference works. IDE completions work. But the transformer erases everything:

- `x.map(f)` → `map(x, f)` (standalone function call)
- `Some(5)` → `5` (constructor erasure)
- `None` → `null` (constant erasure)

The runtime representation is `A | null`. The methods exist only at author-time.

### Transparent scope

Within the file that defines the `@opaque` type, the underlying representation is visible -- Scala 3 semantics. This lets implementations use natural patterns:

```typescript
// Inside option.ts -- transparent scope
export function map<A, B>(o: Option<A>, f: (a: A) => B): Option<B> {
  return o === null ? null : f(o); // Just works -- Option<A> is A | null here
}
```

Outside the defining file, `Option<A>` is opaque -- you interact through its methods.

### Implicit conversions

Assignment between an `@opaque` type and its underlying representation is free, handled by SFINAE:

```typescript
const nullable: number | null = fetchValue();
const opt: Option<number> = nullable; // No error, no ceremony, no fromNullable()
const back: number | null = opt; // Same in reverse
```

At runtime, all three variables hold the same value. The type boundary exists only in the type checker.

### Beyond Option

The infrastructure is general. Any "rich interface, cheap runtime" pattern benefits:

```typescript
/** @opaque number */
interface Meters {
  add(other: Meters): Meters;
  scale(factor: number): Meters;
  toFeet(): number;
}

/** @opaque () => A */
interface IO<A> {
  map<B>(f: (a: A) => B): IO<B>;
  flatMap<B>(f: (a: A) => IO<B>): IO<B>;
  run(): A;
}
```

Newtypes get methods. Effect types get fluent APIs. All zero-cost.

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
- **Types have two faces** -- Type macros let types appear rich to the type checker (with methods, constraints, APIs) while erasing to cheap representations at runtime. SFINAE handles the seams.
- **What runs is what you'd write by hand** -- If you had infinite patience and perfect knowledge of every type in your program.

Zero-cost abstractions aren't a feature. They're the philosophy.
