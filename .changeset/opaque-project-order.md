---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
---

An `@opaque` type declared in one file of a project is erased in every other file whichever is
transformed first. Its rewrite used to be registered only when the declaring file was transformed,
so `typesugar expand use.ts`, the language service or a bundler that reached the consumer first left
`a.map(f)` a method call on what is really `A | null`. Every `@opaque` interface of the program is now
registered before the first file is transformed (where the macro would run: the tag starts a line and
the file imports typesugar). The companion functions are imported the way the consumer imports the
declaring file (`./opt.js`), or by a relative path, not by the declaring file's absolute `.ts` path.
