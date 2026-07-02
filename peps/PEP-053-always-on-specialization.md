# PEP-053: Always-On Specialization — Remove the Explicit `specialize` Surface and Static Builtins

**Status:** In Progress (2026-07-02) — Waves 1–2 landed (explicit surface deleted; source extraction covers aliases, factories, indirect members, companions)
**Date:** 2026-07-02
**Author:** Claude (with Dean Povey)
**Absorbs:** [PEP-052](PEP-052-import-scoped-macro-activation.md) Phase D (the "inlining registry" phase)
**Relates to:** [PEP-004](PEP-004-source-based-typeclass-features.md) (source-based typeclass features), [PEP-032](PEP-032-macro-expansion-import-emission.md) (self-contained expansions)

## Summary

Specialization (zero-cost inlining of typeclass dictionary methods at call sites)
becomes a **transparent, always-on compiler optimization** — not an API. This PEP:

1. **Deletes the explicit specialization surface**: the `specialize()`,
   `specialize$`, `mono()`, and `inlineCall()` macros, the `fn.specialize(dict)`
   extension-method rewrite, the `Specialized<F, N>` type, and the
   `@typesugar/specialize` package.
2. **Deletes the ~30 hard-coded `registerInstanceMethods(...)` builtins** (the
   static source-string tables for fp/std/effect instances) after upgrading
   AST source extraction to cover everything they covered.
3. **Unifies the specialization pipeline**, which today exists as two
   independently maintained near-verbatim copies (`packages/transformer` and
   `packages/transformer-core`).
4. **Keeps the `@no-specialize` opt-out** (and fixes its broken
   `@no-specialize-warn` sibling).

Auto-specialization already runs on every call expression by default — there is
no config toggle, and there never was. What stops it from being _the_ mechanism
is coverage (gated by the hard-coded builtin list), a crutch API (the explicit
macros, which the warnings themselves advertise), and duplication (two pipelines
that can silently diverge). This PEP removes all three, once and for all.

## Motivation — why isn't specialization "just the default" already?

It nearly is. `tryAutoSpecialize` runs unconditionally in both transformers on
every `CallExpression`; the only gates are the generic PEP-052 scope opt-out,
the `@no-specialize` comment, and — the real limiter — **instance recognition**:
an argument specializes only if its method bodies are known, either from

- `tryExtractInstanceFromSource` (AST extraction from the instance's
  declaration), or
- the `instanceMethodRegistry` — whose static entries are ~30 hand-maintained
  `registerInstanceMethods("arrayFunctor", "Array", { map: { source: "(fa, f) => fa.map(f)", ... } })`
  calls: **source-code-as-strings, shipped inside the compiler**, duplicating
  (and drifting from) the real instances in `@typesugar/fp`, `/std`, `/effect`.

That design has three compounding problems:

1. **The builtin table is a lie waiting to happen.** The strings are copies of
   library code. Some already disagree with the source (`flatMapEffect` inlines
   `Effect.map` while the source calls `getEffectModule().map`); two entries
   (`eitherBifunctor`, `flatMapStream`) have **no corresponding source instance
   at all**. Third-party instances can never be in the table, so builtins get
   magic behavior users can't replicate — exactly the "no hardcoded magic"
   principle PEP-052 Part 3 established for operators.
2. **The explicit macros exist because auto-coverage is unreliable.** Every
   TS9602 skip warning says "Use explicit specialize() if you need guaranteed
   inlining" — the escape hatch is load-bearing precisely because the default
   path has gaps. Close the gaps and the escape hatch is pure surface area:
   four macros, a package, a runtime-stub family, an extension-method rewrite,
   and a 10-arity type utility, all teaching users to hand-annotate an
   optimization the compiler should just do. (Rust doesn't have a
   `monomorphize!()` macro.)
3. **Two pipelines.** The production path (ts-patch / unplugin / CLI / LSP /
   `api/compile.ts`) runs a private-method clone in `packages/transformer`
   (~lines 3015–3651); the playground runs the free functions in
   `packages/transformer-core/src/specialization.ts`. Same gates, same
   diagnostics, maintained in parallel — and already divergent (see §Capability
   work, item 5).

