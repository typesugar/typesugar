# @typesugar/core

## 0.2.0

### Minor Changes

- d8f810b: PEP-052 Wave 2: labeled-block macros are now import-scoped (`@syntax-labels`
  activation), matching the operator/method syntax gates.
  - BREAKING (pre-1.0): `let:`/`seq:`/`par:`/`all:` do-notation comprehensions
    only expand in files that import `@typesugar/std/syntax/do`, and bare
    `requires:`/`ensures:` contract blocks only apply `@contract` in files that
    import `@typesugar/contracts/syntax`. The explicit `@contract` decorator form
    is unaffected (importing the symbol is the opt-in).
  - NEW: TS9224 warning when a block-shaped label matches a registered macro
    whose syntax is not activated, with a help hint naming the exact import to
    add (unexpanded do-notation is still valid JS — `x << effect()` silently
    becomes a bit-shift — so the hint matters).
  - NEW: `@syntax-labels <macroName>` activation-marker tag (read alongside
    `@syntax-operators`/`@syntax-methods`) and an optional `syntaxModule` field
    on `LabeledBlockMacro`/`AttributeMacro` that feeds the TS9224 hint and
    doubles as a resolution-free activation fallback — an import specifier
    exactly matching a macro's `syntaxModule` activates it even in hosts that
    cannot resolve modules (the playground's in-memory host, virtual file
    names).
  - FIXED: ordinary loop labels colliding with macro label names
    (`all: for (…)`) were dispatched to the macro (a hard error) when the file
    had the syntax activated; labeled non-blocks are no longer dispatch
    candidates at all.
  - FIXED: an expression-position comprehension in a file that never activates
    do-notation was text-rewritten by the preprocessor and then left mangled
    (invalid JS) by the gate; the preprocessor is now gated on activation too,
    leaving such files untouched.
  - FIXED: activation markers (all kinds, operators/methods included) were
    silently dropped in files rewritten by the expression-comprehension
    preprocessor — the re-parsed file isn't part of the `ts.Program`, so
    checker-based marker resolution failed. Markers now resolve against the
    program's own copy of the file.

- 63bf193: PEP-052 Wave 3: do-notation instance resolution is scope-based — the last
  process-global instance registry is deleted.
  - BREAKING (pre-1.0): `let:`/`par:` comprehensions resolve their
    `FlatMap`/`ParCombine` instance from the file's scope (a local `@impl`
    declaration or an export of any imported module), not from a global
    registry populated by side-effect imports elsewhere in the program. The
    std builtins (Array, Promise, Iterable, AsyncIterable) ride along with the
    `@typesugar/std/syntax/do` marker every do-notation file already imports —
    zero new imports for the common case. Effect users import
    `@typesugar/effect/syntax/do` (one line: activates the labels AND provides
    the Effect instances).
  - NEW: TS9225 "No FlatMap instance for 'X' is in scope" error naming the
    exact import to add when resolution misses.
  - NEW: `@do-methods` JSDoc metadata on instances declares do-notation
    emission (bind/map/orElse method names, static-vs-method call style,
    static receiver, `all` join) — replacing the hardcoded Promise/Effect
    special cases in the comprehension macros. Third-party monads get the
    same treatment as std's.
  - NEW: scanner-visible `FlatMap<Either>` instance (`flatMapEitherInstance`)
    in `@typesugar/fp` — `let:` over Either now works via any fp import (the
    `flatMapEither<E>()` factory alone was never discoverable, so Either
    do-notation had silently never expanded).
  - NEW: `ParCombine<Effect>` instance — `par:` over Effect now emits
    `Effect.map(Effect.all([...]), ...)`; previously it fell back to an
    applicative chain emitting `.map(...).ap(...)` calls Effect doesn't have.
  - REMOVED: `doNotationRegistry`, `parCombineBuilderRegistry`, and their API
    (`registerFlatMap`, `registerParCombine`, `registerParCombineBuilder`,
    `getFlatMapMethodNames`, `hasFlatMapInstance`, `hasParCombineInstance`,
    `getInstanceMeta`, `clearRegistries`). Declare instances with `@impl` +
    `@do-methods` and export them instead.

