# Architecture "slop" review of the compile-time engine — 2026-11

**Branch:** `arch-slop-review-2026-11` · **Baseline:** `main` at `218278b1` · **Author:** Claude Opus 5.5, for Dean's review

Read-only review of `packages/core`, `packages/macros`, `packages/transformer-core` and
`packages/transformer`, with `packages/std` and `packages/fp` covered by a delegated pass
(section S). It looks for repeated or near-duplicate code, parallel abstractions, dead or
orphaned exports, hand-rolled copies of existing helpers, inconsistent sibling modules, and
comments/docs that drifted from the code. Nothing here changes code.

The correctness audit on `fable-correctness-audit`
(`audit/FABLE-AUDIT-2026-11.md`, findings F1–F25, S1–S6) is the baseline: its bugs are not
re-reported, but several of them are cited below as **evidence** that a duplication is
load-bearing, because the bug lives in one copy of something that exists two or more times.

> **Coordinate with the fix thread.** An Opus thread is fixing F1–F25 in the
> `fable-correctness-audit` worktree, touching `specialize.ts`, `specialization.ts`,
> `instance-extraction.ts`, `instance-resolver.ts`, `rewriting.ts`, `method-sugar.ts`,
> `transformer.ts`, `auto-derive.ts` and `typeclass.ts`. Every finding that touches one of
> those files is marked **[coordinate]**: the recommendation is a shape for that thread to
> fix _toward_ (so a point fix lands in every copy), not a standalone refactor to start now.

## Summary

| Tier                                                                     | Findings | Of which new confirmed bugs |
| ------------------------------------------------------------------------ | -------- | --------------------------- |
| A — drift has already produced a bug (confirmed or audit-proven)         | 7        | 4 (B1–B4) + 3 in std (S1)   |
| B — a pending fix will land in only one of several copies                | 7        | 0 (2 plausible)             |
| C — size / maintenance (dead code, oversized modules, re-rolled helpers) | 9        | 0                           |
| D — documentation and comment drift                                      | 4        | —                           |
| S — `std` / `fp` (delegated pass, spot-checked)                          | 12       | 3 (in S1) + 1 purity leak   |
| **Total**                                                                | **39**   |                             |

**New bugs found through the duplication lens** (not in the Fable audit; hand these to the
fix thread or a follow-up):

| ID  | Bug                                                                                                                                                                                          | Evidence                    | Lives in                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------ |
| B1  | Early-return flattening silently **drops side-effect statements** inside nested `if` branches: `if (c) { log(a); return a; } return b;` → `c ? a : b`.                                       | Probe against built `dist`. | `specialize.ts` (A3) **[coordinate]**            |
| B2  | A user's **own local decorator named like a macro is hijacked**: `function reflect(t){…}  @reflect class A {}` → decorator removed, `__A_meta__` emitted.                                    | Probe via `transformCode`.  | `transformer.ts:1513-1518` (A1) **[coordinate]** |
| B3  | Arrow-body **`par:`/`all:` comprehension emits syntactically broken code with no diagnostic**: `const __letyield_0 = par, { a }; << x; …`.                                                   | Probe via full pipeline.    | label vocabulary drift (A4) **[coordinate]**     |
| B4  | `"use no typesugar operators"` and `"use no typesugar typeclasses"` are **documented but no-ops**; operators are gated by `extensions`; JSDoc `@derive` ignores `"use no typesugar derive"`. | `git grep`: zero consumers. | opt-out feature names (A5)                       |

**Top consolidations** (by bug risk, then size):

1. **One attribute-macro dispatcher** for decorators and JSDoc tags (A1) — ~10 behavioural
   divergences today, two of them bugs (F25, B2).
2. **One "value reference" identifier visitor** shared by inlining substitution, free-identifier
   checks and dictionary-call rewriting (A2) — the root shape behind F7, F9, F10 and F24.
3. **One blocking-statement walker** for inline classification and flattening (A3) — six
   copies of the same disjunction; B1 is the drift.
4. **Program-scoped, symbol-keyed registries** instead of eight bare-name maps shared across
   files (B·1) — F14 and F12 are two instances of one pattern.
5. **One import table + one instance-scope walk** (B·2, B·3) — F16, F17 and S1 each need the
   same fix in two or three walkers.

## Method

1. **Mechanical pass.** `pnpm install` + `pnpm build` (workspace concurrency 4), then:
   - `jscpd@4` over the four engine packages, tests excluded, at `--min-lines 8 --min-tokens 70`
     (exact: **17 clones, 237 lines, 0.73 %**) and `--mode weak --min-lines 5 --min-tokens 50`
     (**61 clones, 705 lines, 2.28 %**); same over `std`+`fp` (**31 clones, 533 lines**).
   - `knip@5` with a temporary config (outside the repo), first ignoring then including entry
     exports, and a `git grep -w` cross-check of every candidate against all `*.ts` in the repo
     (tests included). Result: **45 exports with no reference outside their own file and
     `index.ts`**, 16 of them with no reference **at all** (dead code), the rest export-only.
2. **Reading.** Every hot spot in the brief, plus whatever the clones and the knip list led to.
   Four suspicions were checked with throwaway probe scripts against the built packages
   (`/tmp/arch-review/scripts/*.mjs`, not committed).
3. **Delegated pass** over `std` and `fp` (a separate Opus agent with the jscpd/knip output),
   with its top claims spot-checked here (section S).

The engine has **little verbatim copy-paste**: jscpd finds under 1 % exact duplication. The
slop is **semantic**: walkers, dispatchers, registries and resolution paths that solve the same
problem two or three times with slightly different rules, where a fix to one copy does not
reach the others. That is why this report leans on reading, and why the ranking uses bug
history rather than line counts.

---

## Tier A — drift has already produced a bug

### A1 — Two attribute-macro dispatchers: decorators vs JSDoc tags **[coordinate]**

**Copies**

- Decorator path: `MacroTransformer.tryExpandAttributeMacros`, `packages/transformer-core/src/transformer.ts:1451-1586`.
- JSDoc path: `tryExpandJSDocMacros`, `packages/transformer-core/src/macro-helpers.ts:103-208`, called from `transformer.ts:1032-1037`.

PEP-052's own note (`peps/PEP-052-…md:650-652`) said "unifying the maps requires unifying the
dispatchers". Wave 8 unified the `JSDOC_MACRO_TAGS` maps; the dispatchers were never unified.
They differ in at least ten ways:

| Behaviour                     | Decorator path                                               | JSDoc path                                        |
| ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| Macro lookup                  | `resolveMacroFromSymbol(...) ?? globalRegistry.getAttribute` | `globalRegistry.getAttribute` only                |
| Hygiene scope around `expand` | `ctx.hygiene.withScope(...)`                                 | none                                              |
| `expandAfter` ordering        | `sortDecoratorsByDependency`                                 | tag order                                         |
| `"use no typesugar derive"`   | honoured (`:1489-1495`)                                      | ignored (only `"macros"`, `macro-helpers.ts:108`) |
| `@derive` target              | pristine `node` (comment `:1500-1503` explains why)          | `currentNode` after earlier tags rewrote it       |
| Result re-visited             | yes (`:1572-1578`)                                           | **no** → F25                                      |
| `preserveSourceMap`           | yes (`:1579`)                                                | no                                                |
| Expansion tracking            | `expansionTracker.recordExpansion` (`:1539-1549`)            | none (JSDoc expansions are not recorded)          |
| Failure handling              | error + `createMacroErrorStmt`, decorator kept               | error "may be transient — try saving again"       |
| Extra results                 | filtered to statements                                       | pushed unfiltered                                 |

**Why it matters.** F25 (operator sugar skipped inside `@impl` bodies) is row 6. **B2** is row
1 seen from the other side: `resolveSymbolToMacro` (`import-resolution.ts:384-466`) carefully
returns `undefined` for "a local declaration that happens to share a macro's name", and the
decorator path's `?? globalRegistry.getAttribute(macroName)` (`transformer.ts:1513-1518`)
undoes that. Probe:

```ts
function reflect<T>(target: T): T {
  return target;
}
@reflect
class A {
  x = 1;
}
// output: class A { x = 1; }  +  export const __A_meta__ = { name: "A", … }   (user's decorator gone)
```

The JSDoc path's "pristine node" gap (row 5) is unprobed: `/** @adt … @derive Eq */` would hand
`@derive` a node an earlier tag already rewrote, which is exactly what the decorator path's
comment says breaks `extractTypeInfo`.

**Recommendation.** One `expandAttributeSources(node, sources)` where a source is
`{ macroName, args, anchor, identNode? }`, produced either from decorators (`parseDecorator`) or
from JSDoc tags (`parseJSDocMacroArgs`). Lookup is always `resolveMacroFromSymbol` with **no**
bare-registry fallback for symbol-backed sources (JSDoc tags have no symbol and keep the
import-gated `fallbackNameLookupWithImports`). Then sort, hygiene-scope, track, re-visit and
map once. **Size:** about −150 lines. **Risk:** medium (it touches every attribute macro), so
land it with F25's fix, which already has to re-visit JSDoc results. Note the Fable audit's
S5 (why `comptime` still expands inside `@impl` bodies) before changing the re-visit.

### A2 — Three identifier walkers disagree on which identifiers are references **[coordinate]**

**Copies**

- `substituteParams`, `packages/macros/src/specialize.ts:828-854`: replaces **every**
  `Identifier` whose text matches a parameter. No position awareness.
- `isSafeToInlineMethod`, `packages/macros/src/instance-extraction.ts:451-510`: skips type
  nodes, `PropertyAccessExpression.name`, `PropertyAssignment.name` (unless computed) and
  method names.
- `hasOnlySafeFreeIdentifiers` + `collectLocallyDeclaredNames`, `specialize.ts:584-621`: skips
  only `PropertyAccessExpression.name`.
- `rewriteDictCallsForAutoSpec`, `packages/transformer-core/src/specialization.ts:148-180`:
  recognises only `dict.method(...)` **calls** as uses of the dictionary parameter.
- (std) `collectReferencedIdentifiers`, `packages/std/src/macros/comprehension-utils.ts:364`,
  counts property names (S12).

**Why it matters.** The "which identifier occurrences are value references to binding X?"
question is answered four ways. F24 (property names rewritten), F9 (shorthand property
rewritten), F7 (inner binder captures a call-site name) and F10 (dictionary parameter used as a
value dangles) are each a walker that lacks a rule a sibling walker already has. The
`isSafeToInlineMethod` rules are the most complete; `substituteParams` has none of them.

The checker-free `hasOnlySafeFreeIdentifiers` is a **documented, deliberate** divergence (it
runs on reflected `primitives.ts` text with no `Program`; `specialize.ts:575-583` and
CLAUDE.md). Keep it separate in _how it resolves_ a name, but share the _which positions are
references_ rule.

**Recommendation.** A core helper `forEachValueReference(node, visit)` that yields identifiers
in value position only: it skips property names in access/assignment/method/shorthand-key
position (and reports shorthand properties so a substitution can expand `{ x }` to `{ x: arg }`),
type nodes, binding names, labels, and tracks binders so a caller can do capture-avoiding
substitution. The audit's suggested fix for group A ("substitute by symbol, not identifier
text") needs exactly this walker; build it once and use it in all four places. **Size:** +80 /
−60 lines. **Risk:** medium; it changes inlining output, which is the point.

### A3 — Inline-classification walkers: six copies of one blocking-statement rule **[coordinate]**

**Copies** (all in `packages/macros/src/specialize.ts`)

- `classifyInlineFailureDetailed` top level, `:937-963`
- `checkNestedStatements` block branch `:1028-1050` and single-statement branch `:1053-1066`
- `analyzeForFlattening` top level, `:1142-1175`
- `checkNestedForFlattening` block branch `:1195-1216` and single-statement branch `:1218-1231`

Each repeats the same `try` / five-loop-kinds / `throw` / non-`const` disjunction.

**Why it matters — B1.** `analyzeForFlattening` rejects `ExpressionStatement`s at top level
(`:1164-1168`, with a comment saying flattening cannot preserve them), but
`checkNestedForFlattening` does not, and `flattenStatements` then **skips** them (`:1378-1381`,
"They'll be handled by the IIFE wrapper if needed" — they are not). Probe against the built
package:

```ts
function f(c, a, b) {
  if (c) {
    log(a);
    return a;
  }
  return b;
}
// classifyInlineFailureDetailed → { reason: "early return (flattenable)", canFlatten: true }
// flattenReturnsToExpression    → c ? a : b        (log(a) is gone)
```

This is reachable from instance-method inlining (`inlineFromNode`, `specialize.ts:803-809`, i.e.
`===` sugar) and from Result-algebra specialization (`specialization.ts:561-566`). The walkers
also share blind spots: none descends into `switch`, labelled statements or bare nested
blocks, so `{ switch (x) { case 1: return a } return b }` classifies as a plain single return
(harmless today only because `inlineFromNode` then wraps everything in an IIFE).