Since typesugar is pre-release with no consumers, we take the correct fix, not
the compatible one.

## Design principles

- **Specialization is an optimization, not a feature you call.** There is no
  user-facing API to request it and no config to enable it. If the compiler can
  prove the inlining is sound, it does it; if not, dictionary passing remains —
  which is always semantically correct.
- **Source is the single source of truth for instance bodies.** Method
  implementations come from the instance declaration's AST (same-file or
  imported), never from shipped string tables. What works for user instances is
  exactly what works for std/fp/effect instances — no builtin magic.
- **Opt-out, not opt-in.** `// @no-specialize` on the call line disables it.
  This is the one piece of explicit surface that stays (spelled as today;
  Julia's `@nospecialize` is the same idea).
- **Failure to specialize is never an error.** The fallback is the code you
  wrote. Skip diagnostics remain warnings (TS9602), reworded to explain the
  blocker in the function body — not to advertise a deleted macro.
- **Primitive intrinsics are not cruft.** `eqNumber` inlining to `a === b`
  (rather than a call into the source `Eq<number>` instance) is genuinely
  compiler knowledge with no source-level representation. The 16
  `primitiveIntrinsicRegistry` entries stay.

## What is removed

The explicit surface (definitions per the blast-radius inventory):

| Item                                                                                                                            | Where                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `specializeMacro`, `specializeInlineMacro` (`specialize$`), `monoMacro`, `inlineCallMacro`                                      | `packages/macros/src/specialize.ts:1283–1413`, registrations at `:3088–3091`                                                                                                                           |
| Runtime stubs `specialize`, `mono`, `inlineCall`                                                                                | `packages/macros/src/runtime-stubs.ts:531–547`, re-exports `macros/src/index.ts`                                                                                                                       |
| `fn.specialize(dict)` extension rewrite                                                                                         | `packages/transformer/src/index.ts:3877–3885, 5389+`; `packages/transformer-core/src/rewriting.ts:200+`                                                                                                |
| `specializeKind` (`specialize$` stub), `Specialized<F, N>` + `DropLast1..10`                                                    | `packages/specialize/src/index.ts:58`, `src/specialized-type.ts`                                                                                                                                       |
| The `@typesugar/specialize` package                                                                                             | whole package (a thin re-export shell over `@typesugar/macros`)                                                                                                                                        |
| Wiring                                                                                                                          | `packages/typesugar/src/index.ts:104,153` + `package.json` + `tsup.config.ts:26`; `packages/transformer/src/macro-loader.ts:36`; `typesugar.manifest.json:7`; `packages/lsp-server/src/manifest.ts:31` |
| TS9601 ("specialize(): falling back to dictionary passing")                                                                     | `packages/macros/src/specialize.ts:713/731/748`, `docs/guides/error-messages.md:208–240`, `packages/core/src/diagnostics.ts:917`                                                                       |
| The 30 static `registerInstanceMethods` builtins + `registerInstanceMethods`/`endInternalRegistration`/`isInternalRegistration` | `packages/macros/src/specialize.ts:446–499, 761–1154, 1225`                                                                                                                                            |

Explicitly **in** scope for deletion alongside `specialize()`: `mono()` and
`inlineCall()`. Both are same-family sugar with near-zero usage outside the
specialize package's own examples; keeping them would preserve the "annotate
your optimizations" model this PEP removes. (Decision point flagged below.)

## What stays

- The **auto-specialization pipeline**: `tryAutoSpecialize`,
  `tryReturnTypeDrivenSpecialize` (Result-algebra), hoisting
  (`createHoistedSpecialization`, `SpecializationCache`), DCE scanning.
- The **`instanceMethodRegistry` Map itself** — as a per-program **AST cache**,
  populated only by `registerInstanceMethodsFromAST` (written by the
  `@instance`/`@impl` macros and by `tryExtractInstanceFromSource` as a
  write-back cache). The _static seeding_ is what dies, not the mechanism.
- The **16 primitive intrinsics** (`primitiveIntrinsicRegistry`) and
  `getInstanceOrIntrinsicMethods`, which `recursivelyInlineInstanceCalls` and
  `tryInlineDerivedInstanceCall` depend on for nested native-operator inlining.
- The **`@no-specialize` opt-out** (see §Opt-out semantics).
- **Out of scope**: `@typesugar/effect`'s `specializeSchema` (a distinct Effect
  Schema feature that shares only the name) and `@typesugar/sql`'s local
  `registerInstanceMethods` (`sql/src/meta.ts:44` — a name-matched runtime
  stub, not the macros registry).

