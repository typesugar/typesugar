---
"@typesugar/macros": patch
---

The instance scanner no longer swallows a type-checker failure: a module whose exports can't be
read, a re-export whose alias can't be followed, an instance type that can't be resolved (matched
by name only), a `@derive`'d type's companions and a type an `@impl` tag names are each reported
once as a warning (at the use site's file when the failure is in another file).
