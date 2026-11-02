---
"@typesugar/macros": patch
---

`implicit()` with literal arguments, `max(3, 7)` for
`max<A>(a: A, b: A, O: Ord<A> = implicit())`, was TS9001 "No instance found
for `Ord<3 | 7>`" (with help to `@derive(Ord)` on `3 | 7`). The instance is
now looked up for the literal type's base type (`Ord<number>`), widened by
the checker, as method syntax already does for a literal receiver.
