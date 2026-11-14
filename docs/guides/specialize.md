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
__typesugar___sortWith_number_0__([3, 1, 2]);
// where the hoisted function, at the top of the module, is:
// const __typesugar___sortWith_number_0__ = /*#__PURE__*/ items => {
//   return items.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// };
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

- Instances declared with `/** @impl TC<T> */`, or with an
  explicit typeclass type annotation (`const x: Functor<F> = { ... }`), whose
  object-literal bodies the transformer can read from source — including
  instances imported from other modules (renamed imports too), identifier
  aliases (`const stdFlatMapArray = flatMapArray`), zero-arg factory instances
  (`eitherFunctor<E>()`), members that reference other instances
  (`map: optionFunctor.map`, shorthand `{ map }`), and companion paths
  (`Point.Numeric`).
- An instance the compiler only sees as a declaration, because it comes from
  a package's compiled `.d.ts`, is **not** specialized: the declaration has
  no method bodies to inline. That covers the instances `@typesugar/std`,
  `@typesugar/fp` and `@typesugar/effect` ship (`ordNumber`, `eqString`,
  `optionFunctor`, ...) and a library's `@derive` companions (`Point.Eq`).
  The call keeps dictionary passing, which is correct, and warns
  [TS9602](/errors/TS9602) so the
  cost is visible. For a hot path, declare the instance in your own source
  (`/** @impl Ord<number> */ const numberOrd = { ... }`, or
  `derived<Eq<Point>>()` for a type you don't own).

One safety rule for cross-module instances: a method body is inlined only
where every name it uses resolves, at your call site, to the same declaration
it does in the instance's module. A body that references its own module's
local helpers or imports is not inlined (the identifiers wouldn't exist at
your call site): that call goes through the instance, which is always
correct, just not zero-cost, and warns TS9602 naming the identifier
(`the method's body uses 'compareNumber', which is not in scope here`). A
name the body uses as a value must be a value at your call site: a class you
import only as a type (`import type { Pt }`, `import { isPt, type Pt }`, or
through an `export type` re-export) emits no binding, so `isPt.make(3)` is
not inlined as `new Pt(3)` there.
Inlining keeps the call's meaning: each argument is evaluated once, in order,
even when the body uses it twice, out of order, or not at all, and a body
that needs its receiver (`this`, `arguments`) or is a generator is not
inlined. An `async` method is applied in place as an async arrow,
`(async (a) => body)(x)`, which is the call itself (same promise, same
timing). Default, rest and destructured parameters are inlined
directly where that is exact (`(a, b, sep = ",") => a + sep + b` called with
two arguments becomes `a + "," + b`, `({ x, y })` over a variable `p` reads
`p.x` and `p.y`, `(...xs) => xs.length` becomes `[1, 2, 3].length`).
Otherwise the method is applied in place, `((p) => body)(arg)`: still no
dictionary lookup, and the same evaluation as the call.
Methods with self-contained bodies still specialize. The same goes for a
method whose body calls a macro (say, a recursive `clone` that calls
`summon<Clone<Tree>>()`): its source is not yet expanded, so it is called
through the instance instead of inlined.

An inlined body's type annotations follow the same rule, so the expansion
type-checks (`typesugar check --strict`) and the `.d.ts` emitted from it has
the types the source has. A type the call site doesn't import is written
through an import type (`({ x: 1 }) as import("./ord.js").P`), and the
method's own type parameter (`A` in `o as unknown as A`) as the call
instantiates it (`o as unknown as number`). A type that can't be named there
(an interface private to the instance's module, or a type parameter the call
doesn't instantiate) keeps the call going through the instance. Nothing is
ever written as `any`. An exported declaration an inlined call initializes
(`export const r = mapArr.map(xs, f)`, or a function returning one) is
declared with the type the source gives it, the typeclass member's (`r:
unknown` when `map` is declared to return `unknown`), not the inlined body's
narrower one (`number[]`), unless that type can't be named at the
declaration (a class local to the function, a class expression's own
`typeof`): then it keeps the type the expansion infers. An
argument whose type is narrower than its parameter's (`extract(Nil)`,
`Nil: null`, for `l: List<A>`) is substituted as it is when the body reads
the parameter once; when the body reads it more than once, its own tests
(`l != null ? l.head : …`) would narrow the argument to `never`, so that call
goes through the instance too.

When every use of an imported instance is inlined, its import is not emitted
either (`typesugar build`, ts-patch): `import { mkP } from "./ord.js"` would
load the module for nothing. A binding the code still uses (a call that
wasn't inlined, `const inst = mkP`, `export { mkP }`), the declaration's
other bindings and side-effect imports (`import "./setup.js"`) stay.

### With `= implicit()`

`= implicit()` fills in the instance argument at compile time, and the
completed call is then specialized exactly as if you had passed the instance
yourself:

```typescript
function sortWith<T>(items: T[], ord: Ord<T> = implicit()): T[] {
  return items.slice().sort((a, b) => ord.compare(a, b));
}

sortWith([3, 1, 2]);
// Compiles to the same code as sortWith([3, 1, 2], numberOrd):
__typesugar___sortWith_number_0__([3, 1, 2]);
```

The same fallbacks and opt-outs apply as for an explicit call. In
particular, an instance `= implicit()` finds in a package's `.d.ts` is passed
but not inlined, with the same TS9602 warning:

```typescript
import { type Ord } from "@typesugar/std";

sortWith([3, 1, 2]);
// Compiles to sortWith([3, 1, 2], ordNumber), with `import { ordNumber } from
// "@typesugar/std"` added, and warns TS9602: 'ordNumber' is only visible as a
// declaration (from a .d.ts)
```

There is one extra fallback. Suppose a function's body calls another
`= implicit()` function without passing the dictionary, and relies on its own
dictionary being passed along (propagated). A call to that outer function is
not specialized. It keeps dictionary passing and warns TS9602:

```typescript
function sortTwice<T>(items: T[], ord: Ord<T> = implicit()): T[] {
  return sortWith(sortWith(items)); // ord is propagated to both calls
}

sortTwice([3, 1, 2]); // compiles to sortTwice([3, 1, 2], numberOrd)
```

### Around-advice: wrapping a call in an instance method

An instance method that wraps a call (timing, logging, retries) inlines too,
when the call is returned: `return T.around("op", () => expr)`. Its body is
copied into the specialization as statements, `try`/`finally` and loops
included, with the thunk's expression in place of `body()`:

```typescript
/** @typeclass */
interface Traced<S> {
  around<R>(op: string, body: () => R): R;
}

/** @impl Traced<UserSvc> */
const timed: Traced<UserSvc> = {
  around: (op, body) => {
    const t0 = performance.now();
    try {
      return body();
    } finally {
      console.log(op, performance.now() - t0);
    }
  },
};

function getUser(id: string, T: Traced<UserSvc> = implicit()): string {
  return T.around("getUser", () => "user:" + id);
}

getUser("1");
// Compiles to:
const __typesugar___getUser_UserSvc_0__ = (id: string) => {
  {
    const __typesugar_t0_0__ = performance.now();
    try {
      return "user:" + id;
    } finally {
      console.log("getUser", performance.now() - __typesugar_t0_0__);
    }
  }
};
__typesugar___getUser_UserSvc_0__("1");
```

With a no-op instance (`around: (op, body) => body()`) the specialization is
just `return "user:" + id;`, so switching the instance in scope switches the
advice off at no cost.

The rules that keep this exact:

- The method's own `return`s return from the specialized function, which is
  what `return T.around(...)` did with its result; a body that can finish
  without returning returns `undefined`.
- Arguments are evaluated once, in order: a literal is substituted, a
  function argument only where it is called once (`body()`), anything else
  is bound to a `const` first (or dropped, if the method never reads it and
  it has no effect).
- A thunk called once, `body()` with `body` bound to `() => expr`, becomes
  `expr` (also in the ordinary expression inliner). Inside a retry loop it is
  still evaluated on every pass.
- Every name the method declares (`t0`) gets a fresh name, so it can't
  capture a name the arguments use.
- An `async` method's body becomes `return (async () => { ... })();`, after
  its arguments: exactly the call, so a `try` in the caller sees the same
  rejection it would have.
- It declines (dictionary passing, as before) when a name the method reads is
  also bound in the calling function, when a function argument is used other
  than by one call (stored, compared, called twice), when the method writes to
  a parameter, and for receiver use (`this`, `arguments`), generators, labels,
  destructuring and default or rest parameters.

To wrap every method of a service at once, rather than writing
`T.around(...)` in each, see [`forward<S>()`](./forward.md).

## When Specialization Is Skipped

The transformer only inlines what it can prove sound. A call falls back to
dictionary passing — semantically identical, just not inlined — and emits a
[TS9602](/errors/TS9602) warning
when the function body:

- can't be resolved (e.g. the function comes from an untyped/dynamic source —
  declare it as a `const` arrow function or a named `function`);
- contains a loop, `try/catch`, a `throw`, or mutable `let` bindings (an
  instance method may: see
  [Around-advice](#around-advice-wrapping-a-call-in-an-instance-method));
- has early/multiple returns that can't be flattened into a single expression
  (simple guard-clause chains _are_ flattened into ternaries);
- calls an `= implicit()` function without passing its instance argument
  (see [With `= implicit()`](#with-implicit)).

and when an instance method's body uses a name that isn't in scope at the call
site (see [Which instances are recognized](#which-instances-are-recognized)).

It also warns TS9602 when the instance itself is only a declaration (from a
package's `.d.ts`; see [Which instances are recognized](#which-instances-are-recognized)).

Result-returning functions get one extra trick: **return-type-driven
specialization** rewrites `ok()`/`err()` constructors when a function returning
a registered Result type is used where an `Option` or `Either` (from
`@typesugar/fp`) or a `Promise` is expected. Types and constructors are matched
by declaration, not by name, so a library's own `Result` (neverthrow's, say)
is never rewritten, and an alias import (`import { Option as Opt }`) still
counts. typesugar registers the targets but no Result type; a package
registers its own from its `./macros` entry:

```typescript
import { registerResultSource } from "@typesugar/macros";

registerResultSource({
  name: "MyResult",
  type: { module: "my-result", name: "Result" },
  ok: [
    { module: "my-result", name: "ok" },
    { module: "my-result", name: "Result.ok" },
  ],
  err: [
    { module: "my-result", name: "err" },
    { module: "my-result", name: "Result.err" },
  ],
});
```

Only calls that resolve to those constructors are rewritten.

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
real examples. The hoisted `__typesugar___<fn>_<Brand>_<n>__` constants with `/*#__PURE__*/`
annotations are the specializations; grep your build output for the original
dictionary parameter to confirm it's gone.

## Learn More

- [Typeclasses Guide](/guides/typeclasses) — defining typeclasses and instances
- [TS9602](/errors/TS9602) — auto-specialization skipped
- [Error Messages Guide](/guides/error-messages) — TS9602 and friends
- [Macro Triggers Reference](/macro-triggers) — where auto-specialization runs
  in the pipeline
