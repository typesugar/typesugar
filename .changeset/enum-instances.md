---
"@typesugar/macros": patch
---

An enum value resolves the enum's own instance before the primitive's: `Color.Green.show()`,
`c.show()` on a `c: Color` narrowed to one member, and `show(c)` through `= implicit()` used
`@impl Show<number>` beside an `@impl Show<Color>`, because an enum member's type is mutually
assignable with `number` and was matched before being widened to its enum. Resolution now looks
for an instance declared for the enum itself (by symbol) first, in every scope, and falls back to
the primitive's only when the enum has none. `@impl Show<Color>` on an enum declared in the same
file now generates the `Color.Show` companion (it warned "'Color' is not declared in this file");
a `const enum` or `declare enum` gets a warning that says why it has none.
