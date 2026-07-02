# PEP-053: Always-On Specialization — Remove the Explicit `specialize` Surface and Static Builtins

**Status:** In Progress (2026-07-02) — Wave 1 landed (explicit surface deleted)
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
- **Wave 2 — source-extraction capability.** Gap fixes 1–5 with a test per
  former builtin proving its source instance is extractable (imported, aliased,
  factory-form, property-access member), in both pipelines while they still
  exist.
- **Wave 3 — pipeline unification.** Legacy transformer consumes
  transformer-core's specialization module; delete the clone. Full suite +
  LSP/vscode + playground gates.
- **Wave 4 — delete the static builtins.** Remove the 30
  `registerInstanceMethods` calls, the function itself, and the
  internal-registration machinery; author-or-drop `eitherBifunctor`/
  `flatMapStream`; keep primitives + AST cache. Gates: full suite,
  `pnpm bench` (zero-cost benchmarks must still show inlined output — this is
  the regression detector for extraction coverage), playground examples.
- **Wave 5 — docs sweep.** Rewrite `docs/guides/specialize.md` as the
  auto-specialization guide (how it works, what blocks inlining, the opt-out);
  update `docs/reference/packages.md`, `docs/macro-triggers.md`,
  `docs/guides/error-messages.md` (TS9601 section removed, TS9602 documented),
  README/docs package tables, sidebar nav, and the secondary guide mentions
  (typeclasses/fp/validate/opt-out/developer-experience/architecture).

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
- **Open:** whether hoisted specializations that need free identifiers
  (module-local helpers in instance bodies) use PEP-032 import emission or
  just fall back — decide in Wave 2 with the `flatMapIterable` case in front
  of us.
