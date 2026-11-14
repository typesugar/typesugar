# @typesugar/core

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

- 3709f72: Macro identity is (module, export name); validate's `assertType<T>()`; `is<T>(value)`
  - **`@typesugar/core`** (behaviour change, PEP-060 item 8): a macro that declares a `module`
    is now identified in the registry by its kind, `module` and `exportName ?? name`, not by
    its bare name. Two packages can register macros with the same name and both stay loaded.
    Before, the second registration threw "… is already registered" (or, between two
    `@typesugar/*` modules, was silently dropped), so whichever package loaded second lost
    that macro and every macro it registered after it. Registering the same definition again
    (an ESM/CJS or src/dist copy) is still a no-op. A different definition under one identity
    still throws, and so do two different module-less macros of one name and two macros
    claiming one labeled-block label. The bare-name getters (`getExpression(name)` and the
    others) return the module-less macro of that name, else the only macro of that name,
    else `undefined` when several modules provide it. They no longer return whichever loaded
    first. New: `getCandidates(name, kind)` and an optional `kind` argument on
    `getByModuleExport`. `getAll()` lists each macro once.
  - **`@typesugar/transformer-core`**: a call resolves to the macro of the module its import is
    declared in (named, aliased and namespace imports). The import-literal fallback for
    synthetic or detached nodes now picks by the import's module and imported name, and an
    import from `typesugar` that matches two packages' macros is left unexpanded with a
    warning rather than picking one. `@derive` names, JSDoc tags and decorator expand-order
    lookups use the file's imports when several modules provide a name
    (`lookupMacroByName`). `resolveModuleSpecifier` reads the package from the last
    `node_modules/` segment, so pnpm store paths (`node_modules/.pnpm/…/node_modules/@scope/pkg`)
    map to the package and not to `.pnpm`.
  - **`@typesugar/transformer`**: a `__typesugar_macros__` package with one conflicting macro
    still registers the rest and reports the conflict as a load warning.
  - **`@typesugar/validate`**: its macros now declare `module: "@typesugar/validate"`, so
    `assert<T>()` coexists with `@typesugar/testing`'s `assert(cond)` (also on the
    playground, which now preloads validate). New `assertType<T>()`, an alias of
    `assert<T>()` (the typescript-is and typia name), for files that import testing's
    `assert` as well. `is<T>(value)`, `assert<T>(value)`, `assertType<T>(value)` and
    `validate<T>(value)` now check `value` immediately (typia's form). Before, the argument
    was silently dropped and the call returned the checker function, so `if (is<T>(x))` was
    always true. More than one argument is a compile-time error.

- d3243f9: New `derived<TC<T>>()`: declare a derived instance once, in your own module,
  for a type you can't put `@derive` on (a library type such as `Feature` from
  `@types/geojson`):

  ```ts
  // geo-instances.ts
  import type { Feature } from "geojson";
  import type { Clone } from "@typesugar/std";
  import { derived } from "typesugar";

  export const cloneFeature = derived<Clone<Feature>>();
  ```

  - The call expands to the same code `@derive(Clone)` generates (one
    derivation, emitted once), with field instances from scope: a hand-written
    `Clone<GeoJsonProperties>` declared above it is used for `properties`.
  - The const is the instance: `summon`, `= implicit()` and method syntax find
    it in every file that imports the module, as they find a typed or `@impl`
    const. An `@impl` tag is optional (and must agree if present).
    `export const cloneFeature: Clone<Feature> = derived();` is the same
    instance, typed by its annotation, and its `.d.ts` is that annotation as
    written. Neither form leaves a `typesugar` import in the `.d.ts`.
  - Every typeclass `@derive` supports through a structural derivation (Eq,
    Ord, Clone, Debug, Hash, Default, Json, TypeGuard, Show, Semigroup, Monoid).
  - Errors: a field with no instance that can't be derived is TS9107 at the
    `derived` line, naming the field and its type; a type with free type
    parameters is TS9011 (not supported yet); anything but the initializer of a
    top-level `const` is TS9010. Two instances in scope at a use site are the
    existing ambiguity error.
  - Exported from the `typesugar` root and `@typesugar/typeclass` (runtime stub,
    like `summon`).

  **Deprecated: `summon` and `= implicit()` deriving in place.** When no
  instance is in scope they still derive one at the call site, a new copy at
  each call, but now warn once per typeclass and type per file with TS9009,
  which names the `derived` declaration to write. A later release removes the
  fallback, and such a call becomes TS9001. TS9001 for a type declared outside
  the project now suggests `derived<...>()`.

