# PEP-039: Core Hardening — Bug Fixes, String Codegen Removal, and Test Coverage

**Status:** Complete (2026-05-19) — all 6 waves landed
**Date:** 2026-04-11
**Author:** Claude (with Dean Povey)

**Summary of outcomes:**

- 4 critical bugs fixed in Wave 1 (`coverage.ts` key format, `getPrimitivesFor`
  filter, `normalizeTypeName` greedy regex, LSP repeated-line first-occurrence).
- LSP `\r\n` handling fixed across `lsp-server` and `lsp-common`.
- 4 string-codegen files migrated to AST in Wave 2 (`generic.ts`, `hkt.ts`,
  `custom-derive.ts`, `implicits.ts`). Remaining call sites in
  `typeclass.ts` / `quote.ts` / `verify-laws.ts` / `syntax-macro.ts` /
  `auto-derive.ts` / `specialize.ts` deferred to a follow-up PEP.
- Playground robustness (Wave 6): expression-position comprehensions
  (arrow body, `return`, `export default`), `inferTypeConstructor`
  crash recovery, TS9222 (discarded value-producing comprehension) and
  TS9223 (`yield:` inside generator) diagnostics.
- Test coverage went from 16% file-coverage in macros (5/31) to nearly
  complete (26/29 testable files). ~1,033 new test cases across Waves
  3–5:
  - Wave 3: 100 tests across 5 critical macro files.
  - Wave 4: 585 tests across 16 macro files (target was 100).
  - Wave 5: 348 tests across transformer-core (190) + LSP (40) + std
    typeclasses (118).
- Three real bugs pinned as regression-locking tests (with `expect.toThrow`
  / behaviour snapshots) so they fail when fixed:
  1. `hkt.ts` — `isKindAnnotation`/`getKindArity` text slicing doesn't
     match TS parsing of `<F<_>>`; `countUnderscoreMarkers` skips
     `PropertySignature` children of `TypeLiteral` (`.todo`).
  2. `tailrec.ts` — `return f(...)` inside a `for`/`while` body is
     incorrectly classified as tail position and crashes
     `transformTailRecursion` with `Cannot start a block scope during
initialization` instead of emitting a diagnostic.
  3. `module-graph.ts` — literal-filename patterns (no `*` or `/`) never
     match anything because `matchesKindPattern` (line 234) rejects every
     declaration when the pattern is neither `*`, a kind, nor contains
     glob chars.
- Several behavioural quirks pinned as documented contracts (not bugs):
  `cfg.ts` triple-equals falls through to missing-key, lone-`\r` is line
  content not terminator, `Destructure` protocol can't distinguish
  `Some(undefined)` from `None`, `resolveSymbolToMacro` only consults
  registry for `packages/` / `node_modules/` paths.

## Context

A comprehensive code review of the macros, transformer, std, and LSP packages revealed
three categories of issues:

### Category 1: Bugs

**`coverage.ts` key format mismatch (critical):** `registerPrimitive()` creates keys
like `"number::Show"` but `hasPrimitive()` looks for `"number::__binop__(Show"`. The
keys never match — coverage checking is silently broken. `getPrimitivesFor()` has a
similar bug: its filter `key.endsWith(', "::", ${typeclassName}')` can never match the
actual key format, so it always returns an empty array.

**LSP line-matching fallback (high):** When the position mapper returns null,
`server.ts:583` falls back to `originalLines.findIndex((l) => l.trim() === lineText)`,
which matches the _first_ occurrence of that line text. Files with repeated patterns
(common in templates) get diagnostics at wrong positions.

**LSP `\r\n` handling (medium):** `positionToOffset()` in both `lsp-server/src/helpers.ts`
and `lsp-common/src/position-helpers.ts` only checks for `\n` when counting lines. CRLF
files get character offsets that drift by one per line.

**LSP silent diagnostic drops (medium):** When `mapTsDiagnostic()` returns null, only
the first 3 are logged. Remaining drops are silently counted, giving no visibility into
what the user is losing.

### Category 2: CLAUDE.md Violations — String Codegen

The project rule says: build AST nodes via `ts.factory.create*`, never construct code
strings and parse them back. Several macros violate this:

- **`generic.ts`** — `expandGenericForProductType()` and `expandGenericForSumType()` build
  entire Generic instances as template strings with `JSON.stringify`, then `ctx.parseStatements()`
- **`custom-derive.ts`** — `defineCustomDerive()`, `defineFieldDerive()`, `defineTypeFunctionDerive()`
  build function code as joined strings, passed to `ctx.parseStatements()`
- **`hkt.ts`** — `expandTier3HKT()` and `expandTier2Companion()` build interface declarations
  as template strings; `replaceUnderscoreInTypeText()` uses regex on type text
