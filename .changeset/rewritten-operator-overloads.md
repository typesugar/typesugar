---
"@typesugar/macros": patch
---

`typesugar check` judges an overloaded call by all its overloads when an argument is a rewritten
operator. TypeScript resolves `f(a * b)` against the overload that takes the `number` it sees,
so with `f(x: number): string; f(x: Rational): Rational` check invented a TS2345 ("Rational is
not assignable to number") and kept TypeScript's TS2322 for the `string` result, although the
compiled `f(numericRational.mul(a, b))` is the `Rational` overload. Now a call some overload
takes with its arguments as rewritten has no error (and has that overload's return type), a call
none takes is TS2769 "No overload matches this call", and the re-check of the arguments after a
rewritten one does the same.
