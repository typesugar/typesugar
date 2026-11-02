---
"@typesugar/std": patch
"@typesugar/core": patch
"@typesugar/transformer": patch
---

A fluent `match()` on a value TypeScript has narrowed reads it at its declared type. The expansion
reads the scrutinee from a const, which had the narrowed type: after `const circle: Shape = { kind:
"circle", radius: 5 }`, `match(circle)...case({ kind: "square", side })` expanded to a `case
"square":` TypeScript called unreachable (TS2678) and a `side` it typed `unknown` (TS18046), so
type-checking the expansion (`typesugar check --strict`) reported 5 errors on std's showcase, all
in valid code. The const is now asserted back to the declared type, `const _circle = circle as
Shape;` (as the file can name the type: an import type when the file doesn't import it). Only the
members the narrowing removed that are of the kind left come back, so `Shape | null` narrowed to
`Shape` stays non-null. The JavaScript is unchanged: the assertion is erased.

`typeToPortableTypeNode` (exported from `@typesugar/core`) writes a type as a type node a given
file can contain; the declaration emit's `@opaque` annotations use it too.
