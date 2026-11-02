---
"@typesugar/std": patch
---

`match()`: no dead `break` or `MatchError` after a discriminant switch that covers every variant

- A fluent match on a discriminated union compiles to a `switch` on the
  discriminant. When every variant has an arm with no guard and nothing left
  to test (`.case({ kind: "circle", radius })` where `radius` is required), the
  switch can't fall out of a `case`, but every arm was still followed by
  `break;` and the switch by `throw new MatchError(_s)`, which kept
  `import { MatchError } from "@typesugar/std"` in the output (std's showcase
  had it). Both are gone. A `case` whose arms can fall through (a guard, an
  optional field's test, a sub-pattern) keeps its `break;`, and the throw stays
  unless the switch is shown to cover every variant of the type it reads.
- An `if`-chain match that ends in an arm taking every value with a binding or
  `.as()` (`.case(other).then(...)`) no longer has a dead `MatchError` after it.
  The "unguarded binding" case was meant to be covered already, but the arm's
  block wasn't recognised as returning.
- The object-handler form `match(value, { ... })` with a handler for every
  member of a literal union, or every variant, calls its last handler with no
  test: no `MatchError.throw` (and its import) or non-exhaustive throw after it.
