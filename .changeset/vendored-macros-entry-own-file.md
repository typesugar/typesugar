---
"@typesugar/transformer": patch
---

Security: a vendored macro package's macros entry is its own file. Imported by a relative
path, a vendored package resolved `${name}/macros` by name from its package.json, and
without an `exports` map Node found the npm copy of the same name in the project's
`node_modules`, which then ran unapproved (and `approve-macros` listed nothing). The entry
is now resolved through the package's own `exports` map or as a path in its directory; an
entry whose real path is outside the package is refused with a warning, and a bare entry
naming another package (`"macros": "@typesugar/macros"`) is a dependency that keeps the
approval gate.