- 851809b: `match: switch` — the statement form of pattern matching. A `match:` label on
  a `switch` (activated by `import "@typesugar/std/syntax/match"`) keeps the
  switch, with arm bodies in place and plain `break`/`return`/`continue`/
  `throw`/fallthrough, and adds the exhaustiveness check (TS9226, as for the
  fluent form):
  - literal cases (literals, consts, enum members) compile to the same switch,
    label removed: the JavaScript is the hand-written switch;
  - destructuring cases (`case { type: "Point", coordinates: [x, y] }:`)
    compile to a switch on the shared discriminant with the bindings
    destructured in a block per case; built-in extractors (`case Some(v):`)
    work too, and cases with no shared discriminant compile to `switch (true)`;
  - `default:` covers the rest, except one that only throws (a runtime safety
    net), which keeps the check; an unreachable `default:` is a warning.

  Supporting changes: `LabeledBlockMacro.statement` (`"block"` | `"switch"`)
  selects the statement a label attaches to; `erasableSyntaxModule` removes a
  marker-only activation import from the output; a `MatchSwitch` diagnostic
  suppression rule hides TS2304/TS18004 for names a case binds and TS7028 on the
  `match` label in files that activate it.

- a591082: New warning TS9804, "operator syntax not activated" (the operator counterpart
  of TS9224). Since PEP-052, `a + b` only dispatches to a typeclass's `@op +`
  method in a file that imports the typeclass's `/ops` marker (or declares the
  typeclass). Without the import, the operator silently stayed native JavaScript.
  Now, when the operand type has an in-scope instance of a typeclass that maps
  the operator, the transformer warns at the operator and names the import to add.
  For example: `Add import "@typesugar/std/syntax/numeric/ops";`. The warning
  covers binary and prefix-unary `@op` operators, including `===`/`!==` on Eq
  types.

  It only fires when activating the typeclass would actually rewrite the
  expression. It never fires for primitive operands, for types with no instance,
  in activated or `"use no typesugar"` files, or for operators no `@op` maps. Use
  `// @ts-no-typesugar operators` to keep a native operator on purpose.
  - `@typesugar/core`: the `TS9804` descriptor, and `findSyntaxMarkerSpecifiers()`
    for reverse lookup of registered marker specifiers.
  - `@typesugar/macros`: `getInactiveOperatorCandidates()`.
  - `@typesugar/transformer-core`: the hint, in `operator-activation.ts`.

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

- 51a72ca: `typesugar check` no longer hides real errors next to a rewritten operator. A
  `DiagnosticSuppressionRule` can now report `replacementDiagnostics` in place of a diagnostic it
  suppresses (identical ones are reported once; if computing them throws, the original is kept).
  `RewrittenOperatorResult` uses it to re-check the arguments after a rewritten `a * b`, since tsc
  reports only a call's first failing argument: `g(a * b, 5)` with a `string` parameter is now
  an error at `5`. `OperatorOverload` uses it to report a rewritten value used as a number, which
  TypeScript (typing `a * b` as `number`) accepts and which threw at run time:
  `(a * b).toFixed(2)` (TS2339), `const n: number = a * b` (TS2322, also for `+`), a `number`
  argument (TS2345), and `a * b > 0` when `>` isn't rewritten (TS2365).

### Patch Changes

