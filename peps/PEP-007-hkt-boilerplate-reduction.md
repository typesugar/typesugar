# PEP-007: HKT Boilerplate Reduction for `.ts` Files

**Status:** Done
**Date:** 2026-03-14
**Author:** Dean Povey

## Context

Defining a type-level function (needed for typeclasses like Functor, Monad) currently requires 4 lines of boilerplate per type:

```typescript
export interface OptionF extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: Option<this["__kind__"]>;
}
```

This must be written for every type that participates in HKT: `OptionF`, `EitherF<E>`, `ListF`, `StateF<S>`, `ArrayF`, `MapF<K>`, etc. The only varying part is the concrete type application — everything else is mechanical.

Additionally, typeclass definitions and generic functions must use `Kind<F, A>` instead of the natural `F<A>`:

```typescript
interface Functor<F> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
}
```

In `.sts` files, the preprocessor handles `F<_>` syntax natively. But in `.ts` files (the majority of user code), there's no ergonomic alternative.

### Scala 3 Comparison

In Scala, type constructors are first-class — `Option` already IS `* -> *`:

```scala
trait Functor[F[_]]:
  extension [A](fa: F[A]) def map[B](f: A => B): F[B]

given Functor[Option] with ...
```

TypeScript lacks higher-kinded types, so we need an encoding. But the user should never see or think about the encoding.

## Core Insight

`Functor<Option>` and `F<A>` are both **syntactically valid** TypeScript — they parse into perfectly good ASTs. TypeScript would later reject them with type errors (TS2314 "requires N type arguments", TS2315 "is not generic"), but the typesugar transformer can fix these before TypeScript type-checks.

The type error IS the signal that tells the macro what to rewrite.

## Robustness Analysis

### Parse Verification (confirmed)

`F<A>` where F is a type parameter parses correctly in ALL 14 tested positions:

| Position           | Example                          | Parses? |
| ------------------ | -------------------------------- | ------- |
| Parameter type     | `map(fa: F<A>)`                  | ✅      |
| Return type        | `pure(a: A): F<A>`               | ✅      |
| Nested             | `flatten(ffa: F<F<A>>)`          | ✅      |
| Generic function   | `function lift<F>(fa: F<A>)`     | ✅      |
| Type alias         | `type Lifted<F> = F<A>`          | ✅      |
| Conditional type   | `F<A> extends null ? ...`        | ✅      |
| Mapped type        | `{ [K in keyof T]: F<T[K]> }`    | ✅      |
| Extends clause     | `extends Functor<F>`             | ✅      |
| Union              | `F<A> \| null`                   | ✅      |
| Intersection       | `F<A> & { meta: true }`          | ✅      |
| Tuple              | `[F<A>, F<B>]`                   | ✅      |
| Generic constraint | `<F extends { length: number }>` | ✅      |
| Default type param | `<F = Array>`                    | ✅      |
| Multi-arity        | `F<A, B>`                        | ✅      |

All produce TS2315/TS2314 type-checker errors (not parse errors). The AST is fully intact.

### Detection Algorithm (confirmed — zero false positives, no TypeChecker needed)

The rewrite rule is simple and unambiguous: **if a TypeReferenceNode's identifier matches a type parameter of any enclosing scope AND has type arguments, rewrite `X<Y>` to `Kind<X, Y>`.**

This has zero false positives because TypeScript type parameters can NEVER take type arguments. Every `F<A>` where F is a type parameter is an HKT usage.

**Critically, detection requires only `ts.createSourceFile()` — no Program, no TypeChecker, no module resolution.** The check is: walk up parent chain, collect `typeParameters` arrays from enclosing scopes, check if the identifier matches. This is a purely structural/syntactic operation.

Verified with two proof-of-concept scripts:

- `sandbox/hkt-poc-detection.ts` — 13 cases, 29 correct rewrites, 5 correctly ignored, 0 false positives
- Standalone test with raw `ts.createSourceFile()` (no Program, no TypeChecker) — same correct results

This means the rewrite works in:

