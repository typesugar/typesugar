---
"@typesugar/std": patch
---

A call pattern whose name has no `Destructure` instance is a type test
(`value instanceof Name`) that binds the whole value to its one argument. Two
silent miscompilations of it are now errors: more than one argument
(`Money(a, c)` bound only `a` and left `c` unbound or captured from an outer
scope), and a name that is not a class or built-in constructor (an interface
with a factory function, `Pt(p)`, compiled to an `instanceof` that throws).
A checker failure while looking up a `Destructure` instance is reported as a
warning instead of being swallowed.
