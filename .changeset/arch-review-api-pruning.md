---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/typeclass": patch
"@typesugar/transformer-core": patch
"@typesugar/std": patch
"@typesugar/fp": patch
"typesugar": patch
---

1.0 public-API pruning (audit/ARCH-REVIEW-2026-11-TRIAGE.md, PR 3). Removes exports that
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
