---
"@typesugar/transformer-core": patch
---

A `/** @derive(Meta) ... */` tag followed by description lines derives just its list: a JSDoc
tag's comment runs to the next tag, so the prose became part of the list ("Unknown derive:
'(Meta)\nUser table schema ...'"). Only the parenthesized list, or the comma-separated names that
start the tag, are read.
