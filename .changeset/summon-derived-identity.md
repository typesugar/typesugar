---
"@typesugar/macros": patch
---

- `summon<Eq<X>>()` no longer resolves to a same-file `derived<Eq<X>>()` const
  whose derivation failed (it emitted `const s = m` with `m` the un-expanded
  stub). A failed `derived<...>()` is not an instance, wherever it is declared
  relative to the use.
- Deriving finds the type by identity: the symbol the type reference resolves
  to, not a lookup of its name at the top of the file, so `summon<Eq<Point>>()`
  in a function with its own `interface Point` (or `Range`, beside the DOM's)
  derives that type, and `derived<Eq<geo.Point>>()` through a namespace import
  works.
- One instance reached through two import bindings (`import { Vec }` from one
  module, `import { Vec as V2 }` from another that re-exports it) is one
  instance, not "Ambiguous Eq instance for type 'Vec': Vec.Eq, Vec.Eq".
