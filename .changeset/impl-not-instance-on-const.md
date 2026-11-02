---
"@typesugar/core": patch
"@typesugar/typeclass": patch
---

Docs: instances are declared with `/** @impl Typeclass<Type> */` on a const

- The `@typesugar/typeclass` README quick start showed `@instance("Show<number>")`
  as a decorator on a `const`, which TypeScript rejects (TS1206: decorators are
  not valid on variables). It now uses `/** @impl Show<number> */`.
- The TS9002 and TS9003 explanations no longer show the decorator-on-a-const
  "legacy" form, and TS9006, TS9007/TS9050, TS9104, TS9401, TS9802 and TS9803
  recommend `@impl` instead of `@instance`.
- The TS9001 and TS9102 error pages' examples are rewritten against what the
  transformer does: `p1 === p2` on a type with no `Eq` instance is not TS9001
  (it stays reference equality, with no diagnostic); TS9001 comes from
  `summon` on a type parameter or on a type with no instance that can't be
  derived. TS9102's page described a missing field instance (that is TS9101)
  and showed an `@noDerive` field annotation, which doesn't exist.
