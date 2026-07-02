---
"@typesugar/transformer": minor
"@typesugar/transformer-core": minor
---

PEP-053 Wave 3: one specialization pipeline. The legacy transformer's private
clone of the specialization pass (~700 lines) is deleted in favor of the
shared implementation in `@typesugar/transformer-core`, now exported from its
package index. Production paths (ts-patch, unplugin, CLI, LSP) and the
playground run the same code.

Unification deltas (all in the direction of correctness): hoisted
specializations of generic functions no longer carry parameter type
annotations that reference stripped type parameters; void-returning functions
no longer emit a spurious `[TS9602] no return statement` skip warning; inlined
derived-instance calls strip comment trivia in both pipelines (previously
legacy-only).
