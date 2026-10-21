---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
---

`typesugar check --strict` / `build --strict` type-check the expansion the build itself makes (the
code it emits, and the declarations come from), and filter its diagnostics against that expanded
program. It used to expand detached copies of every file first, where the macros asked the checker
about nodes it never bound: some calls expanded wrongly or not at all (fp's `case Some(v)` in a
`match: switch`), errors such as "Cannot find name 's'" for a parameter leaked into the source's own
diagnostics, and the expanded program's diagnostics were filtered against the source as written,
whose text their positions don't refer to. An error the source already reports is not repeated at
its expanded position.

A prose "@opaque" in a JSDoc comment ("a call on an @opaque type") is no longer read as an `@opaque`
tag: typesugar's own `index.d.ts` got a syntax error in the `--strict` view of `@opaque` types, and
a library's `.d.ts` could register an interface as opaque.
