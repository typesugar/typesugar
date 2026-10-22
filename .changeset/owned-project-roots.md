---
"@typesugar/transformer": patch
"@typesugar/core": patch
---

A directory no longer becomes the project's by having its own tsconfig. tsserver makes every
directory with a `tsconfig.json` its own project, so opening a vendored file whose directory
shipped one ran the vendored package's macros (`vendor/evil/node_modules/@typesugar/x`) and
would have run its `typesugar.config.*`; `typesugar expand vendor/evil/index.ts` did the same
(its program's only root file made the vendored directory the project). The project is now the
outermost project enclosing the directory a host starts from (the tsconfig's directory, the
program's files, the cwd): the highest directory above it with a `package.json`, `tsconfig.json`
or `pnpm-workspace.yaml`, below the home directory, with a git worktree checked out inside its
own repository counting as its own project. It owns that root and the workspace packages the
root declares, nothing else. check, build, watch, expand, approve-macros and the language
service all use this rule, and config files (`typesugar.config.*`, `.typesugarrc*`, package.json
`"typesugar"`) are read only from owned directories: a config file in any other directory on the
way up is not run, and a warning names it. `config.load()` takes `onlyIn` (core) for this.
`approve-macros` creates a new config file in the owned directory containing the tsconfig.
