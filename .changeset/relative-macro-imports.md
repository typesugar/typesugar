---
"@typesugar/transformer": patch
---

A macro imported by a relative path to its own package is expanded: `packages/mapper/examples/
showcase.ts` imports `transformInto` from `"../src/index.js"`, and the macro loader only looked
at bare specifiers, so `@typesugar/mapper`'s macros were never loaded and the call ran its
runtime stub ("transformInto() was called at runtime"). A relative import now loads the macro
entry of the package it lands in (the nearest `package.json` above the imported file) when that
package declares `typesugar.macros`, under the same trust rules as a bare import. A load
failure is a warning, except in a file inside that package (its own build).
