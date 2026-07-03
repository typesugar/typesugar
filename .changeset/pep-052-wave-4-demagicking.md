---
"@typesugar/core": patch
"@typesugar/macros": minor
"@typesugar/std": patch
"@typesugar/fp": minor
"@typesugar/effect": patch
"@typesugar/transformer": patch
"@typesugar/transformer-core": patch
"@typesugar/typeclass": patch
---

PEP-052 Wave 4: de-magicking — HKT typeclass knowledge is
declaration-derived and the dead post-registry surfaces are gone.

- REMOVED: `hktTypeclassNames`, `registerHKTTypeclass`, the
  `hktExpansionRegistry` hardcoded seeds, and the hand-written HKT signature
  templates. `isHKTTypeclass` now derives from the `@typeclass` interface
  declaration (type parameter used as `Kind<F,…>`, including through
  `extends` chains — the op-index flattens heritage). fp's typeclass
  interfaces (Functor…Alternative) now carry `@typeclass` tags and are read
  exactly like third-party typeclasses.
- REMOVED: the `InstanceMeta` type, all no-op 1-arg
  `registerInstanceWithMeta` calls, the legacy transformer's import
  pre-scan, the dead `knownTypeclasses` scope chain
  (`isTypeclassInScope`/`getInScopeTypeclasses`/`registerImportedTypeclass`),
  the test-only ResultAlgebra helpers
  (`unsafeResultAlgebra`/`hasResultAlgebra`/`getAllResultAlgebras`), and
  `register-instances.ts` (`registerStdInstances` survives as a deprecated
  runtime no-op stub).
- NEW: `@do-instance-module <specifier>` JSDoc tag — do-notation instance
  providers self-describe their activation import; the TS9225 hint consults a
  program-wide index first and falls back to a small static table only for
  providers whose declaration files are unreachable in the program.