- **oxc engine** (parse-only, no TypeChecker) ✅
- **Degraded IDE mode** (TypeChecker unavailable) ✅
- **Any parser** producing type parameter + type reference AST nodes ✅

### Environment Compatibility

The detection is universal. The question is where the REWRITE runs relative to type checking.

**Current architecture:**

```
.sts files:  preprocessor (token-level F<_>→Kind)  →  VirtualCompilerHost  →  ts.Program  →  type check  →  macro transform
.ts files:   (no preprocessing)                     →  VirtualCompilerHost  →  ts.Program  →  type check  →  macro transform
```

The `VirtualCompilerHost` feeds preprocessed content to `ts.createProgram()`. TypeScript type-checks the content the host provides. Currently, `shouldPreprocess()` only returns `true` for `.sts/.stsx` files (line 133-139 of `virtual-host.ts`).

**Proposed architecture:**

```
.sts files:  preprocessor (F<_>→Kind, |>, ::)   →  VirtualCompilerHost  →  ts.Program  →  type check  →  macro transform
.ts files:   HKT rewriter (F<A>→Kind, AST-only) →  VirtualCompilerHost  →  ts.Program  →  type check  →  macro transform
                          ↑
             NEW: pure ts.createSourceFile(), no TypeChecker
```

The HKT rewriter for `.ts` files slots into the same position as the preprocessor for `.sts` files — before `ts.Program` creation. Since `TransformationPipeline` creates the Program via `VirtualCompilerHost`, the type checker sees the rewritten code in ALL environments:

| Environment                | Uses Pipeline?                                                                            | F<A> rewrite                         | @impl Functor<Option> |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ | --------------------- |
| **IDE** (language service) | ✅ Yes — `getScriptSnapshot`                                                              | ✅ Works                             | ✅ Works              |
| **Bundlers** (unplugin)    | ✅ Yes — `transform()`                                                                    | ✅ Works                             | ✅ Works              |
| **`tsc` + ts-patch**       | ⚠️ Partial — macro transform during emit, but preprocessor runs via `VirtualCompilerHost` | ✅ Works (if HKT rewrite is in host) | ✅ Works (JSDoc only) |
| **oxc engine**             | ✅ Yes — own pipeline                                                                     | ✅ Works (AST-only)                  | ✅ Works              |

**Key insight:** By putting the `F<A>` → `Kind<F, A>` rewrite in the `VirtualCompilerHost` (alongside the existing `.sts` preprocessor), it runs before `ts.Program` creation in all environments. No ts-patch v3 migration needed. No timing issues.

The only requirement: extend `shouldPreprocess()` to also detect `.ts` files containing HKT patterns. The detection is a fast AST scan with no TypeChecker dependency.

## Proposal

### Five tiers, from most explicit to most ergonomic:

### Tier 3: `@hkt` with `_` Marker (types you don't own)

```typescript
import type { _ } from "@typesugar/type-system";

/** @hkt */
type ArrayF = Array<_>;

/** @hkt */
type MapF<K> = Map<K, _>;
```

The `_` marker type: `export type _ = never & "__kind__"`. TypeScript reduces it to `never` (valid anywhere). The AST preserves the intersection for macro detection. The macro finds the `_` position, replaces with `this["__kind__"]`, emits the full `TypeFunction` interface.

### Tier 2: `@hkt` on Type Definitions (companion generation)

```typescript
/** @hkt */
type Option<A> = A | null;
// Generates: OptionF extends TypeFunction { _: Option<this["__kind__"]> }

/** @hkt */
type Either<E, A> = { _tag: "Left"; error: E } | { _tag: "Right"; value: A };
// Generates: EitherF<E> extends TypeFunction { _: Either<E, this["__kind__"]> }
```

Last type parameter is the hole (Scala convention). `@hkt` generates a `*F` companion.

### Tier 1: Implicit Resolution in `@impl` (zero boilerplate)

```typescript
/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};
```

The `@impl` macro reads the JSDoc, sees `Option` is a generic type, generates the encoding internally. No `OptionF`, no `@hkt`, no `_`. Works in ALL environments (JSDoc is not type-checked).

