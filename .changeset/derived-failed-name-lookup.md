---
"@typesugar/macros": patch
---

A `derived<TC<T>>()` const whose derivation failed is no longer used as an instance by the
by-name scope walk either: `= implicit()`'s by-name fallback emitted `same(x, x, eqInner)` with
`eqInner` the un-expanded stub (only the type-based resolver dropped it). Companion-path
extraction and do-notation instance lookup go through the same walk. `findInstanceInScopeByName`,
`findEmittableInstanceByName`, `resolveDoNotationInstance` and `InstanceExtractionContext` now
take a full `MacroContext`.
