---
"@typesugar/fp": patch
"@typesugar/contracts": patch
---

**Breaking for `@typesugar/fp` users.** fp's `Eq`, `Ord` and tuple helpers now use
`@typesugar/std`'s names, argument order and semantics, so an instance of one package's `Eq`/`Ord`
is an instance of the other's, and the `===`/`!==`/`<`/`<=`/`>`/`>=` operator rewrites (activated
by `@typesugar/std/syntax/eq/ops` and `.../ord/ops`) call methods that exist on fp's instances.
Before, `a === b` on an fp instance compiled to `inst.equals(a, b)`, which threw at run time.

| Before                                                                                          | After                                                                            |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Eq<A>.eqv(x, y)`                                                                               | `Eq<A>.equals(x, y)` and `Eq<A>.notEquals(x, y)` (required)                      |
| `Ord<A>` extends `{ eqv }`                                                                      | `Ord<A>` extends `{ equals, notEquals }`                                         |
| `neqv(E)(x, y)`                                                                                 | removed; use `E.notEquals(x, y)`                                                 |
| `eqBy(E, f)`                                                                                    | `eqBy(f, E = eqStrict())`                                                        |
| `ordBy(O, f)`                                                                                   | `ordBy(f, O)`                                                                    |
| `makeEq(eqv)` returns `{ eqv }`                                                                 | `makeEq(equals)` returns `{ equals, notEquals }`                                 |
| `constant(a)` returns `(_: B) => a`                                                             | `constant(a)` returns `() => a` (a thunk, as in std)                             |
| `mapFst(f)(pair)`, `mapSnd(f)(pair)`                                                            | `mapFst(pair, f)`, `mapSnd(pair, f)` (pair first, as in std)                     |
| `bimap(f, g)(pair)` (tuple, `syntax/pipe`)                                                      | `bimap(pair, f, g)`                                                              |
| `@typesugar/fp/syntax` exported its own `Monad` interface and a `{ pure, flatMap, map }` `IODo` | `@typesugar/fp/syntax` re-exports the same `Monad` and `IODo` as `@typesugar/fp` |

To migrate an `Eq` instance written as an object literal, rename `eqv` to `equals` and add
`notEquals: (x, y) => !equals(x, y)` (or build it with `makeEq`). The `getEq`/`getOrd` of every
fp data type (Option, Either, List, NonEmptyList, Validated, RemoteData) and fp's law suites use
the new names. `flatMapValidated` is deliberately not an `@impl` instance (a scope-found FlatMap
would make `let:` over Validated short-circuit); its comment now says so. The contracts prover
reads `equals(L, R)` / `E.equals(L, R)` as an equality, as it did `eqv`.
