---
"@typesugar/transformer": patch
---

Which macro packages run is decided by where they are. A macro package reached by a relative
import (or `export … from`) whose real path is not inside a `node_modules` directory is project
code — a vendored directory, a workspace sibling imported by path, a nested project, a
package's own `../src` — and loads with no approval and no warning, whatever its `package.json`
calls itself. Anyone who can write files into the repository can already edit the configs every
build runs (SECURITY.md, "What typesugar trusts"). A package inside `node_modules` is a
dependency and keeps the approval gate: `@typesugar/*` (and `typesugar`) are trusted, anything
else needs `security.allowedMacroPackages`. Its name is what Node resolution gives from the
importing file; a relative path into `node_modules` counts as a bare import of the package its
path names (not the name its `package.json` claims). Files inside `node_modules` are never
scanned, so a dependency's own imports load nothing. Project code is loaded by real path, never
under the name it claims, so it cannot stand in for the real package of that name.
`typesugar approve-macros` now runs exactly the build's discovery (new `scanMacroPackages`), so
it lists what the build would refuse, and `export … from` re-exports are scanned like imports.
