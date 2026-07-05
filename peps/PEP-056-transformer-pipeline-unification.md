# PEP-056: Transformer Pipeline Unification — One Engine, Not Two

**Status:** Draft
**Date:** 2026-07-05
**Author:** Claude (Sonnet 5), for Dean's review

## Context

PEP-015 (2026-03) set out to do exactly what this PEP proposes finishing: extract
a single, browser-compatible transformation core so "new macros work everywhere"
and there is "one place" macro-expansion logic lives. Waves 1-4 of that PEP
landed a real package, `@typesugar/transformer-core`, and PEP-053 (specialization)
and PEP-052 Wave 8 (JSDoc/decorator/derive dispatch) later moved two more whole
subsystems into it, with the legacy `@typesugar/transformer` reduced to
one-line delegating wrappers for those specific pieces.

The rewriting/dispatch layer — the code that decides what a macro call,
operator, or method-sugar use site actually becomes — was never migrated. An
architecture audit run this week (five independent code investigations,
cross-checked by hand against `packages/transformer/src/index.ts` and
`packages/transformer-core/src/*.ts`) found:

- **`@typesugar/transformer/src/index.ts` is 4,869 lines.** `@typesugar/transformer-core`
  totals 6,534 lines across all its files. The legacy package is not a thin
  shim over the core — it's a comparably-sized, independently-maintained
  second implementation that the real CLI/build pipeline (`pipeline.ts`)
  calls directly via `macroTransformerFactory`, bypassing `transformer-core`
  entirely for the actual transform step.
- Six dispatch functions exist as **separate, independent implementations in
  both packages**, same names, never merged: `tryExpandTaggedTemplate`,
  `tryExpandTypeMacro`, `tryRewriteExtensionMethod`, `tryRewriteTypeclassOperator`,
  `tryExpandExpressionMacro`, `tryExpandAttributeMacros`. Roughly 700-750 lines
  of near-parallel logic in the legacy file alone, matched by comparable logic
  in `transformer-core/src/rewriting.ts` and `transformer.ts`.
- **Method-sugar dispatch (`x.equals(y)` → companion call) exists only in the
  legacy pipeline.** `tryResolveTypeclassMethod`/`resolveMethodSugarInstance`
  (`index.ts:3618-3772`) have no equivalent anywhere in `transformer-core`.
  This is why the browser playground could never rewrite `.equals()` sugar —
  not a bug in the playground, a missing feature in the pipeline it runs.
  PEP-052 itself says this plainly, just in Wave 6/Phase E prose rather than
  its own "Implementation status" summary, which reads more finished than it is.
- The class of bug this produces is concrete, not hypothetical: earlier this
  week, `tryRewriteTypeclassOperator`'s instance-resolution path
  (`InstanceScanner.scanLocalFile`, shared by both pipelines via
  `@typesugar/macros`) turned out to scan the pre-transform parse tree, so it
  could never see a `@derive`-synthesized companion built during the same
  pass — `p1 === p2` silently stayed native reference equality in a
  `@derive(Eq)` class, in **both** pipelines, since both call the identical
  shared function. That specific bug is now fixed (a same-pass side-table the
  scanner also consults). The dispatch-layer duplication that makes bugs like
  it expensive to find and fix in only one place at a time is not.

Two pipelines that mostly agree is a worse position than either one pipeline
or two pipelines that are honestly divergent by design. It means every
rewriting bug has to be found, understood, and fixed twice — and, per the
`@derive` case, it's easy to fix it in the one place that's actually shared
and not notice the other copy needed the same fix, or to fix one copy and
ship believing both are covered.

## Goal

Delete `@typesugar/transformer`'s independent rewriting implementation.
`@typesugar/transformer-core` becomes the **single, complete** macro
expansion and rewriting engine — used identically by the CLI, the language
service, and the browser playground. What remains of `@typesugar/transformer`
is a thin Node host: dynamic macro-package loading (`require()`, which
cannot exist outside Node), disk caching, and the CLI/language-service
surface — all of it calling into `transformer-core` for the actual
transform, never reimplementing it.

### Node-dependency analysis

