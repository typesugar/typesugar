# @typesugar/fp

## 0.2.0

### Minor Changes

- e92220f: 1.0 public-API pruning (audit/ARCH-REVIEW-2026-11-TRIAGE.md, PR 3). Removes exports that
  nothing in the compiler used, that were deprecated, or that duplicated a newer API.

  **`@typesugar/core`**
  - Macro capabilities (`capabilities.ts`, never enforced): `createRestrictedContext`,
    `resolveCapabilities`, `DEFAULT_CAPABILITIES`, `MacroCapabilities`.
  - Prelude table (`prelude.ts`, never consulted): `DEFAULT_PRELUDE`, `getPreludeTypeclasses`,
    `getPreludeEntry`, `isPreludeMethod`, `isPreludeOperator`, `generatePreludeDeclaration`,
    `METHOD_TO_TYPECLASS`, `OPERATOR_TO_TYPECLASS`, `PreludeEntry`. The `resolution.prelude`
    config option is unchanged.
  - Manifest discovery (never called): `discoverManifests`, `createManifestRegistry`,
    `mergeManifestIntoRegistry`, `getManifestRegistry`, `resetManifestRegistry`,
    `DiscoveredManifest`, `ManifestDiscoveryOptions`, `ManifestRegistry`. The manifest schema types,
    `loadManifest` and `validateManifest` stay.
  - Diagnostics: `legacyToRichDiagnostic`, `printDiagnostic`, `printDiagnostics`,
    `renderDiagnosticsCLI`, and the `writer` option of `CLIRenderOptions` (only the printers read
    it). `renderDiagnosticCLI` stays.
  - `createInstanceLocation`, `InMemoryExpansionCache`.

  **`@typesugar/macros`**
  - The `impl("TC<T>", {...})`, `typeclass("Name")` and `instance("TC<T>", {...})` expression
    macros (`implMacro`, `typeclassMacro`), left over from the removed preprocessor. Use
    `/** @impl TC<T> */` and `/** @typeclass */` (JSDoc) or the decorator forms; they are the only
    forms. The instance scanner no longer recognises a `const x = impl("TC<T>", …)` initializer.
  - The runtime stubs `typeclass(name)` and `impl(desc, obj)` lose their expression overloads;
    `typeclass`, `impl` and the deprecated `instance` remain as decorators.
  - `generateStandardTypeclasses`, `getAllTypeclassDefs`, and the `SemigroupPrimitives` /
    `MonoidPrimitives` aliases (use `Semigroup` / `Monoid`).

  **`@typesugar/typeclass`**: `implMacro` and `generateStandardTypeclasses` re-exports.

  **`typesugar`**: the expression overloads of the `typeclass`, `impl` and `instance` stubs, as
  above.

  **`@typesugar/transformer-core`**
  - `isExtensionEnabled` and `fallbackNameLookup` (internal, unused).
  - `JSDOC_MACRO_TAGS` is now a `ReadonlySet<string>` of tag names instead of an identity map,
    without the dead `operators`/`operator` entries (no macro has either name; an `@operators` JSDoc
    tag is now left alone instead of being reported as an unknown macro tag).

  **`@typesugar/std`**
  - Range: the deprecated function API (`range`, `rangeInclusive`, `rangeBy`, `rangeReversed`,
    `rangeIterator`, `rangeToArray`, `rangeForEach`, `rangeMap`, `rangeFilter`, `rangeReduce`,
    `rangeContains`, `rangeSize`, `rangeFirst`, `rangeLast`, `rangeIsEmpty`) and the `RangeExt` and
    `RangeExtensions` objects. Use the extension methods: `(1).to(10).step(2).toArray()`. The
    `Range` type, `eqRange` and `ordRange` stay.
  - Legacy typeclasses that duplicated newer ones or had no instances: `Parseable` (and
    `ParseResult`), `Printable`, `Coercible`, `Defaultable`, `Copyable`, `Sized`, `Identifiable`,
    `Reducible`, `Zippable`, `Splittable`, `Searchable`, with all their instances
    (`parseableNumber`, `printableNumber`, `numberToString`, `defaultNumber`, `copyableArray`,
    `sizedString`, …). Use `Clone`, `Debug`, `Json`, or fp's `Show`.
  - `registerParCombine` (deprecated) and its generic fallback builder, which emitted an
    unimportable `getParCombine("X")` call. Declare an `@impl ParCombine<F>` instance instead.

  **`@typesugar/fp`**: the third Option/Result implementation (`ZeroCost`, `ZeroCostOptionOps`,
  `ZeroCostResultOps`, `ZeroCostOption`, `ZeroCostResult`, `ZeroCostOk`, `ZeroCostErr`, the
  `@typesugar/fp/zero-cost` subpath) and the `zeroCostOptionMacro`/`zeroCostResultMacro` macros
  that only inlined calls to it. fp's `Option` (`A | null`) is the zero-cost Option.

