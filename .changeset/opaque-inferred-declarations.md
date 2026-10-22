---
"@typesugar/transformer": patch
---

Declarations keep an `@opaque` type the source infers. They come from the expanded program, where
the type is erased, so `export const a = Some(3)` was declared `declare const a = 3;` and `function
mk(n: number) { return n > 0 ? Some(n) : None; }` returned `number | null` (`typesugar build` and
tsup's `withTypesugar({ dts: true })` alike). An exported declaration whose inferred type involves an
`@opaque` type now gets that type, from the source as written, as an annotation on the copy the
declarations are emitted from (`a: Option<number>`; `import("@typesugar/fp").Option<number>` where
the file doesn't import the type by name). Variables, functions, `export default` and the public
members of exported classes; the JavaScript is unchanged.
