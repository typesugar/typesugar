---
"@typesugar/std": patch
"@typesugar/macros": patch
"@typesugar/eslint-plugin": patch
---

`match: switch` has guards: `case P && cond:`. When the condition is false the switch tries the next case, and the condition can use the names `P` binds (they are read from the scrutinee, `w` → `s.w`). `case _ && cond:` is a condition alone, which is how a value computed at run time is compared (`case _ && n === twice(m):`). A guarded case covers nothing for exhaustiveness, as `.if()` in the fluent form. `typesugar check` reports a type error in a guard at the guard, and nothing about the label as written; the ESLint processor drops `no-constant-binary-expression` on a guarded label's pattern.
