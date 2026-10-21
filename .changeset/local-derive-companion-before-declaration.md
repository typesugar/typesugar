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
reads another file's, so both orders compile to `P.Eq`. A use at module top
level above the declaration, which runs before the companion is assigned, is
still TS9001, now saying so and to move the declaration up.
