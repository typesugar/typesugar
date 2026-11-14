---
"@typesugar/std": patch
"@typesugar/transformer-core": patch
---

`match` works through a namespace import: `std.match(value, handlers)`, `std.match(value).case(...)`, and the extension call `shape.match(handlers)` (rewritten to `std.match(shape, handlers)`) expand as their bare-import forms do. The macro took any `x.match(...)` callee for a fluent-chain link and failed with "Fluent match chain does not root in a call expression".
