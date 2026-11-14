# @typesugar/transformer

## 0.2.0

### Minor Changes

- 86e239b: `typesugar build` emits `.d.ts` files from the expanded program. TypeScript
  computes declarations with the checker, and `build` used to hand it the
  unexpanded source, so an exported function returning a fluent `match()` was
  declared `: any` and pattern-bound names were undeclared. Now every file is
  expanded first and the declarations describe the expanded code
  (`area(shape: Shape): number`), importing nothing from typesugar. The program
  the macros run against is built with declaration emit off, so it reports no
  declaration errors about unexpanded types; `noEmitOnError` is decided on the
  diagnostics `build` reports.

  New flags: `typesugar build --emitDeclarationOnly` (only `.d.ts`, for projects
  whose JavaScript comes from a bundler) and `--declarationDir <dir>`. The same
  step is available as an API: `emitDeclarations({ project, declarationDir })`
  from `@typesugar/transformer`.

- b676bbc: New: `node --import typesugar/register` (also `@typesugar/transformer/register`), Node module hooks that run TypeScript through typesugar's macro expansion, for scripts, tsx, `node --test`, tape and benchmarks run from source.
  - Each `.ts`/`.mts`/`.cts`/`.tsx` module outside `node_modules` is expanded with the nearest `tsconfig.json`. A module the expansion does not change goes to the rest of the loader chain untouched (Node's type stripping, or tsx), so a project with no macros runs exactly as before. A changed module is compiled to JavaScript for the running Node (no downlevelling; class-field semantics follow the tsconfig `target`) with an inline source map. A macro error fails the import.
  - Works alone on Node 22.18+ / 23.6+ and with tsx registered before or after it, since it reads sources from disk rather than from the next loader. Also via `NODE_OPTIONS` (or pnpm's `node-options`).
  - The resolve hook maps a missing relative `./x.js` imported from TypeScript to `./x.ts` (`.mjs`/`.cjs`/`.jsx` likewise), as TypeScript and tsx do.
  - Uses `module.registerHooks()` where available (Node 22.15+ / 23.5+, covers `require()`), else `module.register()` (Node 20.6+, `import` only).
  - The hook module imports only Node builtins; TypeScript and the pipeline load on the first TypeScript module.
  - `@typesugar/transformer`: `transpileExpanded()` takes a `module` option, and `TransformationPipeline` has `getCompilerOptions()`.

  See docs/getting-started/environments/node.md.

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

- 855eb1f: PEP-053 Wave 3: one specialization pipeline. The legacy transformer's private
  clone of the specialization pass (~700 lines) is deleted in favor of the
  shared implementation in `@typesugar/transformer-core`, now exported from its
  package index. Production paths (ts-patch, unplugin, CLI, LSP) and the
  playground run the same code.

  Unification deltas (all in the direction of correctness): hoisted
  specializations of generic functions no longer carry parameter type
  annotations that reference stripped type parameters; void-returning functions
  no longer emit a spurious `[TS9602] no return statement` skip warning; inlined
  derived-instance calls strip comment trivia in both pipelines (previously
  legacy-only).

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

- 2d2ff92: `typesugar check` and `build` type-check the expansion of a fluent `match()` chain too, as they do a
  comprehension's, a `match:` switch's and an `ensures:` block's. A chain's pattern names are
  undeclared as written (the MacroCallChain rule hides that), so `.case({ kind: "circle", r
}).then(r.toUpperCase())` on a number `r` passed plain `check`, built, and threw "r.toUpperCase is
  not a function" at run time; only `--strict` reported it. Plain `check` and `build` now report
  TS2339 at the line you wrote. Only what lies inside the chain is reported. A file with such a chain
  costs one expanded check of that file (std's showcase: 0.63 s / 299 MB to 0.82 s / 359 MB).
- a80b382: `typesugar check` (and the `emitDeclarations()` API) no longer report an assignment between an
  `@opaque` type and its underlying representation: `const o: Option<number> = numberOrNull` with
  `Option` from `@typesugar/fp`, the same value passed as an argument, and a same-file
  `/** @opaque A | undefined */` type. Both filter the source's diagnostics before expanding anything,
  and the TypeRewriteAssignment rule matches against the `@opaque` types the expansion registers, so
  it hid nothing there; `build` and the editor, which filter later, did. The program's `@opaque`
  types (its own sources' and those of the `.d.ts` files they import) are now registered before the
  filter runs.
- b98f015: `typesugar build`, `check`, `watch` and `expand` run the expression-position comprehension
  rewrite the pipeline runs (`const f = (id) =>` then `let: { ... } yield: ...`, `return let: ...`,
  `export default let: ...`): `build` emitted broken JavaScript for them
  (`export const f = (id) => let, { user }; ...`) and `check` reported the broken parse. Diagnostics
  in a rewritten file are reported at the lines as written.
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
- 2f43c28: A transform that runs out of stack ("Transform failed: RangeError: Maximum call stack size
  exceeded") now says why and what to do: an expression nests too deeply, in practice a chain of
  thousands of typeclass operators on objects (`a + a + ... + a`, each rewritten level rebuilt
  around its left operand); split it into intermediate consts. A 200-term chain transforms fine.
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

- 291dc90: A type whose derives only generate its companion (`/** @derive(Eq, Clone) */ export interface Vec`)
  can be re-exported by name. `typesugar build` dropped `export { Vec } from "./vec.js"` (and
  `import { Vec } from "./vec.js"; export { Vec };`) from the JavaScript, because `Vec` is only an
  interface in the source, while the `.d.ts` still exported it; a consumer's `a === b`
  (`Vec.Eq.equals(a, b)`) then failed with "does not provide an export named 'Vec'". The emit now
  keeps a re-export whose target, followed through every alias, is a type a derive makes a value.

  Under `verbatimModuleSyntax` and `isolatedModules`, `typesugar check` and `build` no longer report
  TS1484 on `import { Vec }` or TS1205 on `export { Vec } from` for such a type (`export type`, the fix
  TypeScript suggests, would leave the companion out of the JavaScript), and `typeof Vec.Eq` in a type
  position is no longer TS2693. A type without derives is still reported.

  An exhaustive destructuring `match: switch` at the end of a function, whose every case returns or
  throws, is no longer TS2366 ("Function lacks ending return statement") or TS7030 in `typesugar
check` / `build`. A switch a `break` can leave, or whose last case falls off the end, still is.

- 3ae83a6: The values `@derive(Destructure)` declares (the constructor functions `Point`, `Circle` and their
  instances) can be imported, called and re-exported by name before expansion. Checked as written,
  the source reported `export { Circle } from "./shapes"` and `import { Circle }` as TS2305,
  `Point(1, 2)` as TS2693 and `Circle(2)` in the deriving file as TS2304, so `emitDeclarations` (tsup's
  `withTypesugar`) wrote nothing for an index file that re-exports them. A derive macro can now say
  which names it declares (`generatedNames`), and the `DerivedDeclarationReference` suppression rule
  accepts exactly those. `typesugar build` keeps those names in the JavaScript's imports and
  re-exports, which TypeScript dropped as type-only.
- 4504b87: `@derive(Destructure)` works in a program that imports no typesugar package (a library whose source
  only uses the built-in `@derive` tag). Its derive macro comes with `@typesugar/std`, whose macros were
  loaded only when some file imported a typesugar package, so it was "Unknown derive: 'Destructure'".
  They are now loaded for every program, as the other built-in derives are.
- d8d3736: Docs: the recommended build paths are a bundler plugin (`unplugin-typesugar`, or
  `withTypesugar()` from `typesugar/tsup`), `typesugar build` in place of `tsc`, and
  `node --import typesugar/register` for running files. ts-patch is documented as an
  alternative for a plain `tsc`, not as a required step. The transformer README and
  the AI-assistant context `typesugar init` installs (`ai/AGENTS.md`, the typesugar
  skill) say so; the transformer-core README no longer calls the transformer a
  ts-patch plugin.
- abb063e: `typesugar doctor` checks ts-patch, its `prepare` script and the tsconfig `transform` plugin only
  for a project that compiles through a patched `tsc` (ts-patch installed, or the transform plugin with
  a `tsc`/`tspc` script). A project that builds with `typesugar build` or runs under `node --import
typesugar/register` failed them unless `unplugin-typesugar` was a direct dependency; they are now
  skipped there.
- ce9fd6d: `typesugar doctor` checks TypeScript against the supported range (`>=5.9.0 <7.0.0`): it fails on TypeScript 7 and warns below 5.9, reads the installed version before the declared one, and suggests `typescript@6` instead of `typescript@latest` (which installs TypeScript 7).
- f415cc2: Two emit-time checks that degraded silently when the type checker threw now
  print a one-line `[typesugar]` warning: the check that keeps a re-export of a
  value `@derive` creates (a failure could drop `export { Vec } from "./vec"`
  from the output without a word), and the read of a file's exports for the
  `@opaque` declaration annotations.
- 80b45c7: `typesugar expand --ast` prints the expanded syntax tree instead of crashing with "Converting
  circular structure to JSON". Each node has its `kind`, its real `kindName` (`VariableStatement`,
  not the `FirstStatement` range marker), its own primitive fields and its syntactic children;
  macro warnings go to stderr.
- 3da95a9: An error TypeScript finds in macro-generated code is reported at the nearest code of yours around
  it instead of being dropped. The editor dropped every such error (a position with no source
  mapping), and plain `typesugar check`/`build` did too, so an unannotated `@impl` instance with a
  missing or misspelled member (TS1360 at the `satisfies` the expansion adds) built cleanly and
  threw at run time; `check --strict` reported it at a line of the expanded code. All of them now
  report it at the instance's initializer. `check` and `build` also type-check the expansion of
  every `@impl` instance (as they already did for comprehensions and `match()` chains), since an
  unannotated instance meets its typeclass only there.
- bb1720e: An import whose every use was inlined is not emitted. `mkP.make(1)` on an imported `@impl`
  instance is inlined to `({ x: 1 })`, but the JavaScript kept `import { mkP } from "./ord.js"`
  (TypeScript decides import elision from the source as written), loading the module for nothing. A
  binding the expansion no longer references is now dropped from its import, and a declaration left
  with none is not emitted, as TypeScript does for an import used only as a type. A binding still
  used (a call that wasn't inlined, a value use, a re-export), the declaration's other bindings and
  side-effect imports stay; nothing changes under `verbatimModuleSyntax` or `emitDecoratorMetadata`.
- 9dcc681: An exported declaration initialized by an inlined instance call keeps the type the source gives it
  in the `.d.ts`. The declarations are emitted from the expansion, where `mapArr.map([1, 2], f)` is
  the method's body: `export const r` was declared `number[]`, though the source's `r` is `unknown`
  (the typeclass member's return type), so the declarations changed with whether a call was inlined.
  As for `@opaque` types, such a declaration (a const, a class property, `export default`, or a
  function or method whose body has an inlined call) is now annotated with the source's type, unless
  that is `any`. A type that can't be written
  at the declaration (a class local to the function, or a class expression's own `typeof Cls`) is not
  written there: that declaration keeps the type the expansion infers.
- 3ae83a6: `typesugar build`, watch and ts-patch keep the imports the expanded code references: TypeScript
  dropped `import { Point }` when the source used `Point` only as a type, so the emitted
  `Point.Eq.equals(...)` (or an instance imported by name and used only through `summon`) was a
  ReferenceError at run time.
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

- 34bdce1: The `typesugar create library` template's `tsup.config.ts` says when its bundled
  declarations stop being enough: instances, derives and `Destructure` extractors
  work for consumers through tsup's one-`.d.ts`-per-entry output, but a library
  that ships `@opaque` types needs per-module declarations and JavaScript, because
  consumers find an opaque type's companions as `export`ed functions in the
  `.d.ts` module that declares it.
- 6322cde: `typesugar create library` builds with `withTypesugar()` from `typesugar/tsup`, so `dts: true`
  emits declarations from the expanded program (the derived companions included), and its Vitest
  config adds the typesugar plugin so the tests run expanded code. The template's source uses the
  current syntax (`/** @typeclass */`, `/** @impl ... */`, `= implicit()`; `@instance` on a `const`
  is an error), its `typecheck` script is `typesugar check`, and it depends on `typesugar` 0.2.
- f905fba: A macro error reported by the Node loader (`node --import typesugar/register`) or a bundler plugin
  reads `file:line:col: [typesugar] [TS9209] ...`, not `[typesugar] [typesugar] [TS9209] ...`.
- 914817e: `typesugar check`/`build`: a fluent `match()` whose arm result uses a pattern name that shadows
  an outer declaration no longer fails on the chain's result type. With the default lib, in
  `function label(u: U): string { return match(u).case({ kind: "user", name }).then(name)… }`,
  `name` was typed, as written, from DOM's `name: void`, and the `return` was TS2322 (likewise a
  local function `len` in `.then(len)`, and `const v: number[] = xs.map((x) => match(…)…)`). The
  MacroCallChain rule now hides that assignability error, and the expanded check reports it where
  it was if the expansion's type is wrong too. The expanded check now also covers where a chain's
  value meets a declared type (`return`, a typed declaration, an argument), so a wrong result type
  built from pattern names (`.then(nm)` returning a `string` from a `number` function) is reported;
  before, it went unchecked. An error on a `return` the expansion rebuilt is reported at that
  `return`, not at the enclosing function's first line.
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

- 6f70351: `@opaque` annotations are kept as written in every position, and expanded code is checked against
  the runtime view of opaque types (`opaqueTypesAsUnderlying`: `Option<number>` is `number | null`).
  Annotation stripping covered only a variable or parameter default initialized by an erased
  constructor of a same-project type, so `function fo(o: Option<number>)` called as `fo(Some(2))`
  (now `fo(2)`) and `const a: Option<number> = Some(3)` with fp's `Option` failed `strictOutput`, and
  the declarations emitted from the expanded program lost the opaque type where it did strip.
  `strictOutput` and `typesugar build --strict` serve every file in that view.
- 111b43d: Declarations keep an `@opaque` type the source infers. They come from the expanded program, where
  the type is erased, so `export const a = Some(3)` was declared `declare const a = 3;` and `function
mk(n: number) { return n > 0 ? Some(n) : None; }` returned `number | null` (`typesugar build` and
  tsup's `withTypesugar({ dts: true })` alike). An exported declaration whose inferred type involves an
  `@opaque` type now gets that type, from the source as written, as an annotation on the copy the
  declarations are emitted from (`a: Option<number>`; `import("@typesugar/fp").Option<number>` where
  the file doesn't import the type by name). Variables, functions, `export default` and the public
  members of exported classes; the JavaScript is unchanged.
- dade880: An `@opaque` type declared in one file of a project is erased in every other file whichever is
  transformed first. Its rewrite used to be registered only when the declaring file was transformed,
  so `typesugar expand use.ts`, the language service or a bundler that reached the consumer first left
  `a.map(f)` a method call on what is really `A | null`. Every `@opaque` interface of the program is now
  registered before the first file is transformed (where the macro would run: the tag starts a line and
  the file imports typesugar). The companion functions are imported the way the consumer imports the
  declaring file (`./opt.js`), or by a relative path, not by the declaring file's absolute `.ts` path.
- 4f6ad83: PEP-034: Unified SFINAE registration and shared IDE infrastructure
  - Unified all SFINAE rule registration into `registerAllSfinaeRules()` to prevent drift between IDE paths
  - New `@typesugar/lsp-common` package with shared position mapping, AST helpers, and macro code actions
  - Added `getApplicableRefactors` and `getCompletionEntryDetails` to the TS plugin language service
  - Diagnostic parity test suite exercising all 6 SFINAE rules
  - Zed extension workspace detection (only starts LSP for typesugar projects)

- b6a5211: PEP-047: Remove the `@typesugar/preprocessor` package

  The lexical preprocessor is gone. HKT type-syntax (`F<A>` → `Kind<F, A>`) is now
  handled solely by the AST-based rewriter in `@typesugar/transformer`
  (`rewriteHKTTypeReferences`), which the type-checker path already used.
  - **`@typesugar/playground`** (breaking): the `preprocess` / `preprocessOnly` /
    `preprocessCode` exports were removed. Use `transform()` — macro expansion runs
    the HKT rewrite internally.
  - **`@typesugar/transformer`**: CLI build/run/preprocess now call the AST
    rewriter; `RawSourceMap` is imported from `@typesugar/core`.
  - **`@typesugar/eslint-plugin`**: the processor uses the AST rewriter instead of
    the preprocessor.
  - **`@typesugar/lsp-server`, `unplugin-typesugar`**: dropped the unused
    `@typesugar/preprocessor` dependency.
  - **Behavior drop:** the preprocessor's `Kind<TypeF, A>` → concrete `Type<A>`
    resolution is removed (it was unused on the `.ts` path); `Kind<…>` relies on
    the `Kind` type's own instantiation, as the type-checker path already did.

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

- e274769: PEP-052 Wave 8: unified the two pipelines' JSDoc/decorator macro dispatch —
  `@typesugar/transformer` now delegates to `@typesugar/transformer-core`'s
  shared implementation instead of keeping its own ~875-line copy.
  - FIXED: `@typesugar/transformer-core` silently ignored `@deriving`/`@derive`
    JSDoc tags ("unknown JSDoc macro tag" warning) and silently no-op'd real
    `@derive(...)` decorators — PEP-032 deleted the standalone `derive`
    attribute macro, and neither of transformer-core's dispatchers had the
    special case routing it to the real derive registry instead. Both fixed.
    `@adt` is now recognized as a JSDoc tag too (it was missing from the tag
    map entirely).
  - FIXED (transformer-core only, found while porting): `expandDeriveDecorator`
    was missing the `TS9101`/`TS9103`/`TS9104` diagnostic checks (non-derivable
    field types, union without discriminant, empty types) and source-map
    preservation for derive-generated statements that `@typesugar/transformer`
    already had. `extractTypeInfo` was missing a method/accessor skip check,
    so it could incorrectly count a class's methods as derivable data fields.
    Both ported into the shared implementation.
  - REMOVED: `@typesugar/transformer`'s private copies of the JSDoc tag map,
    dispatcher, decorator parsing/sorting, and derive-expansion logic — all
    now delegate to `@typesugar/transformer-core`.

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

- 33fee99: PEP-060 D5: the tsserver plugin is typesugar's single editor engine for 1.0.
  - **`typesugar-vscode`**: the extension no longer starts `@typesugar/lsp-server`, so
    completions, hover, diagnostics, definitions, rename and code actions are no longer served
    twice. Language features come only from the bundled tsserver plugin. "Expand Macro at Cursor"
    and "Show Transformed Source" stay; they now ask the plugin through custom tsserver requests,
    and both are also in the editor context menu. `typesugar.comptimeInEditor` reaches the plugin
    through the TypeScript extension's `configurePlugin` (trusted workspaces only). Removed:
    CodeLens, the LSP's macro semantic tokens (and their token types and colours), the status bar
    item, the `refreshManifest` / `generateManifest` / `addDerive` commands, the
    `enableCodeLens` / `enableInlayHints` / `enableDiagnostics` / `manifestPath` settings, the
    manifest activation event, and eight unused modules. `generateManifest` ran
    `typesugar build --manifest`, a flag that doesn't exist.
  - **`@typesugar/transformer`** (language-service plugin): answers the custom tsserver requests
    `_typesugar.expandMacro` and `_typesugar.showTransformed`; adds macro-expansion inlay hints
    and maps TypeScript's own inlay hints back to source positions; takes `comptimeInEditor` from
    the editor (`configurePlugin`) but ignores it when it comes from the repository's
    `tsconfig.json`; loads at most once per project (a `tsconfig.json` entry plus the VS Code
    extension's global plugin no longer double-transform); maps positions for TypeScript's own
    refactors, which crashed on transformed files; and no longer offers "Expand …" / "Add
    @derive(...)" refactors that did nothing.
  - **`@typesugar/lsp-server`**: removed from the repository. The published 0.1.1 stays on npm and
    stays installable, but gets no further releases; use the TypeScript plugin.

- 56e1acf: Editor position fixes in the TypeScript plugin, for files whose macros expand:
  - Go-to-definition (and go-to-implementation) lands on the right line after a `@derive` or other
    expansion that adds lines above the target. tsserver converts the result to line/column with
    the language service's `toLineColumnOffset`, which read the expanded code; the plugin now
    converts on the source text.
  - TypeScript's quick fixes are offered in expanded files, with their edits on the source text.
    The error's span is mapped into the expanded code, and a fix that would edit generated code is
    not offered. "Fix all" (combined code fixes) is mapped the same way.
  - TypeScript's own inlay hints are shown when the requested span starts or ends in a comment
    (as a whole-file request always does): the span is mapped as a range.
  - Rename, find-references and document highlights no longer return locations in generated code.
    A `@derive` companion's references to the type were mapped onto the `@derive` tag, so renaming
    the type would have edited "@de" of the comment five times. A location is kept only when it is
    the same text in the source.
  - A file the transform leaves unchanged maps positions by identity.

  `@typesugar/lsp-common` adds `mapSourceSpanToOriginal` (a span that must be the user's own text)
  and `mapTextSpanToTransformed` (a request span mapped as a range). Position-to-line lookups in
  the `@typesugar/transformer-core` position mapper are now a binary search.

- 8587de8: The source map of an expanded file now maps every token after a template literal with
  substitutions (`` `#${n}` ``) or a regular expression containing a quote or backtick. The map
  generator found the output's tokens with a bare scanner, which read the `}` that ends a
  substitution as a brace and the next backtick as the start of a new template, so the rest of the
  file had no mappings: in the editor, diagnostics after such a template were dropped and
  go-to-definition, references and rename lost every position after it. It now collects the
  output's tokens by parsing it.
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

- a266074: Which macro packages run is decided by where they are. A macro package reached by a relative
  import (or `export … from`) whose real path is not inside a `node_modules` directory is project
  code — a vendored directory, a workspace sibling imported by path, a nested project, a
  package's own `../src` — and loads with no approval and no warning, whatever its `package.json`
  calls itself. Anyone who can write files into the repository can already edit the configs every
  build runs (SECURITY.md, "What typesugar trusts"). A package inside `node_modules` is a
  dependency and keeps the approval gate: `@typesugar/*` (and `typesugar`) are trusted, anything
  else needs `security.allowedMacroPackages`. Its name is what Node resolution gives from the
  importing file; a relative path into `node_modules` counts as a bare import of the package its
  path names (not the name its `package.json` claims). Files inside `node_modules` are never
  scanned, so a dependency's own imports load nothing. Project code is loaded by real path, never
  under the name it claims, so it cannot stand in for the real package of that name.
  `typesugar approve-macros` now runs exactly the build's discovery (new `scanMacroPackages`), so
  it lists what the build would refuse, and `export … from` re-exports are scanned like imports.
- 8acbcc4: A macro imported by a relative path to its own package is expanded: `packages/mapper/examples/
showcase.ts` imports `transformInto` from `"../src/index.js"`, and the macro loader only looked
  at bare specifiers, so `@typesugar/mapper`'s macros were never loaded and the call ran its
  runtime stub ("transformInto() was called at runtime"). A relative import now loads the macro
  entry of the package it lands in (the nearest `package.json` above the imported file) when that
  package declares `typesugar.macros`. A load failure is a warning, except in a file inside that
  package (its own build).
- e365b8d: The doc comments of sql's `Read`/`Write`/`Codec` derive macros, and the `macro-plugin` template's
  `@example`, began a line with `@derive(...)` on a `const`, which is a real JSDoc tag there: it was
  ignored before, and is now error TS9102. They name the derive in code text (or a fenced example)
  instead.
- e064ef7: std's showcase compiles and runs again, and every `packages/*/examples/*.ts` is now run with
  `typesugar run` in the test suite (the ones still broken are listed, with why). Fixes on the way:
  - `match()` treats an object type with a literal-typed property as a one-variant discriminated
    union: `const c: Shape = { kind: "circle", radius: 5 }` (narrowed to the circle variant) is
    covered by its `.case({ kind: "circle", radius })` arm instead of TS9226 "not enumerable".
  - std's root exports the array `groupBy` under its own name (as well as `arrayGroupBy`), so
    `import { groupBy } from "@typesugar/std"; xs.groupBy(f)` resolves.
  - An imported value whose apparent type carries a `declare global` stub (std's `LT`, a number,
    has `clamp` through `interface Number`) is no longer offered as an extension namespace:
    importing `LT` next to `clamp` made `(150).clamp(0, 100)` ambiguous.
  - `typesugar run` bundles for the Node it runs on (top-level await works) and gives bundled
    CommonJS modules a `require` for Node builtins ("Dynamic require of 'path' is not supported").

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

- 652d1c6: The TypeScript plugin now loads when `tsconfig.json` names it as documented
  (`{ "name": "@typesugar/transformer/language-service" }`). tsserver requires the plugin module to
  be the factory function, and the package's CommonJS entry exported `{ default }`, so tsserver
  skipped it with "did not expose a proper factory function". Editors that load the plugin from
  `tsconfig.json` (Neovim, Zed, Sublime, Helix and Emacs through typescript-language-server or
  vtsls) got no typesugar support. The VS Code extension was not affected: it loads the plugin
  through `@typesugar/ts-plugin`, which unwraps `default`.
- bf451af: The bundler plugins' TypeScript-to-JavaScript step no longer passes the project's
  `compilerOptions.plugins` to TypeScript. With ts-patch installed, TypeScript applies each
  `{ "transform": ... }` entry in `transpileModule` too, so a tsconfig that lists
  `@typesugar/transformer` for `tspc` had its already expanded code expanded again: a
  `/** @typeclass */` interface got its companion twice, and esbuild/tsup failed with "Multiple
  exports with the same name".
- 0464551: A ts-patched `tsc -p packages/app` run from the repository root reads `packages/app`'s
  `typesugar.config.*`: the ts-patch entry now searches for the config from the tsconfig's
  directory, as the CLI, the editor and the bundler plugins do, instead of from the current
  directory. The search still walks up to the repository root.
- 8b6ed1a: `withTypesugar()` for tsup (`unplugin-typesugar/tsup`, also `typesugar/tsup`):
  wraps a tsup config, adds typesugar's esbuild plugin, and makes `dts: true`
  work on macro code. tsup's own `dts` step type-checks the unexpanded source,
  so a fluent `match()` with binding patterns failed it with TS2304. The helper
  emits the declarations from the expanded program into `.tsup/typesugar-dts/`
  and points tsup's `dts` step at them, so tsup still bundles and names them
  (`index.d.ts`, `index.d.cts`). In watch mode they are re-emitted after each
  rebuild. `emitDeclarations()` now also returns `declarationsBySource`.
- 2f89b77: Security: a vendored macro package's macros entry is its own file. Imported by a relative
  path, a vendored package resolved `${name}/macros` by name from its package.json, and
  without an `exports` map Node found the npm copy of the same name in the project's
  `node_modules`, which then ran unapproved (and `approve-macros` listed nothing). The entry
  is now resolved through the package's own `exports` map or as a path in its directory; an
  entry whose real path is outside the package is refused with a warning, and a bare entry
  naming another package (`"macros": "@typesugar/macros"`) is a dependency that keeps the
  approval gate.
- 858a07a: `typesugar watch`'s "Found N errors" summary counts the errors it printed. It used to be
  TypeScript's count, which includes the diagnostics the suppression rules hide and none of the
  macro errors (a project with a statement-position comprehension printed two errors and said
  "Found 18 errors"). Diagnostics in a file with an expression-position comprehension are reported
  at the positions as written, as `check` and `build` report them, also after an edit on a
  case-insensitive file system, and the comprehension preprocessor's own errors (TS9223) are
  reported in watch too.
- 5214c09: `typesugar watch` runs the expanded type check `check` and `build` run: the expansion of a
  comprehension, `match:` case, `ensures:` block or fluent `match()` chain whose bound names the
  suppression filter hid is type-checked on every rebuild, so `user.nme` in a comprehension is
  reported (TS2551) instead of "Found 0 errors". It reuses the watch program's SourceFiles and
  the expansion each file was last emitted with.
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
- Updated dependencies [16bf668]
- Updated dependencies [01a547c]
- Updated dependencies [34850dc]
- Updated dependencies [291dc90]
- Updated dependencies [5f9af12]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7340c04]
- Updated dependencies [8f533b0]
- Updated dependencies [d8d3736]
- Updated dependencies [7d84596]
- Updated dependencies [592d66b]
- Updated dependencies [3460709]
- Updated dependencies [eb77b03]
- Updated dependencies [810833a]
- Updated dependencies [c60519f]
- Updated dependencies [4ca9f31]
- Updated dependencies [0435dc6]
- Updated dependencies [80d05b4]
- Updated dependencies [bec2d2b]
- Updated dependencies [fbf4ef1]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [75f1968]
- Updated dependencies [e016c8d]
- Updated dependencies [c9a1e3e]
- Updated dependencies [624d80a]
- Updated dependencies [e0ba26b]
- Updated dependencies [9dcc681]
- Updated dependencies [4b0d84d]
- Updated dependencies [76af80e]
- Updated dependencies [977888e]
- Updated dependencies [ac891d1]
- Updated dependencies [c7fb29f]
- Updated dependencies [508c7d3]
- Updated dependencies [283fe78]
- Updated dependencies [eb6e5a8]
- Updated dependencies [6659c44]
- Updated dependencies [0411491]
- Updated dependencies [f4ffc81]
- Updated dependencies [0780883]
- Updated dependencies [b893cb6]
- Updated dependencies [914817e]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [05dbbcb]
- Updated dependencies [ef7164e]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [dade880]
- Updated dependencies [d0392e0]
- Updated dependencies [babbb30]
- Updated dependencies [8d5b6e3]
- Updated dependencies [cb87742]
- Updated dependencies [0e5a1de]
- Updated dependencies [38a89d0]
- Updated dependencies [ef5be91]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [89c895b]
- Updated dependencies [4f6ad83]
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
- Updated dependencies [a252187]
- Updated dependencies [2fb4b62]
- Updated dependencies [c352805]
- Updated dependencies [56e1acf]
- Updated dependencies [4b8ef70]
- Updated dependencies [93ea406]
- Updated dependencies [e0694af]
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
- Updated dependencies [0c9202a]
- Updated dependencies [5cc34d9]
- Updated dependencies [8204470]
- Updated dependencies [c1e797e]
- Updated dependencies [6edd688]
- Updated dependencies [615d4c1]
  - @typesugar/core@0.2.0
  - @typesugar/macros@0.2.0
  - @typesugar/transformer-core@0.2.0
  - @typesugar/lsp-common@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/transformer-core@0.1.1
  - @typesugar/preprocessor@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/transformer-core@0.1.1-rc.0
  - @typesugar/preprocessor@0.1.1-rc.0