Audit note: `createSpecializedFunction` is today shared by the explicit macro,
the `fn.specialize()` extension, and parts of hoisting. After Wave 1 its
liveness must be re-checked — keep whatever the auto path still uses, delete
the rest.

## Capability work — closing the gaps the builtins papered over

The gap analysis of `tryExtractInstanceFromSource` against the 30 builtins
found five concrete deficiencies. All must land (with tests) **before** the
builtins are deleted:

1. **Cross-module alias resolution.** Extraction calls `getSymbolAtLocation` →
   `getDeclarations()` without `getAliasedSymbol`, so an **imported** instance
   resolves to its `ImportSpecifier` and extraction bails. Since every builtin
   instance lives in a different package from user call sites, this single gap
   makes the whole builtin table load-bearing. Fix: follow import aliases to
   the original `VariableDeclaration`.
2. **Function-form / factory instances.** `eitherFunctor<E>()`,
   `effectFunctor`, `effectMonad`, `effectEitherMonad` are factories
   (`const eitherFunctor = <E>() => ({ ... })`). Today `getInstanceName`
   rejects `CallExpression` args and extraction requires an object-literal
   initializer. Fix: accept a call-of-identifier arg; resolve the factory; if
   its body is (or trivially returns) an object literal, extract from that.
3. **Identifier-alias consts.** `export const stdFlatMapArray = flatMapArray`
   (`std/src/specialize/index.ts:64+`) — chase identifier initializers to the
   aliased declaration.
4. **Property-access members.** `map: optionFunctor.map`
   (`fp/src/instances.ts:277`) is skipped by `extractMethodsFromObjectLiteral`.
   Fix: resolve the referenced instance and splice in that method.
5. **Unify extraction criteria.** transformer-core requires an `@impl`/
   `@instance` JSDoc tag; the legacy transformer accepts `@impl` **or** a
   typeclass type annotation (`const x: Functor<F> = {...}`). Adopt the looser
   rule (annotation suffices) everywhere — several std/effect instances
   (`flatMap*`, `chunkFunctor`, `effectOptionMonad`) carry only annotations.
6. **Companion-path instances** (found empirically during Wave 1's deep
   review): `double(p, numericPoint)` specializes but
   `double(p, Point.Numeric)` — the `@derive`/`@impl` companion form — does
   not (`getInstanceName` yields `"Point.Numeric"`, which neither the registry
   nor source extraction resolves). Since companions are the convention the
   operator/method-sugar paths emit, Wave 2 should make companion property
   accesses extractable too (resolve the companion member back to its
   generating instance/derivation).

Known semantic caveats to resolve during migration (not blockers, but each
needs an explicit decision + test):

- `flatMapIterable`/`flatMapAsyncIterable` source bodies call module-local
  helpers (`iterableMap`) — inlining them captures free identifiers. Either
  rely on PEP-032 import emission for hoisted specializations, or let these
  fall back to dictionary passing (acceptable: fallback is always correct).
- `flatMapEffect`'s builtin inlined `Effect.map` but the source calls
  `getEffectModule().map` — the **source** behavior wins by definition; verify
  the effect benchmarks still pass.
- `eitherBifunctor` and `flatMapStream` have **no source instance**: author
  them in fp/effect if anything exercises them, otherwise they are already
  dead and simply vanish with the table.