- 563e46b: PEP-052 Wave 6: resolution-free operator/method syntax-marker fallback,
  closing the gap for hosts (the browser playground) that cannot resolve
  modules via the checker.
  - NEW: `@typesugar/core` exports `registerSyntaxMarkerFallback`/
    `getSyntaxMarkerFallback` — a small, provider-declared registry that lets a
    package register "this exact import specifier activates operator/method
    syntax for typeclass X" without needing real module resolution.
    `scanImportsForScope` consults it as a purely additive fallback alongside
    the existing checker-based marker discovery.
  - NEW: `@typesugar/std` registers all 21 of its syntax markers (13 method +
    8 operator) via this mechanism from its `./macros` entry; `@typesugar/fp`
    registers its one marker (`@typesugar/fp/syntax/show`) from its root `.`
    entry (fp has no separate `./macros` compile-time entry).
  - FIXED: `@typesugar/playground`'s `transform()` — the actual in-memory host
    this wave exists for — never loaded std's or fp's compile-time
    registrations at all (both were only imported for runtime values via a
    separate iframe-sandbox bundle). A playground snippet importing e.g.
    `@typesugar/std/syntax/eq/ops` could not activate Eq operator syntax.
    Fixed with two side-effect imports; verified negligible bundle-size impact.

- 8aaf40f: PEP-053 Wave 2: source-based instance extraction now covers everything the
  static builtin table covered. Auto-specialization recognizes instances across
  import aliases (including renames), identifier-alias consts
  (`const stdFlatMapArray = flatMapArray`), zero-arg factory instances
  (`eitherFunctor<E>()`), indirect object-literal members
  (`map: optionFunctor.map`, shorthand `{ map }`), and companion paths
  (`Point.Numeric`). Acceptance criteria are unified across both pipelines:
  an `@impl`/`@instance` tag OR a typeclass-shaped type annotation suffices.

  Cross-module method bodies that reference the instance module's local helpers
  or imports are NOT inlined — those calls fall back to dictionary passing
  (always correct) instead of capturing dangling identifiers.

  The extraction implementation is now shared (`@typesugar/macros`
  instance-extraction module) and consumed by both the legacy transformer and
  transformer-core, replacing the duplicated per-pipeline copies. New
  `cloneNodeDeep` utility in `@typesugar/core` protects foreign-file ASTs from
  in-place position stripping during inlining.