- 459807a: **Breaking for `@typesugar/fp` users.** fp's `Eq`, `Ord` and tuple helpers now use
  `@typesugar/std`'s names, argument order and semantics, so an instance of one package's `Eq`/`Ord`
  is an instance of the other's, and the `===`/`!==`/`<`/`<=`/`>`/`>=` operator rewrites (activated
  by `@typesugar/std/syntax/eq/ops` and `.../ord/ops`) call methods that exist on fp's instances.
  Before, `a === b` on an fp instance compiled to `inst.equals(a, b)`, which threw at run time.

  | Before                                                                                          | After                                                                            |
  | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
  | `Eq<A>.eqv(x, y)`                                                                               | `Eq<A>.equals(x, y)` and `Eq<A>.notEquals(x, y)` (required)                      |
  | `Ord<A>` extends `{ eqv }`                                                                      | `Ord<A>` extends `{ equals, notEquals }`                                         |
  | `neqv(E)(x, y)`                                                                                 | removed; use `E.notEquals(x, y)`                                                 |
  | `eqBy(E, f)`                                                                                    | `eqBy(f, E = eqStrict())`                                                        |
  | `ordBy(O, f)`                                                                                   | `ordBy(f, O)`                                                                    |
  | `makeEq(eqv)` returns `{ eqv }`                                                                 | `makeEq(equals)` returns `{ equals, notEquals }`                                 |
  | `constant(a)` returns `(_: B) => a`                                                             | `constant(a)` returns `() => a` (a thunk, as in std)                             |
  | `mapFst(f)(pair)`, `mapSnd(f)(pair)`                                                            | `mapFst(pair, f)`, `mapSnd(pair, f)` (pair first, as in std)                     |
  | `bimap(f, g)(pair)` (tuple, `syntax/pipe`)                                                      | `bimap(pair, f, g)`                                                              |
  | `@typesugar/fp/syntax` exported its own `Monad` interface and a `{ pure, flatMap, map }` `IODo` | `@typesugar/fp/syntax` re-exports the same `Monad` and `IODo` as `@typesugar/fp` |

  To migrate an `Eq` instance written as an object literal, rename `eqv` to `equals` and add
  `notEquals: (x, y) => !equals(x, y)` (or build it with `makeEq`). The `getEq`/`getOrd` of every
  fp data type (Option, Either, List, NonEmptyList, Validated, RemoteData) and fp's law suites use
  the new names. `flatMapValidated` is deliberately not an `@impl` instance (a scope-found FlatMap
  would make `let:` over Validated short-circuit); its comment now says so. The contracts prover
  reads `equals(L, R)` / `E.equals(L, R)` as an equality, as it did `eqv`.

- 95602ac: The built-in extractors are `Destructure` instances owned by the packages that
  own the types. `@typesugar/fp` ships `destructureSome`/`destructureNone`,
  `destructureLeft`/`destructureRight`, `destructureCons`/`destructureNil` and
  (new) `destructureValid`/`destructureInvalid` next to Option, Either, List and
  Validated, each with a `@destructure` descriptor, so `match(o).case(Some(v))`
  compiles to the same inlined test and binding as before (pinned in tests).

  **Breaking:** `match.ts` no longer special-cases these names. An extractor
  follows the constructor's symbol: a `Some`/`Left`/`Ok`/... that is not fp's
  needs its own instance. The `_tag`-based fallback (used when the scrutinee's
  type had a `_tag` property) and the `Ok`/`Err` extractors for
  `{ ok: true; value }` results are gone: declare instances with
  `@destructure _tag = "Some" -> value` / `@destructure ok = true -> value`, or
  use object patterns. Exhaustiveness for key tests is now general: `has k`
  extractors cover a union when every member has a required `k`.

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

