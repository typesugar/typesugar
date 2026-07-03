---
"@typesugar/fp": minor
"@typesugar/macros": patch
---

PEP-052 Wave 5: `Show` method-sugar activation, and a latent
`resolveTypeString` bug fix.

- NEW: `Show`'s interface now carries `@typeclass`, and a new
  `@typesugar/fp/syntax/show` marker (`@syntax-methods Show`) activates
  `.show()` method sugar — mirroring how Eq/Ord's method syntax is gated.
  `Show` has no operator form, so there is only one activation tier.
- FIXED: `resolveTypeString` (used by the instance scanner to resolve
  `@impl <TC><Type>` type strings) silently resolved the `symbol`/`unknown`/
  `object` keyword types to `any` on some `ts.TypeChecker` configurations
  (an unbound synthetic node quirk), which — because `any` is bidirectionally
  assignable to/from everything — could make two unrelated instances
  (e.g. `@impl Show<symbol>` and `@impl Show<number>`) spuriously report as
  "ambiguous" for every other type. Added the checker's internal
  `getESSymbolType`/`getUnknownType` fast paths and hardened the fallback so
  any keyword resolving to `any` (other than `any` itself) is treated as
  unresolvable rather than silently wrong.