- `optionMonad`'s builtin shipped an inline `map`; post-migration it comes via
  gap-fix 4.

## Pipeline unification

One implementation, two consumers. `packages/transformer`'s private-method
clone (`tryAutoSpecialize`, `tryExtractInstanceFromSource`,
`inlineAutoSpecializeForHoisting`, `tryReturnTypeDrivenSpecialize`,
`tryInlineDerivedInstanceCall`, `rewriteDictCallsForAutoSpec`,
`specializeForResultAlgebra`, ~lines 3015–3651) is deleted in favor of the
free functions in `transformer-core/src/specialization.ts` (which already take
a context parameter). The main risk is the context-type mismatch between the
two transformers' `MacroContext` implementations — the wave starts with an
interface audit; if full unification stalls, the fallback is a shared module
both import (what `position-mapper.ts` already does), never two copies.

## Opt-out semantics (kept, fixed)

- `// @no-specialize` on the call line disables specialization for that call.
  Spelling unchanged.
- **Bug fix:** the check is a raw substring scan and `"@no-specialize-warn"`
  _contains_ `"@no-specialize"`, so the bail branch fires first and
  `@no-specialize-warn` today disables specialization entirely instead of
  suppressing warnings. Fix with exact-token matching. Decide whether
  `-warn` survives at all — with TS9602 reworded and rate-limited it may be
  unnecessary (recommended: keep it; silencing a per-call warning without
  changing semantics is a legitimate need).
- **Doc/impl mismatch:** docs show the marker on the line above the call;
  the implementation scans only the same line before the call start. Extend
  the scan to the immediately preceding comment line so both documented forms
  work, and add tests for each.
- The generic PEP-052 scope opt-outs (`@ts-no-typesugar macros`,
  `"use no typesugar"`) continue to imply no specialization — unchanged.

## Waves

