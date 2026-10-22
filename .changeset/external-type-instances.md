---
"@typesugar/macros": patch
"@typesugar/core": patch
---

Instances for types you don't own (a library type such as `Feature` from
`@types/geojson`), written in your own module and imported, now resolve
everywhere:

- An `@impl Clone<Feature>` for a generic whose type parameters all have
  defaults matched `summon<Clone<Feature>>()` but not a value typed `Feature`,
  so `implicit()` and `f.clone()` (with a bare `import "./instances"`) missed
  it. The bare name now matches its default instantiation.
- `implicit()` resolves its instance by the inferred type, not only by its
  printed name (`Feature<Geometry, GeoJsonProperties>` never matched
  `Feature`).
- `summon` in an instance's own initializer no longer resolves to that
  instance (`const cloneFeature = cloneFeature`, a ReferenceError at load), so
  `/** @impl Clone<Feature> */ export const cloneFeature =
summon<Clone<Feature>>();` derives it once, for importers to use.

TS9101's explanation and the error-messages guide no longer tell you to wrap
a library type in a newtype; they point to the typeclasses guide's new
"Instances for types you don't own" section.
