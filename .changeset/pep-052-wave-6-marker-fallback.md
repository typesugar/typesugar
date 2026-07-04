---
"@typesugar/core": minor
"@typesugar/std": patch
"@typesugar/fp": patch
"@typesugar/playground": patch
---

PEP-052 Wave 6: resolution-free operator/method syntax-marker fallback,
closing the gap for hosts (the browser playground) that cannot resolve
modules via the checker.

- NEW: `@typesugar/core` exports `registerSyntaxMarkerFallback`/
  `getSyntaxMarkerFallback` — a small, provider-declared registry that lets a
  package register "this exact import specifier activates operator/method
  syntax for typeclass X" without needing real module resolution.
  `scanImportsForScope` consults it as a purely additive fallback alongside
  the existing checker-based marker discovery.
- NEW: `@typesugar/std` registers all 21 of its syntax markers (13 method +
  8 operator) via this mechanism from its `./macros` entry; `@typesugar/fp`
  registers its one marker (`@typesugar/fp/syntax/show`) from its root `.`
  entry (fp has no separate `./macros` compile-time entry).
- FIXED: `@typesugar/playground`'s `transform()` — the actual in-memory host
  this wave exists for — never loaded std's or fp's compile-time
  registrations at all (both were only imported for runtime values via a
  separate iframe-sandbox bundle). A playground snippet importing e.g.
  `@typesugar/std/syntax/eq/ops` could not activate Eq operator syntax.
  Fixed with two side-effect imports; verified negligible bundle-size impact.
