---
"@typesugar/transformer": patch
"@typesugar/transformer-core": patch
---

An exported declaration initialized by an inlined instance call keeps the type the source gives it
in the `.d.ts`. The declarations are emitted from the expansion, where `mapArr.map([1, 2], f)` is
the method's body: `export const r` was declared `number[]`, though the source's `r` is `unknown`
(the typeclass member's return type), so the declarations changed with whether a call was inlined.
As for `@opaque` types, such a declaration (a const, a class property, `export default`, or a
function or method whose body has an inlined call) is now annotated with the source's type, unless
that is `any`.
