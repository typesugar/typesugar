---
"unplugin-typesugar": patch
---

The bundler plugins build one TypeScript Program per build instead of one per module. The
transform hook invalidated every module the first time it saw it, even when the bundler handed it
the code that is on disk (what the Program was built from), so each module rebuilt the Program.
On neverthrow (5 modules) that was 5 Programs per Rollup build. A module whose first code differs
from disk (another plugin rewrote it) is still invalidated.
