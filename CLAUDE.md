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

The original `builtinDerivations` + `convertToCompanionAssignment` legacy exception
was removed in 2026-05 after they were confirmed to be dead code (orphaned by
PEP-038 Wave 2F's GenericDerivation migration).

`specialize.ts`'s ORIGINAL exception entry — the legacy string-source
`method.source` fallback path in `inlineMethod`, fed by 16 hand-written
primitive-intrinsic source strings — was removed in 2026-07 (PEP-052 Wave 7).
Nothing produces a `.source`-shaped `DictMethod` anymore; `specialize.ts`
remains on this list only for the new, narrower reflection-based exception
described above.
