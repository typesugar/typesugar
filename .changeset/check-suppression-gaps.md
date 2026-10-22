---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

`typesugar check` (and the IDE) no longer reports errors for code the transformer handles,
found by type-checking every package example:

- `@reflect interface User` was TS1206 ("Decorators are not valid here"): the MacroDecorator
  rule's name table missed it. Any registered attribute macro's decorator is now suppressed.
- `.show()` for a `/** @typeclass */ interface Show` the file declares itself was TS2339: the
  rule only knew the standard typeclasses' methods. It now reads the program's typeclasses, as
  the rewrite does.
- `ensures: { result >= 0; }` was TS2304 "Cannot find name 'result'" and `ensures: (r) => …`
  TS7006, in files that import `@typesugar/contracts/syntax`. A new ContractBlock rule
  suppresses exactly those two.
- `eff.map((x) => …)` with `import { EffectExt }` was TS2339 and TS7006: the rule matched the
  receiver against the generic `Effect<A, E, R>` parameter with plain assignability. It now uses
  the transformer's own match (`receiverMatchesFirstParam`, moved to `@typesugar/core`), and an
  untyped callback parameter of a rewritten call is not "implicitly any".
- `summon<Read<User>>()` against the published `@typesugar/sql` was TS9001 "No instance found
  for `Read$1<User>`": its bundled `.d.ts` declares `interface Read$1` and exports it
  `as Read`. A typeclass renamed that way is keyed by its exported name.
