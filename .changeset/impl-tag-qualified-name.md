---
"@typesugar/macros": patch
---

An `@impl` tag naming a type through a namespace import,
`/** @impl Eq<geo.Point> */ export const eqGeo = derived<Eq<geo.Point>>();`
with `import * as geo from "./geo"`, was an error saying the tag should be
`@impl Eq<geo.Point>`: the tag's name was looked up whole in scope. A
qualified name is now resolved through the checker, segment by segment.
