---
"@typesugar/macros": patch
"@typesugar/core": patch
---

`derived<Eq<Array<number>>>()` reported TS9107 for a field named
`__@unscopables@22`, and `derived<Eq<Map<string, number>>>()` silently
generated an `Eq` that compared `a["__@toStringTag@35"]`: a built-in type from
TypeScript's lib was "derived" from its methods and internals. It is now
TS9106, saying it is a built-in and to use a library's instance (std's) or
an `@impl` of your own; `summon`'s TS9001 help for one no longer points at
`derived<...>()`.

An `@impl` tag on a `derived<...>()` const is compared with the call's type
argument as types, not as text: an alias of the type (`/** @impl Eq<P2> */`
with `type P2 = Pt` on `derived<Eq<Pt>>()`) agrees, and the tag's typeclass
is resolved through imports and aliases.
