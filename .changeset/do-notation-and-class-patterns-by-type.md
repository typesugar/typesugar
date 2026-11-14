---
"@typesugar/macros": patch
"@typesugar/std": patch
---

Do-notation finds a `FlatMap`/`ParCombine` instance by the first bind's type when no instance carries its printed name. With `@impl FlatMap<Result>` for a union `Result = Ok | Err`, a bind typed `Ok<…>`, `Err<…>` or an alias of `Result` used to fail with TS9225 ("No FlatMap instance for 'Ok'"); it now resolves when every class or interface the bind's type is made of is part of the instance's type. Name matches still take precedence.

`typesugar check` and the language service no longer report TS2348 ("Value of type 'typeof X' is not callable") for a class used as an extractor pattern (`.case(Ok(v))`, `case Ok(v):`); the expansion never calls it. The error is still reported outside patterns, including in an arm's result.