- **`implicits.ts`** — `transformImplicitsCall()` uses `ctx.parseExpression()` on a dotted name
  string instead of building a property access chain via AST

~100 lines of string-based codegen across 8 call sites.

### Category 3: Test Coverage Gaps

The macros package has **5 tested files out of 31** (16%). Critical untested files include
`typeclass.ts` (~2700 LOC), `specialize.ts` (~3000 LOC), `comptime.ts` (653 LOC),
`implicits.ts` (605 LOC), `operators.ts` (285 LOC), `extension.ts` (450 LOC), and
`derive.ts` (157 LOC).

The transformer-core package has 4 large untested modules: `rewriting.ts` (~1000 LOC),
`specialization.ts` (~1100 LOC), `import-resolution.ts` (695 LOC), `macro-helpers.ts`
(671 LOC).

The LSP has no tests for position mapping edge cases (Windows line endings, repeated
lines, UTF-16 surrogates) or error scenarios (transform failures, unmappable ranges).

Additional dead code: `StoredSuggestion` interface and `suggestionCache` in `server.ts`
are populated but never consumed. `getPrimitivesFor()` is exported but broken.
`normalizeTypeName()` uses a greedy regex that mangles nested generics. Primitive generic
instances in `generic.ts` are registered but never used.

## Waves

### Wave 1: Critical Bug Fixes ✅

**Status:** Complete (2026-04-12)

Fix the bugs that produce wrong behavior today.

**`packages/macros/src/coverage.ts`:**

- [x] Fix `hasPrimitive()` key format to match `registerPrimitive()`: change from
      `` `${typeName}::__binop__(${typeclassName}` `` to `` `${typeName}::${typeclassName}` ``
- [x] Fix `getPrimitivesFor()` filter: replace the impossible `key.endsWith(...)` with a
      correct check that matches the `typeName::typeclassName` format
- [x] Fix `normalizeTypeName()` greedy regex `/<.*>$/` — replaced with `indexOf('<')` +
      `substring` for simplicity and correctness with nested generics

**`packages/macros/src/operators.ts`:**

- [x] Replace fragile `typeName.split("<")[0]` in `tryTypeclassResolution()` with proper
      TypeChecker-based type name extraction using `type.getSymbol()` / `aliasSymbol` with
      fallback to `typeToString` for primitives

**`packages/lsp-server/src/server.ts`:**

- [x] Replace `findIndex` first-occurrence heuristic with outward search from expected
      line number to disambiguate repeated lines
- [x] Increase diagnostic drop logging: removed the `droppedByMapper <= 3` limit — all
      dropped diagnostics are now individually logged
- [ ] ~~Remove dead `StoredSuggestion` interface and `suggestionCache`~~ — **NOT dead code:**
      `suggestionCache` is consumed by the `onCodeAction` handler (line ~1545) for quick fix
      suggestions. Incorrectly identified in the review.

**`packages/lsp-server/src/helpers.ts` and `packages/lsp-common/src/position-helpers.ts`:**

- [x] Add `\r\n` handling to `positionToOffset()` and `offsetToPosition()` — skip `\r`
      before `\n` in line-counting loops, exclude `\r` from line length calculations

**`packages/macros/src/generic.ts`:**

- [x] Remove unused primitive generic instance exports (`genericNumber`, `genericString`,
      `genericBoolean`) — confirmed unused outside the file. Inlined the registration calls.

**Gate:**

- `cd packages/macros && npx vitest run` — all existing tests pass
- `cd packages/lsp-server && npx vitest run` — all 68 tests pass
- `cd packages/transformer && npx vitest run` — all tests pass
- `cd packages/macros && npx tsc --noEmit` — zero errors
- `cd packages/lsp-server && npx tsc --noEmit` — zero errors
- Code review: verify `hasPrimitive()` and `registerPrimitive()` key formats match;
  verify `positionToOffset()` handles `\r\n`; verify `findIndex` replacement is
  correct; verify no new string codegen introduced

### Wave 2: String Codegen to AST Conversion ✅

**Status:** Complete (2026-04-12)

Convert all `ctx.parseStatements()`/`ctx.parseExpression()` string-template patterns
to proper `ts.factory.create*` AST construction.

**`packages/macros/src/generic.ts` (~34 lines):**

- [x] `expandGenericForProductType()` — replace template string + `parseStatements` with:
  - `factory.createVariableStatement` for the `genericFoo` const
  - `factory.createObjectLiteralExpression` for the `{ to, from }` object
  - `factory.createExpressionStatement` + `factory.createCallExpression` for
    `registerGenericMeta()` and `registerGeneric()` calls
  - Use `factory.createArrayLiteralExpression` instead of `JSON.stringify(fieldNames)`
- [x] `expandGenericForSumType()` — same approach

**`packages/macros/src/hkt.ts` (~18 lines):**

