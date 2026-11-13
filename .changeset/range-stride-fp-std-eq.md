---
"@typesugar/std": minor
"@typesugar/fp": minor
---

**Breaking:** `Range`'s step size field is now `stride` (`{ start, end, stride, inclusive }`).
While it was `step`, it hid the `step` extension method from the type checker, so
`(0).to(10).step(2)` failed with TS2349 ("This expression is not callable"). The method keeps its
name: `(0).to(10).step(2).toArray()` now type-checks. Code that read `r.step` reads `r.stride`.

`@typesugar/fp`'s `Eq`, `Ord` and `Ordering` are now `@typesugar/std`'s types, re-exported, rather
than a copy with the same members, and fp depends on `@typesugar/std`. fp's `PartialOrd`,
`LT`/`EQ`/`GT` and combinators are unchanged.
