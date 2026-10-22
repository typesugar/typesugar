---
"@typesugar/transformer": patch
"@typesugar/core": patch
---

`typesugar check` and `build` type-check the expansion of the constructs whose bound names the
source as written can't check: a do-notation comprehension's steps, a `match:` case's pattern,
an `ensures:` block's `result`. `fetchAge(user.nme)` in a `let:` was reported only by `--strict`,
at its position in the expanded code; it is now reported by plain `check` and `build`, at the line
you wrote. Only what lies inside those constructs is reported, and an error that exists only in
generated code is left out (`--strict` still reports everything).

The expanded program reuses the first program's SourceFile for every file the macros didn't
change, so `--strict` is cheaper too (examples/basic: 1.2 s to 0.9 s, 512 MB to 374 MB peak), and
`--strict` reports an error at the line you wrote when it maps to one.

`filterDiagnostics` takes an optional `onSuppressed(diagnostic, ruleName)` callback.
