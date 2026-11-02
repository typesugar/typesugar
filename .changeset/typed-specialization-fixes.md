---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

Fixes found with instances for types you don't own (Turf case study):

- An instance whose method calls a macro (a recursive `clone: (t) => ({ ...t,
children: t.children.map((c) => summon<Clone<Tree>>().clone(c)) })`) was
  inlined at call sites from its unexpanded source, leaving the raw `summon`
  call in the output ("summon is not a function" at run time). Such a method
  is no longer inlined; it is called through its dictionary.
- `implicit()` auto-specialization emitted the specialized copy's parameters
  without types (`a => ...`), so the expanded TypeScript failed
  `noImplicitAny`. An annotation that names a type parameter now gets the
  call's type (`(a: Feature): Feature => ...`), and each instantiation gets
  its own copy. The specialization cache is also keyed by a stable function
  identity, not the checker's lazily assigned `symbol.id`, which could change
  between two calls of one function (or be 0 for two different ones).
- Derived `Eq` rejected a field typed with an alias of an array or tuple
  (`Position`, `BBox` from `@types/geojson`, F12), because the field check
  read the type's text. The check now runs the same code that generates the
  comparison, which compares arrays, tuples and unions of them element by
  element; a nullable field's exact instance (`Eq<GeoJsonProperties>`) is
  used when one is in scope; and a sum type's variant fields are compared
  through locals of the variant's type, so each comparison is type-checked.
- A union-typed field with a `Clone` instance in scope (`derived<Clone<Geometry>>()`)
  is cloned through it instead of being re-derived inline.
- Deriving for a type exported from the same file (`export class Box<T>`)
  found no type to derive from.
