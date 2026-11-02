---
"@typesugar/transformer": patch
---

`typesugar watch`'s "Found N errors" summary counts the errors it printed. It used to be
TypeScript's count, which includes the diagnostics the suppression rules hide and none of the
macro errors (a project with a statement-position comprehension printed two errors and said
"Found 18 errors"). Diagnostics in a file with an expression-position comprehension are reported
at the positions as written, as `check` and `build` report them, also after an edit on a
case-insensitive file system, and the comprehension preprocessor's own errors (TS9223) are
reported in watch too.