| File (current)                                                 | Lines         | Genuinely Node-only?                                                                                                   | Disposition                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `macro-loader.ts`                                              | 269           | Yes — `createRequire`, dynamic package resolution                                                                      | Stays. This is the actual reason a Node host package must exist.                                                                                                                                                                                      |
| `cache.ts`                                                     | ?             | Yes — `fs`, `crypto` disk cache                                                                                        | Stays, as a wrapper around `transformer-core`'s `transformCode`.                                                                                                                                                                                      |
| `pipeline.ts`                                                  | 2,276         | Partial — real `ts.Program`/`ts.sys`, incremental builds                                                               | Stays, but calls `transformer-core`'s `MacroTransformer` instead of `macroTransformerFactory`. `transformer-core`'s `transformCode` already accepts an injected `program`/`compilerHost` (added in PEP-015 Wave 3) — this is exactly the seam to use. |
| `cli.ts` / `language-service.ts`                               | 1,226 / 1,405 | Yes — process/CLI, TS Language Service plugin host                                                                     | Stay as Node hosting surfaces, unchanged in shape, just calling a different transform entry point underneath.                                                                                                                                         |
| `dts-opaque-discovery.ts`                                      | ?             | No — reads `.d.ts` files reachable via `ts.Program`, which `transformer-core` can already do via injectable `readFile` | Move to `transformer-core`.                                                                                                                                                                                                                           |
| `profiling.ts`                                                 | ?             | No — pure timing utility, no Node API                                                                                  | Move to `transformer-core` (or `@typesugar/core`) so both pipelines get the same profiler instead of the CLI-only one today.                                                                                                                          |
| `index.ts` (`macroTransformerFactory`, all rewriting/dispatch) | 4,869         | **No** — every dispatch function audited has either a `transformer-core` equivalent already or is portable to one      | Delete. Replaced by direct use of `transformer-core`'s `MacroTransformer`.                                                                                                                                                                            |

The upshot: nothing in the actual rewriting/dispatch logic requires Node. The
only load-bearing Node dependency in the whole legacy package is
`macro-loader.ts`'s dynamic `require()`-based package discovery — everything
else is either already duplicated in `transformer-core` or portable to it
with no environment constraint in the way.

## Approach

```
BEFORE                                    AFTER

@typesugar/transformer                    @typesugar/transformer-core (COMPLETE)
├── index.ts (4,869 lines)                ├── transformer.ts   (MacroTransformer, all dispatch)
│   ├── macroTransformerFactory           ├── rewriting.ts     (+ tagged-template, type-macro,
│   ├── tryExpandTaggedTemplate (DUP)     │                       extension-method, operator — merged)
│   ├── tryExpandTypeMacro (DUP)          ├── method-sugar.ts  (NEW — ported from legacy, the
│   ├── tryRewriteExtensionMethod (DUP)   │                       one capability transformer-core
│   ├── tryRewriteTypeclassOperator (DUP) │                       never had)
│   ├── tryExpandExpressionMacro (DUP)    ├── specialization.ts (already shared, PEP-053)
│   ├── tryExpandAttributeMacros (DUP)    ├── macro-helpers.ts  (already shared, PEP-052 Wave 8)
│   └── tryResolveTypeclassMethod         ├── dts-opaque-discovery.ts (moved from legacy)
│       (legacy-only, no core equivalent) ├── profiling.ts      (moved from legacy)
├── pipeline.ts → macroTransformerFactory  └── transform.ts      (transformCode(), unchanged entry)
├── cache.ts
├── macro-loader.ts (Node require())            ↑                              ↑
├── cli.ts                                      │                              │
└── language-service.ts                  @typesugar/transformer         @typesugar/playground
                                          ├── pipeline.ts → transformer-core's
                                          │   MacroTransformer, program injected
                                          ├── cache.ts   (disk cache wrapper)
                                          ├── macro-loader.ts (require(), unchanged)
                                          ├── cli.ts / language-service.ts (unchanged shape)
                                          └── index.ts — DELETED
```

### Design principles

1. **One dispatch implementation per rewrite kind, no exceptions.** If a
   capability exists in `transformer-core`, `@typesugar/transformer` calls it.
   It never reimplements it "for now" or "to be safe." A wave gate that finds
   a second implementation of anything on this PEP's list is a failed gate,
   not a partial pass.
2. **Node-only code stays Node-only, and nothing else does.** The dividing
   line is `require()`/`fs`/`crypto` — not "this file happens to live in the
   Node package today." Every file gets re-evaluated against that line, not
   grandfathered by its current location (this is exactly how `profiling.ts`
   and `dts-opaque-discovery.ts` were found to be misplaced).
