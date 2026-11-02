---
"@typesugar/contracts": patch
---

A method of an `@invariant` class keeps its `requires:`/`ensures:` blocks: `@invariant` wrapped
each method body in its try/finally before the method's own contract was expanded, so the blocks
were no longer top-level statements and `old()` in an `ensures:` block was reported as "old() can
only be used inside an `ensures:` block". The leading contract blocks now stay first, outside the
wrap: preconditions, then the body and the invariant check, then postconditions.

The package's examples run with `typesugar run` again: `tryProve` is imported from
`@typesugar/contracts/macros` (the proof engine is not in the runtime entry), `contracts-example.ts`
imports `@contract`/`@invariant` instead of declaring local stand-ins (a local function of the same
name is not the macro), and the showcases use the current `old()` block form and decidability
queries.
