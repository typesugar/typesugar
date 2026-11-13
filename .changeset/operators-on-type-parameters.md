---
"@typesugar/macros": minor
"@typesugar/transformer-core": minor
---

Operators on a type parameter dispatch to the dictionary in scope. In generic code
(`function f<A>(c: Numeric<A>, a: A, b: A) { return a + b; }`) the operator used to stay
JavaScript's own, and a specialization of the function copied that native body for the concrete
instance, so `f(numericPoint, p, q)` returned a string or `NaN` with no build error. It now
compiles to `c.add(a, b)`, finding the dictionary as a parameter (also of an enclosing function),
an `= implicit()` parameter or a `const` above it, through type aliases; specialization inlines
the instance for it; and `typesugar check` drops TypeScript's operand errors there (TS2365,
TS2362, TS2363) and types the result as `A`.
