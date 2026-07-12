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

- `packages/transformer/src/dts-transform.ts` — `parseOpaqueTypeExpression`,
  and ONLY that. `transformDtsContent` turns each `@opaque`-tagged interface
  in a compiled `.d.ts` file into a type alias exposing the underlying
  runtime representation. The interface's name, type parameters (including
  constraints/defaults), and export/declare modifiers are all reused
  directly from the real parsed `ts.InterfaceDeclaration` via
  `ts.factory.createTypeAliasDeclaration`, then printed — no template
  strings. The one holdout is the `@opaque` JSDoc tag's VALUE itself (e.g.
  `A | null`): it's free-form TypeScript type syntax a human wrote inside a
  comment, which the checker never parses as type syntax, so there is no
  syntax tree attached to it anywhere upstream — same category as
  `typeclass.ts`'s `fullSignatureText` contract and `effect/schema.ts`'s
  `mapTypeToSchema` above. `parseOpaqueTypeExpression` wraps it as
  `type __T = ${text};` in a throwaway source file and extracts the parsed
  `ts.TypeNode`, then strips its positions (`stripPositions` from
  `@typesugar/core`) before splicing it into the real declaration — the
  position-stripping step is load-bearing, not optional: without it the
  printer uses the node's real-but-wrong-file `pos`/`end` (offsets into the
  temporary wrapper text) as if they applied to the real `.d.ts` file's
  text, silently splicing in random unrelated bytes from whatever the real
  file happens to have at those numeric offsets (caught by
  `dts-transform.test.ts`'s multi-interface test during PEP-057's follow-up
  pass — the exact bug `ctx.parseExpression`'s own `stripPositions` call in
  `core/src/context.ts` already guards against for the same reason).
  Narrowly scoped to `parseOpaqueTypeExpression`; everything else in the
  file is AST-built.

**Pre-`Program` source-text rewrites** (a different mechanism than the
`ctx.parseStatements`/`ctx.parseExpression` list above, but the same
underlying rule — a raw `ts.createSourceFile` + `MagicString` text patch
applied to the file's own source before a real `ts.Program`/checker exists,
rather than AST construction):

- `packages/transformer/src/arrow-comprehension-preprocess.ts` — when a
  `let:/yield:` comprehension (`par:`/`seq:`/`all:` too) appears in
  expression position with a newline before it (arrow body, bare `return`,
  or `export default`), TypeScript's own parser produces an error-recovered
  AST that is too fragile to patch with `ts.factory.update*` — the
  comprehension's label gets parsed as a bare identifier, the following
  block as an unrelated `ObjectBindingPattern`, and subsequent statements as
  error-recovered `BinaryExpression`s. There is no valid AST to build
  factory nodes alongside at this point — the fix has to happen on the
  TEXT, before the real parse, so that TS's normal ASI path produces a
  shape the transformer's existing merge logic can handle. Detection uses a
  real AST walk (`ts.forEachChild`) over the first (broken) parse plus a
  scanner-based brace-balancer (`ts.createScanner`, template-literal aware)
  to find exact span boundaries — not regex-based text search beyond a
  cheap `hasPotentialComprehension` prefilter — and the inserted text is a
  handful of fixed wrapper tokens (`{ { const __tag = `, `; return __tag; } }`)
  with only a synthesized identifier substituted in, not reconstructed
  program logic. `transformCode` reparses the rewritten source afterward
  through the normal pipeline.
- `packages/transformer/src/hkt-rewriter.ts` — rewrites `F<A>` → `Kind<F, A>`
  (where `F` is a type parameter) in `VirtualCompilerHost`, before
  `ts.Program` creation, specifically so the type checker never sees the
  invalid `F<A>` syntax (which throws TS2315). Since this must run before a
  checker/Program exists, and the output must be a source-text string (fed
  straight into the normal `ts.createProgram` file-read path, not spliced
  into an already-built tree), a `MagicString` patch of the original file
  text is the only way to keep the rest of the file's positions/source-maps
  intact. As of PEP-057's follow-up pass, the _replacement text itself_ is
  built from real `ts.factory.createTypeReferenceNode`/printer output
  (reusing the actual matched type-argument nodes), not manual template-
  string interpolation — only the outer "patch this one span of the
  original file" mechanism remains textual, because it has to.

The original `builtinDerivations` + `convertToCompanionAssignment` legacy exception
was removed in 2026-05 after they were confirmed to be dead code (orphaned by
PEP-038 Wave 2F's GenericDerivation migration).

`specialize.ts`'s ORIGINAL exception entry — the legacy string-source
`method.source` fallback path in `inlineMethod`, fed by 16 hand-written
primitive-intrinsic source strings — was removed in 2026-07 (PEP-052 Wave 7).
Nothing produces a `.source`-shaped `DictMethod` anymore; `specialize.ts`
remains on this list only for the new, narrower reflection-based exception
described above.

**Both exception lists above must be exhaustive, not illustrative.** If you
add a `parseStatements`/`parseExpression` call, or a raw `ts.createSourceFile`
used to build-then-reparse/patch generated text (the pre-`Program`
source-rewrite category above), anywhere in this repo, either it's already
covered by name and file above, or you add it to the matching list in the
same commit with the same justification structure the existing entries use
(why AST construction wasn't feasible here, not just "it was easier"). A
string-codegen call site with no corresponding CLAUDE.md entry is a bug in
this file, not a passable gap — flag it in review rather than assuming an
old omission means the rule doesn't apply to your package. (PEP-057's
follow-up pass found exactly this: `arrow-comprehension-preprocess.ts`
already had its own in-file comment calling itself "a deliberate exception
to the CLAUDE.md rule" — but the entry above was still missing until that
pass added it. An exception a file claims for itself isn't real until it's
also in this list.)

**Patching a real, human-authored file outside the macro pipeline** (a
different mechanism than the `ctx.parseStatements`/`ctx.parseExpression`
list above — no `MacroContext` is involved, and this doesn't run as part of
transforming a project's own source — but the same underlying rule):

- `packages/transformer/src/config-writer.ts` — the `typesugar
approve-macros` (PEP-055) CLI command's `typesugar.config.ts` writer. When
  no config file exists yet, the file is pure AST codegen (`ts.factory` +
  the printer, no exception needed). When a config file already exists,
  though, this parses it with `ts.createSourceFile`, builds the
  `security.allowedMacroPackages` replacement content with `ts.factory`,
  and splices ONLY that printed node into the ORIGINAL file's text via
  `MagicString` — rather than reprinting the whole file from a rebuilt
  AST — because the file is something a human wrote and may have their own
  comments/formatting elsewhere in it that a full reprint would discard.
  Same reasoning `hkt-rewriter.ts` and `dts-transform.ts`'s
  `parseOpaqueTypeExpression` already use for the analogous "patch one
  small region of real source, leave the rest untouched" problem. Falls
  back to printing a snippet for the user to add by hand (writes nothing)
  for any config-file shape it doesn't recognize — see the file for the
  exact cases.

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