- 612112b: Fixes from the 2026-11 architecture review (audit/ARCH-REVIEW-2026-11-TRIAGE.md):
  - A decorator the file implements itself is no longer taken for a macro of the same name:
    `function reflect(t) { … }  @reflect class A {}` keeps the user's `@reflect` instead of
    dropping it and emitting `__A_meta__`. An ambient declaration (`declare function reflect`)
    still reaches the macro.
  - Every opt-out feature in docs/guides/opt-out.md now works. `"use no typesugar typeclasses"`
    turns off `@typeclass`, `@impl`/`@instance` and `summon`/`summonAll` (it was accepted and
    ignored), and `"use no typesugar derive"` covers a JSDoc `/** @derive … */` tag as well as
    the decorator. Core exports the feature names as `OptOutFeature`/`OPT_OUT_FEATURES`, and a
    macro can declare the feature that turns it off (`optOutFeature`), checked by
    `isMacroOptedOut`.
  - An expression-position comprehension (`const f = (x) => par: { … } yield: { … }`) in a file
    that hasn't activated the label syntax gets the TS9224 hint, as the block form does, instead
    of only TypeScript's syntax error.
  - An ambiguous typeclass method-sugar instance (and a failure resolving one) is reported at the
    call, not at the start of the file.
  - TS9602 for an imported generic function says that only same-file functions are specialized,
    instead of advising a different declaration form.
  - std's `ordArray(O).lessThan` and the other comparison methods no longer rebuild the `Ord` and
    `Eq` dictionaries on every call.

- de93aa3: Macros inside `assert(...)` expand. The argument used to be instrumented before the macros in
  it ran, so `assert(showAll(xs, summon<Show<number>>()) === "…")` compiled to
  `(values[i] = summon)()` and threw "summon() must be processed by the typesugar transformer" at
  run time, and `extend(x).m()` / extension methods inside it were skipped. Expression macros can
  now set `expandArgumentsFirst: true` to receive their arguments already expanded; `assert` does,
  and instruments the expanded expression (the diagram still shows the values of the parts of the
  source the expansion kept).
- e3065ec: `typesugar check` and `build` type-check the expansion of the constructs whose bound names the
  source as written can't check: a do-notation comprehension's steps, a `match:` case's pattern,
  an `ensures:` block's `result`. `fetchAge(user.nme)` in a `let:` was reported only by `--strict`,
  at its position in the expanded code; it is now reported by plain `check` and `build`, at the line
  you wrote. Only what lies inside those constructs is reported, and an error that exists only in
  generated code is left out (`--strict` still reports everything).

  The expanded program reuses the first program's SourceFile for every file the macros didn't
  change, so `--strict` is cheaper too (examples/basic: 1.2 s to 0.9 s, 512 MB to 374 MB peak), and
  `--strict` reports an error at the line you wrote when it maps to one.

  `filterDiagnostics` takes an optional `onSuppressed(diagnostic, ruleName)` callback.

- 4d4ce68: `typesugar check` (and the IDE) no longer reports errors for code the transformer handles,
  found by type-checking every package example:
  - `@reflect interface User` was TS1206 ("Decorators are not valid here"): the MacroDecorator
    rule's name table missed it. Any registered attribute macro's decorator is now suppressed.
  - `.show()` for a `/** @typeclass */ interface Show` the file declares itself was TS2339: the
    rule only knew the standard typeclasses' methods. It now reads the program's typeclasses, as
    the rewrite does.
  - `ensures: { result >= 0; }` was TS2304 "Cannot find name 'result'" and `ensures: (r) => …`
    TS7006, in files that import `@typesugar/contracts/syntax`. A new ContractBlock rule
    suppresses exactly those two.
  - `eff.map((x) => …)` with `import { EffectExt }` was TS2339 and TS7006: the rule matched the
    receiver against the generic `Effect<A, E, R>` parameter with plain assignability. It now uses
    the transformer's own match (`receiverMatchesFirstParam`, moved to `@typesugar/core`), and an
    untyped callback parameter of a rewritten call is not "implicitly any".
  - `summon<Read<User>>()` against the published `@typesugar/sql` was TS9001 "No instance found
    for `Read$1<User>`": its bundled `.d.ts` declares `interface Read$1` and exports it
    `as Read`. A typeclass renamed that way is keyed by its exported name.

