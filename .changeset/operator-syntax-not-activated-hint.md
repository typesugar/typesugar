---
"@typesugar/core": minor
"@typesugar/macros": minor
"@typesugar/transformer-core": minor
---

New warning TS9804, "operator syntax not activated" (the operator counterpart
of TS9224). Since PEP-052, `a + b` only dispatches to a typeclass's `@op +`
method in a file that imports the typeclass's `/ops` marker (or declares the
typeclass). Without the import, the operator silently stayed native JavaScript.
Now, when the operand type has an in-scope instance of a typeclass that maps
the operator, the transformer warns at the operator and names the import to add.
For example: `Add import "@typesugar/std/syntax/numeric/ops";`. The warning
covers binary and prefix-unary `@op` operators, including `===`/`!==` on Eq
types.

It only fires when activating the typeclass would actually rewrite the
expression. It never fires for primitive operands, for types with no instance,
in activated or `"use no typesugar"` files, or for operators no `@op` maps. Use
`// @ts-no-typesugar operators` to keep a native operator on purpose.

- `@typesugar/core`: the `TS9804` descriptor, and `findSyntaxMarkerSpecifiers()`
  for reverse lookup of registered marker specifiers.
- `@typesugar/macros`: `getInactiveOperatorCandidates()`.
- `@typesugar/transformer-core`: the hint, in `operator-activation.ts`.
