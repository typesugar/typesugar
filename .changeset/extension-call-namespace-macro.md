---
"@typesugar/transformer-core": patch
---

An extension call through a namespace import of a macro module (`import * as std from "@typesugar/std"; shape.match(handlers)`, rewritten to `std.match(shape, handlers)`) now expands like a direct call to the macro and drops the import if nothing else uses it. It was left as a run-time call. The macro is resolved by symbol: the module the namespace binds, and its export.
