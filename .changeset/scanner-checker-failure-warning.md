---
"@typesugar/macros": patch
---

A type-checker failure while looking for a same-file `@derive` companion (a use above the
declaration) is now a warning naming the declaration it skipped, instead of being swallowed.
