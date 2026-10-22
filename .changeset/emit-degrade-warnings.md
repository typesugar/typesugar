---
"@typesugar/transformer": patch
---

Two emit-time checks that degraded silently when the type checker threw now
print a one-line `[typesugar]` warning: the check that keeps a re-export of a
value `@derive` creates (a failure could drop `export { Vec } from "./vec"`
from the output without a word), and the read of a file's exports for the
`@opaque` declaration annotations.