3. **`transformer-core`'s existing injection points are the seam, not a new
   one.** `transformCode(code, { program, compilerHost })` already supports a
   real, Node-backed `ts.Program` (added in PEP-015 Wave 3 for exactly this
   kind of future use, then never exercised by the CLI). Waves below wire the
   CLI through it rather than inventing a second entry point.
4. **Every wave gate re-runs the full test suite, not a filtered subset** —
   the specific failure mode this PEP exists to prevent (a fix that lands in
   one pipeline and not its "identical" twin) is invisible to a package-scoped
   test run when the two packages' tests happen to independently pass.

## Waves

### Wave 1: Port method-sugar dispatch into `transformer-core`

The one true capability gap, not just a duplication. `transformer-core` gains
its first real method-sugar dispatcher.

- [ ] Port `tryResolveTypeclassMethod`/`resolveMethodSugarInstance`
      (`index.ts:3618-3772`) into a new `transformer-core/src/method-sugar.ts`,
      adapted to `transformer-core`'s existing context/visitor conventions
      (not a verbatim copy — check it against `tryRewriteTypeclassOperator`'s
      already-shared instance-resolution path for the same class of gap this
      PEP's motivating bug came from).
- [ ] Wire it into `transformer-core/src/transformer.ts`'s dispatch chain, gated
      by the same `ResolutionScopeTracker`/`getMethodCandidates` activation
      check the legacy version uses.
- [ ] New tests in `transformer-core/tests/`: method-sugar activation on/off,
      cross-module companion resolution, same-file `@derive` companion
      (the exact scenario PEP-052's `@derive` fix covers for operators —
      confirm method sugar gets the identical fix for free, since it now goes
      through the same shared `resolveInstance`).
- [ ] Playground (`packages/playground`) demo/test proving `.equals()` sugar
      now works in the browser bundle for the first time.

**Gate:**

- [ ] `pnpm --workspace-concurrency=1 build` green
- [ ] Full `pnpm test` (not a package filter) green
- [ ] A playground-bundle test (not just a `transformer-core` unit test)
      demonstrates `.equals()` rewriting end-to-end

### Wave 2: Merge the four remaining duplicated dispatchers

`tryExpandTaggedTemplate`, `tryExpandTypeMacro`, `tryRewriteExtensionMethod`,
`tryExpandExpressionMacro`, `tryExpandAttributeMacros` — read both
implementations side by side for each one (PEP-052 Wave 8's own retrospective:
"a wave scoped as a mechanical port hid real behavioral divergence in 2 of 8
functions" — expect the same here, budget time to read full bodies, not just
diff signatures).

**Implementation status — scope adjusted, see note below.**

- [x] For each function: reconcile behavior differences into
      `transformer-core`'s copy (the more complete/correct one wins per
      function, not "core always wins by default").
      Also check `tryRewriteTypeclassOperator` (`index.ts:4549-4701` vs.
      `rewriting.ts:365`) even though the shared `resolveInstance` call
      inside it is already unified — the surrounding dispatch/activation
      logic in each copy may still have drifted.
