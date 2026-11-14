---
"unplugin-typesugar": patch
---

The bundler plugin keeps a TypeScript Program for each build that hands it different code for the same file, instead of one Program that switched between them. tsdown runs its ESM and CJS builds through one plugin instance, and with `dts: { emitDtsOnly: true }` one build gets each file's source and the other a stub (`export {}`). When the two builds' transforms interleaved, each switch rebuilt the Program, and in between a file's expansion saw the other build's stubs instead of what it imports. A switch no longer rebuilds, and each build's files expand against that build's own code.
