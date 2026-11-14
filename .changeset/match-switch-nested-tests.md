---
"@typesugar/std": patch
"@typesugar/macros": patch
---

`match: switch` tests below the top level: a literal, an extractor, a type test or a regex in a nested position (`{ kind: "a", inner: { tag: "x" } }`, `{ kind: "slot", value: Some(v) }`, `Some(0)`) is now a test instead of an error, reading nested values with `?.` so a missing optional parent fails the case. Object and array shapes with none of those inside still destructure; `[x, y, ...[]]` opts into an exact array length. Type tests (`String(s)`, `Date(d)`, a class without a `Destructure` instance) and regexes (`case /^a/:`) work at the top level, binding the narrowed value. `typesugar check` no longer reports TS2678 on a regex case label.