- [x] `expandTier3HKT()` — replace template string interface with
      `factory.createInterfaceDeclaration` with heritage clause, `__kind__` member, and
      `_` member whose type is the replaced RHS
- [x] `expandTier2Companion()` — same pattern for companion interface
- [x] `replaceUnderscoreInTypeText()` — replaced with `replaceUnderscoreInTypeNode()`:
      proper AST walking that visits type nodes and replaces `_` identifiers with
      `this["__kind__"]` indexed access types. Handles type references, arrays, unions,
      intersections, tuples, function types, parenthesized types, conditional types,
      type literals, and mapped types.

**`packages/macros/src/custom-derive.ts` (~45 lines):**

- [x] `defineCustomDerive()` — changed callback contract from `(info) => string` to
      `(ctx, info) => ts.Statement[]`. Breaking API change (acknowledged in trade-offs).
- [x] `defineFieldDerive()` — callback changed to `(ctx, typeName, field) => ts.Statement[]`;
      preamble/postamble also changed to return `ts.Statement[]`
- [x] `defineTypeFunctionDerive()` — callback returns `{ params: Array<{name, type: TypeNode}>,
returnType: TypeNode, body: ts.Statement[] }`. Framework builds function declaration via
      `factory.createFunctionDeclaration`.

**`packages/macros/src/implicits.ts` (~3 lines):**

- [x] `transformImplicitsCall()` — replaced `ctx.parseExpression(resolved.instanceName)` with
      `buildDottedExpression()` helper that splits on `.` and builds a chain of
      `factory.createPropertyAccessExpression`

**Notes:**

- The `printTypeNode()` helper in hkt.ts was removed (no longer needed).
- The old `replaceUnderscoreInTypeText()` regex function was replaced by the AST-walking
  `replaceUnderscoreInTypeNode()`.
- `StringDeriveCallback` type was replaced by `CustomDeriveCallback` with the new signature.
- Remaining `parseStatements`/`parseExpression` calls in other files (typeclass.ts, quote.ts,
  verify-laws.ts, syntax-macro.ts, auto-derive.ts, specialize.ts) are out of Wave 2's scope.
  These are legacy string codegen tracked in CLAUDE.md for future cleanup.

**Gate:**

- `cd packages/macros && npx vitest run` — all tests pass
- `cd packages/transformer && npx vitest run` — all tests pass
- `cd packages/macros && npx tsc --noEmit` — zero errors
- Grep verification: `grep -rn 'parseStatements\|parseExpression'` in the four converted
  files (generic.ts, hkt.ts, custom-derive.ts, implicits.ts) returns zero hits
- Code review: verify all new AST construction is correct and produces identical output
  to the old string-based approach; verify no regressions in macro expansion behavior

### Wave 3: Test Coverage — Critical Macro Files ✅

**Status:** Complete (2026-04-12)

Add unit tests for the highest-complexity untested macro files. These are the core of
the macro system and bugs here propagate everywhere.

**`packages/macros/src/typeclass.ts` (~2700 LOC, complex):**

- [x] Test instance registry: register, lookup, duplicate detection, update
- [x] Test standard typeclass registration (Eq, Ord, Semigroup, Monoid, Clone, Debug)
- [x] Test operator syntax mapping and merging
- [x] Test typeclass definition registration and overwriting
- [x] Test HKT typeclass and expansion registration
- [x] Test derivation context management (withDerivationContext, exception safety)
- [x] Test FlatMap/ParCombine instance management and method name overrides
- [x] Test ParCombine builder registry
- [x] Test coverage hooks registration

**`packages/macros/src/specialize.ts` (~3000 LOC, complex):**

- [x] Test specialization cache: key computation, brand sorting, storage, retrieval, clearing
- [x] Test result algebra system: built-in algebras (Option, Either, Unsafe, Promise), registration, lookup
- [x] Test instance method registry: string-based and AST-based registration, lookup
- [x] Test inline failure classification: all 8 failure reasons + null (inlineable)
- [x] Test classifyInlineFailureDetailed: canFlatten info
- [x] Test getInlineFailureHelp: help text for each reason
- [x] Test nested statement detection (try/catch in if, loop in if)

**`packages/macros/src/comptime.ts` (653 LOC, medium):**

- [x] Test jsToComptimeValue: all primitive types (null, undefined, number, string, boolean, bigint)
- [x] Test arrays: empty, nested, mixed types
- [x] Test objects: empty, nested, with array values
- [x] Test circular reference detection in objects and arrays
- [x] Test shared (non-circular) reference handling (known limitation: treated as circular)
- [x] Test unsupported types (functions, symbols)

**`packages/macros/src/implicits.ts` (605 LOC, medium):**

