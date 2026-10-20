---
"@typesugar/macros": minor
---

**Breaking:** derived `Clone` is field-wise, like Rust's `#[derive(Clone)]`,
instead of a shallow copy. Each field is cloned through its own `Clone`, so
mutating a clone no longer changes the original:

- primitives and functions are copied as they are; arrays, readonly arrays
  and tuples element by element (`a.xs.slice()`, `a.rows.map(e => e.slice())`);
  `Date`, `Map`, `Set`, `RegExp` and typed arrays into new ones;
- a field whose type has a `Clone` instance in scope (an `@impl`, or a
  `@derive(Clone)` companion) goes through that instance;
- any other object type, and a discriminated union (per variant, with a
  `switch`), is cloned structurally by the same rules, inlined; a type that
  contains itself gets a local helper, so derivation never loops;
- `any`, `unknown`, `object` and type parameters are copied by reference
  (there is no type to clone by; a `Clone<any>` instance in scope is used),
  and so is a class with no `Clone` instance, with a warning.

The copy is still a spread of the original with the cloned fields set on top,
so an absent optional field stays absent and undeclared properties are kept.
Before, `summon<Clone<T>>()` and `@derive(Clone)` produced `({ ...a })`, whose
nested arrays and objects were shared with the original. Code that relied on
that sharing must now share explicitly.

This also includes two fixes from the same branch: a derived `Clone` no longer
adds `undefined` keys for absent optional fields or drops undeclared
properties (it listed the declared fields), and `@derive(Clone)` /
`summon<Clone<T>>()` on a discriminated union no longer fails with TS9106.

`summon<TC<T>>()` with no instance in scope now derives for the type `T`
names, so for `interface Feature<G = Geometry, P = Props>` the fields are
`Geometry` and `Props`, not the type parameters `G` and `P`.

Found by the Turf case study (Stage 1, findings F8 and F9): a derived `Clone`
for the `@types/geojson` shapes now passes all 46 of `turf-clone`'s
assertions.