- **Wave 1 — delete the explicit surface. DONE.** Everything in §What is
  removed except the builtin table: the four macros + registrations, runtime
  stubs, `fn.specialize()` rewrite (both copies), the `@typesugar/specialize`
  package (+ manifest/loader/typesugar wiring, dry-run example deps —
  including a third manifest copy in `packages/vscode/src/manifest.ts` the
  original blast-radius inventory missed), TS9601 (removed, incl. the dead
  `TS9221` diagnostic descriptor it was the only user of), TS9602 reworded
  (dropped "Use explicit specialize()"; points at the body blocker or "falling
  back to dictionary passing"), the `@no-specialize`/`-warn` substring-collision
  bug fixed (`-warn` used to hit the bail branch and fully disable
  specialization instead of just suppressing warnings) + extended to scan the
  preceding comment line, with new tests for all 4 combinations in both
  transformers. `createSpecializedFunction` and its whole private helper
  family (`getDictName`, `specializeFunction`, `rewriteDictCalls`,
  `createPartialApplication(Multi)`, etc.) confirmed dead (zero callers once
  the macro + extension were gone) and deleted. Deleted/adapted dependent
  tests (`tests/red-team-specialize.test.ts`, `specialize-extension.test.ts`,
  `specialize-diagnostics.test.ts`, `specialize-improvements.test.ts`,
  `rewriting.test.ts`) and examples (`docs/examples/core/specialize.ts`
  rewritten to demonstrate auto-specialization; `packages/typeclass/examples/
showcase.ts`'s live `.specialize()` calls, which would have thrown at
  runtime — verified by transforming + executing the rewritten section
  directly, since the only test covering that file only checks "transforms
  without crashing," never executes the output). Extensive docs sweep
  (README, AGENTS.md, package READMEs, architecture.md, guides, error
  reference, vitepress nav) rewriting specialize()-as-API prose to describe
  the always-on model; also fixed two pre-existing (not caused by this PEP)
  broken doc examples that never imported PEP-052's required activation
  marker. Full suite green (7088+ passed), typecheck/format/skip-policy/
  runtime-purity/vscode/ts-plugin gates all green. Two independent review
  passes (one before push, findings fixed) confirmed no dangling references
  to deleted symbols anywhere in the tree. _This wave also removes the only
  registry consumers with no source fallback (the explicit macros read
  `instanceMethodRegistry` directly), simplifying Wave 4._
  **Deep-review round (post-PR, 5-lens):** removed dead imports/helpers the
  surgery stranded (`markPure`, `parseTypeConstructor`, `getNodeText` +
  `printer` in specialize.ts; `registerInstanceMethods` import in
  typeclass.ts); scrubbed three more IDE/diagnostic surfaces still advertising
  the deleted macro (`core/src/import-suggestions.ts`, the TS9061 template in
  `core/src/diagnostics.ts`, the vscode `tmLanguage` grammar keyword list);
  hardened the preceding-line opt-out scan to comment-only lines (a trailing
  `// @no-specialize` on the previous line no longer opts out the next line's
  unrelated call — with a negative test) and added the missing legacy-copy
  `-warn`-preceding-line test; pulled the `docs/guides/specialize.md` rewrite
  forward from Wave 5 (it opened with `npm install @typesugar/specialize`);
  fixed the README top example + comparison table (still claimed ambient
  `===`/`.show()`, false since PEP-052); corrected the typeclasses-guide
  claim that `double(p, Point.Numeric)` inlines — verified empirically it
  does NOT (const-name form does; companion-path extraction is now Wave 2
  gap 6); added the missing changeset (minor: typesugar/macros/transformer/
  transformer-core, patch: core).
- **Wave 2 — source-extraction capability. DONE (2026-07-02).** All six gap
  fixes landed as ONE shared implementation —
  `packages/macros/src/instance-extraction.ts` — that both pipelines delegate
  to (the legacy transformer's private clone and transformer-core's copy of
  `tryExtractInstanceFromSource`/`getInstanceName`/`hasImplAnnotation`/
  `extractBrandFromImpl` were deleted in favor of it, pre-staging Wave 3):
  - Gap 1: symbol resolution follows import aliases (`getAliasedSymbol`),
    including renamed imports; cross-module brand extraction reads the type
    annotation from the DECLARING file (the old copies passed the call-site
    file to `getText`, a latent bug).
  - Gap 2: zero-arg factory calls (`eitherFunctor<E>()`) resolve to the
    factory's returned object literal — concise arrow body or a block whose
    trailing return follows only variable statements. Factories with VALUE
    parameters are rejected (bodies would capture the argument); acceptance is
    `@impl` on the factory or a typeclass-shaped return annotation. Factory
    brands use the instance name, never the return annotation's first type
    argument (a bare type parameter like "E" would collide across factories
    and poison the specialization cache key).
  - Gap 3: identifier-alias consts (`const stdFlatMapArray = flatMapArray`)
    chase initializers (identifier, property access, or factory call),
    depth-limited to 5; acceptance may be satisfied anywhere along the chain.
  - Gap 4: indirect object-literal members resolve via a `MemberMethodResolver`
    hook on `extractMethodsFromObjectLiteral` — property-access members
    (`map: optionFunctor.map`), identifier members (`map: mapOption`), and
    shorthand (`{ map }`); `inlineFromNode` learned FunctionDeclaration
    bodies for the identifier case.
  - Gap 5: unified acceptance everywhere — `@impl`/`@instance` tag OR
    typeclass-shaped type annotation (transformer-core previously required the
    tag; the playground pipeline now matches production).
  - Gap 6: companion paths (`Point.Numeric`) that have no symbol in the
    checker's program resolve by scope via the new
    `findInstanceInScopeByName` (instance-resolver) — the same scanner
    machinery method sugar trusts — then extract from the located const's
    declaration. Both the transform-time-generated-companion and
    real-companion-const shapes are covered by tests.
  - **DECIDED (was the Wave-2 open question): fallback over import emission.**
    A method body lifted from ANOTHER module may reference bindings that exist
    only there (module-local helpers like `iterableMap`, or the module's own
    imports like `Effect.map`); inlining would capture dangling identifiers.
    Extraction runs a free-identifier scan on every extracted method and DROPS
    unsafe ones — the call falls back to dictionary passing, which is always
    correct. Safe siblings still specialize (per-method, not per-instance).
    A referenced binding is safe if it is ambient/lib, inside the method
    itself, or (same-module only) at the call-site file's module scope —
    which also catches factory-LOCAL bindings (`const functor =
eitherFunctor<E>()` inside a factory body) that would dangle even
    same-file. If Wave 4's bench parity gate needs the Either/Effect/Iterable
    instances inlined cross-module, PEP-032 import emission is the upgrade
    path.
  - Extracted method nodes are DEEP-CLONED (`cloneNodeDeep`, new in core)
    before registration/inlining: `stripPositions`/`stripCommentsDeep` mutate
    in place, and inlining a method lifted from another file would otherwise
    corrupt that file's AST for its own emit in program-wide transforms.
  - Tests: form-coverage suites in both pipelines
    (`packages/transformer/tests/pep053-source-extraction.test.ts` end-to-end;
    `packages/transformer-core/tests/specialization.test.ts` unit-level with a
    new multi-file-program helper), plus a per-former-builtin matrix
    (`tests/pep053-former-builtins.test.ts`) against the REAL fp/std sources
    with RENAMED imports (so the still-present builtin table cannot mask an
    extraction failure): 13 self-contained builtins (array/option/promise
    instances, Array/Promise FlatMaps + std aliases) inline cross-package;
    6 helper-dependent ones (Either factories, Iterable FlatMaps + alias)
    fall back cleanly. Effect instances follow the fallback group's
    namespace-import shape and are covered by shape, not by pulling the
    `effect` library into a test program.
  - Wave 4 note: `arrayFoldable`'s builtin registers a `reduce` method its
    source instance does not define — deleting the builtin drops `reduce`
    inlining for it (callers fall back); no code depends on it in-repo.
- **Wave 3 — pipeline unification. DONE (2026-07-02).** The legacy
  transformer's private specialization clone (`tryAutoSpecialize`,
  `tryInlineDerivedInstanceCall` + recursive inliner,
  `tryReturnTypeDrivenSpecialize`, `specializeForResultAlgebra`,
  `rewriteResultCalls`, `getTypeName`, `getContextualTypeForCall`,
  `resolveAutoSpecFunctionBody`, `rewriteDictCallsForAutoSpec`,
  `inlineAutoSpecializeForHoisting`, plus the top-level DCE pair
  `eliminateDeadDerivedInstances`/`containsIdentifierRef` — ~700 lines) is
  deleted; three thin private shims map class state (`ctx`, `verbose`,
  `specCache`) onto the shared free functions, now exported from
  `@typesugar/transformer-core`'s index (the dependency already pointed the
  right way). A pre-deletion line-by-line divergence audit found the two
  copies identical except three deltas, resolved as: (1) shared's stripping
  of dangling type-parameter annotations on hoisted specializations WINS
  (legacy kept unresolvable annotations); (2) shared's suppression of the
  spurious `[TS9602] no return statement` warning for void functions WINS
  (legacy warned); (3) legacy's `stripCommentsDeep` on inlined
  derived-instance output was PORTED INTO the shared function (prevents the
  printer emitting instance-declaration trivia at call sites). DCE stays
  driven by the class-level `inlinedInstanceNames` set on both sides —
  `DerivedInstanceDCETracker`/`scanForDerivedInstanceDeclarations`/
  `checkForValueRef` remain exported but are exercised only by unit tests.
  Production paths (ts-patch, unplugin, CLI, LSP, api/compile.ts) and the
  playground now run the SAME specialization code.
