---
"@typesugar/macros": patch
"@typesugar/transformer": patch
---

`typesugar check`/`build`: a fluent `match()` whose arm result uses a pattern name that shadows
an outer declaration no longer fails on the chain's result type. With the default lib, in
`function label(u: U): string { return match(u).case({ kind: "user", name }).then(name)… }`,
`name` was typed, as written, from DOM's `name: void`, and the `return` was TS2322 (likewise a
local function `len` in `.then(len)`, and `const v: number[] = xs.map((x) => match(…)…)`). The
MacroCallChain rule now hides that assignability error, and the expanded check reports it where
it was if the expansion's type is wrong too. The expanded check now also covers where a chain's
value meets a declared type (`return`, a typed declaration, an argument), so a wrong result type
built from pattern names (`.then(nm)` returning a `string` from a `number` function) is reported;
before, it went unchecked. An error on a `return` the expansion rebuilt is reported at that
`return`, not at the enclosing function's first line.
