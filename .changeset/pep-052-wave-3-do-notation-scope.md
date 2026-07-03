---
"@typesugar/core": minor
"@typesugar/macros": minor
"@typesugar/std": minor
"@typesugar/effect": minor
"@typesugar/fp": patch
"@typesugar/transformer": patch
"@typesugar/transformer-core": patch
---

PEP-052 Wave 3: do-notation instance resolution is scope-based — the last
process-global instance registry is deleted.

- BREAKING (pre-1.0): `let:`/`par:` comprehensions resolve their
  `FlatMap`/`ParCombine` instance from the file's scope (a local `@impl`
  declaration or an export of any imported module), not from a global
  registry populated by side-effect imports elsewhere in the program. The
  std builtins (Array, Promise, Iterable, AsyncIterable) ride along with the
  `@typesugar/std/syntax/do` marker every do-notation file already imports —
  zero new imports for the common case. Effect users import
  `@typesugar/effect/syntax/do` (one line: activates the labels AND provides
  the Effect instances).
- NEW: TS9225 "No FlatMap instance for 'X' is in scope" error naming the
  exact import to add when resolution misses.
- NEW: `@do-methods` JSDoc metadata on instances declares do-notation
  emission (bind/map/orElse method names, static-vs-method call style,
  static receiver, `all` join) — replacing the hardcoded Promise/Effect
  special cases in the comprehension macros. Third-party monads get the
  same treatment as std's.
- NEW: `ParCombine<Effect>` instance — `par:` over Effect now emits
  `Effect.map(Effect.all([...]), ...)`; previously it fell back to an
  applicative chain emitting `.map(...).ap(...)` calls Effect doesn't have.
- REMOVED: `doNotationRegistry`, `parCombineBuilderRegistry`, and their API
  (`registerFlatMap`, `registerParCombine`, `registerParCombineBuilder`,
  `getFlatMapMethodNames`, `hasFlatMapInstance`, `hasParCombineInstance`,
  `getInstanceMeta`, `clearRegistries`). Declare instances with `@impl` +
  `@do-methods` and export them instead.
