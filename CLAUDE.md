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

**Legacy exception:** `builtinDerivations` in `typeclass.ts` currently use string-based
codegen with `convertToCompanionAssignment` (regex rewriting). This is technical debt
tracked for cleanup — do not extend this pattern to new code. See PEP backlog for the
audit/migration plan.
