# PEP-039: Core Hardening — Bug Fixes, String Codegen Removal, and Test Coverage

**Status:** In Progress
**Date:** 2026-04-11
**Author:** Claude (with Dean Povey)

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

### Wave 2: String Codegen to AST Conversion

Convert all `ctx.parseStatements()`/`ctx.parseExpression()` string-template patterns
to proper `ts.factory.create*` AST construction.

**`packages/macros/src/generic.ts` (~34 lines):**

- `expandGenericForProductType()` — replace template string + `parseStatements` with:
  - `factory.createVariableStatement` for the `genericFoo` const
  - `factory.createObjectLiteralExpression` for the `{ to, from }` object
  - `factory.createExpressionStatement` + `factory.createCallExpression` for
    `registerGenericMeta()` and `registerGeneric()` calls
  - Use `factory.createArrayLiteralExpression` instead of `JSON.stringify(fieldNames)`
- `expandGenericForSumType()` — same approach

**`packages/macros/src/hkt.ts` (~18 lines):**

- `expandTier3HKT()` — replace template string interface with
  `factory.createInterfaceDeclaration` with heritage clause, `__kind__` member, and
  `_` member whose type is the replaced RHS
- `expandTier2Companion()` — same pattern for companion interface
- `replaceUnderscoreInTypeText()` — replace regex substitution on type text with proper
  AST walking: visit type nodes and replace `_` identifiers with `this["__kind__"]`
  indexed access types

**`packages/macros/src/custom-derive.ts` (~45 lines):**

- `defineCustomDerive()` — change the callback contract from returning a code string to
  returning `ts.Statement[]` directly. Update all callers.
- `defineFieldDerive()` — build statements per-field using AST factory, collect into array
- `defineTypeFunctionDerive()` — build function declaration via
  `factory.createFunctionDeclaration` with proper parameter list and body

**`packages/macros/src/implicits.ts` (~3 lines):**

- `transformImplicitsCall()` — replace `ctx.parseExpression(resolved.instanceName)` with
  a helper that splits on `.` and builds a chain of `factory.createPropertyAccessExpression`

**Gate:**

- `cd packages/macros && npx vitest run` — all tests pass
- `cd packages/transformer && npx vitest run` — all tests pass
- `cd packages/macros && npx tsc --noEmit` — zero errors
- Grep verification: `grep -rn 'parseStatements\|parseExpression' packages/macros/src/` should
  return zero hits (excluding any legitimate parse-from-file uses in `include.ts`)
- Code review: verify all new AST construction is correct and produces identical output
  to the old string-based approach; verify no regressions in macro expansion behavior

### Wave 3: Test Coverage — Critical Macro Files

Add unit tests for the highest-complexity untested macro files. These are the core of
the macro system and bugs here propagate everywhere.

**`packages/macros/src/typeclass.ts` (~2700 LOC, complex):**

- Test instance registry: register, lookup, duplicate detection
- Test derivation strategy resolution: built-in vs custom vs fallback
- Test instance dependency sorting and cycle detection
- Test typeclass hierarchy (superclass constraints)

**`packages/macros/src/specialize.ts` (~3000 LOC, complex):**

- Test zero-cost specialization: monomorphization of generic code
- Test specialization cache: hit, miss, invalidation
- Test type parameter inference from call sites
- Test edge cases: recursive types, mutual recursion, generic constraints

**`packages/macros/src/comptime.ts` (653 LOC, medium):**

- Test constant folding and propagation
- Test build-time evaluation semantics
- Test error reporting for non-constant expressions
- Test interaction with other macros

**`packages/macros/src/implicits.ts` (605 LOC, medium):**

- Test implicit parameter resolution priority (local > import > registry)
- Test ambiguity detection and error messages
- Test type parameter inference from provided arguments
- Test `extractTypeArgFromParam()` with various type shapes

**`packages/macros/src/derive.ts` (157 LOC, simple):**

- Test sum type detection and record type derivation
- Test recursive type handling
- Test error messages for unsupported derive targets

**Gate:**

