---
"@typesugar/std": patch
---

`match()` sees through nested extractor patterns when checking exhaustiveness. Arms such as `Ok(Ok(v))`, `Ok(Err(e))` and `Err(e)` over a `Result<Result<number, string>, string>` (neverthrow's classes with `has value` / `has error` descriptors, or `ok = true` / `ok = false` ones) were reported as TS9226 "the scrutinee type is not enumerable" although they cover every value; they are now exhaustive, and dropping one of them is still reported. Such a match keeps every arm's test, so its output type-checks.