- [x] Test isImplicitDefault: implicit() calls, other defaults, no initializer, wrong function name
- [x] Test hasImplicitParams: with/without implicit params, mixed defaults, no params
- [x] Test getImplicitParamIndices: contiguous, non-contiguous, single, none
- [x] Test buildImplicitScopeFromDecl: scope building, type arg extraction, edge cases
- [x] Test isRegisteredTypeclass: standard and unknown typeclasses
- [x] Test resolveImplicit: registered, missing, derived, companionPath vs instanceName

**`packages/macros/src/derive.ts` (157 LOC, simple):**

- [x] Test derive marker symbols: unique, distinct, correct toString
- [x] Test frozen companion objects (Eq, Ord, Hash, Show): immutability, primitive instances
- [x] Test primitive instance methods (equals, compare, hash, show)
- [x] Test createDerivedFunctionName: all 11 known operations + default fallback
- [x] Test uncapitalization edge cases

**Gate:**

- `cd packages/macros && npx vitest run` — all 245 tests pass (100 new across 5 files)
- `cd packages/macros && npx tsc --noEmit` — zero errors
- New test count: ~100 new test cases across the 5 files (target was 60)
- Code review: completed — tests cover critical paths AND edge cases (empty inputs,
  missing registrations, circular references, nested AST patterns, exception safety)
- Transformer/LSP/core packages: all existing tests pass, no regressions
- Pre-existing transformer failures (effect showcase, strict output timing) are unchanged

### Wave 4: Test Coverage — Remaining Macro Files

Add unit tests for the remaining untested macro files. These are medium-complexity
but still important for confidence.

**Batch A — Macro expansion mechanics ✅ (Complete 2026-05-19, 165 tests):**

- [x] `operators.ts` (289 LOC) — 44 tests covering `getOperatorString` across 19
      `SyntaxKind` cases + undefined fallback, macro metadata for all five exports,
      default expansion of `__pipe__`/`__cons__`/`__apply__`, typeclass-dispatch path
      with `globalResolutionScope`, primitive-no-symbol fallback, and `pipe`/`compose`
      expansion plus error paths.
- [x] `extension.ts` (449 LOC) — 33 tests covering `createRegistrationCall` AST shape,
      `registerExtensionsMacro` / `registerExtensionMacro` success + error paths,
      `extensionAttribute` on function decls / variable decls / namespaces (export
      gating, primitive type handling, qualified names, TS9206 paths). All AST
      built with `ts.factory.*`.
- [x] `hkt.ts` (993 LOC) — 50 tests + 1 `.todo` covering `parseTypeConstructor`
      across simple/generic/nested/malformed inputs, kind annotation predicates,
      `replaceUnderscoreInTypeNode` across all 10 type-node variants
      (TypeReference, ArrayType, UnionType, IntersectionType, TupleType, FunctionType,
      ConditionalType, TypeLiteral, MappedType, ParenthesizedType), `expandTier3HKT`
      / `expandTier2Companion` interface shape, and `kindParamRegistry` lifecycle.
      Surfaced two real bugs (documented in module comment + `.todo`): (1)
      `isKindAnnotation` / `getKindArity` rely on `param.getStart()..getEnd()` text
      slicing that doesn't match how TS actually parses `<F<_>>`; (2)
      `countUnderscoreMarkers` skips `PropertySignature` children of `TypeLiteral`,
      so `type ObjF = { value: _ }` is not detected as Tier 3.
- [x] `generic.ts` (639 LOC) — 38 tests covering `registerGeneric` / `getGeneric`
      lifecycle, `registerGenericMeta` / `getGenericMeta`, `showProduct` / `showSum`
      / `eqProduct` / `eqSum` / `ordProduct` / `hashProduct` with field-equality and
      lexicographic / deterministic semantics, `deriveShowViaGeneric` /
      `deriveEqViaGeneric` (success + missing-instance throws), and the
      `genericDerive` attribute macro end-to-end against a real `ts.Program` +
      `createMacroContext` — asserting it emits the 4 expected nodes (interface +
      const + `registerGenericMeta` + `registerGeneric`), handles classes and
      discriminated unions, and that the Wave-2 AST path produces real
      `ts.ArrowFunction` initializers.

**Batch B — Code generation macros ✅ (Complete 2026-05-19, 158 tests):**

- [x] `custom-derive.ts` (342 LOC) — 31 tests. `defineCustomDerive`
      registration/options/default+custom description, ctx + SimpleTypeInfo
      shape, field flags, typeParams, `hasField`/`getField`, zero-field,
      verbatim AST return, Error + non-Error throw diagnostics.
      `defineCustomDeriveAst`: registration, AST-flavored default description,
      raw `DeriveTypeInfo` forwarding incl. sum-type, error diagnostic.
      `defineFieldDerive`: per-field invocation order, zero-field skip,
      preamble/postamble bracketing, multi-stmt flattening.
      `defineTypeFunctionDerive`: FunctionDeclaration shape, export modifier,
      multi-param ordering with type nodes.
