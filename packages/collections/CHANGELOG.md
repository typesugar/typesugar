# @typesugar/collections

## 0.1.2

### Patch Changes

- 76672a0: PEP-053 Waves 4–5: the compiler's hard-coded builtin instance table is gone.
  The ~28 static `registerInstanceMethods(...)` registrations (source-code-as-
  strings copies of the fp/std/effect instances), the deprecated
  `registerInstanceMethods` function, and the internal-registration machinery
  are deleted from `@typesugar/macros`. Instance method bodies now come
  exclusively from source extraction — the same rules for std/fp/effect
  instances as for user instances, no builtin magic. The 16 primitive
  intrinsics (`eqNumber` → `a === b`, …) and the per-program AST registry
  (`registerInstanceMethodsFromAST`) remain. `eitherBifunctor` and
  `flatMapStream` (registrations with no corresponding source instance) are
  dropped. Residual `specialize()`-as-API comment mentions in std/effect/
  collections/validate sources are rewritten for the always-on model.
- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- Updated dependencies [928566a]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [563e46b]
- Updated dependencies [76672a0]
- Updated dependencies [ab72bde]
  - @typesugar/std@0.2.0

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/std@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/std@0.1.1-rc.0
