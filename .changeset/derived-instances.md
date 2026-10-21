---
"@typesugar/macros": minor
"@typesugar/typeclass": minor
"typesugar": minor
"@typesugar/core": minor
---

New `derived<TC<T>>()`: declare a derived instance once, in your own module,
for a type you can't put `@derive` on (a library type such as `Feature` from
`@types/geojson`):

```ts
// geo-instances.ts
import type { Feature } from "geojson";
import type { Clone } from "@typesugar/std";
import { derived } from "typesugar";

export const cloneFeature = derived<Clone<Feature>>();
```

- The call expands to the same code `@derive(Clone)` generates (one
  derivation, emitted once), with field instances from scope: a hand-written
  `Clone<GeoJsonProperties>` declared above it is used for `properties`.
- The const is the instance: `summon`, `= implicit()` and method syntax find
  it in every file that imports the module, as they find a typed or `@impl`
  const. An `@impl` tag is optional (and must agree if present).
  `export const cloneFeature: Clone<Feature> = derived();` is the same
  instance, typed by its annotation, and its `.d.ts` is that annotation as
  written. Neither form leaves a `typesugar` import in the `.d.ts`.
- Every typeclass `@derive` supports through a structural derivation (Eq,
  Ord, Clone, Debug, Hash, Default, Json, TypeGuard, Show, Semigroup, Monoid).
- Errors: a field with no instance that can't be derived is TS9107 at the
  `derived` line, naming the field and its type; a type with free type
  parameters is TS9011 (not supported yet); anything but the initializer of a
  top-level `const` is TS9010. Two instances in scope at a use site are the
  existing ambiguity error.
- Exported from the `typesugar` root and `@typesugar/typeclass` (runtime stub,
  like `summon`).

**Deprecated: `summon` and `= implicit()` deriving in place.** When no
instance is in scope they still derive one at the call site, a new copy at
each call, but now warn once per typeclass and type per file with TS9009,
which names the `derived` declaration to write. A later release removes the
fallback, and such a call becomes TS9001. TS9001 for a type declared outside
the project now suggests `derived<...>()`.
