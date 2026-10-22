---
"@typesugar/transformer": patch
---

A ts-patched `tsc -p packages/app` run from the repository root reads `packages/app`'s
`typesugar.config.*`: the ts-patch entry now searches for the config from the tsconfig's
directory, as the CLI, the editor and the bundler plugins do, instead of from the current
directory. The search still walks up to the repository root.
