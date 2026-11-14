---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

A receiver's own method now always wins over a same-named import, as the extension-methods guide's resolution order says. An imported bare function used to override it, so `import { match } from "@typesugar/std"` (or from ts-pattern) turned every neverthrow `result.match(onOk, onErr)` in the file into `match(result, onOk, onErr)`, which was left unbound once the macro's import was elided. An import still stands in for a member that can't be called (a `step: number` field).

On a value with no such member, `value.name(...)` is no longer dispatched to an imported `name` macro by name with the method call as its argument (which failed with "Fluent match chain does not root in a call expression"). It is an extension call, `name(value, ...)`, and when `name` is a macro that call now expands like any other call to it.

An optional method (`fold?(...)`, which is `F | undefined` under `strictNullChecks`) and a member typed as a union of function types also count as the receiver's own method. When a macro is reached only through the method form, its import is now removed from the output, as it is for a direct call.
