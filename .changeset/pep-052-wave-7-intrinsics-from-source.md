---
"@typesugar/macros": patch
---

PEP-052 Wave 7: primitive typeclass intrinsics (`eqNumber.equals` → `===`,
etc.) are no longer hand-written source strings — they're reflected from
`primitives.ts`'s real, live implementations, so the two can never drift
apart again.

- FIXED: two real bugs found while auditing the hand-written strings against
  `primitives.ts`'s actual bodies. `showString.show` used an unescaped
  template literal instead of `JSON.stringify`, producing broken output for
  any string containing a quote or backslash. `ordString.compare` used
  `.localeCompare`, which is locale/ICU-dependent and non-deterministic
  across environments, instead of a plain lexicographic comparison.
- CHANGED: `hashNumber`/`hashString`/`hashBigint` no longer inline to a
  crude stand-in (`a | 0`, etc.) at compile time — their real implementations
  (NaN/Infinity-aware, guaranteed-unsigned hashes) are more correct but too
  complex to inline; calls now correctly fall through to a real function
  call instead. Runtime behavior when NOT inlined was already correct
  (`primitives.ts` was always the actual implementation used at runtime);
  only the compile-time inlining optimization for these three is affected.
- REMOVED: `DictMethod.source` and `inlineMethod`'s string-parsing fallback
  — every registered method is now a real AST node.
