---
"@typesugar/transformer": patch
---

`typesugar expand --ast` prints the expanded syntax tree instead of crashing with "Converting
circular structure to JSON". Each node has its `kind`, its real `kindName` (`VariableStatement`,
not the `FirstStatement` range marker), its own primitive fields and its syntactic children;
macro warnings go to stderr. Expanding a vendored file no longer runs that vendored package's
macros.
