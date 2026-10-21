---
"@typesugar/transformer": patch
"unplugin-typesugar": patch
---

A macro error reported by the Node loader (`node --import typesugar/register`) or a bundler plugin
reads `file:line:col: [typesugar] [TS9209] ...`, not `[typesugar] [typesugar] [TS9209] ...`.
