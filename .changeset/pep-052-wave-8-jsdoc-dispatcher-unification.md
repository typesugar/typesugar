---
"@typesugar/transformer-core": minor
"@typesugar/transformer": patch
---

PEP-052 Wave 8: unified the two pipelines' JSDoc/decorator macro dispatch —
`@typesugar/transformer` now delegates to `@typesugar/transformer-core`'s
shared implementation instead of keeping its own ~875-line copy.

- FIXED: `@typesugar/transformer-core` silently ignored `@deriving`/`@derive`
  JSDoc tags ("unknown JSDoc macro tag" warning) and silently no-op'd real
  `@derive(...)` decorators — PEP-032 deleted the standalone `derive`
  attribute macro, and neither of transformer-core's dispatchers had the
  special case routing it to the real derive registry instead. Both fixed.
  `@adt` is now recognized as a JSDoc tag too (it was missing from the tag
  map entirely).
- FIXED (transformer-core only, found while porting): `expandDeriveDecorator`
  was missing the `TS9101`/`TS9103`/`TS9104` diagnostic checks (non-derivable
  field types, union without discriminant, empty types) and source-map
  preservation for derive-generated statements that `@typesugar/transformer`
  already had. `extractTypeInfo` was missing a method/accessor skip check,
  so it could incorrectly count a class's methods as derivable data fields.
  Both ported into the shared implementation.
- REMOVED: `@typesugar/transformer`'s private copies of the JSDoc tag map,
  dispatcher, decorator parsing/sorting, and derive-expansion logic — all
  now delegate to `@typesugar/transformer-core`.
