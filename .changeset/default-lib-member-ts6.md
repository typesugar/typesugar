---
"@typesugar/macros": patch
---

An imported function's `.call`/`.bind`/`.apply` (a member every function has from the standard
library) is never taken as an extension method on TypeScript 6 either: default-lib files were
recognised by their `/// <reference no-default-lib="true"/>`, which TypeScript 6's lib files no
longer carry, so `o.call(1)` became `helper.call(o, 1)`. They are now recognised by the program.
