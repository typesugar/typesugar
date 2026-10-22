---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An operator, `summon` or `implicit()` above its type's `@derive` declaration
in the same file didn't find the companion: the local scope only saw it once
the derive had expanded. `function f(a: P, b: P) { return a === b; }` before
`/** @derive(Eq) */ interface P` was a TS9001 pointing at a derive that had
succeeded (and `summon<Eq<P>>()` derived a second instance in place, TS9009).
The local scope now reads the file's `@derive` annotations as the import scan
reads another file's, so both orders compile to `P.Eq`, when the use is inside
a function that can only run later: one bound to a name (a function
declaration, `const f = () => ...`, a class member) that nothing above the
declaration calls, except another such function. A use that can run before
the companion is assigned (module top level, an immediately invoked function,
a callback passed to a call at top level such as `xs.filter(v => v === q)`, a
function called above the declaration, and a class's definition-time code:
a static initializer or static block, a computed member name, a decorator,
or a member a decorator receives) is still TS9001, saying so and to move the
declaration up; it is never rewritten to a `P.Eq` that would throw. A
reference to a class at definition time (from its own static parts, `this`
in them included, or from code above the declaration) runs only what it
runs: `new C()` runs the constructor and instance initializers, `C.m()` or
`new C().m()` runs `m`, a member referred to directly may be called, and the
class or an instance handed to other code may have any member called; so
`static shared = new C()` or `static kind = C.name` leaves `C`'s methods
rewritten, while `static early = new C().same(a, b)` makes `same` TS9001.
