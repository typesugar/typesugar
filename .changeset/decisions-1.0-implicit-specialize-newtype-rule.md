---
"@typesugar/transformer-core": minor
"@typesugar/macros": minor
---

Specialize `= implicit()` calls; remove the NewtypeAssignment suppression rule

- **`@typesugar/transformer-core`** (behaviour change): a call completed by
  `= implicit()` is now auto-specialized exactly like the explicit call.
  `sortWith([3, 1, 2])` with `ord: Ord<T> = implicit()` compiles to a hoisted
  `__typesugar___sortWith_number_0__([3, 1, 2])` with the comparator inlined,
  not to `sortWith([3, 1, 2], numberOrd)`. It falls back to dictionary passing
  in the same cases an explicit call does, and `// @no-specialize` works on it.
  This reverses the PEP-056 choice to keep implicit calls as plain dictionary
  passing.
  - New fallback (explicit and implicit calls): a function whose body calls
    another `= implicit()` function without passing the instance is no longer
    specialized. It warns TS9602 and keeps dictionary passing. Before, the
    hoisted copy dropped the propagated instance and threw "implicit()
    requires the typesugar transformer" at runtime.
- **`@typesugar/macros`** (breaking): removed the `createNewtypeAssignmentRule`
  export and the `NewtypeAssignment` rule from
  `registerAllDiagnosticSuppressionRules` / `ALL_DIAGNOSTIC_SUPPRESSION_RULE_NAMES`.
  `@typesugar/type-system`'s `UnwrapNewtype` reads a phantom base slot, so
  `wrap<T>()` and the newtype constructors type-check without any suppression.
  Code that declares its own `Newtype`/`UnwrapNewtype` with the old
  `T extends Newtype<infer Base, string>` shape will now see that TS2345.
