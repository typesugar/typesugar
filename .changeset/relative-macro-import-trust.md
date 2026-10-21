---
"@typesugar/transformer": patch
---

A macro package reached by a relative import is no longer trusted by the name in its own
`package.json`. A relative path reaches any directory, so `vendor/evil/package.json` claiming
`"@typesugar/totally-official"` had its macros entry executed by `typesugar check`. Its macros now
load only when that name, resolved from the project as a bare import, lands in the same directory
(a workspace link or `file:` dependency; for a file inside the package, resolved from the
package's parent), or when the build runs inside the package itself; the usual `@typesugar/*` /
`allowedMacroPackages` rules then apply. Anything else is skipped with a warning naming its
directory, and an unapproved relatively imported package is now a warning too, and is listed by
`typesugar approve-macros`. Loaded macro entries are tracked by real path, not by claimed name.