- [x] `auto-derive.ts` (~1100 LOC) — 36 tests. Registry register/get/has/
      overwrite/built-ins, `clearDerivationCaches` cache vs registration
      semantics, `canDeriveViaGeneric` (5 cases), `tryDeriveViaGeneric`
      error/trace paths (unknown typeclass, missing meta, field-check
      rejection, codegen-null, sum without `deriveSum`), success paths incl.
      cache-hit, TypeChecker mirror synthesis for interface/class/type-alias
      product, discriminated-union → switch output, methods-only rejection,
      `makePrimitiveChecker`. Documented real bug:
      `extractMetaFromTypeChecker` scope-search fallback returns `any` from
      `getDeclaredTypeOfSymbol` for interface symbols obtained via
      `getSymbolsInScope`. Real callers always pass the declaring node,
      masking this in production.
- [x] `tailrec.ts` (716 LOC) — 35 tests. Macro metadata, factorial transform
      with AST shape assertions, if-statement / switch / ternary /
      mutually-exclusive-branches tail calls, non-tail diagnostics including
      binary op and try/catch, no-recursion diagnostic, unwrappers (parens,
      `as`, non-null, `await` rejection), logical `&&`/`||` RHS, unsupported
      shapes (arrow var, class method, anonymous default-export, ambient
      declaration), decorator stripping, parameter-rebinding `_next_*`
      temporaries. Documented real bug:
      `findRecursiveCalls` treats any `ReturnStatement` as a tail position
      unconditionally — `return f(...)` nested inside a `for`/`while` body
      crashes `transformTailRecursion` with `Cannot start a block scope
during initialization` instead of emitting a tail-position diagnostic.
      Test pins the current behaviour so it will fail when fixed.
- [x] `quote.ts` (548 LOC) — 56 tests. Splice wrappers (SpreadSplice /
      IdentSplice / RawSplice with cross-type instanceof checks), `quote` /
      `quoteStatements` / `quoteType` / `quoteBlock` with structural AST
      assertions, builders (`quoteCall`/`quotePropAccess`/`quoteMethodCall` /
      `quoteConst`/`quoteLet` Const-vs-Let flag, `quoteReturn`, `quoteIf`
      block-wrap and array bodies, `quoteArrow` block-vs-expr body,
      `quoteFunction` modifiers/return type/typed-optional params),
      template/splice arity edge cases.

**Batch C — Smaller macros ✅ (Complete 2026-05-19, 262 tests):**

- [x] `reflect.ts` (895 LOC) — 24 tests. `reflectAttribute` on interfaces
      (incl. empty, generic, readonly/optional flags), classes
      (fields+methods+async+optional params+type params), type-alias
      products, type-alias sums, unsupported declarations. `typeInfoMacro`
      object-literal shape, fields, kind variants, missing type-arg
      diagnostic. Structural assertions via `ts.is*` predicates.
- [x] `verify-laws.ts` (458 LOC) — 36 tests covering config / inference /
      extraction / arg parsing / codegen / `capitalize` / end-to-end.
      Source change: added an `@internal`-tagged re-export block to make
      internals testable. NOTE: uses `ctx.parseStatements(...)` over
      template strings — adds to the Wave 8 string-codegen migration list.
- [x] `static-assert.ts` (244 LOC) — 35 tests. `staticAssertMacro`
      (truthy/falsy literals, comparisons, runtime expressions emitting
      TS9219, arity errors, message variants), `compileErrorMacro`,
      `compileWarningMacro` (severity divergence, arity, fallback),
      `printConditionBrief` / `extractStringArg` indirect coverage.
- [x] `cfg.ts` (254 LOC) — 39 tests. Pins notable contracts:
      `setCfgConfig` is shallow replace (not deep merge); evaluator only
      matches `==`/`!=`, not `===`/`!==` — `target.platform === 'browser'`
      falls through to missing-key lookup and is falsy.
      `initializeFromEnvironment` gated by `cfgInitialized` flag.
- [x] `config-when.ts` (144 LOC) — 24 tests covering `configWhenMacro`
      (expression: true/false/missing-key/nested-path/string/number/
      equality/arrow-invocation/arity/non-literal errors) and
      `configWhenAttrMacro` (function/class/variable for both branches,
      arity + non-literal errors).
- [x] `syntax-macro.ts` (379 LOC) — 39 tests. Source change: exported
      four previously-private functions (`parsePattern`, `extractCaptures`,
      `nodeToText`, `expandTemplate`) for direct unit testing. Confirmed:
      `expandTemplate` fast-path when template is exactly `$name`,
      unmatched `$z` left untouched, `extractCaptures` returns null on
      arity / kind mismatch.
