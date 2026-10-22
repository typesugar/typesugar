---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An inlined `@impl` method no longer writes `any` for a type the call site can't name.
`mkP.make(1)`, where the call site doesn't import `P`, inlined as `({ x: 1 }) as any`, so the
emitted `.d.ts` said `p: any` (the source says `P`) and the expanded type check saw nothing. Such
a type is now written through an import type (`import("./ord.js").P`); one that can't be named at
the call site (the method's own type parameter, a type private to the instance's module) keeps the
call going through the instance. An argument narrower than its parameter (`extract(Nil)`) that
the body reads more than once is no longer asserted as `any` either: that call goes through the
instance.
