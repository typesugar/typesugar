# Zero-Cost Specialization

Compile-time specialization eliminates typeclass dictionary passing from
generic functions — similar to GHC's `SPECIALIZE` pragma or Rust's
monomorphization, but **always on and fully automatic** (PEP-053). There is no
macro to call, no annotation to add, and no package to install: any call that
passes a known typeclass instance is specialized by the transformer, with the
instance's method bodies inlined directly at the call site.

## How It Works

Write generic, dictionary-passing code as usual:

```typescript
interface Ord<A> {
  compare(a: A, b: A): number;
}

/** @impl Ord<number> */
const numberOrd: Ord<number> = {
  compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

function sortWith<A>(items: A[], ord: Ord<A>): A[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}
```

Calling it with a known instance auto-specializes the call:

```typescript
sortWith([3, 1, 2], numberOrd);

// Compiles to (dictionary gone, comparator inlined):
__sortWith_number__([3, 1, 2]);
// where the hoisted __sortWith_number__ is:
// (items) => items.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
```

The transformer:

1. Recognizes that an argument is a typeclass instance whose method bodies it
   knows (see below).
2. Resolves the called function's body.
3. Rewrites the body, replacing every `dict.method(...)` call with the
   instance's actual implementation, and removes the dictionary parameter.
4. Hoists the specialized function to module scope (with a `/*#__PURE__*/`
   annotation for tree-shaking) and **deduplicates**: every call site pairing
   the same function with the same instances reuses one hoisted definition.

Multiple dictionaries work the same way — `sortAndShow(items, ordNumber,
showNumber)` specializes on both at once.

### Which instances are recognized

- Instances declared with `/** @impl TC<T> */` (or `@instance`), or with an
  explicit typeclass type annotation (`const x: Functor<F> = { ... }`), whose
  object-literal bodies the transformer can read from source — including
  instances imported from other modules (renamed imports too), identifier
  aliases (`const stdFlatMapArray = flatMapArray`), zero-arg factory instances
  (`eitherFunctor<E>()`), members that reference other instances
  (`map: optionFunctor.map`, shorthand `{ map }`), and companion paths
  (`Point.Numeric`).
- The built-in std/fp/effect instances (Array/Option/Either/Promise functors
  and monads, FlatMap instances, etc.).
- Primitive instances (`eqNumber`, `ordString`, ...) inline to native
  operators (`a === b`, `a < b`) rather than function calls.

One safety rule for cross-module instances: a method body that references its
own module's local helpers or imports is not inlined (the identifiers wouldn't
exist at your call site) — that call keeps dictionary passing, which is always
correct, just not zero-cost. Methods with self-contained bodies still
specialize.

### With `= implicit()`

`= implicit()` composes with auto-specialization: the transformer first fills
in the instance argument, and the filled-in call then specializes like any
other.

```typescript
function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

sortWith([3, 1, 2]); // instance resolved AND inlined automatically
```

## When Specialization Is Skipped

The transformer only inlines what it can prove sound. A call falls back to
dictionary passing — semantically identical, just not inlined — and emits a
[TS9602](/guides/error-messages#auto-specialization-skipped-ts9602) warning
when the function body:

- can't be resolved (e.g. the function comes from an untyped/dynamic source —
  declare it as a `const` arrow function or a named `function`);
- contains a loop, `try/catch`, a `throw`, or mutable `let` bindings;
- has early/multiple returns that can't be flattened into a single expression
  (simple guard-clause chains _are_ flattened into ternaries).

Result-returning functions get one extra trick: **return-type-driven
specialization** rewrites `ok()`/`err()` constructors when a `Result`-typed
function is used where an `Option`, `Either`, or `Promise` is expected.

## Opting Out

Specialization is on by default; opt out per call with a comment on the same
line (before the call) or on its own comment line directly above:

```typescript
// @no-specialize
const slow = sortWith([3, 1, 2], numberOrd); // keeps dictionary passing

const alsoSlow = /* @no-specialize */ sortWith([3, 1, 2], numberOrd);
```

To keep specialization but silence a TS9602 skip warning, use
`// @no-specialize-warn` in the same positions.

The file/function/line-level [opt-out directives](/guides/opt-out)
(`"use no typesugar"`, `// @ts-no-typesugar`) also disable specialization
along with everything else.

## Verifying Zero Cost

Check the compiled output — the [playground](https://typesugar.org/playground)
shows it side by side, and [Zero-Cost, Seen](/guides/zero-cost) walks through
real examples. The hoisted `__fn_Brand__` constants with `/*#__PURE__*/`
annotations are the specializations; grep your build output for the original
dictionary parameter to confirm it's gone.

## Learn More

- [Typeclasses Guide](/guides/typeclasses) — defining typeclasses and instances
- [Error Messages Guide](/guides/error-messages) — TS9602 and friends
- [Macro Triggers Reference](/macro-triggers) — where auto-specialization runs
  in the pipeline
