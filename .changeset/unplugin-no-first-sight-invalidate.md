---
"unplugin-typesugar": patch
---

Builds no longer rebuild the TypeScript Program once per file. The plugin invalidated every file the first time the bundler handed it over, even when the text was what the Program had just read from disk, so each file threw the Program away. A 136-file tsdown build (dinero.js, five output configs) took 29 s with the plugin against 1.8 s without it. The plugin now invalidates only when the bundler's text differs from what the pipeline last read (the previous code, else the disk), as the ESLint processor already does.