- **Wave 4 — delete the static builtins.** Remove the 30
  `registerInstanceMethods` calls, the function itself, and the
  internal-registration machinery; author-or-drop `eitherBifunctor`/
  `flatMapStream`; keep primitives + AST cache. Gates: full suite,
  `pnpm bench` (zero-cost benchmarks must still show inlined output — this is
  the regression detector for extraction coverage), playground examples.
- **Wave 5 — residual docs/comment sweep.** Most of the originally-planned
  docs sweep landed with Wave 1 (see its DONE note): `docs/guides/specialize.md`
  was rewritten as the auto-specialization guide, and
  `docs/reference/packages.md`, `docs/guides/error-messages.md`, README/docs
  package tables, sidebar nav, and the secondary guides were all updated,
  because leaving them describing a deleted API until a later wave meant the
  live docs site would lie in the interim. Remaining for this wave: the
  one-line JSDoc/comment mentions of `specialize()` scattered through package
  sources (`sql/src/{derive-meta,typeclasses,connection-io}.ts`,
  `collections/src/hash-{set,map}.ts`, `effect/src/{instances,index}.ts`,
  `validate/src/schema.ts`, `fp/src/{effect/index,typeclasses/functor}.ts`,
  `std/src/{index,typeclasses/numeric-ops}.ts`), a `docs/macro-triggers.md`
  consistency pass, and re-dating `docs/PERFORMANCE.md` if Wave 4 moves the
  benchmark numbers.

