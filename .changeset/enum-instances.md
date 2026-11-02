---
"@typesugar/macros": patch
---

An enum value resolves the enum's own instance before the primitive's: `Color.Green.show()`,
`c.show()` on a `c: Color` narrowed to one member, and `show(c)` through `= implicit()` used
`@impl Show<number>` beside an `@impl Show<Color>`, because an enum member's type is mutually
assignable with `number` and was matched before being widened to its enum. Resolution now looks
for an instance declared for the enum itself (by symbol) first, in every scope, and falls back to
the primitive's only when the enum has none. `@impl Show<Color>` on an enum generates no
`Color.Show` companion and no longer warns "'Color' is not declared in this file": a companion
merged into the enum object overwrote a same-named member (`Op.Eq` beside `@impl Eq<Op>`) and
appeared in `Object.values(Status)`. The instance resolves by its declared type without one. An
enum member passed where an instance is expected (`log(Op.Eq)`) is no longer taken for the
`Eq<Op>` instance by its dotted name.
