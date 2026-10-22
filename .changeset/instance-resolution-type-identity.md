---
"@typesugar/macros": patch
---

Instance resolution prefers the instance declared for the type itself over one for a type of the
same structure. Two classes with the same fields (`class UserId { constructor(public value: string) {} }`
and an `Email` of the same shape) are assignable to each other, so with both `@derive(Eq)`'d,
`===` on two `UserId`s, `summon<Eq<UserId>>()` and `implicit()` failed with "Ambiguous Eq instance
for type 'UserId': UserId.Eq, Email.Eq". The tie is now broken by symbol identity; a structural
match still resolves a type that has no instance of its own.
