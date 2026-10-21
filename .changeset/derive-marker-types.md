---
"typesugar": minor
"@typesugar/macros": patch
---

The derive markers are also their typeclasses' types

- `Eq`, `Ord`, `Clone`, `Debug`, `Hash`, `Json`, `Semigroup` and `Monoid` from
  `typesugar` are now both the derive marker (a value, as before) and the
  `@typesugar/std` typeclass of that name (a type alias of the interface, not a
  copy); `Show` is `@typesugar/fp`'s `Show`. One import serves `@derive(Clone)`
  and `summon<Clone<Point>>()`. Before, the marker was only a value, so plain
  TypeScript reported TS2749 on `summon<Clone<Point>>()` and typed it as `any`,
  and `const copy = summon<Clone<Point>>().clone(p); copy === p` stayed
  reference equality unless `copy` was annotated. `typesugar` now depends on
  `@typesugar/std` and `@typesugar/fp` for these types; its runtime entry still
  loads neither (the aliases are type-only). `Default` and `TypeGuard` have no
  typeclass interface yet and stay values only.
- `summon<TC<T>>()` and `derived<TC<T>>()` find the typeclass `TC` names
  through the checker (imports, renames, forwarding type aliases) instead of by
  its spelling, so `import { Clone as Copyable } from "typesugar"` and
  `summon<Copyable<Point>>()` resolve `Point`'s `Clone` instance.
