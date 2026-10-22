---
"@typesugar/transformer": patch
"typesugar-vscode": patch
---

An error TypeScript finds in macro-generated code is reported at the nearest code of yours around
it instead of being dropped. The editor dropped every such error (a position with no source
mapping), and plain `typesugar check`/`build` did too, so an unannotated `@impl` instance with a
missing or misspelled member (TS1360 at the `satisfies` the expansion adds) built cleanly and
threw at run time; `check --strict` reported it at a line of the expanded code. All of them now
report it at the instance's initializer. `check` and `build` also type-check the expansion of
every `@impl` instance (as they already did for comprehensions and `match()` chains), since an
unannotated instance meets its typeclass only there.
