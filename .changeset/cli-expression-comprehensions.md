---
"@typesugar/transformer": patch
---

`typesugar build`, `check`, `watch` and `expand` run the expression-position comprehension
rewrite the pipeline runs (`const f = (id) =>` then `let: { ... } yield: ...`, `return let: ...`,
`export default let: ...`): `build` emitted broken JavaScript for them
(`export const f = (id) => let, { user }; ...`) and `check` reported the broken parse. Diagnostics
in a rewritten file are reported at the lines as written.
