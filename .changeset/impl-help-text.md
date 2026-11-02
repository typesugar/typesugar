---
"@typesugar/core": patch
"@typesugar/macros": patch
---

Diagnostics suggest `/** @impl Typeclass<Type> */` for a hand-written instance. The
"no instance" help used to say "provide @instance Eq<Color>", and a bare `@impl` said
`@impl("Type")` / `@impl(Typeclass, Type)`: decorator forms, which TypeScript rejects
on a `const`.