- f8dcade: A derived `Clone` of a class returns an instance of that class: the copy is
  created with the original's prototype (`Object.create(Object.getPrototypeOf(a))`)
  and its own fields copied onto it, so methods, getters, `instanceof` and a
  subclass's overrides work on the clone. It used to be a plain object typed as
  the class. A class whose instances can't be copied field by field, one with a
  `#private` member (or an `accessor` field) or one that extends a built-in such
  as `Map`, is now a TS9106 error that says why, instead of a broken clone.

  Generated code no longer prints a comment from the user's file inside an empty
  argument list (a derived `Map` clone printed `v.slice(/** @derive(Clone) */)`):
  `stripPositions` and the derivation parser reset node lists' positions too.

- 2543157: A left-nested binary chain deeper than about 2,000 levels (a long string
  concatenation or arithmetic line, as generated code has) failed with
  "Transform failed: RangeError: Maximum call stack size exceeded": the macro
  visitor recursed once per level, as did hygiene's binding scan, the pipeline's
  source-map walk and its scratch-token pass. They now walk such chains with a
  loop (same steps, same order, same output), and the operator rewrite rejects an
  arithmetic operand before the checks that walk up the node's ancestors. A
  20,000-term concatenation transforms in well under a second; plain tsc handles
  that depth too. `@typesugar/core` exports the iterative walker,
  `forEachDescendant`. In a file with a macro expansion
  too: the import cleanup's reference scans and the source map's output-token pass recursed
  once per level and overflowed on such a chain.
- c5ebf64: Security: a dependency's config is never read, and the editor ignores a dependency's own
  project. Opening a file inside `node_modules/evil` in VS Code gave it the project
  `node_modules/evil/tsconfig.json`; the language-service plugin attached to it and loaded
  config from `node_modules/evil`, which ran evil's `typesugar.config.cjs` in the editor and let
  a `"typesugar": { "security": { "allowedMacroPackages": ["evil"] } }` block in evil's
  package.json approve evil's macros for your own project. Now:
  - no host reads a config file or a package.json `"typesugar"` block inside a `node_modules`
    directory (by real path); a search starting inside one walks past it to the project's
    config;
  - the language-service plugin does nothing in a project whose tsconfig is inside
    `node_modules`;
  - config is kept per project: a `TransformationPipeline` given `config` (`config.capture()`
    after `config.load()`; `createPipeline`, the editor and the ts-patch entry do this) makes
    that project's config current around its work (`config.runWith()`), so one editor or Node
    process serving two projects applies each project's config to its own files only.

- d79d995: `/** @derive(Eq) */` on an `enum` was silently ignored; it is now TS9102, like
  `@derive` on a `const` or a function (another macro tag on an enum warns that it
  was ignored).

  Documentation that mentions `@derive` no longer trips TS9102: on a declaration
  `@derive` can't apply to (a derive macro's own `const`), a `@derive(X)` line
  followed by prose (`@derive(Read) — derives a Read instance`) is documentation,
  and a macro tag after an `@example` tag (`@example` then `@derive(Validation)` on
  its own line) is example code, like one in a fenced example. A bare
  `@derive(Eq)` line on a `const` is still TS9102.

- 0b5bcf8: `@derive` on something that is not an interface, class or type alias is error TS9102 at the tag,
  with help that points at `derived<TC<T>>()` for a variable. A JSDoc `@derive` on a `const` used to
  be ignored without a word, and one on a function only warned.
- a070a0c: Every reader of a `@derive` / `@deriving` JSDoc tag uses one parser, `deriveTagNames` (exported
  from `@typesugar/core`), so they agree with the derive macro on what a type derives. Method syntax
  matched the typeclass name anywhere in the tag's comment: with `@derive(Eq)` and a description
  line that mentioned "Show", `p.show()` became `Point.Show.show(p)`, a companion that never
  exists. The TS2339 suppression rule took every word of the comment as a derive name, the
  auto-derive check and std's `Destructure` planner had the same kind of match, and the instance
  scanner dropped the last name of `@derive Eq, Clone` when a description line followed. Tags in
  prose or fenced examples no longer count in any of them.
