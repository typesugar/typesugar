# PEP-062: Typeclass Dispatch Everywhere

**Status:** Draft (2026-10-21). Nothing implemented except the `match()` work tracked in
[PEP-008](PEP-008-pattern-matching.md) Waves 10–11.
**Date:** 2026-10-21
**Author:** Claude (with Dean Povey)
**Related:** [PEP-052](PEP-052-import-scoped-macro-activation.md) (import-scoped
activation: "sugar is never ambient; instances resolve from scope"),
[PEP-008](PEP-008-pattern-matching.md) (pattern matching, `Destructure`),
[PEP-060](PEP-060-architecture-for-1.0.md) (1.0 architecture), [PEP-048](PEP-048-package-triage.md)
(package triage), the Turf case study
([typesugar/turf-typesugar](https://github.com/typesugar/turf-typesugar), `CASE-STUDY.md`)

## Context

The Turf case study found that `match()` extractors (`Some(x)`, `Left(e)`, `Point(x, y)`)
are recognised by name, from hard-coded tables and process-global registries, while a
`Destructure` typeclass for exactly this sat unused. Dean asked whether other features
have the same problem. A read-only audit of `decisions-1.0` (2026-10-21) says many do.

The pattern is always the same: a feature decides what to do from a type's or
constructor's **name**, or from a fixed table, instead of resolving a typeclass instance
from scope. The costs:

1. **Users can't extend it.** Their own types never get the behaviour that built-in ones get.
2. **It isn't scoped.** Name tables and global registries are ambient, which is what PEP-052
   set out to remove, and same-named types in different modules collide.
3. **It breaks when representations differ.** fp's null-based `Option` needed special
   cases in `match()` and is mis-mapped by the Effect Schema derive.
4. **Docs promise typeclass behaviour the code doesn't have.**

The principle this PEP adopts: **if a feature's behaviour depends on the type of a value,
it resolves a typeclass instance for that type from scope.** Built-in types get ordinary
instances shipped by the packages that own them. Fast paths for known types are fine
_behind_ a resolvable instance (an inlined instance is how zero cost works), but never
instead of one.

## Audit findings

Classes:

- **A** means it should be a typeclass.
- **B** means fine: a fast path behind a resolvable instance.
- **C** means a legitimate syntax check.

File references are against `decisions-1.0` on 2026-10-21. Only rows that need work are
listed; the B and C rows are summarised after the table.

| #   | Feature                                  | Where                                                                                          | What is hard-coded                                                                                                                                                               | Consequence                                                                                                       | Typeclass                                            |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `match()` extractors                     | `std/src/macros/match.ts:125-271, 570-600, 2440`                                               | Tables for Some/None/Left/Right/Ok/Err/Cons/Nil; global product/custom registries; a `_tag` probe picks the representation; custom extractors are `Name.extract()` by convention | Ambient and not extensible; representation guessed                                                                | `Destructure` (PEP-008 Wave 11, in progress)         |
| 2   | do-notation: which monad                 | `std/src/macros/comprehension-utils.ts:412-440`                                                | The "brand" (Array/Promise/Effect/Iterable) is chosen by symbol name or type text before the instance is resolved                                                                | A user monad is second-class; the choice is by name                                                               | `FlatMap<F>` resolved from the value's type (Wave 2) |
| 3   | do guards (`if` in `let:`)               | `let-yield.ts:121, 247`                                                                        | `GUARD_CAPABLE_BRANDS` = Array/Iterable/AsyncIterable                                                                                                                            | A user type with an empty value can't use guards                                                                  | `Alternative` / `MonoidK` (`empty`)                  |
| 4   | do `\|\|` / `??` fallback                | `let-yield.ts:287, 515-521`; `instance-scanner.ts:88`                                          | Method-style instances default to `orElse`; `flatMapArray` has no `@do-methods`                                                                                                  | Can emit `arr.orElse(...)` on a type that has no such method                                                      | `SemigroupK` / `Alternative` (`orElse`)              |
| 5   | derive: field handling                   | `macros/src/auto-derive.ts:451, 730, 1044-1066`                                                | Field types judged by type text; only Eq/Semigroup/Monoid look up field instances                                                                                                | `@derive(Show/Ord/Hash)` ignores a nested type's own instance or rejects it; Eq rejected GeoJSON `Position` (F12) | Each field through its type's instance               |
| 6   | derive: Show/Ord/Hash/Debug/Default      | `auto-derive.ts:1073-1097, 1164-1168, 1210-1218, 1285-1322, 1463-1583`                         | Per-type-text code paths (raw `<`, `JSON.stringify`, `({} as T)`)                                                                                                                | Debug and sum-type Show throw on `bigint`; nested instances ignored                                               | Show, Ord, Hash, Debug, Default                      |
| 7   | derive: Json / TypeGuard                 | `auto-derive.ts:1345, 1380, 1478-1500`                                                         | `runtimeTypeCheck` on type text; nested types only get `is object`                                                                                                               | `fromJson` lets nested objects through unchecked                                                                  | Json; a TypeGuard typeclass (none exists)            |
| 8   | sql Read/Write                           | `sql/src/derive-common.ts:49-90, 166-180`                                                      | `describeType`: primitives plus `"Date"`/`"Buffer"` via `typeToString`                                                                                                           | A user `Meta<UserId>` is never used for a column                                                                  | `Meta`/`Get`/`Put` from scope                        |
| 9   | sql registries                           | `sql/src/typeclasses.ts:1084-1146`; `derive-typeclasses.ts:147, 178`; `infer-macro.ts:188-199` | Global registries keyed by string (one never filled)                                                                                                                             | Not import-scoped; same-name collisions                                                                           | Instances; delete the dead one                       |
| 10  | Return-type specialization               | `transformer-core/src/specialization.ts:1160-1224`; `macros/src/specialize.ts:258-274`         | Sources fixed to Result/Either/Validation by name; global `ResultAlgebra` registry                                                                                               | Third-party result types can't take part                                                                          | `ResultAlgebra` as a typeclass instance              |
| 11  | Effect Schema derive                     | `effect/src/derive/schema.ts:178-245`                                                          | `switch` on type names, else a `${name}Schema` naming convention                                                                                                                 | fp's null-based `Option` mapped to `Schema.Option` (wrong); aliases missed                                        | A `Schema` instance from scope                       |
| 12  | Generic registries                       | `macros/src/generic.ts:274-285`; `auto-derive.ts:176-189`                                      | Global maps keyed by type and typeclass name                                                                                                                                     | Same-name collisions; not scoped                                                                                  | Scoped registration                                  |
| 13  | Coverage registry                        | `macros/src/coverage.ts:52-70, 275-327`; `typeclass.ts:218`                                    | Global `"Type::TC"` set; `checkCoverageForDerive` never called                                                                                                                   | Exported helpers answer by name; dead code                                                                        | Delete                                               |
| 14  | `erased()` capabilities (frozen package) | `erased/src/macros.ts:34-97, 214-221`                                                          | Capability name → typeclass table                                                                                                                                                | User typeclasses can't be capabilities; an unknown one warns and the method is silently missing from the vtable   | Read the typeclass index                             |
| 15  | codec field kinds (frozen package)       | `codec/src/macros.ts:24-52`; `json-codec.ts:72-111`                                            | Closed set of field kinds                                                                                                                                                        | No per-field codec for user types                                                                                 | `Codec` per field                                    |

Also wrong, but not in the table:

- **Companion fallback** (`typeclass.ts:1255-1367`): class B, but its `getBaseType` maps
  `bigint` to `"number"` and `T[]` to `"array"` (giving `array.Eq`). Fix it as part of
  Wave 3.
- **Duplicate typeclass definitions.** Do-notation's `FlatMap<F>` is defined twice, in
  `std/src/typeclasses/flatmap-instances.ts:45` and `fp/src/typeclasses/monad.ts:26`.
  Wave 2 needs one definition that both packages' instances implement.

**Docs that claim typeclass behaviour the code doesn't have:**

- `fp/src/typeclasses/eq.ts` claims `@op` operators, but has no `@op` tags and no `@typeclass`.
- `units/src/types.ts:372-424` says unit operators rewrite, but `units` has no `@impl`.
- `fusion/src/index.ts:13-14` mentions a "global typeclass registry", which PEP-052 removed.
- `destructure.ts:9-11, 24-29` claims built-in instances that don't exist.

**Fine as they are (B and C):**

- The specialization intrinsics table (`specialize.ts:618, 702-750`) is justified. It
  applies only when the call resolves to typesugar's own primitives. One caveat: an
  unresolved name falls back to a lookup by name (`specialization.ts:321-330`), which
  Wave 4 should remove.
- The do-notation static instance tables behind marker imports are fine, and so is
  `par:`'s builder map behind a scoped instance. The standard typeclass seeds, which a
  source `@typeclass` replaces, are fine too.
- Primitive operators keep their native meaning, which is correct.
- Pattern type checks (`typeof`/`instanceof`) and Effect's `"Effect"` identifier checks
  are fine, though the latter misses `import { Effect as E }`.

## Design

### Resolving a type constructor's instance (for do-notation)

`user << fetchUser(id)` has a value of type `Promise<User>`, and needs `FlatMap<F>` for
the `F` that `Promise<User>` is an application of. Today a name check picks `F`. Instead:

1. Collect the `FlatMap` instances in scope (std's and the effect adapter's ship as
   ordinary instances; a user's own monad is one more).
2. For each one, ask the HKT machinery whether the value's type is `Kind<F, A>` for some
   `A`, by unifying the instance's `F` against the value type. typesugar already
   represents `F<A>` as `Kind<F, A>` ([PEP-007](PEP-007-hkt-boilerplate-reduction.md), `hkt-rewriter.ts`).
3. Exactly one match: use it, inlined as today, so zero cost is unchanged. None:
   TS9001 with the trace. Several: the existing ambiguity error.

Guards resolve `Alternative<F>` (`empty`), `||`/`??` resolve `SemigroupK<F>` or
`Alternative<F>` (`orElse`), and `par:` resolves `Applicative<F>` or `ParCombine<F>`.
All are found the same way.

### Field-wise derivation

Every derive (Show, Ord, Hash, Debug, Default, Json, TypeGuard, Clone, Eq) treats each
field the same way:

- resolve the field type's instance from scope;
- otherwise derive it structurally, recursively;
- otherwise report an error naming the field.

There is no type-text branching. This generalises what Clone and Eq already do on
`case-study-fixes` (PEP-060 follow-up), and lets `derived<TC<T>>()` ("option B") compose.

### Fast paths

Allowed only behind a resolvable instance. The typical case is an inlined instance for a
known type (`Some(x)` on fp's Option compiles to `x != null`). Each wave pins today's
emitted output for the built-in types before it changes anything, and the output must
not get worse.

## Waves

1. **`match()` and `Destructure`.** Tracked in PEP-008 Waves 10–11 (in progress).
2. **do-notation on typeclasses.**
   - One definition of each functional typeclass, owned by std (see Decisions).
   - Promise/Array/Iterable/AsyncIterable instances in std, and Effect's in
     `@typesugar/effect`.
   - Instance-by-unification as above.
   - Guards via `Alternative`, `||`/`??` via `SemigroupK`/`Alternative`, `par:` via
     `Applicative`/`ParCombine`.
   - Delete the brand inference and `GUARD_CAPABLE_BRANDS`.
   - Gate: a user-defined monad works in `let:`/`par:`/guards/`||` with no special
     registration, and today's Promise/Array/Effect output is unchanged.
3. **Field-wise derivation for every derive** (rows 5–7):
   - Show/Ord/Hash/Debug/Default/Json resolve field instances from scope.
   - Add a TypeGuard typeclass.
   - Fix the `bigint` crashes and nested `fromJson` validation.
   - Fix the companion fallback's `getBaseType`.
4. **Return-type specialization** (row 10): `ok`/`err` through `ApplicativeError`
   instances (see Decisions); delete `ResultAlgebra` and its registry; remove the by-name
   intrinsic fallback.
5. **sql** (rows 8–9): column types through `Meta`/`Get`/`Put` instances from scope;
   import-scoped registries; delete the never-filled one.
6. **Effect Schema derive** (row 11): a `Schema` instance from scope, with instances for
   fp's types that match their real representation.
7. **Registries and dead code** (rows 12–13): scope the Generic registry; delete the
   coverage registry.
8. **Docs that overclaim:** fix the four listed above.
9. **Frozen packages** (rows 14–15): only if PEP-048's re-triage unfreezes `erased` or
   `codec`. Otherwise their docs say the capability and field-kind sets are closed.

10. **Native errors** (Dean, 2026-10-21: "Add all 5"; pattern matching on errors is in
    PEP-008 Wave 12). Depends on Wave 4's `ApplicativeError`/`MonadError` in std.
    - **Exceptions as an instance.** A throwing instance in which a function simply
      returns `A`: `raiseError(e)` is `throw e`, and `handleErrorWith` is `try`/`catch`. The
      same generic code (`ME: MonadError<F, E> = implicit()`) then compiles to plain
      throwing code with this instance, or to `Result`-returning code with Result's.
    - **Early return on error (Rust's `?`).** In a function returning `F<A>` with an
      `ApplicativeError` instance, a call like `const user = check(parseUser(s))` compiles
      to `const _r = parseUser(s); if (!_r.ok) return _r; const user = _r.value;` for
      Result, and to the equivalent for Either, Option and Promise (`await` plus rethrow).
      There is no allocation. The name (`check`, `try_`, a `?:` label form) is open.
    - **Bridges between exceptions and values:**
      - `attempt(() => JSON.parse(s))` returns a `Result`, compiled to an inline
        `try`/`catch`;
      - `r.orThrow()` turns an `Err` into a throw;
      - `await settle(p)` turns a Promise rejection into an `Err`.

      Each compiles to the hand-written code.

    - **`@derive(Error)`, like Rust's `thiserror`.** On a union of error variants it
      generates real `Error` subclasses (or one per variant), with a proper `name`, a
      `message` formatted from a per-variant template, `cause` chaining (`Error.cause`)
      and `toJSON`. Matching on them uses PEP-008 Wave 12's `Error`-subclass extractors.
      ```ts
      /** @derive(Error) */
      type ConfigError =
        | { kind: "Missing"; key: string } // message: `missing key ${key}`
        | { kind: "Invalid"; key: string; cause: unknown };
      ```
    - Not planned: checked exceptions (`@throws` verified at compile time). TypeScript
      can't see what a call throws, so the check would be noisy and unreliable.

Waves 2 and 3 matter most for 1.0: every `let:` and every `@derive` user is affected.
Waves 4–7 are smaller and can follow.

## Decisions

- **std owns the core functional typeclasses** (Dean, 2026-10-21: "std gets some FP
  typeclasses? That's okay"). The typeclasses that std features dispatch on move to
  `@typesugar/std`: Functor, Apply, Applicative, FlatMap, SemigroupK, MonoidK,
  Alternative and ParCombine, with the instances for JavaScript's own types (Promise,
  Array, Iterable, AsyncIterable). `@typesugar/fp` extends and re-exports them and adds
  its data types and their instances, so one definition of each typeclass exists and
  fp's types work in std's do-notation with no extra registration. Moving them is part
  of Wave 2.

- **The core data types move to std too; fp becomes advanced FP on top of std** (Dean,
  2026-10-21: "Do the split", choosing it over merging all of fp into std).
  - **Moves to `@typesugar/std`:** Option, Either/Result, Validated and NonEmptyList, with
    their instances and their `Destructure` extractors, plus Foldable and Traverse
    alongside the typeclasses above.
  - **Stays in `@typesugar/fp`, now depending on std:** IO and the effect helpers, Reader,
    State, Writer, Id, List, RemoteData, the law checkers, the advanced HKT helpers and the
    examples.
  - **Compatibility:** fp re-exports everything that moved, so existing imports keep
    working.
  - **The test bar:** a type moves only with tests up to std's standard. That also settles
    PEP-048's coverage condition on fp for the moved parts.
  - **Why:** std's own features (`match()` extractors, do-notation, the `Some(x)` →
    `x != null` zero-cost path) already depend on Option; Rust and Scala keep
    Option/Either/Result in their standard libraries; std has no Option of its own to
    reconcile; and std is tree-shaken ESM, so an unused type costs nothing.
  - **Sequencing:** part of Wave 2. It starts after PEP-008 Wave 11 (the `Destructure`
    retrofit) and the `derived<TC<T>>()` work land, because both touch fp's Option and
    Either.

- **Both Result and Either go to std, one Option** (Dean, 2026-10-21: "there is space
  for both result and either").
  - `Result<T, E>` (`{ ok: true; value } | { ok: false; error }`, today fp's
    `ZeroCostResult`) is the error type.
  - `Either<E, A>` (field-presence `Left`/`Right`, today fp's `data/either`) is the
    general two-way union.
  - Both get full instances and `Destructure` extractors, with conversions between them.
  - fp's two Options (`data/option` and `zero-cost`'s `ZeroCostOption`, both `T | null`)
    merge into one std `Option`.
- **`ApplicativeError` and `MonadError` move to std and replace `ResultAlgebra`** (Dean,
  2026-10-21). Return-type specialization (row 10) is `pure` plus `raiseError` with the
  typeclass taken out, keyed by type name. Instead, `ok(x)` / `err(e)` in a function
  returning `F<A>` resolve `ApplicativeError<F, E>` from scope and inline it:

  | Type      | Instance                                   | E              | `err(e)` compiles to      |
  | --------- | ------------------------------------------ | -------------- | ------------------------- |
  | Result    | MonadError                                 | its error type | `{ ok: false, error: e }` |
  | Either    | MonadError                                 | its Left type  | `{ left: e }`             |
  | Option    | MonadError                                 | `void`         | `null`                    |
  | Validated | ApplicativeError only (accumulates errors) | its error type | `Invalid(e)`              |
  | Promise   | MonadError                                 | `unknown`      | `Promise.reject(e)`       |

  Effect's instance lives in `@typesugar/effect`, and IO's stays in fp. Third-party result
  types take part by providing an instance. Generic code (`ME: MonadError<F, E> =
implicit()`) is specialized per call site, and do-notation's error recovery can use
  `handleErrorWith`. This needs the HKT machinery to resolve partially applied
  two-parameter constructors (`Result<_, E>`), which Wave 2 must prove first.

## Open questions

- Unification cost. Resolving do-notation instances by unification runs per `<<`
  binding. It needs measuring on a large file; the instance index is per program, so it
  should be cheap, but nothing confirms that yet.
- `Promise` is not a lawful monad: `then` flattens nested promises. Its `FlatMap`
  instance is a pragmatic one. Document that, as fp libraries do.