- 48b621b: PEP-052 Wave 5: `Show` method-sugar activation, and a latent
  `resolveTypeString` bug fix.
  - NEW: `Show`'s interface now carries `@typeclass`, and a new
    `@typesugar/fp/syntax/show` marker (`@syntax-methods Show`) activates
    `.show()` method sugar — mirroring how Eq/Ord's method syntax is gated.
    `Show` has no operator form, so there is only one activation tier.
  - FIXED: `resolveTypeString` (used by the instance scanner to resolve
    `@impl <TC><Type>` type strings) silently resolved the `symbol`/`unknown`/
    `object` keyword types to `any` on some `ts.TypeChecker` configurations
    (an unbound synthetic node quirk), which — because `any` is bidirectionally
    assignable to/from everything — could make two unrelated instances
    (e.g. `@impl Show<symbol>` and `@impl Show<number>`) spuriously report as
    "ambiguous" for every other type. Every keyword type string now resolves
    through the checker's internal intrinsic getter (`getESSymbolType`,
    `getUnknownType`, `getNonPrimitiveType`, etc.) instead of an unbound
    synthetic node, and the fallback path is hardened so any keyword resolving
    to `any` (other than `any` itself) is treated as unresolvable rather than
    silently wrong.
  - FIXED: `@typesugar/fp`'s `package.json` had `"sideEffects": false`, which
    could let an aggressive bundler drop the new marker's bare side-effect
    import. Flipped to `true`, matching `@typesugar/std`'s existing markers.

- c3ad41c: **Breaking:** `Range`'s step size field is now `stride` (`{ start, end, stride, inclusive }`).
  While it was `step`, it hid the `step` extension method from the type checker, so
  `(0).to(10).step(2)` failed with TS2349 ("This expression is not callable"). The method keeps its
  name: `(0).to(10).step(2).toArray()` now type-checks. Code that read `r.step` reads `r.stride`.

  `@typesugar/fp`'s `Eq`, `Ord` and `Ordering` are now `@typesugar/std`'s types, re-exported, rather
  than a copy with the same members, and fp depends on `@typesugar/std`. fp's `PartialOrd`,
  `LT`/`EQ`/`GT` and combinators are unchanged.

### Patch Changes

- 7d84596: Docs and comments brought in line with the extractor typing, covering-match,
  marker-type and scoping fixes: the fp README's `Some`/`None` output (the
  assertion, no `MatchError`), the std and macros READMEs on when a match has no
  throw, the umbrella README on markers being types, the reserved TS9702 (no
  "automatic"/"explicit" modes in 1.0), and core's prelude, resolution-scope and
  `ResolutionConfig` comments (the mode and prelude are not read).
- a39fa2d: The FlatMap bridge instances `flatMapOption`, `flatMapIO` and `flatMapList` have `ap`. They are
  `@impl FlatMap<…>` instances, and fp's `FlatMap` extends `Apply`, so without it `typesugar check