- [x] `module-graph.ts` (375 LOC) — 28 tests. Documented real bug:
      literal-filename patterns (no `*` or `/`, e.g. `"foo.ts"`) never
      match anything — `matchesPattern` accepts the file by glob, but
      `matchesKindPattern` (line 234) rejects every declaration because
      the pattern is neither `*`, a kind, nor contains `*`/`/`.
- [x] `coverage.ts` (339 LOC) — 37 tests including Wave 1 regression
      guards: key format `number::Show` not `number::__binop__(Show`;
      `getPrimitivesFor` returns registered types; `normalizeTypeName`
      handles nested generics like `Map<string, Array<number>>` via
      `indexOf('<')`. Plus registry semantics, built-in primitives,
      `checkCoverage` (covered/missing/opt-out/custom message),
      `configureCoverage`/`getCoverageConfig`, `validateCoverageOrError`
      diagnostic emission with summary dedup. Minor: `coverage.ts:118`
      has a stray `)))` in the Show missing-message template (cosmetic).

**Wave 4 totals:** 585 new test cases across 16 files (target ~100).
Macros package now has 831 tests across 26 test files. Three real bugs
documented as pinned `expect.toThrow` / behaviour-snapshot tests for
later fixes (hkt-`<F<_>>`, tailrec loop-nested-return, module-graph
literal-filename pattern); one as `.todo` (hkt countUnderscoreMarkers
skips PropertySignature children).

**Gate:**

- `cd packages/macros && npx vitest run` — all tests pass
- `cd packages/macros && npx tsc --noEmit` — zero errors
- New test count: at least 100 new test cases across all files in this wave
- Every `.ts` file in `packages/macros/src/` (excluding `index.ts` and `runtime-stubs.ts`)
  has a corresponding `.test.ts` file
- Code review: verify no test is a pure smoke test (must assert on specific behavior);
  verify edge cases are covered for the medium-complexity files

### Wave 5: Test Coverage — Transformer-Core and LSP Edge Cases ✅

**Status:** Complete (2026-05-19, 348 tests)

Fill the remaining test gaps in the transformer-core and LSP packages.

**`packages/transformer-core/` — untested modules (190 tests):**

- [x] `rewriting.ts` (1375 LOC) — 51 tests. The file's actual scope (NOT
      what the PEP backlog initially described): macro/operator/opaque
      rewriting pass — tagged-template + type macros, extension methods,
      HKT, typeclass operator rewriting, opaque ctor/method/constant/
      annotation erasure and inference helpers. All 14 exports covered.
- [x] `specialization.ts` (1214 LOC) — 51 tests. `tryAutoSpecialize`
      end-to-end (cache hit/miss/clear, hoisted decl, TS9602 diagnostic,
      synthetic-node suppression, `@no-specialize` directive,
      no-instance-args skip), dictionary call rewriting, hoisted
      specialization construction, return-type-driven specialization,
      derived-instance inlining, DCE tracker. Notes: `@no-specialize`
      only fires on the same source line as the call;
      `generateHoistedName` produces hygiene-mangled identifiers.
- [x] `import-resolution.ts` (694 LOC) — 46 tests. All 11 exports:
      specifier resolution, alias matching, name lookup, import cleanup,
      symbol→macro resolution incl. re-export chains, star re-exports,
      aliased imports, package-boundary imports, circular re-exports.
      Note: `resolveSymbolToMacro` only consults the registry for
      symbols whose declaring file is under `packages/` or
      `node_modules/` — by design (prevents `Show.summon` matching a
      global `summon` macro).
- [x] `macro-helpers.ts` (670 LOC) — 42 tests. `JSDOC_MACRO_TAGS`,
      `isJSDocMacroTargetNode`, `hasJSDocMacroTags`, `parseJSDocMacroArgs`,
      `createSyntheticDecorator`, `parseDecorator`,
      `sortDecoratorsByDependency`, `sortDeriveArgsByDependency`
      (builtin Ord/Eq, Monoid/Semigroup deps), `extractTypeInfo`
      (product / primitive / generic / recursive / anonymous),
      `expandDeriveDecorator` error paths, `tryExpandJSDocMacros`.

**`packages/lsp-server/` and `packages/lsp-common/` — edge case tests (40 tests):**

