# typesugar

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

- 81f31db: The derive markers are also their typeclasses' types
  - `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Json`, `Semigroup` and `Monoid` from
    `typesugar` are now both the derive marker (a value, as before) and the
    `@typesugar/std` typeclass of that name (a type alias of the interface, not a
    copy); `Show` is `@typesugar/fp`'s `Show`. One import serves `@derive(Clone)`
    and `summon<Clone<Point>>()`. Before, the marker was only a value, so plain
    TypeScript reported TS2749 on `summon<Clone<Point>>()` and typed it as `any`,
    and `const copy = summon<Clone<Point>>().clone(p); copy === p` stayed
    reference equality unless `copy` was annotated. `typesugar` now depends on
    `@typesugar/std` and `@typesugar/fp` for these types; its runtime entry still
    loads neither (the aliases are type-only). `Default` and `TypeGuard` have no
    typeclass interface yet and stay values only.
  - `summon<TC<T>>()` and `derived<TC<T>>()` find the typeclass `TC` names
    through the checker (imports, renames, forwarding type aliases) instead of by
    its spelling, so `import { Clone as Copyable } from "typesugar"` and
    `summon<Copyable<Point>>()` resolve `Point`'s `Clone` instance.

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

- b676bbc: New: `node --import typesugar/register` (also `@typesugar/transformer/register`), Node module hooks that run TypeScript through typesugar's macro expansion, for scripts, tsx, `node --test`, tape and benchmarks run from source.
  - Each `.ts`/`.mts`/`.cts`/`.tsx` module outside `node_modules` is expanded with the nearest `tsconfig.json`. A module the expansion does not change goes to the rest of the loader chain untouched (Node's type stripping, or tsx), so a project with no macros runs exactly as before. A changed module is compiled to JavaScript for the running Node (no downlevelling; class-field semantics follow the tsconfig `target`) with an inline source map. A macro error fails the import.
  - Works alone on Node 22.18+ / 23.6+ and with tsx registered before or after it, since it reads sources from disk rather than from the next loader. Also via `NODE_OPTIONS` (or pnpm's `node-options`).
  - The resolve hook maps a missing relative `./x.js` imported from TypeScript to `./x.ts` (`.mjs`/`.cjs`/`.jsx` likewise), as TypeScript and tsx do.
  - Uses `module.registerHooks()` where available (Node 22.15+ / 23.5+, covers `require()`), else `module.register()` (Node 20.6+, `import` only).
  - The hook module imports only Node builtins; TypeScript and the pipeline load on the first TypeScript module.
  - `@typesugar/transformer`: `transpileExpanded()` takes a `module` option, and `TransformationPipeline` has `getCompilerOptions()`.

  See docs/getting-started/environments/node.md.

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

- 4b78011: `typesugar init` gains a non-interactive mode: `--yes` (accept every default),
  `--persona <end-user|app-developer|extension-author>`. Without a TTY and
  without `--yes`, `init` and `create` now fail immediately with an actionable
  message instead of hanging forever on a prompt nobody can answer — which is
  what happened in CI, and to any AI assistant trying to set typesugar up.
- 076e677: PEP-058 Wave 6: `typesugar init` and `typesugar create` now scaffold AI-assistant
  context into your project — an `AGENTS.md` (read natively by Cursor, Copilot,
  Codex and Zed), a `CLAUDE.md` pointer, and a Claude Code skill. The content
  ships inside the package, is marker-delimited, and re-running `init` refreshes
  only that block, leaving everything you wrote around it untouched. New `--ai` /
  `--no-ai` flags.
- 8b6ed1a: `withTypesugar()` for tsup (`unplugin-typesugar/tsup`, also `typesugar/tsup`):
  wraps a tsup config, adds typesugar's esbuild plugin, and makes `dts: true`
  work on macro code. tsup's own `dts` step type-checks the unexpanded source,
  so a fluent `match()` with binding patterns failed it with TS2304. The helper
  emits the declarations from the expanded program into `.tsup/typesugar-dts/`
  and points tsup's `dts` step at them, so tsup still bundles and names them
  (`index.d.ts`, `index.d.cts`). In watch mode they are re-emitted after each
  rebuild. `emitDeclarations()` now also returns `declarationsBySource`.

### Patch Changes

- 7d84596: Docs and comments brought in line with the extractor typing, covering-match,
  marker-type and scoping fixes: the fp README's `Some`/`None` output (the
  assertion, no `MatchError`), the std and macros READMEs on when a match has no
  throw, the umbrella README on markers being types, the reserved TS9702 (no
  "automatic"/"explicit" modes in 1.0), and core's prelude, resolution-scope and
  `ResolutionConfig` comments (the mode and prelude are not read).
- 89c895b: Package descriptions: the umbrella package uses the project tagline;
  `@typesugar/typeclass` no longer claims auto-derivation (instances come from
  `@derive` and `derived()`); `@typesugar/derive` says it is the `@derive` macros;
  `@typesugar/lsp-common` describes the language-service helpers it holds, not the
  removed LSP server.
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

- 2fb4b62: Fix: `summonAll` is now importable. It is a registered macro that declares
  `module: "typesugar"` and is documented as public API, but it shipped with no
  runtime stub and no facade export — so `import { summonAll } from "typesugar"`
  failed to type-check and the feature was unusable.
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
- Updated dependencies [2d2ff92]
- Updated dependencies [a80b382]
- Updated dependencies [4d4ce68]
- Updated dependencies [9bcb9d8]
- Updated dependencies [0e0fe90]
- Updated dependencies [b98f015]
- Updated dependencies [f8dcade]
- Updated dependencies [3400d8c]
- Updated dependencies [fae35e9]
- Updated dependencies [f3c8949]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [2f43c28]
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
- Updated dependencies [4504b87]
- Updated dependencies [8f533b0]
- Updated dependencies [d8d3736]
- Updated dependencies [7d84596]
- Updated dependencies [abb063e]
- Updated dependencies [ce9fd6d]
- Updated dependencies [f415cc2]
- Updated dependencies [592d66b]
- Updated dependencies [3460709]
- Updated dependencies [80b45c7]
- Updated dependencies [86e239b]
- Updated dependencies [eb77b03]
- Updated dependencies [810833a]
- Updated dependencies [c60519f]
- Updated dependencies [4ca9f31]
- Updated dependencies [0435dc6]
- Updated dependencies [459807a]
- Updated dependencies [95602ac]
- Updated dependencies [a39fa2d]
- Updated dependencies [3da95a9]
- Updated dependencies [bec2d2b]
- Updated dependencies [fbf4ef1]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [75f1968]
- Updated dependencies [e016c8d]
- Updated dependencies [c9a1e3e]
- Updated dependencies [624d80a]
- Updated dependencies [e0ba26b]
- Updated dependencies [bb1720e]
- Updated dependencies [9dcc681]
- Updated dependencies [4b0d84d]
- Updated dependencies [76af80e]
- Updated dependencies [977888e]
- Updated dependencies [ac891d1]
- Updated dependencies [c7fb29f]
- Updated dependencies [508c7d3]
- Updated dependencies [283fe78]
- Updated dependencies [3ae83a6]
- Updated dependencies [d7d6236]
- Updated dependencies [eb6e5a8]
- Updated dependencies [34bdce1]
- Updated dependencies [6322cde]
- Updated dependencies [f905fba]
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
- Updated dependencies [b676bbc]
- Updated dependencies [6f70351]
- Updated dependencies [111b43d]
- Updated dependencies [dade880]
- Updated dependencies [d0392e0]
- Updated dependencies [babbb30]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [89c895b]
- Updated dependencies [c30101d]
- Updated dependencies [4f6ad83]
- Updated dependencies [b6a5211]
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [48b621b]
- Updated dependencies [563e46b]
- Updated dependencies [57d76a1]
- Updated dependencies [e274769]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [855eb1f]
- Updated dependencies [76672a0]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [4b78011]
- Updated dependencies [a252187]
- Updated dependencies [076e677]
- Updated dependencies [2fb4b62]
- Updated dependencies [33fee99]
- Updated dependencies [56e1acf]
- Updated dependencies [8587de8]
- Updated dependencies [93ea406]
- Updated dependencies [e0694af]
- Updated dependencies [c3ad41c]
- Updated dependencies [3e05585]
- Updated dependencies [95b6631]
- Updated dependencies [f471698]
- Updated dependencies [5da6803]
- Updated dependencies [a266074]
- Updated dependencies [8acbcc4]
- Updated dependencies [51a72ca]
- Updated dependencies [616d213]
- Updated dependencies [dca9c00]
- Updated dependencies [e365b8d]
- Updated dependencies [e064ef7]
- Updated dependencies [cf7c08b]
- Updated dependencies [d7b3911]
- Updated dependencies [e40c7e3]
- Updated dependencies [652d1c6]
- Updated dependencies [bf451af]
- Updated dependencies [2f1744b]
- Updated dependencies [0464551]
- Updated dependencies [8b6ed1a]
- Updated dependencies [5d86014]
- Updated dependencies [0c9202a]
- Updated dependencies [5cc34d9]
- Updated dependencies [8204470]
- Updated dependencies [c1e797e]
- Updated dependencies [932d6e5]
- Updated dependencies [6edd688]
- Updated dependencies [2f89b77]
- Updated dependencies [858a07a]
- Updated dependencies [5214c09]
- Updated dependencies [615d4c1]
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0
  - @typesugar/typeclass@0.2.0
  - @typesugar/std@0.2.0
  - @typesugar/fp@0.2.0
  - @typesugar/transformer@0.2.0
  - @typesugar/type-system@0.1.2
  - unplugin-typesugar@0.2.0
  - @typesugar/derive@0.1.2
  - @typesugar/reflect@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/macros@0.1.1
  - @typesugar/transformer@0.1.1
  - unplugin-typesugar@0.1.1
  - @typesugar/derive@0.1.1
  - @typesugar/typeclass@0.1.1
  - @typesugar/specialize@0.1.1
  - @typesugar/reflect@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/macros@0.1.1-rc.0
  - @typesugar/transformer@0.1.1-rc.0
  - unplugin-typesugar@0.1.1-rc.0
  - @typesugar/derive@0.1.1-rc.0
  - @typesugar/typeclass@0.1.1-rc.0
  - @typesugar/specialize@0.1.1-rc.0
  - @typesugar/reflect@0.1.1-rc.0