### Tier 0: `F<A>` in Typeclass Bodies (Kind elimination)

```typescript
/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

function lift<F, A, B>(F: Functor<F>, f: (a: A) => B): (fa: F<A>) => F<B> {
  return (fa) => F.map(fa, f);
}
```

The transformer rewrites every `F<A>` (where F is a type parameter) to `Kind<F, A>` before type checking. Works in IDE and bundlers. Users of raw `tsc` continue using `Kind<F, A>`.

### Error Cases

| Condition                   | Error Code | Message                                       |
| --------------------------- | ---------- | --------------------------------------------- |
| Tier 1: Can't resolve type  | TS9305     | `Cannot resolve type constructor 'Foo'`       |
| Tier 2: No type params      | TS9302     | `@hkt requires at least one type parameter`   |
| Tier 3: No `_` in RHS       | TS9303     | `@hkt type alias must contain _ placeholder`  |
| Tier 3: Multiple `_` in RHS | TS9304     | `@hkt must contain exactly one _ placeholder` |

## Waves

### Wave 1: `_` Marker Type and Tier 3 (~12 files)

Start with the most explicit form — handles all edge cases, no environment restrictions.

**Tasks:**

- [x] Add `export type _ = never & "__kind__"` to `packages/type-system/src/hkt.ts`
- [x] Re-export `_` from `packages/type-system/src/index.ts`
- [x] Re-export `_` from `packages/fp/src/hkt.ts` and `packages/fp/src/index.ts`
- [x] Re-export `_` from `packages/typesugar/src/index.ts` (umbrella)
- [x] Rewrite `hktAttribute.expand` in `packages/macros/src/hkt.ts` for Tier 3:
  - Detect `@hkt` on type aliases whose RHS contains `_`
  - Find `_` position (symbol resolution + structural fallback for `never & "__kind__"`)
  - Replace `_` with `this["__kind__"]`, emit full `TypeFunction` interface
  - Emit TS9303 when no `_` found, TS9304 when multiple `_` found
- [x] Add TS9303 and TS9304 descriptors to `packages/core/src/diagnostics.ts`
- [x] Re-add `["hkt", "hkt"]` to `JSDOC_MACRO_TAGS` in `packages/transformer/src/index.ts`
- [x] Tests: `ArrayF`, `MapF<K>`, `PromiseF`, `SetF` generation from `@hkt` + `_`
- [x] Add `@hkt` error examples to `sandbox/error-showcase.ts`

**Files changed:**

| File                                | Change                                      |
| ----------------------------------- | ------------------------------------------- |
| `packages/type-system/src/hkt.ts`   | Add `export type _ = never & "__kind__"`    |
| `packages/type-system/src/index.ts` | Add `_` to re-exports                       |
| `packages/fp/src/hkt.ts`            | Re-export `_` from `@typesugar/type-system` |
| `packages/fp/src/index.ts`          | Add `_` to barrel exports                   |
| `packages/typesugar/src/index.ts`   | Re-export `_`                               |
| `packages/macros/src/hkt.ts`        | Rewrite `hktAttribute.expand` for Tier 3    |
| `packages/core/src/diagnostics.ts`  | Add TS9303, TS9304 descriptors              |
| `packages/transformer/src/index.ts` | Add `"hkt"` to `JSDOC_MACRO_TAGS`           |
| `sandbox/error-showcase.ts`         | Add `@hkt` error examples                   |
| `tests/hkt-macro.test.ts`           | **New** — Tier 3 tests                      |

**No conflict:** No existing `type _` found in the codebase. No imports from `@typesugar/type-system/hkt` subpath.

**Gate:**

- [x] `/** @hkt */ type ArrayF = Array<_>` produces correct `TypeFunction` interface
- [x] `Kind<ArrayF, number>` resolves to `Array<number>`
- [x] Error on missing `_`, multiple `_`
- [x] Existing tests pass

### Wave 2: Tier 2 — `@hkt` Companion Generation (~18 files)

