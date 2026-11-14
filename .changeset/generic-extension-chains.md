---
"@typesugar/transformer-core": patch
"@typesugar/macros": patch
"@typesugar/transformer": patch
---

Extension-method chains through generic functions, found porting remeda:

- `users.sortBy(f).groupBy(g)` is rewritten to `groupBy(sortBy(users, f), g)`. The chained call
  used to be left as written, a TypeError at run time that `typesugar check` did not report,
  when the inner function's return type is a mapped or conditional type over its type parameters
  (remeda's `ReorderedArray<T>`, `Chunk<T, N>`), also through a variable it initialises. Only
  overloads that take the rewritten call's argument count are considered, so a purried
  data-last overload is no longer taken for the data-first one. A chained call that still cannot
  be rewritten is now an error.
- `typesugar check` no longer reports TS2551 ("Did you mean 'sort'?") for an extension call whose
  name is close to a member of the receiver (`xs.sortBy(...)` on an array), nor TS7006 for a
  callback inside an array or object literal argument (`xs.sortBy([(u) => u.score, "desc"])`).
- Under `noUnusedLocals`, `typesugar check`, `build` and `watch` no longer report an import used
  only through method syntax as unused (TS6133/TS6192); a declaration with some bindings used
  that way reports only the others.
