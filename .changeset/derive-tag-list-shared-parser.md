---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
"@typesugar/std": patch
---

Every reader of a `@derive` / `@deriving` JSDoc tag uses one parser, `deriveTagNames` (exported
from `@typesugar/core`), so they agree with the derive macro on what a type derives. Method syntax
matched the typeclass name anywhere in the tag's comment: with `@derive(Eq)` and a description
line that mentioned "Show", `p.show()` became `Point.Show.show(p)`, a companion that never
exists. The TS2339 suppression rule took every word of the comment as a derive name, the
auto-derive check and std's `Destructure` planner had the same kind of match, and the instance
scanner dropped the last name of `@derive Eq, Clone` when a description line followed. Tags in
prose or fenced examples no longer count in any of them.
