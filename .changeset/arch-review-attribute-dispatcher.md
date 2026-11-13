---
"@typesugar/transformer-core": patch
"@typesugar/macros": minor
"@typesugar/std": minor
---

Decorators and JSDoc tags go through one attribute-macro dispatcher
(`expandAttributeSources`, transformer-core `attribute-dispatch.ts`), so a JSDoc tag now behaves
exactly like the decorator it stands for:

- tags expand in `expandAfter` order, not written order;
- each expansion runs in its own hygiene scope and shows in the expansion view;
- `@derive` reads the declaration as written, even after an earlier tag rewrote it;
- a `// @ts-no-typesugar <feature>` comment on the declaration's line covers its tags;
- a failing macro is reported as `@name macro expansion failed: …` at the tag and leaves a throwing
  stub in the output, as a decorator does (it used to say "this may be transient — try saving
  again");
- extra statements a macro returns are visited, so macros inside them expand.

**Breaking:** instance lookup by name follows `===` sugar's rule everywhere: two instances at the same level
(two local ones, or two imported modules that both export one) are an error naming both, and
nothing else is reported for that use. An instance some import exports ranks above another module's
non-exported one. A
`let:`/`par:` comprehension and `implicit()`'s by-name fallback used to take the first one in
import order. `@derive` planning still treats either as "the type already has an instance".