**Recommendation.** One recursive `findBlockingStatement(stmts, { rejectExpressionStatements })`
visitor used by all four entry points, descending into every statement container.
**Size:** about −110 lines. **Risk:** low; behaviour only gets stricter.

### A4 — Comprehension label vocabulary hard-coded in seven places **[coordinate]**

**Copies**

| Where                                                                           | Main labels           | Continuations                      |
| ------------------------------------------------------------------------------- | --------------------- | ---------------------------------- |
| registry (truth): `std/src/macros/let-yield.ts:130-131`, `par-yield.ts:114-115` | `let seq` / `par all` | `yield pure return` / `yield pure` |
| `transformer/src/arrow-comprehension-preprocess.ts:51-52`                       | `let par seq all`     | `yield pure return in`             |
| `transformer-core/src/transformer-utils.ts:207`                                 | `let par seq all`     | —                                  |
| `transformer-core/src/transformer.ts:435`, `:586` (merge)                       | **`let seq` only**    | from registry                      |
| `transformer/src/pipeline.ts:1673` (pre-filter regex)                           | `let seq par all`     | —                                  |
| `lsp-server/src/manifest.ts:52`                                                 | `let`                 | `yield pure` (no `return`)         |
| `vscode/src/manifest.ts:183-198`                                                | (4 entries)           | `yield pure` (no `return`)         |

**Why it matters — B3.** The preprocessor and the wrapper-flattening accept `par`, the merge
that consumes them does not, so an arrow-body `par:` is wrapped, flattened and then left as
error-recovered garbage with no diagnostic:

```ts
const f = (x: Promise<number>) =>
par: { a << x; b << Promise.resolve(2); }
yield: { a + b }
// → const f = (x) => { const __letyield_0 = par, { a };  << x; b << …; yield: { a + b; }; return __letyield_0; };
```

`in` is accepted as a continuation by the preprocessor but no macro registers it. Both
editor manifests omit `return`.

**Recommendation.** Derive both sets from `globalRegistry`'s labeled-block macros (`label` and
`continuationLabels`), exposed from core as `getComprehensionLabels()`. The editor manifests
already have a generator path (`transformer/src/manifest.ts:164-171`); the hand-written ones
should use it. **Size:** about −30 lines. **Risk:** low.

### A5 — Opt-out feature names: documented, parsed, never checked

**Copies.** `packages/core/src/resolution-scope.ts:420` accepts `operators`, `derive`,
`extensions`, `typeclasses` and `macros`; `docs/guides/opt-out.md:88-94` documents what each
disables. Call sites of `isInOptedOutScope(…, feature)` in the engine use only `macros`,
`extensions` and `derive` (14 sites; `git grep`).

**Why it matters — B4.** `"use no typesugar operators"` and `"use no typesugar typeclasses"`
are silent no-ops. Operator rewriting is gated by `"extensions"` (`rewriting.ts:413`), which
the guide says covers extension methods and method sugar only. `"use no typesugar derive"` is
checked by the decorator path only (A1 row 4), so `/** @derive Eq */` still expands.

**Recommendation.** A typed `OptOutFeature` union exported from core, with each dispatch entry
point declaring its feature (operators → `"operators"`, `summon`/`@typeclass`/`@impl` →
`"typeclasses"`), and a test per row of the guide's table. **Size:** small. **Risk:** low,
except that files currently relying on `extensions` to disable operators would start getting
operator rewriting; mention in the changelog.

### A6 — Operator rewriting and method sugar: two copies of the same pipeline **[coordinate]**

**Copies.** `tryRewriteTypeclassOperator`, `packages/transformer-core/src/rewriting.ts:405-523`,
and `tryResolveTypeclassMethod` + `resolveMethodSugarInstance`,
`packages/transformer-core/src/method-sugar.ts:103-299`. Both compute
activated ∪ defined typeclasses with the same five lines (`rewriting.ts:421-427`,
`method-sugar.ts:162-167`), look up candidates, loop with ambiguity reporting, call
`ensureImport` + `buildInstanceReferenceExpression`, `stripCommentsDeep` the operands and
`preserveSourceMap`.

**Why it matters.** They already drifted:

- F18: literal-type normalisation exists in the extension path (`rewriting.ts:285-291`) but not in method sugar.
- Ambiguity errors: the operator path anchors on the node; method sugar anchors on the **whole file** (`method-sugar.ts:274-275`, `ctx.reportError(ctx.sourceFile, …)`).
- Null/undefined operand guards exist only for operators; the `@derive` companion fallback (`typeDerivesTypeclass`) exists only for method sugar.

F15's fix (require both operands to match) and F20's fix (stop mutating operands) each have to
be written twice.

**Recommendation.** One `resolveSyntaxDispatch(ctx, { kind, name, receiverType(s) })` returning
the matched instance and the emitted reference; the two entry points keep only their
syntax-specific guards. **Size:** about −80 lines. **Risk:** medium.

### A7 — `std` comprehension emission duplicated between `let:` and `par:` (from section S)

See **S1**: the nested-`par:`-inside-`let:` emitter in `let-yield.ts` is a drifted copy of
`par-yield.ts`'s and has three bugs. Listed here so the tiering is complete.

---

## Tier B — a pending fix will land in only one copy

### B·1 — Bare-name, process-global stores (the F14 / F12 pattern) **[coordinate]**

F14 (`instanceMethodRegistry` keyed by bare local name) and F12 (specialisation cache keyed by
type brand) are instances of one pattern: **state keyed by an unqualified name and shared across
every file of a `Program`, or across programs**. The other stores with that shape:

| Store                                                                       | Key                           | Scope                                      |
| --------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------ |
| `instanceMethodRegistryByProgram`, `specialize.ts:301`                      | instance local name           | per Program (F14)                          |
| `legacyInstanceMethodRegistry`, `specialize.ts:302`                         | instance local name           | **process**, for callers without a Program |
| `derivationCache` / `mirrorCache`, `macros/src/auto-derive.ts:207-210`      | `"TC<TypeName>"` / `TypeName` | **process**, cleared per factory call      |
| `genericMetaRegistry` / `genericRegistry`, `macros/src/generic.ts:108,273`  | type name                     | process                                    |
| `kindParamRegistry`, `macros/src/hkt.ts:269`                                | `"Type.param"`                | process                                    |
| `byName`, `core/src/type-rewrite-registry.ts:160`                           | opaque type name              | process                                    |
| `SpecializationCache` key, `transformer-core/src/specialization.ts:423-424` | fn symbol id + brand          | per file (F12)                             |

