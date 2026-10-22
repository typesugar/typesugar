---
"@typesugar/fp": minor
"@typesugar/std": minor
---

The built-in extractors are `Destructure` instances owned by the packages that
own the types. `@typesugar/fp` ships `destructureSome`/`destructureNone`,
`destructureLeft`/`destructureRight`, `destructureCons`/`destructureNil` and
(new) `destructureValid`/`destructureInvalid` next to Option, Either, List and
Validated, each with a `@destructure` descriptor, so `match(o).case(Some(v))`
compiles to the same inlined test and binding as before (pinned in tests).

**Breaking:** `match.ts` no longer special-cases these names. An extractor
follows the constructor's symbol: a `Some`/`Left`/`Ok`/... that is not fp's
needs its own instance. The `_tag`-based fallback (used when the scrutinee's
type had a `_tag` property) and the `Ok`/`Err` extractors for
`{ ok: true; value }` results are gone: declare instances with
`@destructure _tag = "Some" -> value` / `@destructure ok = true -> value`, or
use object patterns. Exhaustiveness for key tests is now general: `has k`
extractors cover a union when every member has a required `k`.
