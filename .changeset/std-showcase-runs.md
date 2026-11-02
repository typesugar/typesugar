---
"@typesugar/std": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
---

std's showcase compiles and runs again, and every `packages/*/examples/*.ts` is now run with
`typesugar run` in the test suite (the ones still broken are listed, with why). Fixes on the way:

- `match()` treats an object type with a literal-typed property as a one-variant discriminated
  union: `const c: Shape = { kind: "circle", radius: 5 }` (narrowed to the circle variant) is
  covered by its `.case({ kind: "circle", radius })` arm instead of TS9226 "not enumerable".
- std's root exports the array `groupBy` under its own name (as well as `arrayGroupBy`), so
  `import { groupBy } from "@typesugar/std"; xs.groupBy(f)` resolves.
- An imported value whose apparent type carries a `declare global` stub (std's `LT`, a number,
  has `clamp` through `interface Number`) is no longer offered as an extension namespace:
  importing `LT` next to `clamp` made `(150).clamp(0, 100)` ambiguous.
- `typesugar run` bundles for the Node it runs on (top-level await works) and gives bundled
  CommonJS modules a `require` for Node builtins ("Dynamic require of 'path' is not supported").