- 01a547c: `derived<Eq<Array<number>>>()` reported TS9107 for a field named
  `__@unscopables@22`, and `derived<Eq<Map<string, number>>>()` silently
  generated an `Eq` that compared `a["__@toStringTag@35"]`: a built-in type from
  TypeScript's lib was "derived" from its methods and internals. It is now
  TS9106, saying it is a built-in and to use a library's instance (std's) or
  an `@impl` of your own; `summon`'s TS9001 help for one no longer points at
  `derived<...>()`.

  An `@impl` tag on a `derived<...>()` const is compared with the call's type
  argument as types, not as text: an alias of the type (`/** @impl Eq<P2> */`
  with `type P2 = Pt` on `derived<Eq<Pt>>()`) agrees, and the tag's typeclass
  is resolved through imports and aliases.

- 2694138: `derived<Eq<Readonly<Point>>>()`, `Partial<Point>`, `Record<"a" | "b", number>`,
  `Pick<Point, "x">` and the lib's other utility types were refused as
  "built-in" (TS9106), because the check read the type's alias, which the lib
  declares. It now reads the resolved type's own symbol: only an interface or
  class declared in TypeScript's lib (Array, ReadonlyArray, Map, Set, Date,
  Promise, ...) is a built-in, so the utility types derive from their fields,
  and an alias of a built-in (`type Nums = number[]`) is refused like the
  built-in itself instead of being "derived" from `__@unscopables`. A utility type over a built-in
  (`Readonly<Map<string, number>>`, `Readonly<Set<T>>`, `Partial<Date>`, or an alias of one) is a
  built-in too, TS9106, instead of being derived from the built-in's internals
  (`a["__@toStringTag@24"]`). Decided by the type the utility maps, by symbol: a user interface that
  extends a lib type (`interface AppError extends Error { code: number }`) is not a built-in, and
  `Readonly<AppError>` derives like `AppError` does, though some of its properties are declared in
  lib's `Error`.
- 3ae83a6: The values `@derive(Destructure)` declares (the constructor functions `Point`, `Circle` and their
  instances) can be imported, called and re-exported by name before expansion. Checked as written,
  the source reported `export { Circle } from "./shapes"` and `import { Circle }` as TS2305,
  `Point(1, 2)` as TS2693 and `Circle(2)` in the deriving file as TS2304, so `emitDeclarations` (tsup's
  `withTypesugar`) wrote nothing for an index file that re-exports them. A derive macro can now say
  which names it declares (`generatedNames`), and the `DerivedDeclarationReference` suppression rule
  accepts exactly those. `typesugar build` keeps those names in the JavaScript's imports and
  re-exports, which TypeScript dropped as type-only.
- 7d84596: Docs and comments brought in line with the extractor typing, covering-match,
  marker-type and scoping fixes: the fp README's `Some`/`None` output (the
  assertion, no `MatchError`), the std and macros READMEs on when a match has no
  throw, the umbrella README on markers being types, the reserved TS9702 (no
  "automatic"/"explicit" modes in 1.0), and core's prelude, resolution-scope and
  `ResolutionConfig` comments (the mode and prelude are not read).
- 3460709: `==` and `!=` now dispatch through std's `Eq` the same way `===` and `!==` do.
  Before, in a file that imports `@typesugar/std/syntax/eq/ops`, `a === b` called
  `Eq.equals(a, b)` but `a == b` stayed a reference comparison, and without the
  import TS9804 warned for `===`/`!==` but not for `==`/`!=`. Now `a == b` compiles
  to `Eq.equals(a, b)`, `a != b` to `Eq.notEquals(a, b)`, and TS9804 covers all four.
  Comparisons with `null` or `undefined` (`a == null`) and primitive operands stay
  native, as before. For reference identity in a file that activates Eq, write
  `Object.is(a, b)`: it is a call, so it is never rewritten.
  - `@typesugar/macros`: a typeclass method may carry several `@op` tags, one per
    operator, for equivalent spellings of the same operation (`@op ===` and
    `@op ==` on `equals`). Every tag maps its operator to the method. New
    `extractOpsFromJSDoc()` returns all of a member's `@op` operators, and
    `TypeclassMethod.operatorSymbols` lists them; `extractOpFromJSDoc()` and
    `operatorSymbol` keep returning the first. The built-in `Eq` seed maps `==`
    and `!=` too.
  - `@typesugar/std`: `Eq.equals` is tagged `@op ===` and `@op ==`, and
    `Eq.notEquals` `@op !==` and `@op !=`.
  - `@typesugar/transformer-core`: TS9804's help for `===`/`!==`/`==`/`!=` names
    `Object.is(a, b)` as the way to keep reference equality. The operator rewrite
    now honors the documented `operators` opt-out (`// @ts-no-typesugar operators`,
    `"use no typesugar operators"`); before, only `extensions` stopped it, so the
    `operators` opt-out silenced TS9804 but still rewrote in an activated file.
  - `@typesugar/core`: the TS9804 explanation covers `==`/`!=` and `Object.is`.

