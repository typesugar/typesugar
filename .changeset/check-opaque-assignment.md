---
"@typesugar/transformer": patch
---

`typesugar check` (and the `emitDeclarations()` API) no longer report an assignment between an
`@opaque` type and its underlying representation: `const o: Option<number> = numberOrNull` with
`Option` from `@typesugar/fp`, the same value passed as an argument, and a same-file
`/** @opaque A | undefined */` type. Both filter the source's diagnostics before expanding anything,
and the TypeRewriteAssignment rule matches against the `@opaque` types the expansion registers, so
it hid nothing there; `build` and the editor, which filter later, did. The program's `@opaque`
types (its own sources' and those of the `.d.ts` files they import) are now registered before the
filter runs.
