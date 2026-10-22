---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

`typesugar check` hides a TypeScript error only where the build rewrites the code:

- The ExtensionMethodCall rule calls the transformer's own import-provider decision
  (`findImportedExtensionMatches`, now in `@typesugar/macros`) instead of its own copy, which
  lacked the checks for an unopted module namespace, a default-lib member (`.call`, `.bind`), a
  `declare global` stub and a typeclass instance for another type, and hid TS2339 on calls the
  build left as written (a TypeError at run time).
- A union instance (`@impl Describe<Shape>`, `type Shape = Circle | Square`) serves a receiver
  narrowed to its members (`if (t.kind === "circle") t.describe()`); the call was left as written.
- The OperatorOverload rule's TS2365 check is the rewrite's decision (`operatorRewriteResult`): a
  const bound to a rewritten operator (`const p = a * b; p + a`) and a narrowed operand of a
  union instance are no longer reported, and a primitive is decided by the type's flags, not its
  printed name. The rewrite and the filter try the same declared types for a narrowed operand.