- 810833a: An imported object or namespace supplies extension methods only when its import opts in
  (PEP-064): a JSDoc `/** @extension */` on the import declaration, or `import * as X`. A
  typeclass instance declared with `/** @impl */` needs neither; one made
  by `derived<TC<T>>()` needs the tag (its `.d.ts` is a plain annotation). A
  function named after the method (`import { clamp }`) is unchanged. A type-only import never
  supplies extensions, nor does an import shadowed by a local at the call, and `typesugar
check` now hides TS2551 as well as TS2339 on a rewritten call and keeps both in a scope opted
  out of extensions. Before, any imported object with a member whose first parameter accepted the
  receiver was a provider, so `user.info()` with `log.info(msg: unknown)` imported became
  `log.info(user)`, and `typesugar check` hid the TS2339. Add the tag to imports of extension
  objects such as `EffectExt`:

  ```ts
  /** @extension */
  import { EffectExt } from "@typesugar/effect";
  ```

- 0435dc6: Instances for types you don't own (a library type such as `Feature` from
  `@types/geojson`), written in your own module and imported, now resolve
  everywhere:
  - An `@impl Clone<Feature>` for a generic whose type parameters all have
    defaults matched `summon<Clone<Feature>>()` but not a value typed `Feature`,
    so `implicit()` and `f.clone()` (with a bare `import "./instances"`) missed
    it. The bare name now matches its default instantiation.
  - `implicit()` resolves its instance by the inferred type, not only by its
    printed name (`Feature<Geometry, GeoJsonProperties>` never matched
    `Feature`).
  - `summon` in an instance's own initializer no longer resolves to that
    instance (`const cloneFeature = cloneFeature`, a ReferenceError at load), so
    `/** @impl Clone<Feature> */ export const cloneFeature =
summon<Clone<Feature>>();` derives it once, for importers to use.

  TS9101's explanation and the error-messages guide no longer tell you to wrap
  a library type in a newtype; they point to the typeclasses guide's new
  "Instances for types you don't own" section.

- 8b4060d: Diagnostics suggest `/** @impl Typeclass<Type> */` for a hand-written instance. The
  "no instance" help used to say "provide @instance Eq<Color>", and a bare `@impl` said
  `@impl("Type")` / `@impl(Typeclass, Type)`: decorator forms, which TypeScript rejects
  on a `const`.
- a6584d7: Docs: instances are declared with `/** @impl Typeclass<Type> */` on a const
  - The `@typesugar/typeclass` README quick start showed `@instance("Show<number>")`
    as a decorator on a `const`, which TypeScript rejects (TS1206: decorators are
    not valid on variables). It now uses `/** @impl Show<number> */`.
  - The TS9002 and TS9003 explanations no longer show the decorator-on-a-const
    "legacy" form, and TS9006, TS9007/TS9050, TS9104, TS9401, TS9802 and TS9803
    recommend `@impl` instead of `@instance`.
  - The TS9001 and TS9102 error pages' examples are rewritten against what the
    transformer does: `p1 === p2` on a type with no `Eq` instance is not TS9001
    (it stays reference equality, with no diagnostic); TS9001 comes from
    `summon` on a type parameter or on a type with no instance that can't be
    derived. TS9102's page described a missing field instance (that is TS9101)
    and showed an `@noDerive` field annotation, which doesn't exist.

