---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
---

An `@impl` method whose body uses a class as a value (`make: (n) => new Pt(n)`) is no longer
inlined where the call site imports that class only as a type (`import { isPt, type Pt }`,
`import type { Pt }`, or through an `export type` re-export). It compiled to `new Pt(3)` with no
binding for `Pt`, a ReferenceError at run time, and the build exited 0. Such a call now goes
through the instance and warns TS9602 naming the identifier; a plain value import still inlines.