- [x] CRLF / `\r\n` regression tests pinning the Wave 1 fix
      (`positionToOffset` and `offsetToPosition` don't double-count `\r`).
- [x] UTF-16 surrogate pair handling (e.g. `𝟘` U+1D7D8) — character
      offsets count UTF-16 code units per LSP spec.
- [x] Boundary clamping (position past EOF, negative offsets) and
      long-line stress (10K-char single line stays accurate).
- [x] Empty file / `\n`-only / `\r\n`-only edge cases.
- [x] Documented behaviours: lone `\r` (Mac classic) treated as line
      content (not terminator); minor `offsetToPosition` vs
      `positionToOffset` asymmetry at the `\n` of a CRLF.
- `lsp-common` previously had no test config — added
  `packages/lsp-common/vitest.config.ts` and the first test file
  `tests/position-helpers.test.ts` (18 tests).
- `mapTsDiagnostic` repeated-line outward-search is not exported from
  `server.ts`, so unit-level coverage isn't feasible without refactor;
  that path is covered indirectly by `lsp-integration.test.ts`.

**`packages/std/` — typeclass tests (118 tests):**

- [x] `typeclass-laws.test.ts` — 43 tests. Eq reflexivity / symmetry /
      transitivity for number / string / boolean / array<number>;
      Ord laws (reflexivity, antisymmetry, transitivity, Eq compatibility)
      for number / string / boolean / array; Semigroup associativity
      for number / string / bigint / array; Monoid left / right identity + associativity for the same set.
- [x] `numeric-ops.test.ts` — 37 tests. `gcdWith` (zero edge cases,
      negatives, commutativity, coprimes, bigint), `lcmWith` (zero,
      1-identity, coprimes-as-product, bigint), `pow` (0^0=1, 0^n=0,
      n^0=1, large 2^16, signs, negative-throws, bigint 2^64),
      `powFrac` (negative exponent reciprocal), `sum` / `product`
      sanity.
- [x] `destructure.test.ts` — 17 tests. Tuple (positional),
      Object (named), sum-variant (Option-style Some/None), nested
      patterns; extract-on-match, undefined-on-mismatch,
      construct-round-trip. Documented quirk: protocol uses
      `T | undefined` so `Some(undefined)` is indistinguishable from
      `None` — acknowledged in source's "Design" comment.
- [x] `par-combine.test.ts` — 21 tests. `parCombinePromise` (order
      preservation, empty, rejection), `parCombineArray` (cartesian
      product cardinality + values, empty inner),
      `parCombineIterable` (generators), `parCombineAsyncIterable`,
      registry lookup (`getParCombine`/`getParCombineBuilder`).

**Gate:**

- `cd packages/transformer-core && npx vitest run` — all tests pass
- `cd packages/lsp-server && npx vitest run` — all tests pass
- `cd packages/std && npx vitest run` — all tests pass
- `cd packages/transformer-core && npx tsc --noEmit` — zero errors
- New test count: at least 80 new test cases across all packages in this wave
- Code review: verify transformer-core tests exercise real AST transformations (not
  mocked); verify LSP edge case tests reproduce the actual bugs from the review;
  verify std typeclass tests check algebraic laws (associativity, identity, etc.)

### Wave 6: Playground Robustness ✅

**Status:** Complete (2026-04-12)

Surfaced while validating the interactive playground after Wave 3. All issues
block real user flows — do-comprehensions render broken output or produce
silently-discarded Effects that confused first-time users.

**Bug fixes:**

- [x] `inferTypeConstructor` null-ref in .sts mode
  - TypeScript 5.9.3 crashes inside `getContextualTypeForObjectLiteralElement`
    when the callee is unresolved (unresolvable imports in .sts mode) and the
    argument is an object literal. The crash surfaces as
    `TypeError: Cannot read properties of undefined (reading 'escapedName')`
    which the labeled-block macro wrapper rethrows as a `throw new Error(...)`
    in the output.
  - Fix (`packages/std/src/macros/comprehension-utils.ts`): wrap
    `typeChecker.getTypeAtLocation` in try/catch; on failure, fall back to
    `inferTypeConstructorFromAST` — pure AST-based detection that recognizes
    `Effect.succeed(...)`, `Promise.resolve(...)`, `[...]`, `new Promise(...)`.
  - Also use the AST fallback as a last resort when the checker returns an
    unrecognized/`any` type.
  - Tests: `packages/std/tests/infer-type-constructor.test.ts` (7 cases —
    including a throwing-checker stub that simulates the .sts crash).

- [x] Expression-position comprehensions (arrow body, `return`, `export default`)
  - TypeScript does not insert ASI between the host expression and the
    following `let:` label. The arrow-body case parses as
    `(x) => let` (bare identifier) with the `yield:` block's `{ user }`
    spilling into a sibling `ObjectBindingPattern`; `return` parses as a
    bare empty return statement followed by an orphaned `let:` label;
    `export default` parses as `export default let` (bare identifier) with
    the labeled blocks stranded as top-level siblings.
  - Fix (Tier 3 — parse, detect, source-rewrite, reparse): - Arrow / `return`: wrap in a double `{ { const __letyield_N = <labeled
blocks>; return __letyield_N; } }` so the parser's error-recovery
    consumes the stray `}` from the user's `let:` block against the inner
    wrapper Block. The transformer then flattens the inner Block and the
    existing `const x = let;` merge runs unchanged. Post-merge,
    `{ const __letyield_N = EXPR; return __letyield_N; }` collapses back
    to `(params) => EXPR` / `return EXPR;`. - `export default`: hoist to a top-level `const __letyield_N = <labeled
blocks>` and rewrite the export to reference that name. (An IIFE wrap
    would work for arrow but TS's brace-recovery in
    `(() => { … })()` detaches the invocation.) - `await`: intentionally not rewritten — any wrap inside a function body
    runs into the same stray-`}` issue. Users should bind the
    comprehension to a `const` explicitly and `await` that.
  - Preprocessor: `packages/transformer/src/arrow-comprehension-preprocess.ts`.
    Wired from `packages/transformer/src/pipeline.ts` ahead of the main TS
    parse; the generated source map is composed with the surrounding chain.
  - Tests: `packages/std/tests/arrow-let-yield.test.ts` — 6 cases (arrow
    body, TS9222 suppression, `return`, `export default`, TS9223 generator
    diagnostic, top-level regression).

- [x] `TS9223` — `yield:` inside a generator function (error)
  - `yield` is a reserved keyword inside generator bodies, so `yield:` can't
    parse as a LabelIdentifier. The preprocessor scans each generator
    function's body (via brace-balancing on the source, because the parsed
    body often ends early) and emits a targeted diagnostic pointing the user
    at the `pure:` / `return:` continuation aliases.
  - Diagnostic registered at `packages/core/src/diagnostics.ts`; emission
    happens in the preprocessor and is merged into the pipeline's
    diagnostics list.

