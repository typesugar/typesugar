---
"@typesugar/transformer": patch
---

`typesugar check` and `build` type-check the expansion of a fluent `match()` chain too, as they do a
comprehension's, a `match:` switch's and an `ensures:` block's. A chain's pattern names are
undeclared as written (the MacroCallChain rule hides that), so `.case({ kind: "circle", r
}).then(r.toUpperCase())` on a number `r` passed plain `check`, built, and threw "r.toUpperCase is
not a function" at run time; only `--strict` reported it. Plain `check` and `build` now report
TS2339 at the line you wrote. Only what lies inside the chain is reported. A file with such a chain
costs one expanded check of that file (std's showcase: 0.63 s / 299 MB to 0.82 s / 359 MB).
