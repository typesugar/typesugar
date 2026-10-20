---
"@typesugar/transformer-core": patch
---

A macro that hands back the call unchanged (for example `comptime(...)` while comptime evaluation
is off in the editor) is no longer recorded as an expansion of itself. The editor showed the call
again as its inlay hint (`comptime(() => 6 * 7)  = comptime(() => 6 * 7)`); it now shows nothing
until there is a value.
