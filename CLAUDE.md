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
  `assignCode`).
- `verify-laws.ts` — law verification + property-test codegen.
- `auto-derive.ts` — cached derivation output (memory + disk caches store strings;
  changing the cache contract to store AST is the bigger refactor).
- `specialize.ts` — legacy string-source `method.source` path (replaced where
  possible by AST-based `registerInstanceMethodsFromAST`).
- `quote.ts` and `syntax-macro.ts` — these ARE the quasi-quote / user-defined
  syntax-macro primitives. String→AST parsing is their documented purpose; they
  are not migration targets.

The original `builtinDerivations` + `convertToCompanionAssignment` legacy exception
was removed in 2026-05 after they were confirmed to be dead code (orphaned by
PEP-038 Wave 2F's GenericDerivation migration).
