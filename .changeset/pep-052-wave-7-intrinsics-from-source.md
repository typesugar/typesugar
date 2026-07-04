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
- CHANGED: `hashNumber`/`hashBigint` no longer inline to a crude stand-in
  (`a | 0`, a lossy bitmask) at compile time — their real implementations
  (NaN/Infinity-aware, guaranteed-unsigned hashes) call another primitive as
  a helper, which is only safe at runtime, not when inlined verbatim into a
  caller that doesn't have that helper in scope; a registration-time safety
  check now correctly declines to inline these, falling through to a real
  function call instead. `hashString` (self-contained) still inlines-eligible
  at registration but isn't inlined either, for the orthogonal reason its
  loop body is too complex for the existing inlining pass. Runtime behavior
  when not inlined was already correct; only the compile-time inlining
  optimization for these is affected.
- REMOVED: `DictMethod.source` and `inlineMethod`'s string-parsing fallback
  — every registered method is now a real AST node.
