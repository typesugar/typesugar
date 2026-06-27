---
"@typesugar/std": patch
"@typesugar/macros": patch
---

PEP-049 Wave 4 (test debt):

- `@typesugar/std`: rename the boolean extension `then(b, fn)` → `andThen(b, fn)`
  (and the matching `Boolean` global augmentation). A top-level ESM export named
  `then` makes the module namespace a thenable, so `await import()` of
  `extensions/boolean` rejected with `undefined` — the module was effectively
  un-dynamically-importable. Use `b.andThen(() => …)` for the lazy
  conditional; `thenSome`/`elseSome`/`fold` are unchanged.
- `@typesugar/macros`: fix `@hkt` `_` detection inside object type literals.
  `type ObjF = { value: _ }` is now correctly recognized as Tier 3 and expands
  to `this["__kind__"]` (previously the `_` inside a `TypeLiteral`
  `PropertySignature` was skipped and the alias mis-classified as Tier 2).
