# PEP-057: AST-Purity Exception List Audit — Closing the Gap Between the Rule and the Tree

**Status:** Implemented (Waves 1–6)
**Date:** 2026-07-06
**Author:** Claude (Sonnet 5), for Dean's review

## Context

Repo-root CLAUDE.md's "Code generation: prefer AST over string manipulation"
rule bans building code as template strings and reparsing it
(`ctx.parseStatements()`/`ctx.parseExpression()`) in favor of direct
`ts.factory.create*` construction, and names six specific, justified
exceptions (`typeclass.ts`'s companion/HKT text contract, `verify-laws.ts`,
`auto-derive.ts`'s disk cache, `specialize.ts`'s reflection-based primitive
intrinsics, `quote.ts`/`syntax-macro.ts`'s quasi-quote primitives, and
`transformer-core/transformer.ts`'s expression-macro cache).

PEP-056 Wave 4's gap-closing audit found this list no longer matches the
tree: at least ten call sites across eight files do the exact
string-then-reparse codegen the rule bans, with no corresponding CLAUDE.md
entry. PEP-056 Wave 5 tightened the rule itself — "the exception list above
must be exhaustive, not illustrative... a string-codegen call site with no
corresponding CLAUDE.md entry is a bug in this file, not a passable gap" —
which means those ten-plus sites became out-of-compliance with the project's
own written rule the moment that sentence was added, not just an
aspirational target.

This PEP is the scoping pass PEP-056 explicitly deferred ("needs its own PEP
or standalone pass — deliberately not folded into this one, since 'unify the
transformer' and 'bring every macro package up to the AST-purity bar' are
different-sized, differently-risky changes"). Seven parallel investigations
(one or two per file/package) read every undocumented call site and its
surrounding function, in full, to determine what each generates, why it's
stringly-typed, how hard migration actually is, and whether it has any
regression coverage today.

**Headline finding: of 15 undocumented call sites across 8 files, 13 are
recommended for outright migration (mostly straightforward, a few moderate)
and only 2 need a genuine exception entry** — the rest of the list is not
"hard cases nobody got to," it's mostly unexplained convenience from a time
before the rule existed. The bigger risk across the board is not migration
difficulty — it's **near-total absence of macro-expansion-level test
coverage** for these files today (7 of 8 files have zero or partial
`.expand()`-level tests), meaning Wave 6+ must add tests case-by-case before
or alongside migrating, not just migrate and trust vitest's existing net.

## Goal

Bring every macro package's codegen into compliance with CLAUDE.md's
AST-over-strings rule: either migrate a site to direct `ts.factory.create*`
construction, or — only where a concrete, load-bearing obstacle exists —
extend the exception list with the same justification rigor the six existing
entries use (why AST construction wasn't feasible, not "it was easier").

Non-goal: this PEP does not touch the six _already-documented_ exceptions.
Those were each individually justified in earlier PEPs/waves and are not
being re-litigated here.

## Findings by file

Each entry: call site(s), what it generates, why it's string-based, migration
difficulty, recommendation, and current test coverage.

### 1. `packages/codec/src/macros.ts` — 1 site, STRAIGHTFORWARD, tested

**Line 282**, inside `@codec`'s `expand()`. Builds
`defineSchema("Name", { version: N, fields: [...] })` by `JSON.stringify`-ing
a `FieldDescriptor` (all JSON-safe primitives — no type-checker round-trip)
into an object-literal string via `fieldToSource()` (lines 193-206), then
`ctx.parseExpression()`. No comment explains the choice; simplest read is
"convenient, not necessary."

**Migration:** straightforward. Replace `fieldToSource` with a
`fieldToObjectLiteral(f): ts.ObjectLiteralExpression` helper using
`createObjectLiteralExpression`/`createArrayLiteralExpression`/
`createStringLiteral`/`createNumericLiteral`/`createTrue`/`createFalse`, then
`ts.factory.createCallExpression(createIdentifier("defineSchema"), undefined, [...])`.

**Tests:** `packages/codec/tests/macros.test.ts` calls `codecMacro.expand()`
directly and asserts on the generated statement — a real regression check
already exists for this migration.

**Recommendation: MIGRATE.**

### 2. `packages/contracts/src/macros/laws.ts` — 2 sites, STRAIGHTFORWARD, untested

**Line 153** (`expandCompileTime`) and **line 202** (`expandPropertyTest`).
Both are unfinished scaffolding — comments literally say "In full
implementation, this would invoke the prover... Placeholder... emit debug
info if enabled" — not a deliberate string-codegen design choice. Site 1
builds a compile-time IIFE stub with a `for...of` over laws and a debug-env
guard; site 2 builds a `describe`/`it` property-test block with nested
`for` loops calling `.arbitrary()`.

**Migration:** straightforward for both — no dynamic/reflective content,
just `createFunctionExpression`/`createForOfStatement`/`createIfStatement`/
`createCallExpression` and `createExpressionStatement`/nested
`createForStatement`/`createThrowStatement`. Identifier splices
(`lawGen`, `options.eq`, `options.arbitrary`) are already resolvable as
factory-built identifiers rather than text-spliced.

**Relationship to the existing `verify-laws.ts` exception:** same category,
not a distinct case — `verify-laws.ts`'s `generateCompileTimeCheck`/
`generatePropertyTests` are near-identical unfinished scaffolds using the
identical pattern. `laws.ts` itself is _currently_ an undocumented gap next
to its own sibling's documented entry.

**Tests:** none. No test file references `laws`/`@laws`/`lawsAttribute`.

**Recommendation: MIGRATE both files together** (same category, same fix
shape) — or, if deferred past this PEP's waves, name `laws.ts` explicitly
alongside `verify-laws.ts` under one shared justification rather than
leaving it silently uncovered.

### 3. `packages/effect/src/derive/{hash,equal,schema}.ts` — 6 sites, mostly STRAIGHTFORWARD, untested

Three structurally identical files (one per derived typeclass), each with a
product-type `expand()` and a `generateSumTypeXxx()` sibling for
discriminated unions. **No shared base file exists** (`derive/index.ts` only
re-exports) — if migrated, the switch-over-discriminant scaffold and
instance-object-literal shape could be factored into one shared
`derive/codegen-common.ts` once, rather than three times.

- **hash.ts:97** (product) / **hash.ts:136** (sum) — builds
  `export const XHash: Hash.Hash<X> = { [Hash.symbol](self){ return <combine chain>; } }`,
  with per-field `Hash.combine(...)` calls joined as text by
  `generateFieldHashes`. **STRAIGHTFORWARD** — `createVariableStatement` +
  `createObjectLiteralExpression` + `createMethodDeclaration` with
  `createComputedPropertyName`, plus a small recursive combine-chain builder
  replacing the string join. Sum variant adds `createSwitchStatement`/
  `createCaseClause`/`createDefaultClause`.
- **equal.ts:85** (product) / **equal.ts:122** (sum) — same instance shape,
  body is an `&&`-chained `Equal.equals(self.f, that.f)` per field (product)
  or a discriminant guard + switch (sum). **STRAIGHTFORWARD** — reduce over
  fields with `createBinaryExpression(..., AmpersandAmpersandToken, ...)`.
- **schema.ts:228** (product) / **schema.ts:265** (sum) — builds
  `Schema.Struct({...})`/`Schema.Union(...)` plus an `Encoded` type alias.
  The **outer** declaration wrapping is straightforward
  (`createCallExpression`, `createTypeAliasDeclaration` +
  `createTypeQueryNode` for `typeof X`). But `mapTypeToSchema` — the
  recursive regex/substring parser that turns a _stringified_ field type
  (`field.typeString`, e.g. `"Record<string, number[]>"`) into a schema
  constructor call — is **MODERATE-TO-HARD**: it depends on whether
  `DeriveFieldInfo` carries a real `ts.TypeNode` upstream or only text.
  Needs an upstream check (does the type ever have a `ts.TypeNode` available
  by the time this runs?) before committing to migrating this specific
  sub-piece.

**Tests:** none. No dedicated test file for `EffectHash`/`EffectEqual`/
`EffectSchema` beyond a documentation example.

**Recommendation: MIGRATE** hash.ts and equal.ts fully (all 4 sites);
MIGRATE schema.ts's outer declaration shape, **DOCUMENT-EXCEPTION** (pending
an upstream feasibility check) for `mapTypeToSchema`'s leaf-type mapping
specifically, not the whole file.

### 4. `packages/parser/src/macros.ts` (+ `codegen.ts`) — 1 site in macros.ts, MODERATE, partially tested

**Line 96** in `macros.ts`: `ctx.parseExpression(generateParserCode(rules))`.
The real codegen lives entirely in `packages/parser/src/codegen.ts`'s
`emitRule`/`emitLiteral`/`emitSequence`/`emitAlternation`/`emitRepetition`/
`emitOptional`/`emitNegation`/`emitLookahead`/`emitReference` — nine
string-concatenation functions building a giant IIFE of recursive-descent
parser functions compiled from a PEG grammar IR, plus a `JSON.stringify`'d
rules map. File header frames this as "zero-cost, no runtime grammar
interpretation" — a real design goal, but string-templating was the path of
least resistance for the code generator itself, not a stated hard
constraint.

**Migration:** moderate — mechanical but sizeable (9 emit functions, each
recursive). No dynamic type parameters or generics; each `emit*` maps
fairly directly to `createIfStatement`/`createReturnStatement`/
`createCallExpression`/`createFunctionExpression`/`createForStatement`/
`createWhileStatement`. The `JSON.stringify(rule)` embedding needs a small
recursive value-to-AST-literal builder instead.

**Tests:** `codegen.test.ts` exercises `generateParserCode()`'s string
output via `new Function(...)` eval (real coverage of the _generation_
logic, though not via the AST/printer path); `grammar.test.ts` exercises the
runtime tag, not the compile-time macro path. **No test drives the actual
macro-transformer expansion** (the `ctx.parseExpression` splice point
itself) — that needs a net-new fixture test.

**Recommendation: MIGRATE**, but budget for it as the single largest item
in this PEP — 9 emit functions is real surface area, not "flip a few
factory calls."

### 5. `packages/sql/src/derive-typeclasses.ts` — 2 sites, STRAIGHTFORWARD, untested

**Line 300** and **line 436**: `ctx.parseExpression(m.getExpr)` /
`ctx.parseExpression(m.putExpr)`, where `getExpr`/`putExpr` come from
`getGetInstanceForType`/`getPutInstanceForType` (lines 68-149) — twin
functions building `Get.<primitive>`/`Get.nullable(...)`/`Put.<x>`
instance-reference expressions via nested template interpolation instead of
returning `ts.Expression` directly.

**Migration:** straightforward — change both functions' return type from
`string | null` to `ts.Expression | null`, replacing string concatenation
with `createPropertyAccessExpression`/`createCallExpression`. A third
sibling, `getMetaInstanceForType` (lines 154-192), shares the exact pattern
but is currently dead code (no call site reparses it) — worth fixing in the
same pass for consistency even though it's not itself a `parseExpression`
site today.

**Tests:** none. `sql.test.ts`/`sql-extended.test.ts` exercise `Read.make`/
`Write.make` at runtime but never invoke `@deriving(Read|Write|Codec)` or
the macro-expansion path.

**Recommendation: MIGRATE** (including the currently-dead
`getMetaInstanceForType` for consistency).

### 6. `packages/macros/src/typeclass.ts` — 2 previously-unnamed sites, STRAIGHTFORWARD / MODERATE, mixed coverage via companion tests

The existing CLAUDE.md entry names `companionCode`/`assignCode`/
`fullSignatureText` — confirmed still accurate, no drift. Two sites are not
named:

- **Line 2460**, `summonMacro`'s `expand()`:
  `ctx.parseExpression(scopeResult.exportName)` — turns a bare (possibly
  dotted) resolved identifier string into an expression. **STRAIGHTFORWARD**
  — `createIdentifier`, or a dotted-name split into
  `createPropertyAccessExpression` chains.
- **Line 2607**, `extendMacro`'s `expand()`: builds
  `` `${tcName}.summon<${typeName}>("${typeName}").${methodName}(${allArgs})` ``
  then reparses — a generic-typed call chain where `allArgs` is
  `.getText()` of already-real AST argument nodes. **MODERATE** — not a
  fundamental blocker, just multi-level nested factory construction
  (`createCallExpression` with `typeArguments`, nested property-access +
  call); migrating would let the already-real arg nodes be passed directly
  instead of stringified-then-reparsed, which is a correctness improvement
  over today's behavior, not just parity.

**Recommendation: MIGRATE** both; extend/rename nothing in the existing
three-item exception entry (those remain correctly documented as-is).

### 7. `packages/testing/src/macro.ts` — 7 sites, mixed difficulty, 1 of 7 tested

The widest-ranging file in this audit. All seven macros
(`assertMacro`, `ArbitraryDerive`, `testCasesAttribute`, `forAllMacro`,
`assertTypeMacro`, `mockAttribute`, `mockExpressionMacro`) build a full
statement/expression skeleton as a template string and reparse, then splice
real sub-expressions back in via `factory.update*` — an explicit comment at
one site says exactly this: "We build this as a string and parse it, then
splice in the real expression nodes."

- **Line 210** (`assertMacro`) — power-assert tree-diagram algorithm,
  fixed ~50-line skeleton. **MODERATE** (mechanical, verbose).
- **Line 359** (`ArbitraryDerive`) — per-field generator snippets as text
  (e.g. `"(_rng() * 200 - 100)"`). **MODERATE.** The only site with direct
  `.expand()`-level test coverage today (`testing.test.ts`).
- **Line 490** (`testCasesAttribute`) — the worst offender in the whole
  audit: prints an already-real AST body (`target.body.statements`) back to
  text, **strips braces with regex**, then reassembles and reparses — doing
  work that's not just avoidable but actively violates a second rule
  (no-regex-on-generated-code) for no reason, since the statements are
  already AST nodes sitting right there. **STRAIGHTFORWARD** and highest
  priority in this file.
- **Line 709** (`forAllMacro`) — same skeleton-then-patch pattern, 3 splice
  points already isolated via `factory.update*`. **STRAIGHTFORWARD/MODERATE.**
- **Line 948** (`assertTypeMacro`) — same pattern plus `typeName`
  interpolated into error-message string literals. **MODERATE.**
- **Lines 1224 & 1327** (`mockAttribute`, `mockExpressionMacro`) — the one
  real obstacle in this file: method signatures come from
  `typeChecker.typeToString()` as text, embedded into generic type
  arguments. Fixable — `typeChecker.typeToTypeNode()` exists and is unused
  — but is genuine type-to-AST work, not mechanical text splicing.
  **MODERATE.**

**Tests:** only `ArbitraryDerive.expand()` is exercised directly with
assertions on output; the other six are exercised only via
registration/metadata checks, never `.expand()` invocation. **A migration
of the other six would have zero regression coverage today.**

**Recommendation: MIGRATE all seven**, but sequence `testCasesAttribute`
(line 490) first — it's both the easiest fix and the most clearly wrong
code (regex-stripping braces off AST-derived text), and add an
`.expand()`-level test per macro before or alongside each migration, not
after.

## Implementation plan

Sequenced by (a) existing test coverage — migrate what's already checked
first, build confidence, then tackle untested surface with new tests
alongside; (b) difficulty — straightforward sites before moderate ones,
moderate before the two genuine DOCUMENT-EXCEPTION candidates.

### Wave 1: Already-tested, straightforward — prove the pattern

- [x] `packages/codec/src/macros.ts` (1 site) — real test coverage exists;
      use this as the template migration other waves can be checked against.
- [x] `packages/testing/src/macro.ts` line 490 (`testCasesAttribute`) —
      highest-priority fix in the file (regex-on-AST-text is actively wrong,
      not just non-compliant); add an `.expand()`-level test as part of this
      wave, since none exists today.

**Gate:** both migrations produce output byte-identical (module diagnostics
aside) to today's string-based output on their existing/new test fixtures;
full workspace suite green.

### Wave 2: Untested straightforward sites — sql, contracts, typeclass.ts

- [x] `packages/sql/src/derive-typeclasses.ts` (2 sites + the dead
      `getMetaInstanceForType` sibling) — add a macro-expansion fixture test
      first (none exists), then migrate.
- [x] `packages/contracts/src/macros/laws.ts` (2 sites) — migrate alongside
      or ahead of `verify-laws.ts`'s identical-shape sites (out of this
      PEP's direct scope but flagged as the same category — worth doing
      together if `verify-laws.ts` is ever revisited, otherwise name
      `laws.ts` explicitly in CLAUDE.md as sharing that entry).
- [x] `packages/macros/src/typeclass.ts` lines 2460 (straightforward) and
      2607 (moderate) — add coverage for `summonMacro`/`extendMacro`'s
      expansion output if the existing typeclass test suite doesn't already
      assert on it precisely.

**Gate:** new fixture tests added and green; full workspace suite green.

### Wave 3: `effect` derive macros — hash.ts, equal.ts fully; schema.ts's outer shape

- [x] `packages/effect/src/derive/hash.ts` (2 sites) and `equal.ts`
      (2 sites) — migrate fully; factor the shared switch/instance-object
      scaffold into one `derive/codegen-common.ts` helper used by both
      (and left ready for `schema.ts` to adopt where applicable) rather
      than duplicating the fix three times.
- [x] `packages/effect/src/derive/schema.ts`'s outer declaration shape
      (product + sum) — migrate the `Schema.Struct`/`Schema.Union`/
      `Encoded`-alias wrapping.
- [x] Add `.expand()`-level tests for all three macros — none exist today.
- [x] Resolve `mapTypeToSchema`'s feasibility question: does
      `DeriveFieldInfo` (or whatever produces `field.typeString`) have
      access to a real `ts.TypeNode` at the point `schema.ts` runs? If yes,
      migrate `mapTypeToSchema` too, in this wave. If no, this is the
      wave's one genuine **DOCUMENT-EXCEPTION** candidate — add it to
      CLAUDE.md with the same rigor as `specialize.ts`'s reflection
      exception (why a type-string round-trip is the only option here,
      not just convenient).

**Gate:** hash.ts/equal.ts fully migrated with new tests green;
schema.ts's outer shape migrated; `mapTypeToSchema` either migrated or has
a written CLAUDE.md exception entry — not left silently undocumented
either way; full workspace suite green.

### Wave 4: `parser` — the large one

- [x] `packages/parser/src/codegen.ts`'s nine `emit*` functions — migrate to
      direct AST construction. Budget this as its own wave: 9 recursive
      functions, not a small diff.
- [x] `packages/parser/src/macros.ts` line 96 — update the single call site
      once `codegen.ts` returns a `ts.Expression` instead of a string.
- [x] Add a macro-expansion-level test (`grammar` tag through the actual
      compile-time transform path) — today's `codegen.test.ts` only
      exercises the generator function directly via `new Function(...)`
      eval, not the real splice point.

**Gate:** parser test suite green including the new macro-expansion fixture;
generated-parser runtime behavior unchanged (existing `grammar.test.ts`
still passes against migrated output); full workspace suite green.

### Wave 5: `testing/macro.ts`'s remaining six macros

- [x] `assertMacro` (line 210), `ArbitraryDerive` (line 359, already has
      partial coverage — extend it), `forAllMacro` (line 709),
      `assertTypeMacro` (line 948) — migrate; add `.expand()`-level tests
      for the four that currently have none.
- [x] `mockAttribute`/`mockExpressionMacro` (lines 1224, 1327) — the one
      real complexity in this PEP's testing-package scope: switch
      `typeChecker.typeToString()` to `typeChecker.typeToTypeNode()` so
      generic type arguments are built from real type nodes instead of
      text, then migrate the rest mechanically.

**Gate:** all seven `testing/macro.ts` macros migrated, each with an
`.expand()`-level regression test; full workspace suite green.

### Wave 6: Update CLAUDE.md and close the loop

- [x] Update CLAUDE.md's exception list: remove `laws.ts` from being an
      implicit sibling-gap (either it's migrated by Wave 2 and needs no
      entry, or it's explicitly named); add `mapTypeToSchema`'s entry if
      Wave 3 determined it's a genuine exception; re-grep the whole repo
      for `parseStatements`/`parseExpression` one final time to confirm
      zero undocumented call sites remain.
- [x] Update this PEP's status to Done, with a final tally of
      migrated-vs-documented-exception counts.

**Gate:** a repo-wide grep for `parseStatements`/`parseExpression` call
sites, cross-checked by hand against CLAUDE.md's exception list, finds
zero unaccounted-for sites — the rule the previous PEP wrote and the tree
finally agree.

## Files Changed

| File / Package                                                | Change                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/codec/src/macros.ts`                                | `fieldToSource` → AST-literal builder (Wave 1)                                                            |
| `packages/testing/src/macro.ts`                               | All 7 macros migrated off string-then-reparse (Waves 1, 5); new `.expand()`-level tests                   |
| `packages/sql/src/derive-typeclasses.ts`                      | `getGetInstanceForType`/`getPutInstanceForType`/`getMetaInstanceForType` return `ts.Expression` (Wave 2)  |
| `packages/contracts/src/macros/laws.ts`                       | Both scaffold sites migrated, or explicitly named alongside `verify-laws.ts`'s entry (Wave 2)             |
| `packages/macros/src/typeclass.ts`                            | `summonMacro`/`extendMacro` migrated (Wave 2); existing 3-item exception entry unchanged                  |
| `packages/effect/src/derive/hash.ts`, `equal.ts`, `schema.ts` | Migrated; new shared `derive/codegen-common.ts` helper; `mapTypeToSchema` migrated or documented (Wave 3) |
| `packages/parser/src/codegen.ts`, `macros.ts`                 | Nine `emit*` functions migrated to AST construction (Wave 4)                                              |
| `CLAUDE.md`                                                   | Exception list updated to match final state (Wave 6)                                                      |

## Consequences

### Benefits

1. **Closes a rule the codebase itself now treats as load-bearing.** Wave 5
   of PEP-056 made "the exception list must be exhaustive" an explicit,
   quotable rule; this PEP is what makes that statement true rather than
   aspirational.
2. **Fixes one actively-wrong pattern, not just a style violation.**
   `testCasesAttribute`'s regex-stripped-braces reconstruction of an
   already-real AST body is fragile in a way plain non-compliance isn't —
   it can break on formatting the regex didn't anticipate.
3. **Adds macro-expansion-level test coverage that mostly doesn't exist
   today.** 7 of 8 files in this audit have zero or partial `.expand()`-level
   tests for the sites in question — every migration wave doubles as a test
   debt paydown, not just a refactor.
4. **`mockAttribute`/`extendMacro`'s migrations are correctness
   improvements, not just parity** — both currently stringify real AST
   nodes (`typeToString()`, `.getText()`) and reparse them, which is
   strictly more fragile than using the real nodes directly.

### Risks

1. **`parser`'s codegen.ts is genuinely large** (9 recursive emit
   functions) — Wave 4 is the one wave where "moderate difficulty" could
   still mean a multi-day effort, not an afternoon.
2. **Near-zero existing test coverage means migrations are trusted on new
   tests, not existing ones** — for most files in this audit, a
   byte-for-byit behavioral regression could ship undetected unless the new
   fixture tests are written carefully to assert on the actually-meaningful
   shape (not just "it doesn't throw").
3. **`schema.ts`'s `mapTypeToSchema` migration depends on an upstream
   question not yet answered** (does `DeriveFieldInfo` carry a real
   `ts.TypeNode`?) — Wave 3 could stall on this if the answer is no and a
   bigger upstream refactor is required to unblock it cleanly.

## Implementation status & final tally

All six waves landed in a single pass (branch `pep-057-ast-purity-audit`),
executed as seven independent parallel workstreams (one per package/file
group, since none of them shared a file) rather than strictly sequential
PRs — the wave numbering above is preserved for traceability but all landed
together.

**21 string-then-reparse call sites migrated to direct `ts.factory.create*`
construction**, across 8 files in 7 packages:

- `packages/codec/src/macros.ts` — 1 site (reused the existing
  `jsValueToExpression` utility from `@typesugar/core` instead of
  hand-rolling a new object-literal builder).
- `packages/testing/src/macro.ts` — 7 sites (all seven macros:
  `assertMacro`, `ArbitraryDerive`, `testCasesAttribute`, `forAllMacro`,
  `assertTypeMacro`, `mockAttribute`, `mockExpressionMacro`).
  `testCasesAttribute`'s regex-on-AST-text bug is gone — real statement
  nodes are spliced directly. `mockAttribute`/`mockExpressionMacro` now use
  `typeChecker.typeToTypeNode()` instead of `typeToString()`.
- `packages/sql/src/derive-typeclasses.ts` — 2 sites
  (`getGetInstanceForType`/`getPutInstanceForType`) plus the dead sibling
  `getMetaInstanceForType`, migrated for consistency (confirmed genuinely
  unreferenced via repo-wide grep).
- `packages/contracts/src/macros/laws.ts` — 2 sites
  (`expandCompileTime`/`expandPropertyTest`) — migrated in full rather than
  folded into the sibling `verify-laws.ts` exception.
- `packages/macros/src/typeclass.ts` — 2 sites (`summonMacro`, `extendMacro`)
  — the pre-existing `companionCode`/`assignCode`/`fullSignatureText`
  exception entry is untouched and still accurate. `extendMacro` now reuses
  the real receiver/argument AST nodes instead of `.getText()`-then-reparse,
  a correctness improvement over the prior behavior.
- `packages/effect/src/derive/{hash,equal,schema}.ts` — 6 sites. Shared
  scaffold factored into a new `packages/effect/src/derive/codegen-common.ts`.
  `schema.ts`'s outer declaration shape (the `Schema.Struct`/`Schema.Union`
  calls and `Encoded` type alias) is fully AST-built.
- `packages/parser/src/codegen.ts` (9 `emit*` functions) +
  `packages/parser/src/macros.ts` (1 call site) — the largest single
  workstream. `codegen.ts` now imports `typescript`, so its runtime
  re-export was dropped from `packages/parser/src/index.ts` (the `.` entry)
  to preserve PEP-050's runtime-purity guarantee; `generateParserCode` is
  now only reachable via the build-time `./macros` entry.

**1 new genuine CLAUDE.md exception added** (not a deferral — a concrete,
investigated finding): `packages/effect/src/derive/schema.ts`'s
`mapTypeToSchema`/`splitGenericArgs`. Confirmed `DeriveFieldInfo` carries
only `typeString: string` and a checker `ts.Type` — no `ts.TypeNode` — so
there is no tree to recurse over structurally without an upstream change to
`extractTypeInfo` in `transformer-core/src/macro-helpers.ts`. Everything
else in `schema.ts` is AST-built; the exception is scoped to those two
functions only.

**`laws.ts`** needed no CLAUDE.md naming after all — it was migrated
outright in this pass rather than left as an implicit sibling gap next to
`verify-laws.ts`'s documented exception.

**Test coverage added:** every migrated macro gained (or extended) a
genuine `.expand()`-level regression test — `packages/testing` went from 44
to 54 tests (6 newly-covered macros), `packages/sql` gained a net-new
`derive-typeclasses.test.ts` (6 tests, none existed before),
`packages/contracts` gained `laws.test.ts` (11 tests), `packages/effect`
gained `derive-codegen.test.ts` (10 tests), `packages/parser` gained a
macro-expansion-level fixture test exercising the real compile-time
transform path (previously untested), and `packages/macros/src/typeclass.ts`
gained direct `.expand()` coverage for `summonMacro`/`extendMacro`.

**Verification:** full `pnpm build` clean across all packages; full
workspace `vitest run` green — 7307 passed, 38 skipped (pre-existing,
unrelated), 0 failures, 271/272 test files passed. Final repo-wide grep for
`ctx.parseStatements`/`ctx.parseExpression` call sites, cross-checked by
hand against CLAUDE.md's exception list: every remaining hit resolves to an
already-documented exception (`transformer-core/transformer.ts`,
`verify-laws.ts`, `auto-derive.ts`, `quote.ts`, `syntax-macro.ts`,
`typeclass.ts`'s `companionCode`/`assignCode`, and the new
`schema.ts`/`mapTypeToSchema` entry) — **zero unaccounted-for sites**. The
rule the previous PEP wrote and the tree now agree.

## Follow-up pass: raw `ts.createSourceFile` sites outside the ctx.parse* gate

The repo-wide grep above only catches `ctx.parseStatements`/`ctx.parseExpression`
(the `MacroContext` wrapper methods) by construction — it can't see a raw
`ts.createSourceFile(...)` call that builds-then-reparses text through a
different mechanism entirely. A follow-up pass (same session, after the PR
above was opened) checked every remaining raw `ts.createSourceFile` call
site in non-test source by hand. Four were real findings, not noise:

1. **`packages/macros/src/hkt.ts`'s `resolveTypeConstructorViaTypeCheckerUncached`**
   — **migrated, not a hard case.** Built `` declare const __x: ${base}<any>; ``,
   reparsed it, and only ever checked that the parse produced *some*
   `TypeReferenceNode` before calling `checker.resolveName(base, ...)` with
   the same `base` string regardless of what the parse found — the parsed
   tree was never consulted for content. Deleted the reparse entirely;
   `checker.resolveName` takes a plain string. Added direct test coverage
   (`resolveTypeConstructorViaTypeChecker` had none before — only indirect
   coverage via the unrelated `@hkt`/`_`-marker expansion tests).

2. **`packages/transformer/src/arrow-comprehension-preprocess.ts`** —
   **genuine exception, added to CLAUDE.md.** The file's own doc comment
   already called itself "a deliberate exception to the CLAUDE.md rule" —
   it just was never actually added to CLAUDE.md's list. A `let:/yield:`
   comprehension in expression position produces an error-recovered AST too
   fragile to patch with `ts.factory.update*`, so the fix has to happen on
   raw source text (via `MagicString`) before the real parse. This is
   textbook "a file claims an exception for itself that isn't in CLAUDE.md's
   list, which is exactly the bug CLAUDE.md itself warns about."

3. **`packages/transformer/src/hkt-rewriter.ts`** — **migrated.** Rewrites
   `F<A>` → `Kind<F, A>` before `ts.Program` creation (must run pre-checker,
   since the checker itself throws TS2315 on `F<A>`). The outer
   `MagicString`-patch-before-Program mechanism is unavoidable for the same
   reason as #2 — but the *replacement text* itself was being hand-built via
   `` `Kind<${name}, ${args.join(", ")}>` `` string concatenation over
   `node.getText()` slices. Rebuilt via `ts.factory.createTypeReferenceNode` +
   `ts.visitEachChild` (context obtained via a throwaway `ts.transform`
   pass, matching the pattern `packages/macros/src/hkt.test.ts` already uses
   for the same need), reusing the real matched type-argument nodes and
   printing only the small replacement node — not the whole file. Added 3
   new tests exercising nested targets (`F<G<A>>`), targets nested inside a
   non-target generic (`Array<F<A>>`), and multi-argument targets.

4. **`packages/transformer/src/dts-transform.ts`** — **migrated, with one
   narrow new exception.** Post-compile `.d.ts` rewriter erasing
   `@opaque`-tagged interfaces into type aliases. Migrated the whole
   declaration shape to `ts.factory.createTypeAliasDeclaration`, reusing the
   real interface's name/type-parameters/modifiers directly instead of
   hand-formatting `` `${exportKw}${declareKw}type ${name}${typeParams} = ${underlyingType};` ``.
   The one irreducible holdout: the `@opaque` JSDoc tag's *value* (e.g.
   `A | null`) is free-form type syntax a human wrote inside a comment, with
   no attached tree anywhere upstream — same category as `typeclass.ts`'s
   `fullSignatureText` and `effect/schema.ts`'s `mapTypeToSchema`. Documented
   as a new, narrowly-scoped CLAUDE.md exception
   (`parseOpaqueTypeExpression` only). **Caught a real bug in the process**:
   the first version of this migration didn't strip positions off the
   type node parsed from the JSDoc tag's temporary wrapper source file,
   which made the printer slice the *actual* `.d.ts` file's text using
   position offsets that were only valid against the temporary wrapper —
   silently splicing in unrelated bytes from wherever those offsets landed
   in the real file. Caught by the existing `dts-transform.test.ts`
   multi-interface test failing with visibly garbled output; fixed with
   `stripPositions` (`@typesugar/core`), the same fix `ctx.parseExpression`
   itself already applies for the identical reason.

CLAUDE.md now has two new documented exceptions from this pass
(`arrow-comprehension-preprocess.ts`, `dts-transform.ts`'s
`parseOpaqueTypeExpression`) and a new second list category ("pre-`Program`
source-text rewrites") distinguishing this mechanism from the
`ctx.parseStatements`/`ctx.parseExpression` list, with its own "must be
exhaustive" restatement so this class of gap doesn't silently recur.

Full `pnpm build` + full `vitest run` re-verified green after this pass:
7315 passed (8 new), 38 skipped (unchanged, pre-existing), 0 failures,
271/272 files. `npx prettier --check .` clean.