**Depends on:** Wave 1

**Tasks:**

- [x] Extend `hktAttribute.expand` in `packages/macros/src/hkt.ts`:
  - Detect Tier 2: type alias with type params, no `_` in RHS
  - Generate companion `*F` interface (last param as hole)
  - Return `[originalNode, generatedCompanion]`
  - Emit TS9302 when `@hkt` on type with no type params
- [x] Add TS9302 descriptor to `packages/core/src/diagnostics.ts`
- [x] Migrate `packages/fp/src/data/option.ts`: add `/** @hkt */` to `Option<A>`
- [x] Migrate `packages/fp/src/data/either.ts`: add `/** @hkt */` to `Either<E, A>`
- [x] Migrate `packages/fp/src/data/list.ts`: add `/** @hkt */` to `List<A>`
- [x] Migrate `packages/fp/src/data/nonempty-list.ts`: add `/** @hkt */` to `NonEmptyList<A>`
- [x] Migrate `packages/fp/src/data/validated.ts`: add `/** @hkt */` to `Validated<E, A>`
- [x] Update `packages/fp/src/hkt.ts`: remove migrated manual `*F` interfaces, re-export from data modules
- [x] Keep manual `*F` in `hkt.ts` for class-based types (State, Reader, Writer, IO, Resource)
- [ ] ~~Migrate `packages/type-system/src/hkt.ts` built-ins to Tier 3 `@hkt`~~ — **Deferred**: library build (`tsup`) doesn't run the transformer, so DTS output would be wrong. Manual interfaces kept; `ArrayF`/`PromiseF` re-exported from `type-system` into `fp/hkt.ts`.
- [x] Update barrel exports in `packages/fp/src/index.ts`
- [x] Tier 2 tests: `Option<A>`, `Either<E, A>`, `State<S, A>` companion generation

**Files changed:**