- c56886c: PEP-054: Rename "SFINAE rules" to "diagnostic suppression rules"

  "SFINAE" borrowed C++ template-metaprogramming terminology (overload-resolution
  failure) for a mechanism that actually suppresses a TypeScript diagnostic when
  typesugar's macro transformer will resolve it at emit time — an unrelated,
  misleading analogy. Renamed throughout to `DiagnosticSuppressionRule` and its
  family.
  - **`@typesugar/core`** (breaking): `packages/core/src/sfinae.ts` and
    `sfinae-rules.ts` are renamed to `diagnostic-suppression.ts` and
    `diagnostic-suppression-rules.ts`. Every exported symbol is renamed:
    `SfinaeRule` → `DiagnosticSuppressionRule`, `SfinaeAuditEntry` →
    `DiagnosticSuppressionAuditEntry`, `SfinaeEvalResult` →
    `DiagnosticSuppressionEvalResult`, `registerSfinaeRule(Once)` →
    `registerDiagnosticSuppressionRule(Once)`, `clearSfinaeRules` →
    `clearDiagnosticSuppressionRules`, `getSfinaeRules` →
    `getDiagnosticSuppressionRules`, `getSfinaeAuditLog`/`clearSfinaeAuditLog` →
    `getDiagnosticSuppressionAuditLog`/`clearDiagnosticSuppressionAuditLog`,
    `isSfinaeAuditEnabled`/`setSfinaeAuditMode` →
    `isDiagnosticSuppressionAuditEnabled`/`setDiagnosticSuppressionAuditMode`,
    `evaluateSfinae` → `evaluateDiagnosticSuppression`. No deprecated aliases
    (pre-1.0, matching PEP-053's precedent). The `TYPESUGAR_SHOW_SFINAE`
    environment variable is renamed to `TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS`.
  - **`@typesugar/macros`** (breaking): `sfinae-rules.ts`/`sfinae-registration.ts`
    renamed to `diagnostic-suppression-rules.ts`/`diagnostic-suppression-registration.ts`.
    `SfinaeRegistrationOptions` → `DiagnosticSuppressionRegistrationOptions`,
    `registerAllSfinaeRules` → `registerAllDiagnosticSuppressionRules`,
    `ALL_SFINAE_RULE_NAMES` → `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`. Individual
    rule creator functions (`createExtensionMethodCallRule`, etc.) are unchanged.
  - **`@typesugar/transformer`** (breaking, CLI): the `--show-sfinae` flag is
    renamed to `--show-suppressed-diagnostics`. No deprecated alias — the old
    flag is now silently ignored (typesugar's CLI does not error on unrecognized
    flags), so scripts/CI invocations using the old name will stop enabling
    audit mode without a warning. Update any tooling that passes `--show-sfinae`
    or reads `TYPESUGAR_SHOW_SFINAE`.
  - **`@typesugar/lsp-server`, `@typesugar/playground`**: internal call sites
    updated to the renamed core/macros exports; no public API changes.

  Not renamed (deliberately out of scope, see PEP-054): `type-rewrite-registry.ts`
  (a separate, correctly-named mechanism), and PEP-011/PEP-034's own historical
  titles.

### Patch Changes

- 4f6ad83: PEP-034: Unified SFINAE registration and shared IDE infrastructure
  - Unified all SFINAE rule registration into `registerAllSfinaeRules()` to prevent drift between IDE paths
  - New `@typesugar/lsp-common` package with shared position mapping, AST helpers, and macro code actions
  - Added `getApplicableRefactors` and `getCompletionEntryDetails` to the TS plugin language service
  - Diagnostic parity test suite exercising all 6 SFINAE rules
  - Zed extension workspace detection (only starts LSP for typesugar projects)

- 98adbea: PEP-052 Wave 4: de-magicking — HKT typeclass knowledge is
  declaration-derived and the dead post-registry surfaces are gone.
  - REMOVED: `hktTypeclassNames`, `registerHKTTypeclass`, the
    `hktExpansionRegistry` hardcoded seeds, and the hand-written HKT signature
    templates. `isHKTTypeclass` now derives from the `@typeclass` interface
    declaration (type parameter used as `Kind<F,…>`, including through
    `extends` chains — the op-index flattens heritage). fp's typeclass
    interfaces (Functor…Alternative) now carry `@typeclass` tags and are read
    exactly like third-party typeclasses.
  - REMOVED: the `InstanceMeta` type, all no-op 1-arg
    `registerInstanceWithMeta` calls, the legacy transformer's import
    pre-scan, the dead `knownTypeclasses` scope chain
    (`isTypeclassInScope`/`getInScopeTypeclasses`/`registerImportedTypeclass`),
    the test-only ResultAlgebra helpers
    (`unsafeResultAlgebra`/`hasResultAlgebra`/`getAllResultAlgebras`), and
    `register-instances.ts` (`registerStdInstances` survives as a deprecated
    runtime no-op stub).
  - NEW: `@do-instance-module <specifier>` JSDoc tag — do-notation instance
    providers self-describe their activation import; the TS9225 hint consults a
    program-wide index first and falls back to a small static table only for
    providers whose declaration files are unreachable in the program.

- 053978c: PEP-053 Wave 1: specialization is now an always-on compiler optimization, not
  an API.
  - REMOVED: the `specialize()`, `specialize$()`, `mono()`, and `inlineCall()`
    macros and runtime stubs, the `fn.specialize(dict)` extension-method rewrite,
    and the `@typesugar/specialize` package (including the `Specialized<F, N>`
    type). Calls that pass a known typeclass instance auto-specialize — no
    annotation needed; use `// @no-specialize` to opt a call out.
  - REMOVED: `createSpecializedFunction`, `canFlattenToExpression`, and the
    `SpecializeOptions` type from `@typesugar/macros` (dead once the explicit
    surface was gone), and the TS9601/TS9221 diagnostics.
  - FIXED: `// @no-specialize-warn` previously disabled specialization entirely
    (substring collision with `// @no-specialize`); it now only suppresses the
    TS9602 skip warning. Both markers now also work on a comment line
    immediately above the call, matching the documented form.

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- a252187: PEP-058 Wave 2: pre-release onboarding and source corrections.
  - `typesugar init` now actually patches an existing vite/webpack/rollup
    config (previously it computed and silently discarded the patch,
    no-oping in the most common brownfield case), and prints an explicit
    "not yet supported" message for Next.js instead of implying support.
  - `typesugar create` templates now ship inside `@typesugar/transformer` —
    previously they lived only at the monorepo root, so `create` failed for
    every registry install of the CLI.
  - `typesugar doctor`'s ts-patch detection now checks for ts-patch's real
    `/// tsp-module:` header instead of a fuzzy substring that could
    false-positive on unpatched builds.
  - All compiler-emitted diagnostic help URLs (`seeAlso` in the TS9xxx and
    EFFECT0xx catalogs) and CLI next-step links now point at the canonical
    typesugar.org domain (previously typesugar.dev, which is not the site).
  - `@typesugar/lsp-common` gains a README and `sideEffects: false`.

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
