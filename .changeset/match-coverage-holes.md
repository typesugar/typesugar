---
"@typesugar/std": patch
"@typesugar/core": patch
---

`match()`: exhaustiveness agrees with the code it generates

- An arm that names a field its variant declares optional
  (`.case({ k: "b", extra })` with `extra?: string`) tests `"extra" in` the
  value, so `{ k: "b" }` matched no arm and threw `MatchError` at run time, yet
  the match was accepted as exhaustive. Such an arm no longer covers the
  variant: TS9226 reports it and names the optional field. Add an arm for the
  rest (`.case({ k: "b" })`) after it. `match: switch` destructures instead of
  testing, so there the same case still covers the variant and binds
  `undefined`.
- Enum members are constant patterns: `.case({ k: K.A, n })` tests
  `k === K.A`, and the arms count for exhaustiveness as the members' values.
  Before, `K.A` had no test at all (the arm matched any value with an `n`) and
  the match reported "missing variants". A qualified name is a constant only
  when its type is one literal value; any other sub-pattern the macro can't
  compile is now an error instead of matching anything.
- A tuple pattern of the tuple's length with only bindings (`[x, y]` on
  `[number, number]`), or `[head, ...rest]` on a tuple at least that long,
  covers the tuple type: no "not enumerable" TS9226.