| File                                    | Change                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `packages/macros/src/hkt.ts`            | Add Tier 2 detection and companion generation                           |
| `packages/core/src/diagnostics.ts`      | Add TS9302                                                              |
| `packages/fp/src/data/option.ts`        | Add `/** @hkt */` to `Option<A>`                                        |
| `packages/fp/src/data/either.ts`        | Add `/** @hkt */` to `Either<E, A>`                                     |
| `packages/fp/src/data/list.ts`          | Add `/** @hkt */` to `List<A>`                                          |
| `packages/fp/src/data/nonempty-list.ts` | Add `/** @hkt */` to `NonEmptyList<A>`                                  |
| `packages/fp/src/data/validated.ts`     | Add `/** @hkt */` to `Validated<E, A>`                                  |
| `packages/fp/src/hkt.ts`                | Remove manual `*F` for migrated types, add re-exports from data modules |
| `packages/fp/src/index.ts`              | Adjust barrel re-exports for `*F` types                                 |
| `packages/type-system/src/hkt.ts`       | Keep manual interfaces (deferred: tsup doesn't run transformer)         |
| `tests/hkt-macro.test.ts`               | Add Tier 2 tests                                                        |

**Import compatibility:** `OptionF`, `EitherF`, etc. stay exported from `@typesugar/fp` via `hkt.ts` re-exports. No consumer import changes.

**Class-based types deferred:** `StateF<S>`, `ReaderF<R>`, `WriterF<W>`, `IOF`, `ResourceF` remain manual in `hkt.ts` (extend `@hkt` to classes in a future wave).

**Docs (can be done in Wave 5):**

| File                         | Change                                    |
| ---------------------------- | ----------------------------------------- |
| `docs/guides/typeclasses.md` | Update HKT examples from manual to `@hkt` |
| `docs/architecture.md`       | Update HKT examples                       |
| `docs/reference/packages.md` | Update HKT examples                       |
| `PHILOSOPHY.md`              | Update manual OptionF examples            |

**Gate:**

- [x] `/** @hkt */ type Option<A> = A | null` generates `OptionF extends TypeFunction`
- [x] `/** @hkt */ type Either<E, A> = ...` generates `EitherF<E> extends TypeFunction`
- [x] Multi-arity types fix all-but-last parameters correctly
- [x] All existing imports of `OptionF`, `EitherF`, etc. still resolve
- [x] Preprocessor `Kind<OptionF, number>` → `Option<number>` still works

### Wave 3: Tier 1 — Implicit Resolution in `@impl` (~8 files)

**Depends on:** Wave 2

**Tasks:**

- [x] Replace regex parsing in `implAttribute.expand` (`packages/macros/src/typeclass.ts` line ~1690):
  - Current: `^(\w+)<(\w+)>$` — fails on `Functor<Either<string>>`
  - Replace with bracket-aware `parseTypeclassInstantiation` (already exists in same file)
- [x] Add TypeChecker-based resolution in `implAttribute.expand`:
  - If `typeName` (e.g. `"Option"`) is not in `hktExpansionRegistry`, resolve via `ctx.typeChecker`
  - Check if it's a generic type, count type params, determine hole
  - Generate internal TypeFunction encoding
- [x] Add helper `resolveTypeConstructorViaTypeChecker(ctx, typeNameStr)` in `packages/macros/src/hkt.ts`
- [x] Handle partial application: `Either<string>` → fix `E=string`, hole is `A`
- [x] Fix `extractBrandFromImpl` in `packages/transformer/src/index.ts` for nested brackets
- [x] Support `brand` like `"Either<string>"` in `narrowKindType` (`packages/macros/src/specialize.ts`)
- [x] Update `summonMacro.expand` to use full type string for `typeName`
- [x] Add TS9305 diagnostic for "Cannot resolve type constructor"

**Files changed:**

| File                                                 | Change                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/macros/src/typeclass.ts`                   | Replace regex with bracket-aware parsing; add TypeChecker resolution; update `summonMacro` |
| `packages/macros/src/hkt.ts`                         | Add `resolveTypeConstructorViaTypeChecker` and `generateTypeFunctionInterface` helpers     |
| `packages/macros/src/specialize.ts`                  | Support partial-application brands in `narrowKindType` and `instanceMethodRegistry`        |
| `packages/transformer/src/index.ts`                  | Fix `extractBrandFromImpl` for nested generics                                             |
| `packages/core/src/diagnostics.ts`                   | Add TS9301 / TS9305                                                                        |
| `tests/hkt-macro.test.ts`                            | Add `@impl Functor<Option>`, `@impl Functor<Array>`, `@impl Functor<Either<string>>` tests |
| `tests/jsdoc-macros.test.ts`                         | Add JSDoc @impl with bare type tests                                                       |
| `packages/transformer/tests/auto-specialize.test.ts` | Add partial-application tests                                                              |

**Key dependencies:**

- `implAttribute.expand` already has `ctx.typeChecker` available
- `parseTypeclassInstantiation` (bracket-aware) already exists in `typeclass.ts`
- `hktExpansionRegistry` provides fallback for known types

**Gate:**

- [x] `/** @impl Functor<Option> */` works without any `@hkt` or `OptionF` declaration
- [x] `/** @impl Functor<Either<string>> */` works with partial application
- [x] `/** @impl Functor<Array> */` works for built-in types
- [x] `summon<Functor<Option>>()` resolves correctly
- [x] Auto-specialization works with the new brands
- [x] Works in all environments (IDE, bundlers, `tsc`)

### Wave 4: Tier 0 — `F<A>` → `Kind<F, A>` Rewriting (~4 files, 1 new)

**Depends on:** Wave 3

The key insight: this rewrite goes in `VirtualCompilerHost` alongside the `.sts` preprocessor — before `ts.Program` creation. This means it works in ALL environments (IDE, bundlers, `tsc` + ts-patch) with no timing issues.

**Tasks:**

- [x] Create `packages/transformer/src/hkt-rewriter.ts` (**new file**):
  - `rewriteHKTTypeReferences(source: string, fileName: string): { code: string; map: RawSourceMap | null; changed: boolean }`
  - `hasHKTPatterns(source: string): boolean` — fast regex heuristic for early bailout
  - `injectKindImport(code: string)` — add `import type { Kind }` when not already present
  - Use `MagicString` for text replacements and source map generation (same as preprocessor)
  - Walk `TypeReferenceNode`s, collect type params from enclosing scopes, rewrite matches
  - Handle nested: innermost `F<A>` first, then outer `F<Kind<F, A>>` → `Kind<F, Kind<F, A>>`
- [x] Extend `VirtualCompilerHost` in `packages/transformer/src/virtual-host.ts`:
  - Add `shouldRewriteHKT(fileName: string): boolean` — `.ts`/`.tsx` files only
  - In `getPreprocessedFile()`: after `.sts` check, try HKT rewrite for `.ts` files
  - In `readFile()`: mirror the same logic for consistency
  - Use `hasHKTPatterns()` for fast early bailout (most `.ts` files skip this entirely)
- [x] Source map composition: HKT rewrite map feeds into existing `composeSourceMaps()` — no changes to pipeline
- [x] Tests: all 13 edge cases from POC, plus environment verification

**Files changed:**

| File                                       | Change                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `packages/transformer/src/hkt-rewriter.ts` | **New** — AST-based rewriter, MagicString, Kind import injection    |
| `packages/transformer/src/virtual-host.ts` | Add HKT rewrite path for `.ts` files alongside `.sts` preprocessing |
| `packages/transformer/src/index.ts`        | Export `rewriteHKTTypeReferences` if part of public API             |
| `tests/hkt-rewriter.test.ts`               | **New** — all 13 edge cases, environment tests                      |

**No changes needed:** `pipeline.ts`, `language-service.ts`, `unplugin.ts`, `oxc-engine/` — all consume from VirtualCompilerHost, which handles the rewrite transparently.

**Performance:** `hasHKTPatterns()` is a fast regex scan. Only files with type parameter patterns pay for `ts.createSourceFile()` + AST walk. Most application files skip entirely.

**Dependencies:** `typescript` (AST), `magic-string` (already used by preprocessor), `@typesugar/preprocessor` (for `RawSourceMap` type).

**Gate:**

- [ ] `interface Functor<F> { map<A, B>(fa: F<A>, f: (a: A) => B): F<B>; }` works in IDE
- [ ] Same works with unplugin (bundlers)
- [ ] Same works with `tsc` + ts-patch (no TS2315 errors)
- [ ] Same works in oxc engine
- [ ] Concrete generics (`Array<A>`, `Promise<A>`) are NOT rewritten
- [ ] Nested `F<F<A>>` rewrites correctly
- [ ] Existing `Kind<F, A>` usage still works (no regression)
- [ ] Source maps correctly map rewritten positions to original

### Wave 5: Documentation and Migration (~10 files)

**Tasks:**

- [x] Update `docs/guides/typeclasses.md` — show Tier 0/1 as the primary approach, replace manual `TypeFunction` examples
- [x] Update `docs/architecture.md` — update HKT three-layer architecture with new tiers
- [x] Update `docs/reference/packages.md` — update HKT exports and examples
- [x] Update `PHILOSOPHY.md` — update manual OptionF examples to `@hkt`
- [x] Update `packages/type-system/README.md` — document `_` marker, Tier 3
- [x] Update `packages/fp/README.md` — update HKT section
- [x] Update `.cursor/rules/hkt-conventions.mdc` — new conventions for `.ts` files
- [x] Update `AGENTS.md` — update HKT section with new approach
- [x] Add migration guide: old `extends TypeFunction` → new tiers
- [x] Add complete `@hkt` examples to `sandbox/error-showcase.ts`
- [ ] Language service: show generated `*F` type in hover/completion — **Deferred**: stretch goal, requires language service plugin changes

**Files changed:**

| File                                        | Change                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `docs/guides/typeclasses.md`                | Replace manual HKT examples with Tier 0/1 workflow |
| `docs/architecture.md`                      | Update three-layer HKT architecture                |
| `docs/reference/packages.md`                | Update HKT exports                                 |
| `PHILOSOPHY.md`                             | Update OptionF examples                            |
| `packages/type-system/README.md`            | Document `_` marker type                           |
| `packages/fp/README.md`                     | Update HKT section                                 |
| `.cursor/rules/hkt-conventions.mdc`         | New tier-based conventions                         |
| `AGENTS.md`                                 | Update HKT section                                 |
| `sandbox/error-showcase.ts`                 | Complete `@hkt` examples                           |
| `docs/PEP-007-hkt-boilerplate-reduction.md` | Mark as complete                                   |

**Gate:**

- [x] Documentation showcases the Scala-like workflow as primary
- [x] Migration path is clear for existing codebases
- [x] All doc examples are syntactically valid and match real API

## End-State Example

After all waves, the full Functor workflow in a `.ts` file:

```typescript
type Option<A> = A | null;
type Either<E, A> = { _tag: "Left"; error: E } | { _tag: "Right"; value: A };

/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};