Writers into the F14 registry: `instance-extraction.ts:657`, `typeclass.ts:1961` (`@impl`) and
`typeclass.ts:2732` (the `impl("TC<T>", {...})` expression macro, see D2). A fix that only
changes `instance-extraction.ts` leaves two writers on the old key.

**Plausible bug (not probed):** `derivationCache` and `mirrorCache` are keyed by bare type
name, so in one `Program` two files that each declare their own `Point` share one derived
`Eq<Point>` and one "type not found" negative cache entry (`auto-derive.ts:275-304`,
`canDeriveViaGeneric` at `:460-470`). Same class as F14.

**Recommendation.** One core helper, e.g. `programScopedRegistry<V>()`, keyed by
`(declaring file, name)` or by declaration `ts.Symbol`, and migrate the table above onto it as
the F14/F12 fixes land, rather than fixing two entries. CLAUDE.md's "Resolving things a macro
just generated" section lists `registerTypeRewrite` as the _correct_ shape; it is correct about
same-pass visibility but has the cross-file name hazard, so that section should say both.
**Size:** medium. **Risk:** medium.

### B·2 — Two instance-scope walks with different visibility rules **[coordinate]**

**Copies.** `resolveInstance` → `resolveFromLocalScope` + `resolveFromImports`,
`packages/macros/src/instance-resolver.ts:172-270`, and `findScannedInScope`, `:377-413`
(used by `findInstanceInScopeByName`, `hasInstanceInScopeByName` and `resolveDoNotationInstance`).

**Differences.**

- Visibility: `findScannedInScope` also scans imported modules' **non-exported** declarations (`:406-408`); `resolveInstance` does not. The comment at `:370-375` says "all three callers … get the same consistent scope-visibility semantics rather than two different ones", which is true of the three callers of _this_ walk but not of the engine, which has two.
- Precedence: `resolveInstance` has local > explicit import > module scan, with ambiguity detection; `findScannedInScope` returns the first hit in import order, so derive planning and do-notation pick by import order.
- Matching: type assignability vs base-name string. Name matching for do-notation is **documented and deliberate** (PEP-052 §Wave 3, `peps/PEP-052-…md:571`, phantom tags); keep that.
- `resolveDoNotationInstance` runs the whole walk twice on a miss (exact, then convention; `:507-509`).
- `implicits.ts:461-471` calls both kinds for one lookup.

**Why it matters.** F16 (dedupe by `exportName` only, `pickResult` `:540-546`) and F17
(type-only imports) must be fixed in both walks. S6 (non-exported `exportName` not importable)
exists only because one walk widened.

**Recommendation.** One generator `walkInstanceScope(ctx)` yielding
`{ instance, stage, importEntry }` in precedence order, over the import table from B·3; each
consumer supplies its match predicate and its ambiguity policy. **Size:** about −60 lines.
**Risk:** low.

### B·3 — About twenty hand-written walks over import declarations **[coordinate]**

**Copies** (engine only): `instance-resolver.ts:75-124` (`getImportMap`),
`core/src/resolution-scope.ts:313-370` (`scanImportsForScope`),
`transformer-core/src/method-sugar.ts:368-383` (`moduleSpecifierForType`),
`transformer-core/src/import-resolution.ts:224-245` (`findImportModuleForName`), `:58-76`,
`:103`, `:634`, plus `core/src/context.ts:955`, `core/src/hygiene.ts:258`,
`core/src/import-suggestions.ts:772`, `macros/src/diagnostic-suppression-rules.ts:369`,
`macros/src/typeclass.ts:3133`, `transformer-core/src/dts-opaque-discovery.ts:88`,
`transformer/src/{hkt-rewriter.ts:272,306, language-service.ts:608, macro-loader.ts:328,425, pipeline.ts:2027, cli.ts:496}`.

**Why it matters.**

- **Type-only imports:** none of the resolution-relevant walkers checks `isTypeOnly` (F17, S1).
- **Re-parsed copies:** only `scanImportsForScope` reads imports from the **program's** copy of the file (`:322-333`, because the comprehension preprocessor re-parses the text, `pipeline.ts:1711-1736`). `getImportMap` and `moduleSpecifierForType` call `checker.getSymbolAtLocation` on `ctx.sourceFile`, which for a preprocessed file is a detached copy, so they fall back to `ts.sys` resolution (`getImportMap`) or silently find nothing (`moduleSpecifierForType`). Plausible, not probed: in a file that uses an arrow-body comprehension, instance resolution through explicit imports degrades under virtual hosts (LS, playground).
- **Specifier resolution:** three different strategies (checker + `ts.sys` fallback; marker reader; checker only).
- **Shape coverage:** `findImportModuleForName` only sees named imports (not default or namespace).

