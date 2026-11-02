---
"@typesugar/transformer": patch
---

`typesugar doctor` checks ts-patch, its `prepare` script and the tsconfig `transform` plugin only
for a project that compiles through a patched `tsc` (ts-patch installed, or the transform plugin with
a `tsc`/`tspc` script). A project that builds with `typesugar build` or runs under `node --import
typesugar/register` failed them unless `unplugin-typesugar` was a direct dependency; they are now
skipped there.