- c9a1e3e: A call that `= implicit()` completes with an instance from a package's `.d.ts` (std's `ordNumber`, a
  library's `Point.Eq`) warns TS9602, as the same call with the instance written out already did: the
  declaration has no method bodies, so the call keeps dictionary passing. It used to fall back without
  a word, and the specialization guide said a specialized copy was made.
- 4b0d84d: An `@impl` instance's method is inlined into another module only where every name its body uses
  resolves there to the same declaration. `ordNumber.eqv(NaN, NaN)` in a file that imports only
  `ordNumber` compiled to `compareNumber(NaN, NaN) === EQ`, a ReferenceError at run time, because
  `@impl` registered its methods without the symbols their names resolve to and the call site
  accepted any name that resolved to nothing. Such a call now goes through the instance and warns
  TS9602 naming the identifier. A type name in an inlined body that doesn't resolve to the same type
  at the call site is written through an import type, and the method's own type parameter as the call
  instantiates it, so the expansion type-checks under `typesugar check --strict`.
- 977888e: An `@impl` method whose body uses a class as a value (`make: (n) => new Pt(n)`) is no longer
  inlined where the call site imports that class only as a type (`import { isPt, type Pt }`,
  `import type { Pt }`, or through an `export type` re-export). It compiled to `new Pt(3)` with no
  binding for `Pt`, a ReferenceError at run time, and the build exited 0. Such a call now goes
  through the instance and warns TS9602 naming the identifier; a plain value import still inlines.
- 283fe78: A real `@derive`/`@impl`/`@opaque`/`@typeclass` tag written after an
  `@example` section was silently ignored on any declaration: every tag after
  `@example` was treated as example code, so `/** A point. @example const p =
…; @derive(Eq) */ interface Point` got no companion (a ReferenceError at run
  time), and a `@typeclass` or `@hkt` below a fenced `@example` registered
  nothing. As in JSDoc itself, an `@example` now ends at the next line-start
  tag; only a line inside a ```fence is example code. Fence example code that
shows a`@derive` line.
- eb6e5a8: A library's `@derive` companions are found by its consumers. `/** @derive(Eq) */ export interface
Point` in a published package used to be invisible from its `.d.ts`: a consumer's `p1 === p2` stayed
  a reference comparison and `summon<Eq<Point>>()` derived a second instance with TS9009. The instance
  scanner now reads an exported type's companions (`Point.Eq`) from its `@derive` tag, and each
  generated companion carries an `/** @impl Eq<Point> */` tag that declaration emit keeps (the
  decorator form leaves no `@derive` in a `.d.ts`). Operators, `summon`, `= implicit()` and method syntax
  resolve them like any other instance, through the type's own binding (`import { Point
as P }` gives `P.Eq`). The same works between two source files of one program, whichever is
  transformed first.

  The scanner no longer takes a function or class for an instance because its JSDoc shows an `@impl`
  example (typesugar's own `impl()` declaration made `= implicit()` pass `impl` as an `Eq<Point>`), and
  ignores `@impl`/`@derive` tags in prose and fenced examples. A macro error on a JSDoc tag's
  arguments no longer crashes the CLI's diagnostic printer.

- 0780883: `match()`: exhaustiveness agrees with the code it generates
  - An arm that names a field its variant declares optional
    (`.case({ k: "b", extra })` with `extra?: string`) tests `"extra" in` the
    value, so `{ k: "b" }` matched no arm and threw `MatchError` at run time, yet
    the match was accepted as exhaustive. Such an arm no longer covers the
    variant: TS9226 reports it and names the optional field. Add an arm for the
    rest (`.case({ k: "b" })`) after it. `match: switch` destructures instead of
    testing, so there the same case still covers the variant and binds
    `undefined`.
  - Enum members are constant patterns: `.case({ k: K.A, n })` tests
    `k === K.A`, and the arms count for exhaustiveness as the members' values.
    Before, `K.A` had no test at all (the arm matched any value with an `n`) and
    the match reported "missing variants". A qualified name is a constant only
    when its type is one literal value; any other sub-pattern the macro can't
    compile is now an error instead of matching anything.
  - A tuple pattern of the tuple's length with only bindings (`[x, y]` on
    `[number, number]`), or `[head, ...rest]` on a tuple at least that long,
    covers the tuple type: no "not enumerable" TS9226.

- 2252df8: A fluent `match()` on a value TypeScript has narrowed reads it at its declared type. The expansion
  reads the scrutinee from a const, which had the narrowed type: after `const circle: Shape = { kind:
"circle", radius: 5 }`, `match(circle)...case({ kind: "square", side })` expanded to a `case
"square":` TypeScript called unreachable (TS2678) and a `side` it typed `unknown` (TS18046), so
  type-checking the expansion (`typesugar check --strict`) reported 5 errors on std's showcase, all
  in valid code. The const is now asserted back to the declared type, `const _circle = circle as
