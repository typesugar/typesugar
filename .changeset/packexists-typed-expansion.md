---
"@typesugar/type-system": patch
---

`packExists(w)` expands to a value typed like the runtime function's. The expansion
`(w => ({ use: f => f(w) }))(…)` had no `__exists_brand__`, so returning it where an `Exists<W>` is
expected was TS2741 under `typesugar check --strict` (three times in `existential.ts`), and its
`f` was implicitly `any` where nothing typed it. `use` is now `<R>(f: (witness: typeof w) => R): R`,
and the whole is asserted to the call's own type when that type has a name at the call site. Both
are erased: nothing changes at run time.