Invariant (as in PEP-052): the builtin table stays populated until Wave 4's
gates prove source extraction covers it — no wave leaves the build, LSP, or
playground with regressed inlining.

## Acceptance criteria

1. `grep -r "specialize(" --include="*.ts"` in user-facing code finds no
   explicit-macro calls; `@typesugar/specialize` no longer exists;
   `specializeMacro` et al. are gone from the registry, manifests, and loader.
2. Zero `registerInstanceMethods(` call sites (the sql-local stub excepted);
   the only registry writers are `registerInstanceMethodsFromAST` call sites.
3. An imported, `@impl`-tagged (or typeclass-annotated) object-literal,
   factory-form, or aliased instance from another package specializes at a
   user call site — each form covered by a test.
4. Exactly one specialization pipeline implementation is compiled into the
   repo (transformer imports it from transformer-core or a shared module).
5. `// @no-specialize` disables; `// @no-specialize-warn` suppresses warnings
   without disabling; both work same-line and preceding-line; tests cover all
   four cases.
6. `pnpm bench` zero-cost numbers are within noise of pre-PEP
   `docs/PERFORMANCE.md` values; benchmark output assertions confirm inlining
   still occurs for the former-builtin instances exercised there.
7. No TS9601 references remain; TS9602 messages do not mention removed API.
8. Full suite, typecheck, `check:skips`, playground examples green.

## Decisions & open questions

- **DECIDED (Dean, 2026-07-02):** no explicit `specialize()` macro; keep the
  `@no-specialize` opt-out.
- **Recommended, needs confirmation:** `mono()` and `inlineCall()` go too
  (same family, near-zero usage). Cost of keeping: two macros + stubs + docs
  that contradict "specialization is not an API".
- **Recommended:** keep `@no-specialize-warn` (fixed), since TS9602 remains
  the only feedback channel for "why didn't this inline".
- **DECIDED (Wave 2, 2026-07-02):** hoisted specializations that would need
  free identifiers (module-local helpers or the instance module's imports in
  method bodies) **fall back to dictionary passing** — extraction drops those
  methods via a cross-module free-identifier scan. Fallback is always correct;
  PEP-032 import emission remains the upgrade path if Wave 4's bench parity
  gate needs Either/Effect/Iterable instances inlined cross-module.
- **Follow-up (needs npm auth, outside the repo):** `@typesugar/specialize`
  was published to npm at 0.1.1 before Wave 1 deleted the workspace package.
  Deprecate it on npm
  (`npm deprecate @typesugar/specialize "Specialization is always-on in typesugar (PEP-053); this package is no longer needed"`)
  so the orphaned package doesn't mislead. A changeset covering the
  `@typesugar/macros`/`typesugar` export removals ships with Wave 1.
