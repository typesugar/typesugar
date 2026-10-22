---
"@typesugar/transformer": patch
---

A macro package's name is trusted only for the package the project itself resolves it to.
Names are resolved from directories the project owns — the outermost project enclosing the
tsconfig's directory (or the files it lists, or the build's current directory), and the
workspace packages it declares (`pnpm-workspace.yaml`, `package.json` `workspaces`) — never from a directory reached by
following imports into vendored code, and never through a package's own `exports`
self-reference. Before this, `typesugar check` executed the macros of a vendored directory
claiming `"@typesugar/totally-official"` (directly, through its own `exports` map, or through a
copy in its own `node_modules`), and a vendored file's bare `@typesugar/x` import loaded
`vendor/evil/node_modules/@typesugar/x`. A relatively imported package now loads when it is one
of the project's directories (its own examples and tests importing `../src`, a declared
workspace package) or its name, looked up from them, lands in the same directory (a workspace
link or `file:` dependency); the usual `@typesugar/*` / `allowedMacroPackages` rules then apply.
Anything else is skipped with a warning naming its path. `typesugar approve-macros` now runs
exactly the build's discovery (new `scanMacroPackages`), so it lists what the build would refuse,
including these unverified packages, which it never approves. `export … from` re-exports are
scanned like imports. Loaded macro entries are tracked by real path, not by claimed name.
