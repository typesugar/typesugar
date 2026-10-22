---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
"@typesugar/testing": patch
---

Macros inside `assert(...)` expand. The argument used to be instrumented before the macros in
it ran, so `assert(showAll(xs, summon<Show<number>>()) === "…")` compiled to
`(values[i] = summon)()` and threw "summon() must be processed by the typesugar transformer" at
run time, and `extend(x).m()` / extension methods inside it were skipped. Expression macros can
now set `expandArgumentsFirst: true` to receive their arguments already expanded; `assert` does,
and instruments the expanded expression (the diagram still shows the values of the parts of the
source the expansion kept).