Shape;` (as the file can name the type: an import type when the file doesn't import it). Only the
  members the narrowing removed that are of the kind left come back, so `Shape | null` narrowed to
  `Shape` stays non-null. The JavaScript is unchanged: the assertion is erased.

  `typeToPortableTypeNode` (exported from `@typesugar/core`) writes a type as a type node a given
  file can contain; the declaration emit's `@opaque` annotations use it too.

- 8b0526f: A type or `@opaque` companion declared in a `.mts`/`.cts` file is named with the extension
  TypeScript's module resolution expects: `.mjs`/`.cjs` (or the file's own `.mts`/`.cts` where
  the project writes TypeScript extensions, `allowImportingTsExtensions` /
  `rewriteRelativeImportExtensions`), not `.js`. `typeToPortableTypeNode` wrote
  `import("./lib/shapes.js").Shape` for a type in `shapes.mts` -- TS2307 under `--strict`, an
  `any` read inside a fluent `match()` that asserts its scrutinee to it, and a wrong inferred
  `@opaque` annotation in emitted declarations -- and an erased `@opaque` method call imported its
  companion function from `./opt.js` for an `opt.mts`, which fails at run time. Both use
  `sourceSpecifierExtension` (exported from `@typesugar/core`). An extensionless (bundler)
  import of a `.mts`/`.cts` file gets its `.mjs`/`.cjs` extension, which extensionless
  resolution needs.
- 6f70351: `@opaque` annotations are kept as written in every position, and expanded code is checked against
  the runtime view of opaque types (`opaqueTypesAsUnderlying`: `Option<number>` is `number | null`).
  Annotation stripping covered only a variable or parameter default initialized by an erased
  constructor of a same-project type, so `function fo(o: Option<number>)` called as `fo(Some(2))`
  (now `fo(2)`) and `const a: Option<number> = Some(3)` with fp's `Option` failed `strictOutput`, and
  the declarations emitted from the expanded program lost the opaque type where it did strip.
  `strictOutput` and `typesugar build --strict` serve every file in that view.
- 2b2fda8: A line's `// @ts-no-typesugar` marker is found after a template literal with a substitution. The
  comment scanner read the `}` closing `${...}` as a plain brace and the template's closing backtick
  as the start of a new template, which swallowed the comment, so ``grammar`a ${y}` // @ts-no-typesugar``
  still expanded the macro.
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

- cf7c08b: `typesugar check --strict` / `build --strict` type-check the expansion the build itself makes (the
  code it emits, and the declarations come from), and filter its diagnostics against that expanded
  program. It used to expand detached copies of every file first, where the macros asked the checker
  about nodes it never bound: some calls expanded wrongly or not at all (fp's `case Some(v)` in a
  `match: switch`), errors such as "Cannot find name 's'" for a parameter leaked into the source's own
  diagnostics, and the expanded program's diagnostics were filtered against the source as written,
  whose text their positions don't refer to. An error the source already reports is not repeated at
  its expanded position.

  A prose "@opaque" in a JSDoc comment ("a call on an @opaque type") is no longer read as an `@opaque`
  tag: typesugar's own `index.d.ts` got a syntax error in the `--strict` view of `@opaque` types, and
  a library's `.d.ts` could register an interface as opaque.

- 2f1744b: TS9602 (auto-specialization skipped) is in the diagnostic catalog, with an explanation and a
  docs/errors page: it was the only typesugar code emitted as a bare "[TS9602]" string. The warning's
  text is unchanged.

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
