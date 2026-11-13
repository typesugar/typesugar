---
"@typesugar/macros": minor
"@typesugar/core": patch
---

An imported object or namespace supplies extension methods only when its import opts in
(PEP-064): a JSDoc `/** @extension */` on the import declaration, or `import * as X`. A
typeclass instance declared with `/** @impl */` needs neither; one made
by `impl(...)` or `derived<TC<T>>()` needs the tag (its `.d.ts` is a plain annotation). A
function named after the method (`import { clamp }`) is unchanged. A type-only import never
supplies extensions, nor does an import shadowed by a local at the call, and `typesugar
check` now hides TS2551 as well as TS2339 on a rewritten call and keeps both in a scope opted
out of extensions. Before, any imported object with a member whose first parameter accepted the
receiver was a provider, so `user.info()` with `log.info(msg: unknown)` imported became
`log.info(user)`, and `typesugar check` hid the TS2339. Add the tag to imports of extension
objects such as `EffectExt`:

```ts
/** @extension */
import { EffectExt } from "@typesugar/effect";
```
