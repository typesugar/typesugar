---
"unplugin-typesugar": patch
---

The bundler plugin skips declaration files (`.d.ts`, `.d.mts`, `.d.cts`), which hold no code for a macro to expand. tsdown's declaration plugin hands the bundler a generated `.d.ts` per source file; none is on disk or in the Program, so each one rebuilt the Program. On dinero.js (136 files, five output configs) this was most of the remaining build overhead.