- [ ] Delete the legacy copies once each is confirmed byte-for-byte
      equivalent in test coverage (add tests first if a divergence is found
      and either side's behavior is undertested).
- [ ] `@typesugar/transformer/src/index.ts` should now contain no
      independent rewriting logic — only `macroTransformerFactory`'s
      Node-specific wiring (macro-package loading, program construction).

**Scope note (deliberate deviation from the two checkboxes above):** a
research pass compared all six functions (plus the `tryResolveFromTypeRewriteRegistry`/
`tryRewriteOpaqueMethodCall` pair the extension-method merge turned out to
depend on — a seventh near-duplicate not on this list) line-by-line against
their legacy counterparts and found concrete behavioral drift in three of
them, all now fixed in `transformer-core`:

- `tryRewriteExtensionMethod`: legacy normalizes literal receiver types
  (`NumberLiteral`/`StringLiteral`/`BooleanLiteral` → `"number"`/`"string"`/`"boolean"`)
  before extension lookup; core lacked this, so a standalone extension
  registered for `"number"` silently failed to match a literal-typed receiver
  (e.g. `(5).clamp(...)`). Ported, with a regression test proving the fixture
  genuinely has a `NumberLiteral` type.
- `tryRewriteTypeclassOperator`: legacy schedules an import for a
  cross-module (`module-scan`) resolved instance; core assumed the binding
  was already in scope, which is only true for `local-scope`/`explicit-import`
  resolution, not `module-scan` — a real dangling-reference bug for exactly
  the kind of cross-module resolution the browser playground exercises.
  Fixed using `ctx.ensureImport()` (the shared reference-hygiene mechanism,
  already used by Wave 1's `method-sugar.ts`) rather than reintroducing
  per-transformer import-tracking state, and using the identifier it returns
  (not a fresh bare one) so a hygiene-driven alias and the emitted reference
  never disagree. Also ported legacy's `stripCommentsDeep` on both operands
  (a minor but real, printed-output-observable difference). Both proven with
  a real two-file cross-module fixture and a comment-stripping test; verified
  the import-scheduling test genuinely fails without the fix.
- `tryExpandExpressionMacro` (a private `MacroTransformer` method in both
  packages, not a free function): legacy's cache-hit path returns the cached
  node **without** re-visiting it and stores the cache entry **after**
  visiting (documented rationale: a re-parsed cached node is fully synthetic,
  so re-visiting can't expand anything further and can only waste work or, in
  principle, diverge); core's re-visited on hit and stored the pre-visit
  result — two individually-consistent but mutually incompatible designs.
  Reconciled to legacy's documented-correct pair. **Not covered by a new
  test**: `MacroExpansionCache` (`@typesugar/core/cache.ts`) is a disk-based
  cache using Node's `fs` directly, and `transformer-core`'s only
  `MacroTransformer` construction site (`transform.ts:336`, the public
  `transformCode()` entry point) never passes one — deliberately, since doing
  so would break the package's own browser-compatibility mandate. This
  reconciliation is therefore currently unreachable/untestable via any public
  API in `transformer-core`; it's a correctness fix for whenever a caching
  layer is actually wired in (plausibly Wave 4, alongside `pipeline.ts`), not
  a live bug today.

The other three functions (`tryExpandTaggedTemplate`, `tryExpandTypeMacro`,
`tryRewriteExtensionMethod`'s core-wins divergences, `tryExpandAttributeMacros`)
were confirmed either identical (plumbing-only differences) or core-already-more-complete
(e.g. `tryExpandAttributeMacros`'s `globalRegistry` fallback and expansion
tracking, both absent from legacy) — no port needed.

The two unchecked boxes — **deleting the legacy copies and making
`packages/transformer/src/index.ts` import from `transformer-core`** — are
deliberately deferred to Wave 4. Two reasons: (1) two of the six functions
(`tryExpandExpressionMacro`, `tryExpandAttributeMacros`) are private methods
on _each package's own, structurally different_ `MacroTransformer` class —
making legacy "import" core's versions would require first extracting them
to free functions (churn with no independent value, since Wave 4 deletes the
whole legacy class anyway); (2) Wave 4 already deletes
`packages/transformer/src/index.ts` in its entirety once `pipeline.ts` is
rewired onto `transformer-core` directly, which trivially satisfies both
boxes as a side effect. Doing a "make legacy delegate" refactor now, only to
delete the delegating shims two waves later, is pure throwaway work. The
actual safety goal — no more silent behavioral drift between the two
implementations — is met by this wave's reconciliation regardless of whether
the mechanical delegation happens now or is superseded by full deletion.

**Gate:**

- [x] Full workspace build + full `pnpm test` green (7245 passed, up from 7242
      by 3 new regression tests — the fourth reconciliation, the cache-pair
      fix, has no live test per the note above).
- [ ] `grep` confirms zero `function try(Expand|Rewrite)` definitions remain
      in `packages/transformer/src/index.ts` — **not met**; deferred to
      Wave 4 per the scope note above.

### Wave 3: Move the two misplaced Node-agnostic files

- [x] Move `dts-opaque-discovery.ts` to `transformer-core`, using injectable
      `readFile`/`fileExists` rather than `ts.sys` directly. Correction to the
      checkbox as originally worded: `transformer-core` did not already have
      an injectable file-access mechanism for this — added a small
      `DtsFileAccess` interface (`fileExists`/`readFile`) that
      `discoverOpaqueTypesFromImports` accepts, defaulting to `ts.sys` when
      present (Node callers) and a browser-safe no-op otherwise. Only the one
      disk-fallback path in `resolveRelativeDts` needed this — files already
      loaded into `program` resolve the same way regardless of environment.
      `path` (also Node-only in principle) needed no change: the playground
      already has a browser shim for it (`packages/playground/src/browser-shims/path.ts`).
- [x] Move `profiling.ts` to `@typesugar/core` (shared by both pipelines,
      not just one) — no-op profiler when unused, so this costs
      `transformer-core`/the playground nothing. Fixed one real Node
      assumption while moving it: `PROFILING_ENABLED` read `process.env`
      unconditionally, which throws in a browser bundle where `process`
      doesn't exist — now guarded with `typeof process !== "undefined"`.
- [x] `@typesugar/transformer` re-exports both from their new home for
      backward-compat import paths, marked `@deprecated`. All three internal
      consumers (`index.ts`, `cli.ts`, `pipeline.ts`) updated to import from
      the new locations directly rather than through their own package's
      deprecated shim.

**Gate:**

- [x] Full build + test green (`pnpm --workspace-concurrency=1 build` +
      `pnpm test`, 7245 passed).
- [x] Playground bundle size does not regress meaningfully: `browser.js`
      206→213 KB, `runtime.global.js` 574→577 KB across this wave — a few KB
      from the two moved files actually being included (mostly
      `dts-opaque-discovery.ts`, since nothing in the playground's transform
      path currently calls `discoverOpaqueTypesFromImports`, so most of it
      isn't reachable code but the barrel re-export still pulls the module
      in), not a meaningful regression. `profiling.ts` is confirmed a no-op
      at runtime when `PROFILING_ENABLED` is false (every method short-circuits
      immediately), which was the actual "costs nothing" claim this gate cares
      about — module inclusion size and runtime no-op-ness are different
      properties, and only the latter was the gate's real concern.

### Wave 4: Retire `macroTransformerFactory`, wire `pipeline.ts` through `transformer-core`

The actual deletion.

- [ ] `pipeline.ts`'s `transformCode()` (the CLI/build entry point) constructs
      its real `ts.Program`/compiler host as it does today, then calls
      `transformer-core`'s `MacroTransformer`/`transformCode({ program,
  compilerHost, ... })` — the injection seam PEP-015 built and never
      used — instead of `macroTransformerFactory` from `./index.js`.
- [ ] `language-service.ts` (LS plugin) does the same for its per-file
      transform closure.
- [ ] Delete `index.ts` entirely once nothing imports `macroTransformerFactory`.
- [ ] Delete `transformer-core`'s now-redundant in-memory-program convenience
      path IF `pipeline.ts`'s real program subsumes it cleanly — or keep both
      if the in-memory path still earns its keep for tests/tools that don't
      have a real `ts.Program` handy (this is a judgment call to make with
      the actual diff in front of you, not to pre-decide here).

**Gate:**

- [ ] `pnpm --workspace-concurrency=1 build` green
- [ ] Full `pnpm test` green — this is the highest-risk gate in the PEP;
      treat any new failure as a real behavioral gap `pipeline.ts` was
      silently relying on, not a false positive to route around
- [ ] `typesugar build`/`typesugar check` CLI smoke-tested against a real
      project (not just the test suite) — every example under `examples/`
      and `docs/examples/` builds with identical output to before this wave
- [ ] `zero` references to `packages/transformer/src/index.ts` anywhere in
      the tree (`grep -r` across `packages/`, `docs/`, `examples/`)

### Wave 5: Fix the audit's remaining concrete findings

Small, independent fixes surfaced by the same audit, worth landing alongside
the consolidation rather than filed and forgotten:

- [ ] `findInstanceInScopeByName`/`findScannedInScope`
      (`packages/macros/src/instance-resolver.ts`) doesn't consult
      `InstanceScanner.getSynthesized` the way its sibling
      `resolveFromLocalScope` now does — same-pass `@derive` companions are
      invisible to the auto-specialization companion-path walker
      (`Point.Numeric` → generating declaration). One-line fix, mirrors the
      already-fixed sibling exactly.
- [ ] `instanceMethodRegistry` (`packages/macros/src/specialize.ts`) is a
      bare process-lifetime `Map` — the only instance-resolution mechanism in
      the codebase that isn't `WeakMap<ts.Program>`-partitioned. Give it the
      same partitioning every other mechanism already has. Low correctness
      risk today (miss just falls back to a real call) but worth closing the
      one real exception to "no process-global registry."
- [ ] Centralize the synthetic-node guard. At least eight call sites across
      three packages independently reimplement `node.pos === -1 ||
  node.end === -1` with their own copy of the same explanatory comment.
      Add one `isSyntheticNode(node)` helper to `@typesugar/core`, replace
      every site, and use it as the thing new code is expected to reach for
      (see CLAUDE.md addition below).
- [ ] Make the non-verbose CLI path fail loudly. `cli.ts`'s three
      checker-crash `try/catch` blocks (`getPreEmitDiagnostics` ×2, the
      SFINAE filter) currently only log the failure when `--verbose` is
      passed for two of the three — meaning a default build can silently
      drop or leave unfiltered a whole diagnostics pass. At minimum, always
      print one line (not the full stack) when this happens, regardless of
      verbosity.

**Gate:**

- [ ] Full test suite green
- [ ] A test specifically proving the `findInstanceInScopeByName` fix
      (same-file `@derive` + generic-function specialization call),
      structured like the existing operator-sugar regression test

### Wave 6 (separate, larger, not blocking Waves 1-5): Audit and re-scope the AST-purity exception list

Out of scope for the pipeline-unification work itself, but surfaced by the
same audit and worth its own pass: CLAUDE.md's six named string-codegen
exceptions no longer match the tree. At least ten more files
(`testing/macro.ts`, `effect/derive/{hash,equal,schema}.ts`,
`contracts/macros/laws.ts`, `parser/macros.ts`, `codec/macros.ts`,
`sql/derive-typeclasses.ts`, plus two more `parseExpression` sites inside
`typeclass.ts` itself that its own exception entry doesn't name) do the exact
template-string-then-reparse codegen the rule bans, undocumented. This needs
its own PEP or standalone pass — deliberately not folded into this one, since
"unify the transformer" and "bring every macro package up to the AST-purity
bar" are different-sized, differently-risky changes and conflating them would
make this PEP's gates harder to reason about.

## CLAUDE.md additions

Two new principles this audit surfaced, proposed for the "Code generation:
prefer AST over string manipulation" section and a new section after it.
**Not applied yet — this is a proposed diff for review alongside the rest of
the PEP, not a decision already made.**

### 1. Tighten the existing AST-over-strings section

Add, after the current exception list:

> **The exception list above must be exhaustive, not illustrative.** If you
> add a `parseStatements`/`parseExpression` call anywhere in this repo,
> either it's already covered by name and file above, or you add it to this
> list in the same commit with the same justification structure the existing
> entries use (why AST construction wasn't feasible here, not just "it was
> easier"). A string-codegen call site with no corresponding CLAUDE.md entry
> is a bug in this file, not a passable gap — flag it in review rather than
> assuming an old omission means the rule doesn't apply to your package.

### 2. New section: same-pass state visibility

> ## Resolving things a macro just generated
>
> When a macro synthesizes a new declaration, instance, or binding during a
> transform pass (a `@derive` companion, a generated constructor, a
> registered extension method), anything that later needs to _discover_ that
> synthesized thing — a scanner, a resolver, a lookup table — must consult
> **live, same-pass state**, not a scan of the pre-transform source text.
> `sourceFile.statements` is fixed at the start of a pass; a scan over it
> can never see what the pass itself is in the middle of generating,
> regardless of visit order.
>
> Two shapes exist in this codebase; only one is safe against this bug:
>
> - **Live keyed registry, read within the same pass** (`@extension`'s
>   `standaloneExtensionRegistry`, `@opaque`/`@adt`'s `registerTypeRewrite`,
>   `InstanceScanner`'s `registerSynthesized` side-table) — correct. Only
>   constraint is the ordinary declare-before-use one any single top-down
>   pass has.
> - **Scan of a snapshot bound once at pass start**
>   (`InstanceScanner.scanLocalFile` before its `getSynthesized` companion
>   was added) — unsafe by construction for anything synthesized mid-pass.
>
> If you add a new resolution/discovery mechanism, or add a new _consumer_ of
> an existing one (see: `findInstanceInScopeByName`, which didn't get the
> `getSynthesized` fix its sibling `resolveFromLocalScope` did, in the same
> file, and shipped that way for a release), explicitly check which shape
> you're building on and say so in a comment. Silence on this point reads as
> "the author didn't think about it," because in every instance found so far,
> that's exactly what it was.

### 3. New section: checker calls on synthetic nodes

> ## Calling the type checker on macro-generated nodes
>
> A synthesized AST node (`pos`/`end` of `-1`, never part of the `Program`
> the checker was built from) is outside the checker's supported contract —
> `getTypeAtLocation`, `getSymbolAtLocation`, and diagnostic-span code can
> all throw on it. This is a real, load-bearing constraint in this codebase,
> not a hypothetical: `cli.ts` catches it by name (`"start < 0"`) at three
> separate checker entry points.
>
> Use `isSyntheticNode(node)` (`@typesugar/core`) to skip before calling the
> checker on a node that might be macro-generated, rather than a fresh
> `node.pos === -1` check. If you're adding a new checker call site inside
> macro-expansion code, assume the node in front of you might be synthetic
> until proven otherwise (real user source has a real position; a synthetic
> replacement never does) — check first, don't discover it via a thrown
> exception in production.
>
> When you do catch a checker failure and choose to degrade rather than
> propagate, **the user needs to see that something was skipped** — a
> one-line warning survives the failure even if the rest of the diagnostic
> pass doesn't. A caught exception with no visible trace is a worse outcome
> than the exception itself.

## Files Changed

| File / Package                                          | Change                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/transformer-core/src/method-sugar.ts`         | New — ported method-sugar dispatch                                               |
| `packages/transformer-core/src/rewriting.ts`            | Absorbs the four remaining duplicated dispatchers                                |
| `packages/transformer-core/src/dts-opaque-discovery.ts` | Moved from `packages/transformer/src/`                                           |
| `packages/core/src/profiling.ts`                        | Moved from `packages/transformer/src/`                                           |
| `packages/core/src/synthetic-node.ts`                   | New — `isSyntheticNode()` helper                                                 |
| `packages/transformer/src/index.ts`                     | **Deleted**                                                                      |
| `packages/transformer/src/pipeline.ts`                  | Calls `transformer-core`'s `MacroTransformer` with an injected real `ts.Program` |
| `packages/transformer/src/language-service.ts`          | Same change, LS closure                                                          |
| `packages/macros/src/instance-resolver.ts`              | `findInstanceInScopeByName` gains the `getSynthesized` check                     |
| `packages/macros/src/specialize.ts`                     | `instanceMethodRegistry` gains `WeakMap<Program>` partitioning                   |
| `packages/transformer/src/cli.ts`                       | Checker-crash paths always emit one line regardless of `--verbose`               |
| `CLAUDE.md`                                             | Three additions above (proposed, not yet applied)                                |

## Consequences

### Benefits

1. **One rewriting implementation.** A fix lands once, reaches the CLI, the
   language service, and the playground identically — the exact property
   PEP-015 named as its goal in 2026-03 and never fully delivered.
2. **Method-sugar sugar finally works in the browser playground** — not a
   playground bug fixed, a feature the playground never had until this PEP.
3. **~4,800 lines deleted**, not refactored elsewhere — the legacy dispatch
   logic isn't moved, it's retired in favor of code that already exists.
4. **The bug class that motivated this PEP becomes structurally harder to
   reintroduce** — there's no second copy left to drift out of sync with.

### Trade-offs

1. **This is the highest-risk PEP touching this system since PEP-053.**
   `pipeline.ts` is the real build path for every typesugar user; Wave 4's
   gate (full test suite, every example project, a CLI smoke test) is not
   optional scaffolding — it's the actual safety net for a change with this
   blast radius.
2. **Waves 1-2 will likely surface behavior this PEP doesn't anticipate** —
   PEP-052 Wave 8's retrospective found real divergence in what looked like
   mechanical ports 2 out of 8 times; budget for that rate here too, across
   six functions instead of eight.
3. **Sequencing matters**: Wave 1 (method-sugar) and Wave 2 (merge) should
   land and prove stable in the CLI/LS path (still running through
   `macroTransformerFactory` until Wave 4) before Wave 4 actually removes the
   old path — the new dispatch logic gets real-world exercise before it
   becomes the only path, not simultaneously with becoming the only path.

### Future work

- Wave 6 (AST-purity exception list) as its own follow-up PEP.
- Once `transformer-core` is the only implementation, revisit whether
  `@typesugar/transformer` should be renamed to reflect its new, much
  smaller scope (something like `@typesugar/transformer-node` or
  `@typesugar/transformer-cli`) — a naming decision, not blocking any wave
  above, deliberately left for after the code settles.