--strict` reported each instance, and a `FlatMap` summoned as one of them had no `ap` at run time.
  `ap` is derived from the instance's own `flatMap` and `map`.
- d7d6236: The `Kind` documentation no longer says a preprocessor resolves `Kind<OptionF, number>` to
  `Option<number>`: that resolution was removed with the preprocessor in PEP-047, and `Kind<F, A>`
  is the uncomputed phantom marker. `Apply<F, A>` computes the concrete type, and `@impl` expands an
  instance's own signatures. type-system's examples run again (the showcase asserts with `Apply`;
  the phantom-types example uses the current `createStateMachine` config API).
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

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- 93ea406: PEP-060 item 1: support TypeScript 6, reject TypeScript 7 with one clear error
  - **Peer range is now `typescript >=5.9.0 <7.0.0`** on every package (was
    `>=5.0.0 <6.0.0`). TypeScript 6.0.x still has the JavaScript compiler API typesugar
    is built on; TypeScript 7 (`typescript@latest` since 7.0) does not. The floor
    moved up from 5.0 because older releases were measured to break: before 5.5,
    Node's ESM loader sees none of TypeScript's named exports, so the CLI and the
    Vite plugin crash on their first `ts.*` access (5.0–5.3 also lack
    `checker.isTypeAssignableTo` and other APIs typesugar calls); 5.5–5.8 lack
    `checker.getNonPrimitiveType()`, so `@impl X<object>` instances never resolve.
    5.9.3 and 6.0.3 build, type-check and pass the core, transformer-core, macros,
    transformer, std and fp suites. The `library` and `macro-plugin` templates that
    `typesugar create` copies peer the same range, and all three templates now
    install `typescript ^5.9.3`.
  - **`typescript` is now an optional peer** of the packages whose runtime `.` entry
    never loads it: codec, collections, contracts, erased, fp, fusion, mapper, parser,
    strings, testing, units, validate and the `typesugar` umbrella. Their `./macros`
    entries still need TypeScript at build time. `check:runtime-purity` now fails if a
    package with an optional peer loads `typescript` from its `.` entry, directly or
    through a dependency.
  - **TypeScript version guard.** `@typesugar/core` exports `assertSupportedTypeScript`,
    `getUnsupportedTypeScriptReason`, `UnsupportedTypeScriptError`,
    `SUPPORTED_TYPESCRIPT_RANGE` and `TYPESCRIPT_SUPPORT_URL`. `@typesugar/macros` runs
    it first thing at load, and the transformer (pipeline, ts-patch factory, and the
    language-service plugin, which checks tsserver's own TypeScript), `transformCode`,
    unplugin, the LSP server and the ESLint processors call it before their first
    compiler-API access. On TypeScript 7 they all stop with
    `[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed the JavaScript
compiler API that typesugar's transformer needs. Install typescript@6 (or 5.9+) as a
devDependency for typesugar (npm i -D typescript@6); see
https://typesugar.org/getting-started/troubleshooting#typescript-7` instead of an
    opaque `Cannot read properties of undefined (reading 'ES2022')`. TypeScript older
    than 5.9, or a module missing `ts.factory` / `ts.createProgram`, is rejected the
    same way.

- Updated dependencies [e92220f]
- Updated dependencies [f086b8b]
- Updated dependencies [612112b]
- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [4d4ce68]
- Updated dependencies [9bcb9d8]
- Updated dependencies [0e0fe90]
- Updated dependencies [f8dcade]
- Updated dependencies [3400d8c]
- Updated dependencies [fae35e9]
- Updated dependencies [5d86014]
- Updated dependencies [f3c8949]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [a7158b3]
- Updated dependencies [c5ebf64]
- Updated dependencies [ec2188f]
- Updated dependencies [2ec1797]
- Updated dependencies [d79d995]
- Updated dependencies [81f31db]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [34850dc]
- Updated dependencies [291dc90]
- Updated dependencies [5f9af12]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7340c04]
- Updated dependencies [8f533b0]
- Updated dependencies [7d84596]
- Updated dependencies [592d66b]
- Updated dependencies [3460709]
- Updated dependencies [eb77b03]
- Updated dependencies [810833a]
- Updated dependencies [c60519f]
- Updated dependencies [4ca9f31]
- Updated dependencies [0435dc6]
- Updated dependencies [459807a]
- Updated dependencies [95602ac]
- Updated dependencies [bec2d2b]
- Updated dependencies [fbf4ef1]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [75f1968]
- Updated dependencies [e016c8d]
- Updated dependencies [c9a1e3e]
- Updated dependencies [624d80a]
- Updated dependencies [e0ba26b]
- Updated dependencies [4b0d84d]
- Updated dependencies [76af80e]
- Updated dependencies [977888e]
- Updated dependencies [ac891d1]
- Updated dependencies [c7fb29f]
- Updated dependencies [508c7d3]
- Updated dependencies [a5c1b85]
- Updated dependencies [283fe78]
- Updated dependencies [d7d6236]
- Updated dependencies [eb6e5a8]
- Updated dependencies [6659c44]
- Updated dependencies [f4ffc81]
- Updated dependencies [0780883]
- Updated dependencies [f6e9683]
- Updated dependencies [0079f40]
- Updated dependencies [f66c14f]
- Updated dependencies [b893cb6]
- Updated dependencies [4e1787c]
- Updated dependencies [2f7a375]
- Updated dependencies [945648a]
- Updated dependencies [914817e]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [718090c]
- Updated dependencies [5d3d92a]
- Updated dependencies [05dbbcb]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [dade880]
- Updated dependencies [d0392e0]
- Updated dependencies [babbb30]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [c30101d]
- Updated dependencies [4f6ad83]
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [48b621b]
- Updated dependencies [563e46b]
- Updated dependencies [57d76a1]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [76672a0]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [2fb4b62]
- Updated dependencies [93ea406]
- Updated dependencies [e0694af]
- Updated dependencies [c3ad41c]
- Updated dependencies [3e05585]
- Updated dependencies [95b6631]
- Updated dependencies [f471698]
- Updated dependencies [5da6803]
- Updated dependencies [51a72ca]
- Updated dependencies [616d213]
- Updated dependencies [dca9c00]
- Updated dependencies [e064ef7]
- Updated dependencies [cf7c08b]
- Updated dependencies [d7b3911]
- Updated dependencies [e40c7e3]
- Updated dependencies [2f1744b]
- Updated dependencies [5d86014]
- Updated dependencies [0c9202a]
- Updated dependencies [5cc34d9]
- Updated dependencies [8204470]
- Updated dependencies [c1e797e]
- Updated dependencies [6edd688]
- Updated dependencies [615d4c1]
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0
  - @typesugar/std@0.2.0
  - @typesugar/contracts@0.2.0
  - @typesugar/type-system@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/macros@0.1.1
  - @typesugar/type-system@0.1.1
  - @typesugar/contracts@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/macros@0.1.1-rc.0
  - @typesugar/type-system@0.1.1-rc.0
  - @typesugar/contracts@0.1.1-rc.0
