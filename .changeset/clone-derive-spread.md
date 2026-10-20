---
"@typesugar/macros": patch
---

`Clone` derivation: a spread copy for products, and sum types now derive

- A derived `Clone` instance is now `({ clone: (a) => ({ ...a }) })`. It used
  to list the declared fields (`{ x: a.x, bbox: a.bbox }`), so a clone gained
  `bbox: undefined` keys for absent optional fields and lost properties the type
  does not declare. The clone is still shallow, as documented.
- `@derive(Clone)` and `summon<Clone<T>>()` on a discriminated union failed
  with TS9106 ("derivation strategy returned null for sum type"): there was no
  sum-type strategy, although the docs promised one. It now derives the same
  spread copy.

Found by the Turf case study (Stage 1), cloning the `@types/geojson` shapes.
