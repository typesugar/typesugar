---
"@typesugar/macros": patch
"@typesugar/transformer": patch
---

A type whose derives only generate its companion (`/** @derive(Eq, Clone) */ export interface Vec`)
can be re-exported by name. `typesugar build` dropped `export { Vec } from "./vec.js"` (and
`import { Vec } from "./vec.js"; export { Vec };`) from the JavaScript, because `Vec` is only an
interface in the source, while the `.d.ts` still exported it; a consumer's `a === b`
(`Vec.Eq.equals(a, b)`) then failed with "does not provide an export named 'Vec'". The emit now
keeps a re-export whose target, followed through every alias, is a type a derive makes a value.

Under `verbatimModuleSyntax` and `isolatedModules`, `typesugar check` and `build` no longer report
TS1484 on `import { Vec }` or TS1205 on `export { Vec } from` for such a type (`export type`, the fix
TypeScript suggests, would leave the companion out of the JavaScript), and `typeof Vec.Eq` in a type
position is no longer TS2693. A type without derives is still reported.

An exhaustive destructuring `match: switch` at the end of a function, whose every case returns or
throws, is no longer TS2366 ("Function lacks ending return statement") or TS7030 in `typesugar
check` / `build`. A switch a `break` can leave, or whose last case falls off the end, still is.
