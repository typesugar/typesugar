---
"@typesugar/transformer": patch
---

`typesugar watch` runs the expanded type check `check` and `build` run: the expansion of a
comprehension, `match:` case, `ensures:` block or fluent `match()` chain whose bound names the
suppression filter hid is type-checked on every rebuild, so `user.nme` in a comprehension is
reported (TS2551) instead of "Found 0 errors". It reuses the watch program's SourceFiles and
the expansion each file was last emitted with.
