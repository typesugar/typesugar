---
"@typesugar/macros": patch
---

`@impl TC<T>` for a type declared in another file or package no longer warns "no 'T.TC'
companion generated". It is how every instance for a type you don't own is written (effect's
`@impl FlatMap<Effect>`, fusion's `@impl Functor<LazyPipeline>`), nothing at the `@impl` can
change it, and a `T.TC` written anywhere is a TypeScript error where it is written. The warnings
that the `@impl` can act on stay: a class declared after the instance, a const or ambient enum,
a type that is not a plain name.
