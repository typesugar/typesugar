# @typesugar/effect

## 0.2.0

### Minor Changes

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

### Patch Changes

- 0e2a586: PEP-048: pin the supported Effect peer range to `>=3.0.0 <4.0.0`

  Resolves PEP-048 Open Question 1 (Keep `@typesugar/effect`, but declare the
  supported Effect major explicitly rather than the open-ended `>=3.0.0`).

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

- 76672a0: PEP-053 Waves 4–5: the compiler's hard-coded builtin instance table is gone.
  The ~28 static `registerInstanceMethods(...)` registrations (source-code-as-
  strings copies of the fp/std/effect instances), the deprecated
  `registerInstanceMethods` function, and the internal-registration machinery
  are deleted from `@typesugar/macros`. Instance method bodies now come
  exclusively from source extraction — the same rules for std/fp/effect
  instances as for user instances, no builtin magic. The 16 primitive
  intrinsics (`eqNumber` → `a === b`, …) and the per-program AST registry
  (`registerInstanceMethodsFromAST`) remain. `eitherBifunctor` and
  `flatMapStream` (registrations with no corresponding source instance) are
  dropped. Residual `specialize()`-as-API comment mentions in std/effect/
  collections/validate sources are rewritten for the always-on model.
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

- 238e7d7: PEP-058 Wave 4: Effect diagnostic help URLs now point at the canonical
  `typesugar.org/errors/EFFECT0xx` pages (previously an `/effect/errors/`
  path that did not exist), matching the unified error catalog.
- Updated dependencies [4f6ad83]
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [563e46b]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [76672a0]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
  - @typesugar/core@0.2.0
  - @typesugar/std@0.2.0
  - @typesugar/graph@0.1.2
  - @typesugar/testing@0.1.2
  - @typesugar/type-system@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/std@0.1.1
  - @typesugar/graph@0.1.1
  - @typesugar/type-system@0.1.1
  - @typesugar/testing@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/std@0.1.1-rc.0
  - @typesugar/graph@0.1.1-rc.0
  - @typesugar/type-system@0.1.1-rc.0
  - @typesugar/testing@0.1.1-rc.0
