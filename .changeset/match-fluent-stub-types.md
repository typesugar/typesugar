---
"@typesugar/std": minor
"@typesugar/macros": patch
---

The fluent `match()` chain has real types for tools that type-check unexpanded
source (plain `tsc`, tsup's own `.d.ts` step, typescript-eslint, typedoc). It
was typed `never`, so every fluent match failed there with "Property 'case'
does not exist on type 'never'". Now `match(x)` is a `FluentMatch<T>`: literal
arms and `.else()` type-check, and the value is the union of the arm results.
A chain that ends in `.then()` is `R & FluentMatch<…>`, with `null` and
`undefined` results kept beside the intersection; continuing a chain after
such an arm is "possibly null" to plain `tsc`, and typesugar's own checks
(`MacroCallChain`) suppress that error on the chain's receiver. Names bound
by patterns are still undeclared to plain `tsc`. `FluentMatch`,
`FluentMatchCase` and `FluentMatchArms` are exported from `@typesugar/std`.
