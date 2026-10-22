---
"@typesugar/transformer": patch
---

An import whose every use was inlined is not emitted. `mkP.make(1)` on an imported `@impl`
instance is inlined to `({ x: 1 })`, but the JavaScript kept `import { mkP } from "./ord.js"`
(TypeScript decides import elision from the source as written), loading the module for nothing. A
binding the expansion no longer references is now dropped from its import, and a declaration left
with none is not emitted, as TypeScript does for an import used only as a type. A binding still
used (a call that wasn't inlined, a value use, a re-export), the declaration's other bindings and
side-effect imports stay; nothing changes under `verbatimModuleSyntax` or `emitDecoratorMetadata`.