/** @impl Functor<Either<string>> */
const eitherStringFunctor = {
  map: (fa, f) => (fa._tag === "Left" ? fa : { _tag: "Right", value: f(fa.value) }),
};

function lift<F, A, B>(F: Functor<F>, f: (a: A) => B): (fa: F<A>) => F<B> {
  return (fa) => F.map(fa, f);
}
```

No `Kind`, no `OptionF`, no `TypeFunction`, no `_`. Compare to Scala:

```scala
given Functor[Option] with
  extension [A](fa: Option[A]) def map[B](f: A => B): Option[B] = fa.map(f)
```

Equally concise.

## Files Changed (all waves combined)

### Code (~20 files modified, ~3 new)

| File                                       | Wave    | Change                                                                         |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------ |
| `packages/type-system/src/hkt.ts`          | 1, 2    | Add `type _`; migrate built-in `*F` to `@hkt` Tier 3                           |
| `packages/type-system/src/index.ts`        | 1       | Re-export `_`                                                                  |
| `packages/fp/src/hkt.ts`                   | 1, 2    | Re-export `_`; remove migrated `*F`, add re-exports from data modules          |
| `packages/fp/src/index.ts`                 | 1, 2    | Barrel export `_` and `*F` types                                               |
| `packages/fp/src/data/option.ts`           | 2       | Add `/** @hkt */` to `Option<A>`                                               |
| `packages/fp/src/data/either.ts`           | 2       | Add `/** @hkt */` to `Either<E, A>`                                            |
| `packages/fp/src/data/list.ts`             | 2       | Add `/** @hkt */` to `List<A>`                                                 |
| `packages/fp/src/data/nonempty-list.ts`    | 2       | Add `/** @hkt */` to `NonEmptyList<A>`                                         |
| `packages/fp/src/data/validated.ts`        | 2       | Add `/** @hkt */` to `Validated<E, A>`                                         |
| `packages/typesugar/src/index.ts`          | 1       | Re-export `_`                                                                  |
| `packages/macros/src/hkt.ts`               | 1, 2, 3 | Tier 3 `_` detection; Tier 2 companion generation; TypeChecker helpers         |
| `packages/macros/src/typeclass.ts`         | 3       | Bracket-aware parsing; TypeChecker resolution in `@impl`; `summonMacro` update |
| `packages/macros/src/specialize.ts`        | 3       | Support partial-application brands in `narrowKindType`                         |
| `packages/core/src/diagnostics.ts`         | 1, 2, 3 | Add TS9301–TS9304 descriptors                                                  |
| `packages/transformer/src/index.ts`        | 1, 3    | Re-add `@hkt` to tags; fix `extractBrandFromImpl`                              |
| `packages/transformer/src/virtual-host.ts` | 4       | Add HKT rewrite path for `.ts` files                                           |
| `packages/transformer/src/hkt-rewriter.ts` | 4       | **New** — AST-based `F<A>` → `Kind<F, A>` rewriter                             |

### Tests (~3 new files)

| File                                                 | Wave    | Coverage                                                          |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `tests/hkt-macro.test.ts`                            | 1, 2, 3 | **New** — Tier 3 `_`, Tier 2 companion, Tier 1 `@impl` resolution |
| `tests/hkt-rewriter.test.ts`                         | 4       | **New** — all 13 edge cases for `F<A>` rewriting                  |
| `tests/jsdoc-macros.test.ts`                         | 3       | Add `@impl Functor<Option>` tests                                 |
| `packages/transformer/tests/auto-specialize.test.ts` | 3       | Add partial-application tests                                     |

### Documentation (~10 files)

| File                                | Wave | Change                                    |
| ----------------------------------- | ---- | ----------------------------------------- |
| `docs/guides/typeclasses.md`        | 5    | Replace manual HKT examples with Tier 0/1 |
| `docs/architecture.md`              | 5    | Update HKT architecture section           |
| `docs/reference/packages.md`        | 5    | Update HKT exports                        |
| `PHILOSOPHY.md`                     | 5    | Update OptionF examples                   |
| `packages/type-system/README.md`    | 5    | Document `_` marker                       |
| `packages/fp/README.md`             | 5    | Update HKT section                        |
| `.cursor/rules/hkt-conventions.mdc` | 5    | New tier-based conventions                |
| `AGENTS.md`                         | 5    | Update HKT section                        |
| `sandbox/error-showcase.ts`         | 1, 5 | Add `@hkt` error examples                 |
| `sandbox/hkt-poc-detection.ts`      | —    | Already exists (POC)                      |

## Consequences

### Benefits

1. **Zero boilerplate for common case** — Tier 1 requires no annotations at all
2. **True Scala parity** — `@impl Functor<Option>` reads like `given Functor[Option]`
3. **Progressive disclosure** — use Tier 1 by default, explicit tiers when you need control
4. **Backwards compatible** — explicit `OptionF extends TypeFunction` still works
5. **Zero runtime cost** — all encoding is type-level, erased at compile time
6. **Zero false positives** — detection algorithm is provably correct (type params never take args in TS)

### Trade-offs

1. **Implicit magic in Tiers 0-1** — invisible rewrites could confuse users debugging type errors
2. **Tier 1 (`@impl Functor<Option>`) needs TypeChecker** for resolving `Option` → may not work in degraded IDE mode (fallback: Tier 2/3)
3. **Tier 0 (`F<A>`) does NOT need TypeChecker** — pure AST walk, works everywhere
4. **Last-param convention** — if you want a different parameter as the hole, must use Tier 3
5. **Extra preprocessing pass for `.ts` files** — adds a fast AST scan to the pipeline (should be negligible vs type checking)

### Risk Assessment

| Risk                                      | Likelihood | Impact | Mitigation                                                                   |
| ----------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------- |
| `F<A>` detection has false positives      | **None**   | High   | Impossible — type params can't take args in TS                               |
| `F<A>` rewrite doesn't run early enough   | **None**   | High   | Rewrite in `VirtualCompilerHost`, before `ts.Program` creation               |
| `F<A>` detection needs TypeChecker        | **None**   | High   | Verified: pure `ts.createSourceFile()` suffices                              |
| `@impl` resolution fails in degraded mode | Medium     | Low    | Tier 1 needs TypeChecker for `Option` resolution; fallback to Tier 2/3       |
| Multi-arity `Kind2<F, A, B>` complexity   | Low        | Medium | Defer to future work, use `_` marker for now                                 |
| Source maps for rewritten positions       | Low        | Low    | Text-level replacement preserves line numbers; same approach as preprocessor |

### Future Work

- Multi-kinded types: `Kind2<F, A, B>` or variadic `Kind<F, A, B>`
- `Kind` elimination: when both F and A are concrete, resolve to final type
- Preprocessor unification: `.sts` `F<_>` and `.ts` `F<A>` could share the rewriting logic (both are AST-level rewrites)
- Fast-path detection: skip the HKT rewrite pass entirely for files with no type parameters used with args (a quick scan)