- `cd packages/macros && npx vitest run` — all tests pass including new ones
- `cd packages/macros && npx tsc --noEmit` — zero errors
- New test count: at least 60 new test cases across the 5 files
- Code review: verify tests cover the critical paths, not just happy paths;
  verify edge cases (empty inputs, malformed AST, missing registrations) are covered

### Wave 4: Test Coverage — Remaining Macro Files

Add unit tests for the remaining untested macro files. These are medium-complexity
but still important for confidence.

**Batch A — Macro expansion mechanics:**

- `operators.ts` (285 LOC) — operator rewriting for each operator type, precedence,
  typeclass resolution
- `extension.ts` (450 LOC) — extension method binding, method resolution, conflict detection
- `hkt.ts` (837 LOC) — HKT rewriting, tier detection, companion generation, underscore
  replacement
- `generic.ts` (568 LOC) — Generic instance generation for product and sum types,
  metadata registration

**Batch B — Code generation macros:**

- `custom-derive.ts` (342 LOC) — custom derive registration and expansion
- `auto-derive.ts` (~1100 LOC) — automatic derivation selection and ordering
- `tailrec.ts` (716 LOC) — tail call optimization transformation
- `quote.ts` (548 LOC) — quasi-quotation and splicing

**Batch C — Smaller macros:**

- `reflect.ts` (895 LOC) — runtime type reflection generation
- `verify-laws.ts` (458 LOC) — law verification test generation
- `static-assert.ts` (244 LOC) — compile-time assertion checking
- `cfg.ts` (254 LOC) — conditional compilation
- `config-when.ts` (144 LOC) — config-based conditional code
- `syntax-macro.ts` (379 LOC) — custom syntax macro registration
- `module-graph.ts` (375 LOC) — module dependency analysis
- `coverage.ts` (339 LOC) — coverage checking (verify the Wave 1 fixes work correctly)

**Gate:**

- `cd packages/macros && npx vitest run` — all tests pass
- `cd packages/macros && npx tsc --noEmit` — zero errors
- New test count: at least 100 new test cases across all files in this wave
- Every `.ts` file in `packages/macros/src/` (excluding `index.ts` and `runtime-stubs.ts`)
  has a corresponding `.test.ts` file
- Code review: verify no test is a pure smoke test (must assert on specific behavior);
  verify edge cases are covered for the medium-complexity files

### Wave 5: Test Coverage — Transformer-Core and LSP Edge Cases

Fill the remaining test gaps in the transformer-core and LSP packages.

**`packages/transformer-core/` — untested modules:**

- `rewriting.ts` (~1000 LOC) — AST rewriting engine: node replacement, scope handling,
  import injection, statement ordering
- `specialization.ts` (~1100 LOC) — specialization pass: monomorphization, inline
  expansion, dead code elimination
- `import-resolution.ts` (695 LOC) — import specifier resolution, re-export following,
  circular dependency detection
- `macro-helpers.ts` (671 LOC) — shared utilities used by macro implementations

**`packages/lsp-server/` — edge case tests:**

- Position mapping with Windows `\r\n` line endings (verify Wave 1 fix)
- Position mapping with files containing repeated/duplicate lines
- Diagnostic mapping when transformation fails partway through
- Rapid open/close/save cycles (race condition testing)
- Large file performance (>100KB source files)
- UTF-16 surrogate pair handling in character positions

**`packages/std/` — typeclass tests:**

- Add tests for Eq, Ord, Semigroup, Monoid instances
- Add tests for numeric-ops (gcd, lcm, pow)
- Add tests for Destructure and ParCombine typeclasses

**Gate:**

- `cd packages/transformer-core && npx vitest run` — all tests pass
- `cd packages/lsp-server && npx vitest run` — all tests pass
- `cd packages/std && npx vitest run` — all tests pass
- `cd packages/transformer-core && npx tsc --noEmit` — zero errors
- New test count: at least 80 new test cases across all packages in this wave
- Code review: verify transformer-core tests exercise real AST transformations (not
  mocked); verify LSP edge case tests reproduce the actual bugs from the review;
  verify std typeclass tests check algebraic laws (associativity, identity, etc.)

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