**Recommendation.** A core `getFileImports(program, fileName)`, memoised per Program, read from
the program's copy, returning `{ specifier, resolvedFile, isTypeOnly, named: [{ local, imported,
isTypeOnly }], namespace?, default? }`. Move the resolution walkers onto it; the purely
syntactic ones (hygiene, cleanup, the DTS/HKT rewriters) can stay. **Size:** medium.
**Risk:** low.

### B·4 — The "typeclass-shaped annotation" predicate exists three times **[coordinate]**

**Copies.** `hasTypeclassTypeAnnotation`, `packages/macros/src/instance-extraction.ts:119-125`;
`isTypeclassShapedTypeNode`, same file `:201-206` (identical body); the scanner's check,
`packages/macros/src/instance-scanner.ts:485-490`. The scanner requires **exactly one** type
argument; the extraction pair requires **≥ 1**, while the doc comment at
`instance-extraction.ts:116-117` says it "mirrors the instance scanner's type-annotation
discovery".

**Why it matters.** This predicate is F11's root cause. A fix to `hasTypeclassTypeAnnotation`
alone leaves factory return-type acceptance (`:280`) on the loose rule. It is also re-exported
for "backwards compatibility" from `transformer-core/src/specialization.ts:84-91`, where knip
finds it unused.

**Recommendation.** One `isTypeclassInstanceAnnotation(program, typeNode)` that does what F11's
fix direction asks (resolves to a `@typeclass` interface via `isTypeclassDeclared`, which today
has no caller), used by all three sites; drop the re-export. **Size:** −15 lines. **Risk:** low.

### B·5 — Position and comment hygiene: four mutating helpers that undo each other **[coordinate]**

**Copies.** `stripPositions` and `stripCommentsDeep` mutate in place
(`packages/core/src/ast-utils.ts:142-149`, `:191-201`); `cloneNodeDeep` is the non-mutating
version (`:161-189`); `clampSyntheticPositions` mutates −1 back to 0 after the transform
(`packages/transformer/src/pipeline.ts:163-172`, applied at `:342`); `cli.ts:594,625,655` catch
`"start < 0"`; `stripLeakedArrowComments` (`pipeline.ts:2130-…`, applied at `:1887`) deletes
"stray" comments from the **printed text** with line regexes.

**Why it matters.** This is F20's mechanism seen as a design: one helper marks nodes synthetic
by mutation, a second clamps the same nodes back to a real-looking position, a third catches
the crash, and a fourth patches the printer's output with regexes. The clamp walks the whole
result tree, so a program-owned node that F20 stripped and that is still reachable from the
result (an operand or argument embedded in a rewrite) is set to `pos = end = 0` rather than
restored; F20's watch test shows that other stripped nodes stay at −1. Neither value is the
node's real position. The regex post-pass is a "regex over generated code" case that CLAUDE.md forbids
and its exception list does not cover; Pattern A (`^(.+\S)\s+(\/\/.*)$`) can match legitimate
user lines.

**Recommendation.** With F20's fix: make `stripPositions`/`stripCommentsDeep` clone first (or
replace their call sites with `cloneNodeDeep`), then delete `clampSyntheticPositions`, the three
CLI catches, and, once the printer stops seeing mixed real/synthetic trivia,
`stripLeakedArrowComments`. If the regex pass must stay, add it to CLAUDE.md's exception list
with a justification. **Size:** about −120 lines. **Risk:** medium (output formatting).

### B·6 — Two conditional-compilation config stores and two evaluators

**Copies**

- `cfg()` / `@cfg`: own store, env prefix `TYPESUGAR_CFG_`, nesting on `__` only, no config files (`packages/macros/src/cfg.ts:47-137`); set from transformer options only (`pipeline.ts:191-193`).
- `config.when()` / `@config.when`: `packages/core/src/config.ts`, env prefix `TYPESUGAR_`, nesting on both `_` and `__`, cosmiconfig files, integer parsing (`:115-153`).
- Evaluator: `core/src/config.ts:404-486` (private `evaluateExpr`, `splitTopLevel`, `findMatchingParen`, `getNestedValue`) duplicates the exported `evaluateConditionExpr` and helpers in `core/src/ast-utils.ts:353-466` that `cfg` uses.
- `setNestedValue` exists in both `config.ts:155` and `cfg.ts:98`.
- `cfg.ts:151-218` and `config-when.ts:52-114` repeat the same macro bodies (jscpd, 35 + 13 + 11 lines).

**Why it matters.** `cfg("debug", …)` and `config.when("debug", …)` read different stores, so
they can disagree in one build: `TYPESUGAR_DEBUG=1` turns on one and not the other. Any fix to
the evaluator (quoting, precedence) has to be made twice. `docs/architecture.md:576` says cfg
values come from "config files", which is false.

**Recommendation.** `cfg` reads `config.get("cfg.…")` (keeping `TYPESUGAR_CFG_*` as an alias),
`config.ts` uses `evaluateConditionExpr`, and the two macro pairs share one expander.
**Size:** about −110 lines. **Risk:** low. Not on the fix thread's list.

### B·7 — Auto-specialisation body lookup does not follow import aliases **[coordinate]**

`resolveBodyFromSymbol`, `packages/transformer-core/src/specialization.ts:104-129`, takes
`getSymbolAtLocation` and looks for a variable or function declaration, without the
`getAliasedSymbol` step that PEP-053 Wave 2 gap 1 added to its sibling `resolveAliasedSymbol`
(`instance-extraction.ts:184-195`). An imported generic function therefore always reports
TS9602 "function body not resolvable … Declare it as a const arrow function or named function",
which is wrong advice for an imported function. That may be the _right_ outcome (cross-module
bodies can reference module-local helpers; F10 shows how fragile hoisting already is), but it is
undocumented. **Recommendation:** decide; either follow aliases and reuse
`isSafeToInlineMethod`'s free-identifier check, or keep it same-file and say so in the
diagnostic. **Size:** small.

---

## Tier C — size and maintenance

### C1 — Dead code and orphaned exports (knip + `git grep`)

**Dead** (no reference anywhere in the repo except the definition; tests included):

| Symbol                                                                                                 | Where                                               | Note                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `generateStandardTypeclasses`                                                                          | `macros/src/typeclass.ts:2809-2964`                 | ~155-line string holding a **third** copy of the primitive instances, after PEP-052 Wave 7 removed the second for drifting.         |
| `getSpecializationMethodsForDerivation`                                                                | `macros/src/typeclass.ts:1311-1506`                 | ~195 lines.                                                                                                                         |
| `createRestrictedContext`, `resolveCapabilities`, `DEFAULT_CAPABILITIES`                               | `core/src/capabilities.ts` (whole module)           | Documented as active (D1); never wired into `MacroDefinition` or the transformer.                                                   |
| `fallbackNameLookup`                                                                                   | `transformer-core/src/import-resolution.ts:295-327` | Imported by `transformer.ts:59`, never called. Its 6-way `switch` is also copied into `fallbackNameLookupWithImports` (`:331-357`). |
| `isExtensionEnabled`                                                                                   | `transformer-core/src/import-resolution.ts:540`     |                                                                                                                                     |
| `legacyToRichDiagnostic`, `printDiagnostics` (+ `printDiagnostic`, `renderDiagnosticsCLI` export-only) | `core/src/diagnostics.ts:1448`, `:1712-1757`        |                                                                                                                                     |
| `getPreludeEntry`, `generatePreludeDeclaration` (+ `getPreludeTypeclasses`)                            | `core/src/prelude.ts:116-145`                       |                                                                                                                                     |
| `createInstanceLocation`                                                                               | `core/src/coherence.ts:312`                         |                                                                                                                                     |
| `discoverManifests` … `resetManifestRegistry` (6 functions)                                            | `core/src/manifest.ts:155-420`                      | `getManifestRegistry` has no caller; the others only call each other.                                                               |
| `InMemoryExpansionCache`                                                                               | `core/src/cache.ts:260`                             |                                                                                                                                     |
| `getAllTypeclassDefs`, `isTypeclassDeclared`                                                           | `macros/src/typeclass-index.ts:426,435`             | Keep `isTypeclassDeclared`: it is what F11's fix needs (B·4).                                                                       |
| `withIsolatedRegistries`, `withIsolatedDiagnosticSuppressionRules`                                     | `core/src/test-helpers.ts:32,47`                    | Unused even by tests.                                                                                                               |
| `SemigroupPrimitives`, `MonoidPrimitives` aliases                                                      | `macros/src/index.ts:229-230`                       |                                                                                                                                     |
| `clearResolverCache`                                                                                   | `macros/src/instance-resolver.ts:131-133`           | A documented no-op "kept for API compatibility"; exported but called by nothing.                                                    |

**Export-only** (used in their own file; the `export` and the `index.ts` entry are the slop):
`implMacro`, `typeclassMacro`, `instanceVarName`, `summonAllMacro`, `includeTextMacro`,
`expandCompileTimeVerification`, `expandPropertyTestVerification`, `specializeForResultAlgebra`,
`rewriteResultCalls`, `buildLineIndex`/`offsetToLineColumn`/`lineColumnToOffset`,
`createModuleExportIndex`, `MacroPipeline`/`debugStep` (documented in an RFC and
architecture.md, so a keep/delete decision), the `invariant`/`unreachable`/`debugOnly` macro
objects, and `registerHKTExpansion`'s re-export from `macros/src/hkt.ts:68`. Also the thin
`tryExtractInstanceFromSource` wrapper and back-compat re-exports in
`transformer-core/src/specialization.ts:84-98`.

**Size:** about −900 lines all told. **Risk:** low for internal symbols; the core ones are
public API of a pre-1.0 package, so batch them into one changeset. The `typeclass.ts` entries are
**[coordinate]**.

### C2 — `typeclass.ts` (3,231 lines) holds six modules **[coordinate]**

| Lines     | Content                                                               | Better home                                                            |
| --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 234-629   | transitive `@derive` planning                                         | `derive-planner.ts`, next to `auto-derive.ts`                          |
| 755-1183  | `STANDARD_TYPECLASS_DEFS` table + op extraction                       | `standard-typeclasses.ts` (removes the circular import noted at `:88`) |
| 1185-1532 | companion paths, field-instance resolution, dead C1 code              | split between derive and C1 deletions                                  |
| 1993-2180 | HKT expansion registry and signature rewriting                        | `hkt.ts` (which today re-exports from here)                            |
| 2373-2626 | `summon` and `extend` macros                                          | `summon.ts`                                                            |
| 2627-2808 | `impl()`/`typeclass()` expression macros for the removed preprocessor | delete or `legacy-forms.ts` (D2)                                       |
| 3040-3225 | `tryExpandGenericDerive`                                              | derive module                                                          |

What remains is about 900 lines (the `@typeclass` and `@impl` attribute macros plus
registration). Do it after the fix thread lands; it is pure movement. **Risk:** low.

### C3 — `pipeline.ts` (2,587 lines) holds four modules

`macroTransformerFactory` (`:183-350`, the ts-patch/unplugin entry), source-map generation
(`:463-935`, ~470 lines: diff map, AST map and a hand-written VLQ **encoder** at `:894-935`),
strict output typechecking (`:1431-1610`, `:2277-2388`), and the `TransformationPipeline`
class. The VLQ **decoder** lives in another package (`transformer-core/src/source-map-utils.ts:109-220`),
while `@ampproject/remapping` (already a dependency there) brings `@jridgewell/sourcemap-codec`,
which provides both. **Recommendation:** move the factory to `transformer-factory.ts`, source
maps to `source-map-gen.ts` on the codec, and strict-typecheck to its own file.
`fixCompanionConsts` (`:936-968`) describes itself as "Matches nothing for current derive
output"; delete it with its regex. `shouldTransform` (`:1632-1645`) skips a nonexistent
`packages/preprocessor` and does **not** skip `packages/transformer-core`. **Size:** −150
lines net; mostly movement. **Risk:** low.

### C4 — Eight "print a node safely" helpers

`core/src/ast-utils.ts:302-345` (`getPrinter`/`getDummySourceFile`/`printNode`, the shared
ones); `macros/src/typeclass.ts:133-154` (`getNodeText`, its own printer and dummy file);
`transformer-core/src/transformer-utils.ts:8-25` (`safeGetNodeText`, creates a new dummy
`SourceFile` on every fallback); `transformer-core/src/transformer.ts:171-183` (`printNodeSafe`,
a new printer per call); `macros/src/comptime.ts:609-611`; `macros/src/static-assert.ts:177`;
`macros/src/reflect.ts:34`; `core/src/context.ts:73` (`ctx.printer`). **Recommendation:** one
`nodeText(node, sf?)` in core, synthetic-aware via `isSyntheticNode`. **Size:** −40 lines.
**Risk:** low.

### C5 — Hand-rolled IIFE and throw-IIFE builders

IIFE: `specialize.ts:783-796`, `:1315-1329`, `:1481-1495`; std has a helper
(`std/src/macros/comprehension-utils.ts:628` `createIIFE`) plus `match.ts:2293`
`generateIIFE` and `fusion/src/macros.ts:590` `wrapInIIFE`. Throw-IIFE:
`transformer-core/src/transformer-utils.ts:51-73` (`createMacroErrorExpression`),
`core/src/safety.ts:101-121`, `:142-155`, `macros/src/comptime.ts:457-470` (jscpd confirms the
last three). **Recommendation:** `createIIFE(factory, statements)` and
`createThrowIIFE(factory, message)` in core. **Size:** −80 lines. **Risk:** low.

### C6 — Per-Program cache idiom: helper exists, three sites hand-roll it

`getOrCreateWeak` (`core/src/weak-cache.ts`) is used at 4 sites, but `macros/src/hkt.ts:136-140`,
`macros/src/instance-resolver.ts:481-485`, `macros/src/typeclass.ts:2020-2027` and
`macros/src/do-instance-index.ts:33-44` re-roll it, and the "memoise with `null` for misses"
wrapper is written twice (`hkt.ts:131-144`, `instance-resolver.ts:469-492`).
**Recommendation:** add `memoPerProgram(map, program, key, compute)` beside `getOrCreateWeak`.
One caveat for the comment at `instance-resolver.ts:459-463` ("the answer cannot change within a
program"): `findScannedInScope` consults `getSynthesized`, which _does_ change within a pass, so
that memo is a CLAUDE.md "snapshot vs live state" hazard if a do-notation instance is ever
synthesised mid-pass. **Size:** −25 lines. **Risk:** low. **[coordinate]** for the
`instance-resolver.ts` and `typeclass.ts` sites.

### C7 — "JSDoc tags on the declaration or its statement", re-implemented per reader **[coordinate]**

`hasImplAnnotation` and `extractBrandFromImpl` each walk tags on the declaration then on the
parent `VariableStatement` (`instance-extraction.ts:87-109`, `:132-158`, the
`"impl" || "instance"` test three times); `instance-scanner.ts:442-445`;
`do-instance-index.ts:56`; `typeclass-index.ts:58-60`. **Recommendation:**
`getDeclarationJSDocTags(decl)` and `IMPL_TAGS` in core. **Size:** −30 lines.

### C8 — Smaller jscpd clones worth folding

- `transformer-core/src/import-resolution.ts:296-321 ≈ 333-358`: the registry `switch` (see C1).
- `transformer-core/src/macro-helpers.ts:695-719 ≈ 761-784`: product and sum field extraction share a 24-line field-builder.
- `transformer-core/src/transformer-utils.ts:93-157`: `updateNodeDecorators` repeats the same modifier merge five times.
- `transformer-core/src/source-map-utils.ts:36-60 ≈ 67-83`; `macros/src/extension.ts:182-229`; `macros/src/auto-derive.ts:388-428`; `macros/src/include.ts:158-226`; `macros/src/runtime-stubs.ts:371-517` (overload stubs, mostly deliberate).

Each is under 25 lines; fold opportunistically.

### C9 — `JSDOC_MACRO_TAGS` residue

The brief's "two maps" are one map now (PEP-052 Wave 8, `macro-helpers.ts:41-66`). What is left:
it is an identity map (key = value, so a `Set` would do), and it keeps two entries
(`operators`, `operator`) that its own comment says are dead "for parity", which produce an
"Unknown JSDoc macro tag" warning. Trivial.

---

## Tier D — documentation and comment drift

### D1 — `docs/architecture.md`

- §2 places `MacroTransformer` at `src/transforms/macro-transformer.ts (legacy location)` and in `@typesugar/transformer` (`:86-95`, `:227`). Since PEP-056 it is `packages/transformer-core/src/transformer.ts`; the legacy path does not exist.
- 14 file references use the pre-monorepo layout (`src/macros/*.ts`, `src/core/*.ts`), e.g. `:388`, `:536`, `:638`, `:650`, `:667`.
- §7 "Capability Restrictions" (`:650-665`) documents `createRestrictedContext()` as wrapping `MacroContext` in a proxy that "throws on unauthorized access". Nothing calls it (C1). `docs/SECURITY-REVIEW.md:231-237` reviews it as a live control and `.cursor/skills/macro-authoring/SKILL.md` teaches it.
- `:576` says `cfg` reads config files (B·6).
- All camelCase identifiers the doc names still exist (checked mechanically).

### D2 — References to the decorator preprocessor removed by PEP-047

`typeclass.ts:1784-1786` ("Legacy decorator syntax (requires preprocessor)"), `:2630-2635` and
`:2664-2667` ("internal target for preprocessor-rewritten `@impl`/`@instance` decorators"),
`:2744-2748`; `runtime-stubs.ts:86` ("Decorator on const (requires preprocessor)");
`pipeline.ts:1639` (skip regex lists `preprocessor`), `:1644` ("STS/STSX files"). The
`impl("TC<T>", {...})` expression form still works (its runtime stub is exported), so these
macros are reachable, but they are a writer into the F14 registry that nobody is looking at
(B·1).

### D3 — Comments contradicting their own code

- `instance-resolver.ts:370-375`: "the same consistent scope-visibility semantics rather than two different ones" (B·2).
- `instance-extraction.ts:116-117`: "Mirrors the instance scanner's type-annotation discovery" (≥ 1 vs exactly 1 type argument, B·4).
- `auto-derive.ts:194-203` says the derivation caches "do NOT persist across compilations … Future: integrate with MacroExpansionCache"; the function doc at `:236-241` says results are cached at "L2: disk-backed `ctx.expansionCache` (cross-compilation …)".
- `specialize.ts:1379-1380`: "They'll be handled by the IIFE wrapper if needed" (they are dropped, B1).
- `macro-helpers.ts:41` refers to "the legacy transformer's private copy (transformer/src/index.ts JSDOC_MACRO_TAGS)", which no longer exists. This is fine as history, but PEP-052's Wave 4 status text (`peps/PEP-052-import-scoped-macro-activation.md:650-652`) still calls the maps "intentionally-divergent" without noting that Wave 8 merged them.

### D4 — `docs/guides/opt-out.md`

The feature table (`:88-94`) promises `operators` and `typeclasses` opt-outs that do nothing
(A5).

---

## Section S — `std` and `fp` (delegated pass)

A separate Opus agent reviewed `packages/std/src` and `packages/fp/src` with the jscpd and knip
output. I spot-checked S1's crash path (`let-yield.ts:156` accepts a parallel-group-only block,
then `:166` dereferences `steps.find(bind)!`) and S2 (`fp/dist/zero-cost/option.js:1` imports
`typescript`, reached from `fp/src/index.ts:230-231`; `scripts/check-runtime-purity.mjs` only
scans `dist/index.js`, so it passes). The rest is the agent's reading, summarised.

| ID  | Finding                                                                                                                                | Copies / where                                                                                                                                               | Bug risk                                                                                                                                                                                                         | Size                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| S1  | `let:` carries its own drifted copy of `par:` emission                                                                                 | `std/src/macros/let-yield.ts:516-600` vs `par-yield.ts:380-475`, `typeclasses/par-combine.ts:143-695`                                                        | Nested `par:` on Array emits `.ap` (arrays have none); bind followed by a par group uses `map` (nested `F<F<…>>`); a par-only `let:` crashes at `:166`; implicit return drops trailing guards (`:240-247`).      | −120 lines             |
| S2  | `@typesugar/fp`'s runtime `.` entry loads `typescript` and registers macros (`zero-cost/`)                                             | `fp/src/index.ts:230-232`, `fp/src/zero-cost/option.ts:23,340`, `result.ts:91`                                                                               | PEP-050 Case-1 violation that CI misses (same gap as Fable S3); third Option implementation; JSDoc names nonexistent exports.                                                                                    | −430 lines             |
| S3  | `par-combine.ts`: four near-identical builders, a dead registry, and a generic builder that emits an unimportable `getParCombine("X")` | `par-combine.ts:107-128`, `:143-626` (preamble ×7, join ×6, cartesian ×2)                                                                                    | The generic builder would `ReferenceError`; reachable only via the dead registry.                                                                                                                                | −330 lines             |
| S4  | Two incompatible Eq/Ord/Semigroup/Monoid families                                                                                      | `std/src/typeclasses/index.ts:40-640` (`equals`) vs `fp/src/typeclasses/{eq,semigroup,show}.ts` (`eqv`)                                                      | Same instance names, flipped `ordBy`/`eqBy` argument order; fp JSDoc promises `@op` rewriting it cannot do. **Guess:** fp's `@impl Eq<number>` tags could be picked up by the scanner for std's operator syntax. | ~300 lines, public API |
| S5  | Ord method block hand-written ~20× although `makeOrd` exists (in both packages)                                                        | fp `option.ts:495`, `either.ts:591`, … ; std `tuple.ts:126,160`, `range.ts:150`, …                                                                           | std `ordArray` allocates two dictionaries per comparison (`index.ts:484-487`).                                                                                                                                   | −120 lines             |
| S6  | Four do-notation mechanisms in fp; only `let:` documented                                                                              | `fp/src/syntax/do.ts`, per-type `Do`/`bind`/`let_` (8 files), `io/io.ts:851`                                                                                 | `syntax/do.ts`'s `Monad` and `IODo` shadow the real ones differently at `.` and `./syntax`.                                                                                                                      | −368 lines             |
| S7  | Each fp data type is assembled differently (three companion styles, scattered instances, inconsistent exports)                         | `fp/src/data/*`, `fp/src/instances.ts`                                                                                                                       | `flatMapValidated` lacks the `@impl` its comment relies on; documented `NonEmptyList.of` doesn't exist.                                                                                                          | medium                 |
| S8  | Docs drift in `docs/guides/fp.md` and std headers                                                                                      | `fp.md:78-96,123-131,149,230`; `std/src/index.ts:31-33`; `std/src/specialize/index.ts:13`                                                                    | Users copy non-working examples (`List.of`, `IO.flatMap`, `FunctorOption`, `when`/`otherwise`/`P`).                                                                                                              | docs                   |
| S9  | Range has three parallel APIs; seven extension methods unreachable from the barrel                                                     | `std/src/data/range.ts`, `std/src/extensions/range.ts`, `extensions/index.ts:105-108`                                                                        | README documents `(1).to(5).map(...)`, which doesn't activate.                                                                                                                                                   | −100 lines             |
| S10 | Legacy std typeclasses duplicating newer ones; `specialize/index.ts` re-implements 8 private iterable helpers                          | `std/src/typeclasses/index.ts:1073-1501`; `std/src/specialize/index.ts:99-170` vs `flatmap-instances.ts:159-193`                                             | Two copies to fix.                                                                                                                                                                                               | −130 lines             |
| S11 | Same helper names, different semantics, across std and fp                                                                              | `std/src/extensions/function.ts` vs `fp/src/syntax/pipe.ts`; `std/src/data/tuple.ts` vs `pipe.ts:370-408`; aliases `always`/`constant`, `applyTo`/`apply`, … | `constant`, `mapFst` etc. silently differ by package.                                                                                                                                                            | small                  |
| S12 | `collectReferencedIdentifiers` counts property names (cross-reference A2)                                                              | `std/src/macros/comprehension-utils.ts:364`                                                                                                                  | `b << g(cfg.a)` wrongly depends on `a`.                                                                                                                                                                          | small                  |

---

## Checked and found clean (or deliberate) — don't repeat

- **Exact copy-paste in the engine is low:** 17 exact clones of ≥ 8 lines (0.73 %). The remaining jscpd hits are listed in C8; the rest are overload stubs in `runtime-stubs.ts`.
- **`JSDOC_MACRO_TAGS`:** one map since PEP-052 Wave 8 (C9 has the residue).
- **`isNodeWithin`:** one copy (`instance-extraction.ts:420`); `specialize.ts` has no copy. `diagnostic-suppression-rules.ts:709 isDescendantOf` walks parents and serves a different purpose. Note that `isNodeWithin` is position-based and therefore meaningless on synthetic or stripped nodes (B·5).
- **`hasOnlySafeFreeIdentifiers` vs `isSafeToInlineMethod`:** separate resolution strategies are deliberate and documented (no checker for reflected primitives); only the reference-position rule should be shared (A2).
- **`resolveDoNotationInstance` name-based matching:** deliberate, PEP-052 §Wave 3.
- **`primitiveIntrinsicRegistry` as a bare `Map`; `BUILTIN_METHOD_RECEIVER_NAMES`:** deliberate and documented (PEP-052 / PEP-056 Wave 5).
- **`registerHKTExpansion`:** one definition (`typeclass.ts:2047`); `hkt.ts:68` is a re-export.
- **`transformer/src/{source-map-utils,position-mapper,dts-opaque-discovery}.ts`:** documented PEP-056 Wave 3 deprecation shims onto transformer-core, not duplicates.
- **`core/src/cache.ts` (expansion cache) vs `transformer/src/cache.ts` (file cache):** different granularity, not duplicates.
- **Result-algebra specialisation:** live (`fp/src/macros.ts:53-54`, `std/src/macros/index.ts:54` register algebras).
- **`invariant`/`unreachable`/`debugOnly` macros:** registered and live; only the `*Macro` exports are unused.
- **Main transformer vs transformer-core parity:** confirmed identical by the Fable audit.
- **`docs/architecture.md` identifiers:** every camelCase identifier it names still exists; only paths and the capability/cfg claims drifted (D1).
- **`std`/`fp`:** no `parseStatements`/`parseExpression` calls and no raw `pos === -1` checks; `pipe`/`flow`/`compose` arity overloads are deliberate; extension barrels other than range are complete (knip's "unused" list there is public API); `std/typeclasses/flatmap.ts` is a documented back-compat re-export; the syntax-marker fallback table is guarded by a drift test.

## Reproducing

The probes (B1–B3) were throwaway scripts against the built packages; to re-run them, rebuild
and adapt from the snippets above. The mechanical pass:

```bash
npx jscpd@4 --min-lines 8 --min-tokens 70 --format typescript \
  --ignore "**/*.test.ts,**/tests/**,**/dist/**,**/*.d.ts" \
  packages/core/src packages/macros/src packages/transformer-core/src packages/transformer/src
npx knip@5 --config <temp knip.json with per-package src/index.ts entries> --include exports,types,files,duplicates
```

The knip candidates were then checked one by one with `git grep -lw <name> -- '*.ts'`, and
classified as dead (only the definition line) or export-only (used in their own file).
