---
"@typesugar/sql": patch
---

Source comments on the `*Registry` maps say what they are: name-keyed runtime maps for your own
code, which nothing in typesugar reads (compile-time resolution finds instances in scope). They
used to say instance resolution used them and that `@deriving(Read)` generated code reading them.
The JSDoc examples use `/** @derive(Read) */`.
