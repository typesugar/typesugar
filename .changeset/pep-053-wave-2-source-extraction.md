---
"@typesugar/core": minor
"@typesugar/macros": minor
"@typesugar/transformer": minor
"@typesugar/transformer-core": minor
---

PEP-053 Wave 2: source-based instance extraction now covers everything the
static builtin table covered. Auto-specialization recognizes instances across
import aliases (including renames), identifier-alias consts
(`const stdFlatMapArray = flatMapArray`), zero-arg factory instances
(`eitherFunctor<E>()`), indirect object-literal members
(`map: optionFunctor.map`, shorthand `{ map }`), and companion paths
(`Point.Numeric`). Acceptance criteria are unified across both pipelines:
an `@impl`/`@instance` tag OR a typeclass-shaped type annotation suffices.

Cross-module method bodies that reference the instance module's local helpers
or imports are NOT inlined — those calls fall back to dictionary passing
(always correct) instead of capturing dangling identifiers.

The extraction implementation is now shared (`@typesugar/macros`
instance-extraction module) and consumed by both the legacy transformer and
transformer-core, replacing the duplicated per-pipeline copies. New
`cloneNodeDeep` utility in `@typesugar/core` protects foreign-file ASTs from
in-place position stripping during inlining.