**New diagnostics:**

- [x] `TS9222` — "Result of `{label}:` comprehension is discarded" (warning)
  - Fires when a value-producing labeled block macro (`let:/yield:`,
    `par:/yield:`, etc.) is used at statement position with no binding.
  - Added `valueProducing: boolean` to `LabeledBlockMacro`; `letYieldMacro`
    and `parYieldMacro` opt in. The check lives in the transformer's
    labeled-statement visit, emits only when the expansion produces a lone
    `ExpressionStatement` (i.e., not merged into a `const x =` decl).
  - Help text suggests assigning to a variable or prefixing with `void`.
  - Diagnostic registered at `packages/core/src/diagnostics.ts` and wired
    through `packages/transformer/src/index.ts`.

**Examples:**

- [x] `docs/examples/effect/do-comprehensions.ts` — all three do-comprehensions
      now bind to `const`s and run via `Effect.runPromise`. Previously only the
      third produced output; the first two Effects were silently created and
      discarded, confusing users.

**Gate:**

- `cd packages/std && npx vitest run` — all tests pass including the new
  `arrow-let-yield.test.ts`
- `cd packages/core && npx vitest run` — all tests pass
- `cd packages/transformer && npx vitest run` — no new regressions (3
  pre-existing failures unchanged: effect-adapter showcase, effect showcase,
  strict-output timing)
- Playground manual: load Do-Comprehensions (Effect) in both `.ts` and `.sts`
  mode; verify three `console.log` lines appear with no stray `let:/yield:` or
  TypeScript error recovery markers in the output pane
- Code review: verify the arrow-body rewrite doesn't trigger on type positions
  (`type F = () => let: X` etc.) or bare `=> let` without a following labeled
  block; verify MagicString emits source maps so diagnostics on the rewritten
  source still point to the right lines in the original

## Consequences

### Benefits

- **Coverage.ts actually works** — primitive coverage checking has been silently broken;
  fixing it may surface derive failures that were being masked
- **Cross-platform LSP** — Windows users get correct diagnostic positions
- **No more string codegen in macros** — the entire codebase follows the AST-first
  principle, making it safer to compose transformations and reducing regex fragility
- **Test confidence** — going from 16% to ~100% file coverage in macros means refactors
  and new features can be validated automatically
- **Diagnostic visibility** — users will know when diagnostics are being dropped and why

### Trade-offs

- **Large test-writing effort** — Waves 3–5 are substantial; ~240+ new test cases across
  25+ files. This is front-loaded investment that pays off in refactor safety.
- **Wave 2 API change** — converting `defineCustomDerive`'s callback from returning strings
  to returning `ts.Statement[]` may require updates to any external custom derive
  consumers. Check for downstream usage before changing the contract.
- **Coverage.ts fix may break things** — if coverage checking was silently disabled and
  code relied on the "always passes" behavior, fixing it may surface new derive errors.
  This is correct behavior but may require follow-up fixes.

### Non-Goals

- Refactoring `transformer/src/index.ts` (6676 lines) into smaller modules — important
  but orthogonal to this hardening effort
- Adding tests for CLI tools (`cli.ts`, `doctor.ts`, `init.ts`) — these are integration
  entry points better tested via E2E
- Achieving 100% line coverage — the goal is meaningful behavioral coverage of exported
  functions and critical code paths, not coverage metrics
