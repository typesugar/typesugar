# Project Rules

## Code generation: prefer AST over string manipulation

When generating or transforming TypeScript code, **always build AST nodes directly**
(`ts.factory.create*`) rather than constructing code strings and parsing them back.

- Do not use regex to rewrite generated code strings.
- Do not build code as template strings and then call `ctx.parseStatements()` or
  `ctx.parseExpression()` to get AST nodes.
- When you receive an AST node (e.g., from a derivation strategy), keep it as AST —
  do not print it to a string and re-parse.

String-based codegen is fragile (regex can't reliably parse TypeScript) and makes it
harder to compose transformations. AST-based codegen is type-safe, composable, and
doesn't round-trip through the parser.

**Remaining `parseStatements`/`parseExpression` call sites** (deferred to a follow-up
PEP for migration):

- `typeclass.ts` — companion + namespace assignment codegen (`companionCode`,
  `assignCode`), and the HKT-expansion `fullSignatureText` contract: typeclass
  member signatures travel as printed text and are re-parsed by
  `generateHKTExpandedType`. (The heritage flattening that FEEDS that text is
  AST-based — a scoped visitor + one printer call — per the Wave 4 review;
  only the final text hand-off remains string-shaped.)
- `verify-laws.ts` — law verification + property-test codegen.
- `auto-derive.ts` — cached derivation output (memory + disk caches store strings;
  changing the cache contract to store AST is the bigger refactor).
- `specialize.ts` — `parseAsStandaloneExpression`/`loadPrimitiveIntrinsicsFromReflection`
  (PEP-052 Wave 7): the 16 primitive-typeclass intrinsics (`eqNumber.equals` →
  `===`, etc.) are populated by reflecting `primitives.ts`'s REAL, live exports
  via `Function.prototype.toString()` and re-parsing the result — a narrower,
  self-auditing variant of string→AST parsing (not hand-typed strings, and
  registration is rejected outright for anything that doesn't parse cleanly
  as a self-contained arrow function referencing only its own params/locals
  — see the free-identifier safety check in the same file). Not a migration
  target: there is no other way to recover an AST from an already-compiled
  function value, and the alternative (hand-typed duplicate strings) is what
  this replaced after it was found to have drifted for 6 of 16 entries.
- `quote.ts` and `syntax-macro.ts` — these ARE the quasi-quote / user-defined
  syntax-macro primitives. String→AST parsing is their documented purpose; they
  are not migration targets.
- `transformer-core/src/transformer.ts` — `MacroTransformer`'s expression-macro
  expansion cache (`getCachedExpression`/`cacheExpression`): entries are stored
  as printed text and re-parsed via `ctx.parseExpression()` on a cache hit.
  Same category as `auto-derive.ts` (cache contract stores strings; changing
  it to store AST is the bigger refactor) — and the print/reparse round-trip
  is why a cache hit must NOT be re-visited (PEP-056 Wave 2): `parseExpression`
  strips positions, making the reparsed node synthetic, and the visitor skips
  macro expansion on synthetic nodes by design.

- `packages/effect/src/derive/schema.ts` — `mapTypeToSchema` (and its helper
  `splitGenericArgs`), and ONLY those. The `EffectSchema` derive turns each
  field's type into a `Schema.*` constructor expression. Everything else in
  the file is AST-built (`ts.factory.create*`): the `Schema.Struct(...)` /
  `Schema.Union(...)` calls, the exported-const wrapper, and the
  `type XEncoded = Schema.Schema.Encoded<typeof XSchema>` alias. The per-field
  schema expression is the holdout: `mapTypeToSchema` recurses over
  `field.typeString` — the type textualized by `typeChecker.typeToString` in
  transformer-core's `extractTypeInfo` — and returns a schema-source string
  that `schema.ts` re-parses with `ctx.parseExpression` at its two
  property-building call sites (the product struct and each sum variant
  struct). This is on the list because the INPUT is itself a string with no
  syntax tree attached: `DeriveFieldInfo` carries only `typeString: string`
  and `type: ts.Type` (a checker type, not a `ts.TypeNode`), so there is no
  written type node to recurse over structurally — `extractTypeInfo` sees the
  declaration's `ts.TypeNode` but discards it before `schema.ts` runs. The
  clean fix is upstream, not in this file: have `extractTypeInfo`
  (`packages/transformer-core/src/macro-helpers.ts`) carry the real
  `ts.TypeNode` on `DeriveFieldInfo` so `mapTypeToSchema` can recurse over
  `ts.TypeNode` kinds instead of regex/substring-parsing text; until that
  field exists, reconstructing the schema from `typeString` (or re-deriving
  it from `field.type` via the checker, as
  `packages/sql/src/derive-typeclasses.ts` does — itself a larger rewrite that
  drops several cases `mapTypeToSchema` handles today, e.g. `Record`/`Map`/
  `Option`/literal unions) is the only option available to this file. Narrowly
  scoped to `mapTypeToSchema`/`splitGenericArgs`; the surrounding declaration
  codegen is not an exception and must stay AST-based.

The original `builtinDerivations` + `convertToCompanionAssignment` legacy exception
was removed in 2026-05 after they were confirmed to be dead code (orphaned by
PEP-038 Wave 2F's GenericDerivation migration).

`specialize.ts`'s ORIGINAL exception entry — the legacy string-source
`method.source` fallback path in `inlineMethod`, fed by 16 hand-written
primitive-intrinsic source strings — was removed in 2026-07 (PEP-052 Wave 7).
Nothing produces a `.source`-shaped `DictMethod` anymore; `specialize.ts`
remains on this list only for the new, narrower reflection-based exception
described above.

**The exception list above must be exhaustive, not illustrative.** If you
add a `parseStatements`/`parseExpression` call anywhere in this repo,
either it's already covered by name and file above, or you add it to this
list in the same commit with the same justification structure the existing
entries use (why AST construction wasn't feasible here, not just "it was
easier"). A string-codegen call site with no corresponding CLAUDE.md entry
is a bug in this file, not a passable gap — flag it in review rather than
assuming an old omission means the rule doesn't apply to your package.

## Resolving things a macro just generated

When a macro synthesizes a new declaration, instance, or binding during a
transform pass (a `@derive` companion, a generated constructor, a
registered extension method), anything that later needs to _discover_ that
synthesized thing — a scanner, a resolver, a lookup table — must consult
**live, same-pass state**, not a scan of the pre-transform source text.
`sourceFile.statements` is fixed at the start of a pass; a scan over it
can never see what the pass itself is in the middle of generating,
regardless of visit order.

Two shapes exist in this codebase; only one is safe against this bug:

- **Live keyed registry, read within the same pass** (`@extension`'s
  `standaloneExtensionRegistry`, `@opaque`/`@adt`'s `registerTypeRewrite`,
  `InstanceScanner`'s `registerSynthesized` side-table) — correct. Only
  constraint is the ordinary declare-before-use one any single top-down
  pass has.
- **Scan of a snapshot bound once at pass start**
  (`InstanceScanner.scanLocalFile` before its `getSynthesized` companion
  was added) — unsafe by construction for anything synthesized mid-pass.

If you add a new resolution/discovery mechanism, or add a new _consumer_ of
an existing one (see: `findInstanceInScopeByName`, which didn't get the
`getSynthesized` fix its sibling `resolveFromLocalScope` did, in the same
file, and shipped that way for a release), explicitly check which shape
you're building on and say so in a comment. Silence on this point reads as
"the author didn't think about it," because in every instance found so far,
that's exactly what it was.

## Calling the type checker on macro-generated nodes

A synthesized AST node (`pos`/`end` of `-1`, never part of the `Program`
the checker was built from) is outside the checker's supported contract —
`getTypeAtLocation`, `getSymbolAtLocation`, and diagnostic-span code can
all throw on it. This is a real, load-bearing constraint in this codebase,
not a hypothetical: `cli.ts` catches it by name (`"start < 0"`) at three
separate checker entry points.

Use `isSyntheticNode(node)` (`@typesugar/core`) to skip before calling the
checker on a node that might be macro-generated, rather than a fresh
`node.pos === -1` check. If you're adding a new checker call site inside
macro-expansion code, assume the node in front of you might be synthetic
until proven otherwise (real user source has a real position; a synthetic
replacement never does) — check first, don't discover it via a thrown
exception in production.

When you do catch a checker failure and choose to degrade rather than
propagate, **the user needs to see that something was skipped** — a
one-line warning survives the failure even if the rest of the diagnostic
pass doesn't. A caught exception with no visible trace is a worse outcome
than the exception itself.
