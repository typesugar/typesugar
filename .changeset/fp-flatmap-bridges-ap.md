---
"@typesugar/fp": patch
---

The FlatMap bridge instances `flatMapOption`, `flatMapIO` and `flatMapList` have `ap`. They are
`@impl FlatMap<…>` instances, and fp's `FlatMap` extends `Apply`, so without it `typesugar check
--strict` reported each instance, and a `FlatMap` summoned as one of them had no `ap` at run time.
`ap` is derived from the instance's own `flatMap` and `map`.
