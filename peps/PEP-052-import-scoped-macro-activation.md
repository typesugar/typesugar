# PEP-052: Import-Scoped Macro Activation (cats-style syntax)

**Status:** In Progress (2026-07-04) — Wave 1 + registry-deletion Phases A–C landed (PR #34);
Phase E concrete-type method-sugar gating landed; Wave 2 `@syntax-labels` gating landed
(PR #43); Wave 3 scope-based do-notation instance resolution landed — the last
process-global instance registry (`doNotationRegistry`) is deleted and the
"No process-global instance/type-rewrite registry" acceptance criterion is met
(PR #44); Wave 4 de-magicking landed — HKT typeclass knowledge is declaration-derived,
the last dead post-registry surfaces deleted (PR #45); Wave 5 `Show` tagging landed
(also fixed a latent `resolveTypeString` bug affecting any `symbol`/`unknown`/`object`
-typed instance); remaining: Phase D (moved to
[PEP-053](PEP-053-always-on-specialization.md)) and planned Waves 6-10 (marker text
fallback, intrinsics-from-source, JSDoc dispatcher unification, macro-package
discovery + algebra relocation, optional checker-derived native detection — see
"Planned waves")
**Date:** 2026-06-29
**Author:** Claude (with Dean Povey)
**Extends:** [PEP-017](PEP-017-derive-unification.md) ("everything is a typeclass")
**Supersedes (in part):** [PEP-027](PEP-027-use-extension-emit-registration.md) (`"use extension"` global registration)
**Relates to:** [PEP-032](PEP-032-macro-expansion-import-emission.md) (companions), [PEP-034](PEP-034-language-service-parity.md) (LS infra)

## Summary

Make every piece of typesugar sugar **activate only through an explicit import in
the file that uses it**, the way Scala/cats activates typeclass syntax
(`import cats.syntax.eq.*`). Remove all ambient behavior: the process-global
instance/type-rewrite registry, the hardcoded builtins (`Eq.number`,
`BUILTIN_METHOD_RECEIVER_NAMES`, builtin macro-name lists), and label/operator
rewrites that fire regardless of imports. The compiler becomes a **generic engine
over userland annotations**; std becomes "just a library" that uses the same
public surface as third parties.

## Motivation

Today, resolution is **ambient**:

- The landing page describes the current behavior plainly: _"the compiler sees
  `===` on a `User`, resolves the `Eq` typeclass, **auto-derives** an instance,
  and inlines it"_ — with no import, no `@derive`, nothing in the file asking for
  structural equality.
- Operators/instances resolve through a **process-global registry** populated by
  side-effecting registration as files are transformed.
- There are **hardcoded builtins** (`Eq.number`, a `BUILTIN_METHOD_RECEIVER_NAMES`
  set, builtin macro names), so std is privileged and third-party macros are not
  first-class.

This is not just a style problem. The global registry caused a real, shipped CI
failure: `tests/match-destructure.test.ts` passed in isolation but failed in the
full sharded run because another test file had registered `Option` as `@opaque`
and the state **leaked across files**, flipping the `None` codegen (fixed in
PR #29 by clearing the registry per-test — a band-aid over the architecture).
Ambient activation means non-local reasoning, order-dependence, and a privileged
standard library.

### Goals

1. **Explicit:** sugar activates only via imports visible in the using file.
2. **Local & deterministic:** a file's behavior depends only on its own imports +
   the types it references — no global state, no cross-file leakage.
3. **No hardcoded magic:** the compiler special-cases no type, operator, label, or
   macro name. Std uses the identical public mechanism as third parties.
4. **Faithful to Scala/cats:** instances are data resolved from scope; _syntax_
   (operators/methods) is activated by importing syntax modules; coherence is
   **local** (scope decides; ambiguity is an error), not global.

## Principle: two trigger classes, one import rule

Every macro kind is triggered in one of two ways:

| Trigger class | Examples                                                   | The trigger is…                                                                              | Activation                                                     |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Named**     | `comptime(x)`, `` sql`…` ``, `@derive(Eq)`, `Refined<T,P>` | an **imported identifier** (call, tag, decorator, type alias)                                | the import **is** the activation — already explicit            |
| **Syntactic** | `a === b`, `a + b`, `let:`/`requires:` labels, `F<A>` HKT  | a **syntactic form** (operator token, statement label, type application) — no name to import | an explicit **`@syntax-*` activation import** opts the file in |

The single rule: **nothing rewrites unless the using file imports the thing that
activates it.** For named triggers that's automatic. For syntactic triggers we
introduce activation-import markers (below).

## Part 1 — Typeclasses, operators, and methods

### Three tiers of escalating explicitness

```
1. Instance        @typesugar/eq  /  @derive(Eq)        → data only, no sugar
2. Method syntax   import "@typesugar/syntax/eq"        → a.eq(b) / a.notEq(b)   (additive, safe)
3. Operator syntax import "@typesugar/syntax/eq/ops"    → a === b / a !== b       (redefines a primitive — loudest opt-in)
```

- **Methods** are additive (introduce a name that didn't exist), so they're the
  ordinary "syntax" import.
- **Operators** redefine a native primitive, so they require a _separate, louder_
  import. A file that wants typeclass methods but wants `===` to stay vanilla
  simply **stops at tier 2**. Tier 3 implies tier 2 (operators pull in methods).

This is finer-grained than cats (which bundles operator+method) — appropriate
because TS has stronger reason to keep operator overloading at arm's length.

### Resolution algorithm (for `a === b` in file F)

1. **Activations:** collect from F's import graph which `@syntax-operators` /
   `@syntax-methods` markers are present and which typeclasses they name. If no
   activated typeclass declares `@op ===`, stop — `a === b` is native.
2. **Candidate typeclasses:** among activated ones, find those mapping `@op ===`
   (read from `@typeclass`/`@op` JSDoc via the checker).
3. **Instance search** for the operand type `T`, from scope only: imported
   `@instance` values, or the type's companion / `@derive` (PEP-032). No global
   registry.
4. **Rewrite** `a === b` → `eqT.equals(a, b)` (inlined/specialized). If no instance
   for `T` → native `===`. If ≥2 activated typeclasses claim `===` and both have an
   instance for `T` → **ambiguity error** (local coherence).

`!==`, and `< > <= >=` (via `Ord`), follow the same algorithm under
`@typesugar/syntax/ord` / `…/ops`.

### Method form and reference-equality escape

- **`a.eq(b)` / `a.notEq(b)`** — the method form of `Eq`, activated by tier 2.
  The method name comes from the typeclass declaration (author-controlled), so
  third parties name their own surface.
- **Reference equality**, needed only inside operator-activated files:
  - `refEq(a, b)` — a function that emits native `a === b`.
  - `a.ref === b.ref` — `a.ref` is a zero-cost identity that retypes the value as
    `Ref<T>` (a brand with **no** `Eq` instance). By rule (3) it fails the
    instance search and falls through to native `===` — **no special-casing**.
  - Both emit native `===` ("the `===` you'd get without typesugar"), not
    `Object.is`.

### Loose equality

`==` / `!=` are left native, plus an **opt-out-able lint/diagnostic** discouraging
them (we are leaning into `===` as the typeclass operator).

## Part 2 — The same strategy for the other macro kinds

The two-trigger-class rule covers all six macro kinds:

| Macro kind                                                                        | Trigger                          | Class                  | Import-scoped how                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Expression** (`comptime`, `staticAssert`, `pipe`)                               | imported call ident              | named                  | already explicit — resolve the callee symbol; expand iff its declaration is `@macro`. No builtin name list.                                                                                                                                                                                                                                            |
| **Tagged template** (`sql`, `regex`, `html`)                                      | imported tag ident               | named                  | already explicit — same, on the tag symbol.                                                                                                                                                                                                                                                                                                            |
| **Attribute / derive** (`@derive`, `@reflect`, `@tailrec`)                        | imported decorator ident         | named                  | already explicit — the decorator symbol's `@attribute-macro`/`@deriving` declaration drives it; derivables (`Eq`…) are imported too.                                                                                                                                                                                                                   |
| **Type** (`Refined<T,P>`, `Kind<F,A>`)                                            | imported type alias              | named                  | already explicit — the alias is imported; recognized by its `@type-macro` declaration.                                                                                                                                                                                                                                                                 |
| **Operators** (`===`, `+`, `<`)                                                   | operator token                   | **syntactic**          | **NEW:** `@syntax-operators <TC>` activation import (Part 1).                                                                                                                                                                                                                                                                                          |
| **Labeled block** (`let:`/`yield:` do-notation, `requires:`/`ensures:` contracts) | statement label                  | **syntactic**          | **NEW:** `@syntax-labels <macro>` activation import — e.g. `import "@typesugar/contracts/syntax"` activates `requires:`/`ensures:` in the file. Replaces today's global `triggerLabels` registration.                                                                                                                                                  |
| **HKT** (`F<A>` → `Kind<F,A>`)                                                    | type application of a type param | **declaration-scoped** | **The binder is the activation.** `F<A>` only appears where a higher-kinded parameter `F` is in scope, and only its binding declaration introduces `F` — so that declaration carries `@hkt` (existing tier) and `F<A>` rewrites within its scope. No use-site/file import: concrete consumers write `Option<number>`/`Functor<OptionF>`, never `F<A>`. |

**Named-trigger macros are already the model** — importing the symbol _is_ the
opt-in. The only work is **de-magicking**: resolve them purely from the imported
symbol's macro annotation, deleting any hardcoded builtin name lists, so a
third-party `comptime`-style macro is resolved identically to std's.

**Free-standing syntactic triggers** (operators, labels) gain the **`@syntax-*`
activation-import mechanism**. A file with no such marker in its import graph is
never a rewrite candidate for that form — which also gives the transformer a cheap,
correct **per-file gate** (the original question that started this thread: "the
transformer should only be in scope if there are appropriate imports").

**HKT is the exception that proves the rule** — it's syntactic but **bound**, not
free-standing: `F<A>` can only occur inside the declaration that binds the
higher-kinded `F`, so the activation lives on that binder (`@hkt`) rather than on a
file import. There are no use sites to gate. So HKT needs _less_ machinery than I
first proposed, not more.

## Part 3 — The generic engine (no hardcoded magic)

The compiler special-cases nothing. All behavior derives from userland
annotations the type-checker can read:

- `@typeclass` + `@op <token>` — declares a typeclass and which operator/method a
  member maps to.
- `@instance` / `@impl`, `@derive` / `@deriving` — instances (data) + derivation
  strategies, attached to types (companions).
- `@macro` / `@attribute-macro` / `@type-macro` — marks an exported symbol as a
  named-trigger macro.
- `@syntax-methods <TC>`, `@syntax-operators <TC>`, `@syntax-labels <macro>`,
  `@syntax-hkt` — activation markers; importing a module that carries one opts the
  importing file into that syntactic rewrite.

### Third-party authoring example (a `+` for money)

```ts
// @acme/money — typeclass (declares the operator/method mapping)
/** @typeclass */
export interface Add<A> {
  /** @op + */
  add(a: A, b: A): A;
}

// instance (data)
/** @instance */
export const addMoney: Add<Money> = { add: (a, b) => new Money(a.cents + b.cents) };

// activation markers (the import handles)
// @acme/money/syntax/add      →  /** @syntax-methods Add */   export {};
// @acme/money/syntax/add/ops  →  /** @syntax-operators Add */ export {};
```

A consumer:

```ts
import { Money } from "@acme/money";
import "@acme/money/syntax/add/ops"; // opt into the + operator HERE

const total = a + b; // → addMoney.add(a, b), inlined. Without the import: native +.
```

The transformer needs **zero** knowledge of `Add`, `Money`, or `+`. Std's `Eq`
goes through this exact path — the proof the mechanism is complete (if std needed
a builtin, the design would be leaky).

## Migration — de-magicking std

1. Delete the process-global instance/type-rewrite registry; resolve from scope
   (imports + companions) via the checker.
2. Delete hardcoded builtins (`Eq.number`, `BUILTIN_METHOD_RECEIVER_NAMES`,
   builtin macro-name lists). Reship as ordinary instance modules
   (`@typesugar/eq` etc.) and `@syntax-*` markers.
3. Convert `"use extension"` (PEP-027) global registration → `@syntax-methods`
   imports.
4. Convert label macros (contracts `requires:`/`ensures:`, do-notation) from
   global `triggerLabels` → `@syntax-labels` imports.
5. Update the language service (PEP-034) to use the same import-scoped discovery
   (it already has the checker; lexical resolution is _easier_ than the registry).
6. Update docs (`getting-started`, `type-safety`, per-package guides): operators
   and methods now require the relevant `syntax` import; `@derive`/instance is
   required for `===` (no more auto-derive-from-nowhere).

Being **pre-release with no consumers**, this is the ideal time; behavior changes
are acceptable.

## Coherence

Scala-style **local** coherence: multiple instances may exist; scope decides;
ambiguity is a compile error. This trades global coherence (Rust/Haskell) for
locality and flexibility, and is the deliberate choice implied by "follow the
Scala model." Consequence to document: e.g. a structure built with one `Ord` and
queried with another is the user's responsibility.

## Decisions (DECIDED — 2026-06-29)

1. **Tiers:** methods and operators are **separate** imports (tier 2 vs tier 3),
   with bundles `@typesugar/syntax/all` (methods) and `…/all/ops` / a `prelude`
   (incl. operators). ✅ **Decided.**
2. **Operator syntax imported but no instance for `T`:** **native fallback +
   opt-in lint** (friendlier than cats's hard error, since `===` is already
   valid TS). ✅ **Decided.**
3. **Reference equality:** ship **both** `a.ref` and `refEq()`, both emitting
   native `===` (not `Object.is`). ✅ **Decided.**
4. **Loose `==`/`!=`:** native + opt-out-able discouragement lint. ✅ **Decided.**

(Naming of marker tags / module paths remains a bikeshed to settle during
implementation; it doesn't affect the design.)

## Open questions

- **HKT activation — RESOLVED (declaration-scoped).** `F<A>` can only appear where
  a higher-kinded parameter `F` is in scope, and only the declaration that binds
  `F` introduces it. So activation lives on that binder (the `@hkt` tier that
  already exists) and `F<A>` rewrites within its scope; there are no free-standing
  use sites to gate, so no `@syntax-hkt` file import is needed. (Earlier draft
  wrongly lumped HKT with operators/labels.)
- **Naming** of the activation markers and syntax module paths (`/syntax/eq` vs
  `/eq/syntax`, `@syntax-operators` vs `@op-syntax`).
- **Diagnostics** for "you wrote `a === b` and an instance exists but you didn't
  import the operator syntax" — a "did you mean to `import …/ops`?" hint.
- **Phasing:** land the engine + Eq/Ord first (Part 1), then migrate labels/HKT
  (Part 2), then delete the global registry. Each is a wave.

## Acceptance criteria

- No process-global instance/type-rewrite registry; resolution is purely
  scope-based (verified by a test that previously relied on cross-file leakage —
  e.g. the match-destructure case — passing without any registry reset).
- No hardcoded type/operator/macro names in the transformer; std `Eq`/`Ord`/etc.
  are ordinary imported libraries.
- A third-party typeclass with `@op`/`@instance`/`@syntax-*` gets operators,
  methods, and IDE support with zero compiler or plugin changes (covered by a
  fixture package in the test suite).
- A file that imports no `@syntax-*` marker and no named macro is byte-for-byte
  unchanged by the transformer.

## Implementation status & deferred work

**Wave 1 (landed):** the generic import-scoped activation engine + Eq/Ord
**operators**.

- Activation-marker discovery (`@syntax-operators`/`@syntax-methods`), read via the
  checker; markers are carried on an exported `const` so the JSDoc survives `.d.ts`
  generation. A typeclass **defined in the using file** activates its own syntax
  locally ("you don't import what you define").
- A registry-free typeclass op/method index read from `@typeclass` + `@op` JSDoc.
- Operator rewriting gated on activation and resolved purely from scope
  (`resolveInstance`: local-scope incl. non-exported decls → explicit-import →
  module-scan). **The process-global registry fallback in the resolver is deleted.**
- std ships `@op` tags + `@typesugar/std/syntax/{eq,eq/ops,ord,ord/ops}` markers;
  std `Eq`/`Ord` operators resolve through the public mechanism, no builtin magic.

**Status of the registry removal:** the two USER-FACING resolution paths are now
fully **registry-free in BOTH transformers** (main + transformer-core/playground):

- **Operators** (`a === b`, `a < b`): import-scoped (activation marker or in-file
  `@typeclass`), instances from scope. The typeclass-definition lookup reads the
  **op-index** (seeded with `STANDARD_TYPECLASS_DEFS` as static built-in metadata,
  source `@typeclass` interfaces authoritative), NOT the mutable `typeclassRegistry`.
- **Instance-method sugar** (`p.equals()`): candidates from the op-index
  (`getTypeclassesDeclaringMethod`), instances via `resolveInstance` + `@derive`
  companion detection. No `findInstance`.

This fixes the cross-file leakage motivation. **The deep remaining work** is removing
`instanceRegistry` from the INTERNAL machinery where it is still load-bearing:

- `@derive` field-instance resolution (deriving `Eq<Point>` needs `Eq<number>` for the
  `number` field — currently from the registry's primitive instances);
- do-notation / comprehensions FlatMap/ParCombine detection (by type-constructor);
- `implicits`, `generic`-expansion, `primitives` (writers), `erased` (reader).

Cleanly removing it needs a **static built-in primitive-instance table** (analogous to
the op-index seed) for derivation, plus scope-based resolution for user instances —
not the user-facing ambient operator/method behavior (already fixed). Tracked below.

Deferred (the registry stays populated for the above until migrated — nothing broken):

1. **Method-syntax `@syntax-methods` gating** — method sugar resolves from scope but
   is not yet gated on an activation import (the breaking flip; activation state is
   already tracked).
2. **Re-ship remaining instances** as scanner-discoverable `@impl` + per-package
   `<pkg>/syntax/<tc>` markers (const form), and **empty the prelude** so non-Eq/Ord
   typeclasses also stop being ambient.
   - DONE (additive `@impl`, registry still populated): std Eq/Ord (+ markers);
     fp (instances + eq/show/semigroup), math (complex/rational/interval/bigdecimal),
     fusion — all now scanner-discoverable AND source-inlinable.
   - REMAINING: std collections (`flatmap`/`par-combine`, dynamic `forType`), effect,
     sql; per-package `/syntax/*` markers for the method typeclasses; empty prelude.
3. **Inlining/specialization registry.** The separate `instanceMethodRegistry` and
   its 30 static source-string builtins. **MOVED → [PEP-053](PEP-053-always-on-specialization.md)**
   (always-on specialization: builtin-table deletion + explicit-`specialize` surface
   removal + pipeline unification). Note the caveat found while scoping it:
   `tryExtractInstanceFromSource` does NOT yet follow import aliases, so cross-package
   instances (all the builtins) are not actually reachable from source today — that
   capability work is PEP-053 Wave 2.
4. **Second operator path in `transformer-core`** (playground) — **DONE**: migrated to
   the gated, scope-based model (`scanImportsForScope` wired into its transform; the
   registry-based inference helpers removed). The playground is now import-scoped for
   operators.
5. **Delete the global registry objects** (`instanceRegistry`/`typeclassRegistry`/
   `STANDARD_TYPECLASS_DEFS`) and the `coherence.ts` `instances` map (fold into the
   resolver's `ambiguous` result) — only after the internal derivation/do-notation/
   implicits consumers are migrated (see "deep remaining work" above). Then remove
   `clearRegistries`/`clearSyntaxRegistry` from test setup.
6. **Operator type-inference parity.** Nested operator chains (`(a + b) === c`),
   unannotated-initializer inference, and union-member instance matching are not
   ported to the scope-based resolver and currently fall through to native.
7. **Version-keyed caching.** Module-fact caches (scanner, importMap, markers,
   op-index) are keyed by path/program; key them by source-file version for
   watch/LSP incremental correctness, and clear them on pipeline invalidation.
8. **Labels / HKT** activation (PEP Part 2) — `@syntax-labels` for
   `requires:`/`ensures:`/do-notation and the `@hkt` declaration-scoped path.

**Invariant for every deferred item:** the global registry remains in place and
populated until its last consumer is migrated, so the build, the language service,
and the playground are never left broken between waves.

### Registry-object deletion — phased plan (empirically scoped)

A neuter experiment (stub `findInstance`→`undefined`, run the suite) proved the
general `instanceRegistry` is **already dead** for derive/operators/methods/specialize
(all scope-based). It has exactly **two** live consumers, so deleting the objects is a
bounded, non-redesign follow-up:

- **Phase A — implicits → scope.** `resolveImplicit` (implicits.ts) reads the registry
  directly to fill `= implicit()` params. Migrate its call site (has `ctx` + the type
  node) to `resolveInstance` (scope), keeping the registry as a fallback (additive,
  green). Edge case: the implicit inference builds a synthetic type node — resolve the
  concrete field type robustly (e.g. from the call's resolved signature / arg types)
  rather than `getTypeFromTypeNode` on a synthetic node.
- **Phase B — do-notation FlatMap/ParCombine → focused lookup. DONE (PR #34).** `let:`/
  `yield:`/`par:` call `hasFlatMapInstance`/`getFlatMapMethodNames`/`hasParCombineInstance`
  (resolve by type-constructor _name_, HKT). These now read a dedicated `doNotationRegistry`
  (`Map<"<TC>:<forType>", meta>`) kept separate from the general registry and populated by
  `registerInstanceWithMeta` whenever it registers a FlatMap/ParCombine instance (chosen over
  brand-based scope resolution as the smaller, bounded change; side-effect imports like
  `import "@typesugar/effect"` still populate it). `getInstanceMeta` routes FlatMap/ParCombine
  through the same map. **Also required for the gate:** the neuter experiment revealed the
  memory's "exactly two consumers" undercounted — `summon<TC<T>>()`'s explicit-instance step
  was a _third_ live `findInstance` read. Migrated it to scope-first (`resolveInstance` on the
  inner type's `ts.Type`) with the registry retained as fallback, mirroring Phase A's implicits
  migration. After this, the neuter gate (stub `findInstance`→`undefined`, full suite) shows
  **0 failures** — `instanceRegistry` has no live reads, so Phase C (delete the objects) can
  proceed. (The `typeclass.test "instance registry"` mechanism test that used to fail under
  neuter now passes because `getInstanceMeta` reads the focused `doNotationRegistry`.)
- **Phase C — delete the objects.** Split into two sub-parts (bigger than first scoped —
  the derivation planner and `summon`/`erased` also read the registry, uncovered by the
  neuter which only stubbed `findInstance`):
  - **C1 — `instanceRegistry` deleted. DONE (PR #34).** Migrated every remaining reader off
    it first (each verified): the `@derive` transitive-derivation planner
    (`hasPrimitiveOrInstance`) → scope (`hasInstanceInScopeByName`); `summon`/`erased` →
    `resolveInstance`; `= implicit()` → scope + a name-based scope fallback
    (`resolveInstanceInScopeByName`); the transformer/`@instance` dedup guards dropped
    (`registerInstanceWithMeta` is idempotent). Then deleted `findInstance`, `getInstances`,
    `resolveImplicit`, the array + globalThis backing + all writers (`primitives`, `generic`
    ×2, transformer + transformer-core pushes, the `@impl` macro push), and updated the
    registry-_mechanism_ tests (typeclass.test → do-notation lookup; fusion "registered in
    the instance registry" dropped; derive-advanced membership asserts dropped; red-team +
    instance-resolver isolation cruft; showcase). `registerInstanceWithMeta` survives only to
    populate the focused do-notation lookup (`mirrorDoNotationInstance`) + attach companions.
    The only surviving instance store is the FlatMap/ParCombine do-notation lookup.
  - **C2a — `typeclassRegistry`'s operator/method _syntax_-lookup role removed. DONE (PR #34).**
    The op-index (`getOperatorCandidates`/`getTypeclassesDeclaringMethod`, seeded from
    `STANDARD_TYPECLASS_DEFS` + program `@typeclass` interfaces) is the sole owner of syntax
    lookup: deleted the dead `getSyntaxForOperator` + its "syntax registry" mechanism tests;
    migrated the `extend`-macro extension-method scan to `getTypeclassesDeclaringMethod(program)`.
  - **C2b — `typeclassRegistry` object deleted. DONE (PR #34).** The op-index now owns full
    typeclass _definitions_: a shared `buildTypeclassInfoFromInterface` (factored out of the
    `@typeclass` macro) + the `STANDARD_TYPECLASS_DEFS` seed populate a per-program `def`
    (`getTypeclassDef`/`getAllTypeclassDefs`/`isTypeclassDeclared`). Migrated the readers — HKT
    expansion (`generateHKTExpandedType` → `getTypeclassDef(ctx.program)`), `getTypeclassesForMethod`
    (SFINAE, → static seed), and deleted the dead `getTypeclass`/`isRegisteredTypeclass`. Then
    deleted the object + globalThis backing + ALL writers (both `@typeclass` macro forms, the
    module-load seeding, `registerStandardTypeclasses`, `registerTypeclassDef` incl. the
    FlatMap/ParCombine self-registrations, `updateTypeclassSyntax` + the transformer's
    pre-registration pass) + the public `getTypeclasses`; `clearSyntaxRegistry` → no-op then
    deleted; `clearRegistries` now clears only the do-notation lookup. Mechanism tests migrated
    (typeclass.test "typeclass registry" block, fusion/red-team probes, showcase reflection;
    transformer/derive setups no longer call the deleted setup fns — std comes from the seed).
  - **C2c — DONE (PR #34).** Emptied the ambient prelude (nothing in scope by default in
    import-scoped mode; `resolution.prelude` still configurable) and decoupled do-notation from
    the scope gate (`let:`/`yield:`/`par:` self-activate via their macro import, resolving
    FlatMap/ParCombine by type-constructor name). Deleted `clearSyntaxRegistry` (no-op) + its ~29
    call sites across 15 test files. `coherence.ts`'s `instances` map needed no fold — the
    `CoherenceChecker` is an unwired standalone utility (never called in resolution) and the
    resolver already owns ambiguity via its `ambiguous` result.
  - **Phase C RESULT: both ambient registries (`instanceRegistry`, `typeclassRegistry`) are
    deleted; instance resolution is scope-based and typeclass definitions/syntax are per-program
    (op-index). The only surviving instance store is the focused do-notation lookup. Full suite
    7233/0 green.**
- **Phase D — inlining registry. MOVED → [PEP-053](PEP-053-always-on-specialization.md).**
  Replacing `instanceMethodRegistry`'s 30 static source-string builtins with
  `tryExtractInstanceFromSource` grew into a standalone program: PEP-053 also deletes the
  explicit `specialize()`/`specialize$`/`mono()`/`inlineCall()`/`fn.specialize()` surface
  (specialization becomes an always-on optimization with only the `@no-specialize` opt-out)
  and unifies the duplicated specialization pipeline. Tracked there, not here.
- **Phase E — `@syntax-methods` gating + docs sweep. DONE (concrete-type method sugar).**
  Gated `tryResolveTypeclassMethod` (`p.equals(q)`, `p.compare(q)`, `p.combine(q)`, etc. —
  the concrete-type instance-method path, resolved via `resolveInstance`/`@derive`
  companion) on activation, mirroring the operator gate exactly: activated iff the using
  file imports a `@syntax-methods <TC>` (or `@syntax-operators <TC>`, tier 3 ⊇ tier 2)
  marker, or declares the typeclass itself. Wired the already-existing but previously
  unused `getMethodCandidates` (scoped op-index lookup) in place of the unscoped
  `getTypeclassesDeclaringMethod`; only one call site needed gating (transformer-core has
  no method-sugar path yet — a separate, pre-existing gap, not a Phase-E duplicate to
  un-gate). Shipped `@syntax-methods` (+ `/ops` where an operator mapping exists) marker
  modules in `packages/std/src/syntax/` for every remaining seeded typeclass —
  `Semigroup`, `Monoid`, `Group`, `Numeric`, `Integral`, `Fractional`, `Clone`, `Debug`,
  `Default`, `Json`, `TypeGuard` — so the flip doesn't strand any of them without an
  activation import. Two tests relied on ambient method sugar with no marker import;
  fixed by adding the import (not by weakening the gate). Docs swept:
  `docs/guides/typeclasses.md` (removed the false "auto-derived by default"/"@derive is
  just documentation" claims — both are now required; rewrote Extension Methods to show
  the required `@syntax-methods` import), `docs/architecture.md` (Extension Method
  Resolution Order + Operator Overloading sections — dropped the stale
  `typeclassRegistry.syntax` reference, documented both gates precisely),
  `docs/guides/opt-out.md` (`operators` feature is implemented, not "when implemented";
  noted `extensions` also covers method sugar), `docs/index.md` Quick Example (added
  `Clone`/`Json` + their marker imports; dropped `.show()`, which was never actually
  reachable — `Show` isn't `@typeclass`-tagged, see below), plus two doc EXAMPLE files
  that predate this work and were already silently wrong (`docs/examples/getting-started/
welcome.ts`, `docs/examples/core/derive.ts` — claimed `===` rewrites to structural
  equality but never imported `@typesugar/std/syntax/eq/ops`, so it was native reference
  equality all along; no test caught it since `playground-examples.test.ts` only checks
  "runs without throwing," not output content — fixed both).
  **Deferred, deliberately not touched:** `Show` (`packages/fp/src/typeclasses/show.ts`)
  has no `@typeclass` JSDoc tag, so it isn't in the typeclass index and its method sugar
  (`.show()`) was already unreachable via `tryResolveTypeclassMethod` before this change —
  tagging it now would activate the `@typeclass` attribute macro (codegen, not inert
  metadata — the same non-neutral-transform gotcha hit during Phase C's `@impl` additions)
  and needs its own careful pass with export-shape-test verification, not a drive-by
  here. HKT method sugar (`xs.map(f)`, `o.flatMap(g)` — resolved by type-constructor
  brand via the do-notation registry, a different mechanism from the concrete-type path
  just gated) remains untouched, per "Why deleting the registry is gated on the HKT/
  method-sugar work" below — still correctly deferred to Wave 2/Part 2.

- **Wave 2 — `@syntax-labels` gating for labeled-block / trigger-label macros.
  DONE (2026-07-03).** The two remaining free-standing syntactic triggers from the
  Part 2 table are now activation-gated, mirroring the operator/method gates:
  - **Engine:** `FileResolutionScope` gains `activatedLabelSyntax` (keyed by
    **macro name**, not label text, so one marker covers all of a macro's label
    aliases — `let:`/`seq:`); `readSyntaxActivationMarkers` reads the new
    `@syntax-labels <macroName>` JSDoc tag; `activateLabelSyntax` /
    `isLabelSyntaxActivated` on the tracker.
  - **Markers shipped:** `@typesugar/std/syntax/do` (activates `letYield` +
    `parYield` — `let:`/`seq:`/`par:`/`all:`; continuation labels need no gating,
    they're only consumed after an activated head label) and
    `@typesugar/contracts/syntax` (activates `contract`'s `requires:`/`ensures:`
    trigger labels). The explicit `@contract` decorator form stays a named
    trigger — no marker needed.
  - **Gates at every dispatch site:** legacy transformer statement dispatch +
    expression-position (broken-parse `const x = let, {a}`) path +
    `tryExpandImplicitLabelMacro` (contracts, legacy-only); transformer-core
    statement dispatch + the `const x = let;` merge peek (which must be gated
    too, or the held variable statement would be silently dropped).
  - **Diagnostic:** unactivated block-shaped label matching a registered macro
    emits **TS9224** (warning) with a "add `import "<syntaxModule>"`" help —
    critical because unexpanded do-notation is still valid JS (`x << effect()`
    becomes a bit-shift) and unexpanded `ensures:` is silent dead code. New
    optional `syntaxModule` field on `LabeledBlockMacro`/`AttributeMacro` feeds
    the hint. Ordinary loop labels colliding with macro names (`all: for(…)`)
    are never hijacked and never warned (non-block-shaped).
  - **Bug found & fixed while wiring:** activation markers were silently
    dropped for files rewritten by the expression-comprehension preprocessor —
    the re-parsed `SourceFile` isn't part of the `ts.Program`, so
    checker-based module resolution returned nothing. `scanImportsForScope`
    now resolves markers against the program's own copy of the file (imports
    are never touched by preprocessing, so specifier text matches). This
    affected ALL marker kinds (operators/methods too) in preprocessed files.
  - **Review round (same PR, five-lens + verify):** four confirmed issues in
    the first cut, all fixed before merge:
    1. _Playground regression:_ transformer-core's `transformCode` default
       in-memory host can't resolve any module, so checker-based marker reads
       found nothing and labels went dead in the playground. Fixed by making
       `syntaxModule` double as a **resolution-free activation fallback** in
       `scanImportsForScope`: an import specifier exactly matching a
       registered macro's `syntaxModule` activates it with no module
       resolution. (Operator/method markers have no registry back-pointer, so
       the same playground gap for THEM is pre-existing Wave 1 behavior —
       still open, tracked below.)
    2. _Preprocessor mangling:_ the string-level comprehension preprocessor
       committed to do-notation before the AST gate ran; in an unactivated
       file the gated merge then refused to repair the rewrite, emitting
       `__letyield_` fragments (invalid JS) with `changed: true`. Fixed by
       gating the preprocessor itself — the pipeline scans activation (the
       program exists by then; the scan is idempotent) and skips the rewrite
       when neither comprehension macro is activated.
    3. _Loop-label hijack in activated files:_ the block-shape check only
       gated the hint, not dispatch, so `all: for (…)` in a file that
       activates do-notation hard-errored. Dispatch now requires
       `ts.isBlock(stmt.statement)` at every site — a labeled non-block is
       never a candidate, activated or not.
    4. _Trigger-label early exit:_ an unactivated candidate `break`-ed the
       whole body scan, so a later label of a DIFFERENT (activated)
       trigger-label macro would be skipped. Now `continue`s, hinting at most
       once per macro.
       Plus cleanups: the gate + hint logic (three copies) consolidated into
       `transformer-core/src/label-activation.ts` (both transformers import it;
       `registry.getLabeledBlock` docs now warn it is the raw, activation-unaware
       lookup); `scanImportsForScope` iterates the program's copy of the file
       directly and skips guaranteed-to-fail checker lookups when the file isn't
       in the program.
  - **Tests:** `packages/std/tests/pep052-syntax-labels.test.ts` (on/off/hint/
    loop-label-unactivated/loop-label-activated/opt-out × do-notation +
    contracts, unmangled expression-position in unactivated files, the
    in-memory-host `syntaxModule` fallback, and a marker↔macro consistency
    check binding each `@syntax-labels` tag to a registered macro whose
    `syntaxModule` points back at the marker). Existing suites that relied
    on ambient labels fixed by adding the marker import to fixtures (never by
    weakening the gate); `contract-old.test.ts`'s `/virtual/` fileName moved to
    a repo-relative one so the fixture's activation import can resolve.

- **Wave 3 — scope-based do-notation instance resolution. DONE (2026-07-03).**
  The "HKT method sugar" deferred work, resolved: for HKT containers there was
  never a direct `xs.map(f)` rewrite to migrate — the mechanism was the
  `let:`/`par:` comprehension macros resolving `FlatMap`/`ParCombine` by
  type-constructor brand through the global `doNotationRegistry`, seeded by
  import-time side effects anywhere in the program (textbook cross-file
  leakage: `let:` over Effect worked in file B because file A imported
  `@typesugar/effect`). Now:
  - **Resolution rule:** brand `B` resolves iff an instance whose declared
    constructor brand-matches `B` (`B`, `BF`, or `_BTag` spellings) is a
    local `@impl` declaration or an export of any imported module
    (side-effect imports and re-exports included) — `resolveDoNotationInstance`
    in `@typesugar/macros`, a name/brand-keyed variant of the scope walk
    (deliberately not `resolveInstance`'s type-assignability matching:
    `FlatMap<F>`'s parameter is a phantom tag).
  - **Marker doubles as provider:** `@typesugar/std/syntax/do` re-exports the
    four std builtin instances (from new runtime-only twins, keeping user
    bundles `typescript`-free), so the Wave 2 label-activation import already
    in every do-notation file also provides the instances — zero new imports.
    New `@typesugar/effect/syntax/do` does the same for Effect (it carries its
    own `@syntax-labels` tags — the marker reader does not follow re-exports).
  - **`@do-methods` metadata** on instances replaces the hardcoded
    Promise/Effect special cases in the macros (method names, static-vs-method
    call style, receiver, `all` join). std's builtins are detected via their
    existing `FlatMap<_ArrayTag>` type annotations + the `_BTag` convention,
    NOT `@impl` JSDoc — std builds with the typesugar plugin and the `@impl`
    attribute macro's expansion is not build-neutral for global builtins
    (HKT annotation rewrite + `namespace Array {}` companion merge).
  - **`par:` over Effect fixed:** new `ParCombine<Effect>` + a generic
    metadata-driven static-join emission (`Effect.map(Effect.all([...]), …)`)
    replaces the latent broken `.map(...).ap(...)` applicative fallback; the
    same emission serves Promise (`Promise.all(...).then(...)`) without its
    hand-written builder.
  - **Diagnostics:** TS9225 "No FlatMap instance for 'X' is in scope" names
    the exact import to add. A static table serves the four std brands in
    hosts that cannot resolve modules (mirror of Wave 2's text fallback).
  - **Deletion (neuter-gated):** with `lookupDoNotationInstance` stubbed to
    always miss, the full suite passed except the registry's own mechanism
    tests — then `doNotationRegistry`, `parCombineBuilderRegistry`,
    `registerFlatMap`/`registerParCombine`/`registerParCombineBuilder`,
    `getFlatMapMethodNames`/`hasFlatMapInstance`/`hasParCombineInstance`/
    `getInstanceMeta`/`clearRegistries` were deleted (deprecated exports
    removed outright, pre-1.0; the par builders moved into std as a
    module-local map consulted after the scope gate). **This deletes the last
    process-global instance registry — the PEP's first acceptance criterion
    is met.**
  - **Correction to Wave 2's review note:** the docs playground compiles
    SERVER-side (`api/compile.ts`, legacy transformer, real `ts.sys` module
    resolution), so checker-based marker/instance resolution works there; the
    in-memory-host fallbacks protect the `@typesugar/playground` package's
    exported browser `transform()` and virtual-filename tests, not the
    user-facing docs playground.

- **Wave 4 — de-magicking + cruft. DONE (2026-07-03).** The remaining
  hardcoded/global surfaces, each either deleted or explicitly marked
  deliberate:
  - **Deleted (verified caller-free):** the `InstanceMeta` type and every
    no-op 1-arg `registerInstanceWithMeta` call (~60 sites — the function only
    acts when an instance value is passed); the legacy transformer's import
    pre-scan (`ensureImportedRegistrations` + friends), which existed solely
    to make those no-op calls; the dead `knownTypeclasses` →
    `importedTypeclasses` → `isTypeclassInScope` scope chain (zero production
    callers); the test-only ResultAlgebra API; `register-instances.ts` (its
    registrations were no-ops since Wave 3, and the Range instances are
    scanner-visible through their type annotations — deliberately NOT `@impl`
    tags, which are non-neutral under std's plugin build).
  - **HKT knowledge is declaration-derived:** `hktTypeclassNames`,
    the `hktExpansionRegistry` seeds, and `getTypeclassSignatureTemplate` are
    deleted. fp's typeclass interfaces carry `@typeclass` tags; `isHKTTypeclass`
    now asks the op-index whether the interface uses its type parameter as
    `Kind<F,…>` — including through `extends` chains (the op-index flattens
    heritage with positional type-param substitution and diamond dedup, which
    is what obsoletes the hand-written signature templates: fp's Monad is an
    extends-only interface). The `OptionF→Option` seeds became a strip-the-F
    checker-resolution rule in the `@impl` tier-1 auto-register. Bonus
    correctness: std's `FlatMap` and effect's interfaces are non-HKT encodings
    the old name-set misclassified.
  - **TS9225 hint is provider-declared:** instances carry
    `@do-instance-module <specifier>` next to `@impl`/`@do-methods`; a cached
    program-wide index (op-index precedent) serves the hint. The static
    fallback table survives DEMOTED and documented: full derivation is
    impossible in principle when the brand's TYPE comes from a different
    package than its instances (`Effect` from `effect`, the instances from
    `@typesugar/effect`) and nothing pulls the provider's `.d.ts` into the
    program.
  - **Explicitly retained as deliberate (documented in-code):**
    `resultAlgebraRegistry`'s Option/Either/Promise seeds (algebras are
    AST-building rewrite functions, not metadata; fp has no macro entry to
    host relocation; `registerResultAlgebra` is the public extension point);
    `primitiveIntrinsicRegistry` (live and load-bearing for derived-instance
    inlining to native operators — prior scoping wrongly called it dead;
    candidate for PEP-053-style source extraction later); the two
    intentionally-divergent `JSDOC_MACRO_TAGS` maps (each pipeline's
    dispatcher special-cases different tags; unifying the maps requires
    unifying the dispatchers); `BUILTIN_METHOD_RECEIVER_NAMES` (guards JS
    natives, not typesugar packages); the macro-loader's
    `KNOWN_MACRO_PACKAGES` (true third-party macro-package discovery needs a
    `package.json` field design — its own PEP).

### Planned waves (drafted 2026-07-04, after Wave 4's review)

Wave 4 retained five surfaces with in-code justifications. Dean asked for a
wave addressing each; here is the plan, ordered by dependency. Waves 5-6 were
already on the remaining list; 7-10 come from the retained items.

- **Wave 5 — `Show` tagging. DONE (2026-07-04).** The deliberately-deferred
  pass from Phase E: `Show`'s interface (`packages/fp/src/typeclasses/show.ts`)
  now carries `@typeclass`, and a new `@typesugar/fp/syntax/show` marker
  (`@syntax-methods Show`) activates `.show()` method sugar — `Show` has no
  operator form, so unlike Eq/Ord there is only one tier.
  - **Export-shape verified safe:** fp builds without the typesugar plugin
    (`tsup.config.ts` has no `unplugin-typesugar`; `vitest.config.ts` wires no
    transformer either), so the `@typeclass` attribute macro's codegen never
    fires on fp's own build — same precedent Wave 4 already established for
    fp's HKT interfaces. Confirmed both new tags (`@typeclass`,
    `@syntax-methods Show`) survive into `dist/**/*.d.ts`.
  - **Bug found by the careful pass the deferral called for:** `n.show()`
    resolved to an "Ambiguous Show instance for 'number': showNumber,
    showSymbol" error the first time a real end-to-end test exercised
    `resolveInstance`'s type matching with Show's instances in scope.
    `resolveTypeString` (`instance-scanner.ts`) resolved the `symbol` keyword
    via an unbound synthetic `ts.factory.createKeywordTypeNode` node — which
    this checker configuration silently resolves to `any`, not `symbol` — and
    `any` is bidirectionally assignable to/from everything, so `showSymbol`
    (`@impl Show<symbol>`) spuriously matched `number`. Probed further:
    `unknown` and `object` have the identical leak. Fixed two ways: added the
    checker's internal `getESSymbolType`/`getUnknownType` fast paths (mirroring
    the existing `getNumberType`/`getStringType`/etc. getters), and hardened
    the synthetic-node fallback itself — a non-`any` keyword resolving to
    `any` now returns `undefined` (can't-resolve) rather than the silently
    wrong type, so any FUTURE keyword hitting the same unbound-node quirk
    fails safe instead of causing cross-instance false matches. This bug
    predates Wave 5 (any `@impl <TC><symbol|unknown|object>` instance could
    have triggered it) but had no reachable trigger until Show's instances
    became scanner-visible.
  - Test design note: the activation test fixtures deliberately do NOT
    name-import `showNumber` — doing so independently satisfies the older,
    gate-independent "Scala 3-style" standalone-extension-import mechanism
    (any named import whose value has a same-named, same-shaped method is
    treated as an extension regardless of `@syntax-methods` activation),
    which would make the "off" fixture rewrite too and defeat the test. A
    side-effect import of the instance module is enough for scope-based
    instance resolution and carries no named binding for the extension
    scanner to match.

- **Wave 6 — operator/method marker text fallback.** Parity with what labels
  (Wave 2) and do-instances (Wave 3) already have: a resolution-free fallback
  for `@syntax-operators`/`@syntax-methods` markers so operator activation
  works in hosts that cannot resolve modules (the browser
  `@typesugar/playground.transform()` surface). The mechanism exists
  (`syntaxModule`-style text matching keyed by specifier); operators need a
  marker-module → typeclass table analog. Small.

- **Wave 7 — intrinsic bodies from source.** Replace
  `primitiveIntrinsicRegistry`'s 16 hand-written source strings
  (`eqNumber` → `"a === b"`) with bodies extracted from std's actual
  instance declarations using PEP-053's source-based instance-extraction
  machinery (`registerInstanceMethodsFromAST` precedent). Gate: byte-parity
  on `derive-inline.test.ts`'s inlining output ("recursively inlines
  eqNumber.equals to ===") — the same neuter-then-delete discipline as
  Wave 3. This also retires a CLAUDE.md string-codegen exception. Medium.

- **Wave 8 — JSDoc dispatcher unification.** The two `JSDOC_MACRO_TAGS` maps
  can only merge when their dispatchers do. Scope narrowly to the JSDoc
  dispatch path (not the whole legacy-transformer absorption): teach
  transformer-core's dispatcher the legacy visitor's `derive`/`adt`
  special-cases (they bypass the attribute-macro registry by design — the
  derive attribute was deleted in PEP-032), then port the legacy transformer
  to consume the shared dispatcher, then delete its private map. Gate: the
  jsdoc-macros + derive suites on both pipelines. Medium; a stepping stone
  for the larger absorption.

- **Wave 9 — macro-package discovery via `package.json` (needs a PEP first).**
  Replace the macro-loader's `KNOWN_MACRO_PACKAGES`/`FACADE_TO_PROVIDER`
  lists and the `@typesugar/*`-prefix speculative loading with a declared
  manifest field (e.g. `"typesugar": { "macros": "./macros" }`), making
  third-party macro packages first-class. This changes what code the
  compiler executes at build time, so it needs its own PEP (discovery
  semantics, workspace-vs-registry resolution, security posture) — the wave
  here is: draft that PEP, land the field + loader support behind the
  existing lists, then delete the lists once std/fp/effect/contracts declare
  the field. **Unblocks the ResultAlgebra relocation:** once fp can declare
  a macro entry, the Option/Either algebra seeds move from
  `@typesugar/macros` into fp (Promise's into std/macros), and the seeds
  comment in `specialize.ts` comes out. Large.

- **Wave 10 (optional) — checker-derived native detection.** Even
  `BUILTIN_METHOD_RECEIVER_NAMES` is derivable in principle: rather than a
  name list, ask whether the receiver type's symbol declarations live in a
  default-lib file (`program.isSourceFileDefaultLibrary`). Cached per
  program, this makes the "never hijack JS natives" guard follow the
  language itself (new globals, unusual lib configurations) instead of a
  snapshot. Low priority — the list is correct today and changes at TC39
  speed — but it would leave the transformer with zero hardcoded type-name
  lists of any kind. Small-medium.

### Why deleting the registry is gated on the HKT/method-sugar work

The instances still served by the global registry (and by the 30 static inlining
builtins) are overwhelmingly **higher-kinded** — `Functor<OptionF>`,
`Monad<ArrayF>`, `FlatMap`, `ParCombine`, etc. (fp / effect / std collections), keyed
by a type-constructor _brand_ (`forType: "OptionF"`), not a concrete type. They are
consumed by **method sugar** (`xs.map(f)`, `o.flatMap(g)`), which resolves by the
receiver's type constructor — a different mechanism than the concrete-type instance
matching used for `Eq`/`Ord` operators. Making them scope-resolvable therefore needs
**HKT-aware scope resolution**, which is PEP **Part 2** (the `@hkt` declaration-scoped
path + `@syntax-methods`/labels). Concrete-type operator resolution (Eq/Ord) is fully
migrated in Wave 1; the HKT method-sugar migration + the registry/inlining deletion it
unblocks is Wave 2. Attempting the deletion before that would break method sugar,
zero-cost inlining, and the playground — hence it is deferred, not partially done.

**Post-Phase-C update (2026-07-02):** this gate applied to the general
`instanceRegistry` (deleted in Phase C) more than to the inlining builtins:
`transformer-core/src/rewriting.ts`'s `getInstanceMethods` import turned out to be
dead — method sugar does not read `instanceMethodRegistry`. The builtins serve only
zero-cost _inlining_ coverage, so their deletion is gated on source-extraction
capability (import-alias/function-form handling), not on HKT scope resolution.
That work — and the gate verification via the benchmark suite — is
[PEP-053](PEP-053-always-on-specialization.md).
