---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
---

A library's `@derive` companions are found by its consumers. `/** @derive(Eq) */ export interface
Point` in a published package used to be invisible from its `.d.ts`: a consumer's `p1 === p2` stayed
a reference comparison and `summon<Eq<Point>>()` derived a second instance with TS9009. The instance
scanner now reads an exported type's companions (`Point.Eq`) from its `@derive` tag, and each
generated companion carries an `/** @impl Eq<Point> */` tag that declaration emit keeps (the
decorator form leaves no `@derive` in a `.d.ts`). Operators, `summon`, `= implicit()` and method syntax
resolve them like any other instance, through the type's own binding (`import { Point
as P }` gives `P.Eq`). The same works between two source files of one program, whichever is
transformed first.

The scanner no longer takes a function or class for an instance because its JSDoc shows an `@impl`
example (typesugar's own `impl()` declaration made `= implicit()` pass `impl` as an `Eq<Point>`), and
ignores `@impl`/`@derive` tags in prose and fenced examples. A macro error on a JSDoc tag's
arguments no longer crashes the CLI's diagnostic printer.
