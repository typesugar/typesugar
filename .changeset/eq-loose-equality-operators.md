---
"@typesugar/std": minor
"@typesugar/macros": minor
"@typesugar/transformer-core": patch
"@typesugar/core": patch
---

`==` and `!=` now dispatch through std's `Eq` the same way `===` and `!==` do.
Before, in a file that imports `@typesugar/std/syntax/eq/ops`, `a === b` called
`Eq.equals(a, b)` but `a == b` stayed a reference comparison, and without the
import TS9804 warned for `===`/`!==` but not for `==`/`!=`. Now `a == b` compiles
to `Eq.equals(a, b)`, `a != b` to `Eq.notEquals(a, b)`, and TS9804 covers all four.
Comparisons with `null` or `undefined` (`a == null`) and primitive operands stay
native, as before. For reference identity in a file that activates Eq, write
`Object.is(a, b)`: it is a call, so it is never rewritten.

- `@typesugar/macros`: a typeclass method may carry several `@op` tags, one per
  operator, for equivalent spellings of the same operation (`@op ===` and
  `@op ==` on `equals`). Every tag maps its operator to the method. New
  `extractOpsFromJSDoc()` returns all of a member's `@op` operators, and
  `TypeclassMethod.operatorSymbols` lists them; `extractOpFromJSDoc()` and
  `operatorSymbol` keep returning the first. The built-in `Eq` seed maps `==`
  and `!=` too.
- `@typesugar/std`: `Eq.equals` is tagged `@op ===` and `@op ==`, and
  `Eq.notEquals` `@op !==` and `@op !=`.
- `@typesugar/transformer-core`: TS9804's help for `===`/`!==`/`==`/`!=` names
  `Object.is(a, b)` as the way to keep reference equality. The operator rewrite
  now honors the documented `operators` opt-out (`// @ts-no-typesugar operators`,
  `"use no typesugar operators"`); before, only `extensions` stopped it, so the
  `operators` opt-out silenced TS9804 but still rewrote in an activated file.
- `@typesugar/core`: the TS9804 explanation covers `==`/`!=` and `Object.is`.
