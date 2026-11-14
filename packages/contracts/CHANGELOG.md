# @typesugar/contracts

## 0.2.0

### Minor Changes

- d8f810b: PEP-052 Wave 2: labeled-block macros are now import-scoped (`@syntax-labels`
  activation), matching the operator/method syntax gates.
  - BREAKING (pre-1.0): `let:`/`seq:`/`par:`/`all:` do-notation comprehensions
    only expand in files that import `@typesugar/std/syntax/do`, and bare
    `requires:`/`ensures:` contract blocks only apply `@contract` in files that
    import `@typesugar/contracts/syntax`. The explicit `@contract` decorator form
    is unaffected (importing the symbol is the opt-in).
  - NEW: TS9224 warning when a block-shaped label matches a registered macro
    whose syntax is not activated, with a help hint naming the exact import to
    add (unexpanded do-notation is still valid JS — `x << effect()` silently
    becomes a bit-shift — so the hint matters).
  - NEW: `@syntax-labels <macroName>` activation-marker tag (read alongside
    `@syntax-operators`/`@syntax-methods`) and an optional `syntaxModule` field
    on `LabeledBlockMacro`/`AttributeMacro` that feeds the TS9224 hint and
    doubles as a resolution-free activation fallback — an import specifier
    exactly matching a macro's `syntaxModule` activates it even in hosts that
    cannot resolve modules (the playground's in-memory host, virtual file
    names).
  - FIXED: ordinary loop labels colliding with macro label names
    (`all: for (…)`) were dispatched to the macro (a hard error) when the file
    had the syntax activated; labeled non-blocks are no longer dispatch
    candidates at all.
  - FIXED: an expression-position comprehension in a file that never activates
    do-notation was text-rewritten by the preprocessor and then left mangled
    (invalid JS) by the gate; the preprocessor is now gated on activation too,
    leaving such files untouched.
  - FIXED: activation markers (all kinds, operators/methods included) were
    silently dropped in files rewritten by the expression-comprehension
    preprocessor — the re-parsed file isn't part of the `ts.Program`, so
    checker-based marker resolution failed. Markers now resolve against the
    program's own copy of the file.

### Patch Changes

- 5d86014: `verifyLaw` accepts a typed law (`Law<[x: number]>` from `defineLaw`): it took `Law<unknown[]>`,
  which a law with typed `check` parameters is not assignable to.
- 459807a: **Breaking for `@typesugar/fp` users.** fp's `Eq`, `Ord` and tuple helpers now use
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

- a5c1b85: A method of an `@invariant` class keeps its `requires:`/`ensures:` blocks: `@invariant` wrapped
  each method body in its try/finally before the method's own contract was expanded, so the blocks
  were no longer top-level statements and `old()` in an `ensures:` block was reported as "old() can
  only be used inside an `ensures:` block". The leading contract blocks now stay first, outside the
  wrap: preconditions, then the body and the invariant check, then postconditions.

  The package's examples run with `typesugar run` again: `tryProve` is imported from
  `@typesugar/contracts/macros` (the proof engine is not in the runtime entry), `contracts-example.ts`
  imports `@contract`/`@invariant` instead of declaring local stand-ins (a local function of the same
  name is not the macro), and the showcases use the current `old()` block form and decidability
  queries.

- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- 93ea406: PEP-060 item 1: support TypeScript 6, reject TypeScript 7 with one clear error
  - **Peer range is now `typescript >=5.9.0 <7.0.0`** on every package (was
    `>=5.0.0 <6.0.0`). TypeScript 6.0.x still has the JavaScript compiler API typesugar
    is built on; TypeScript 7 (`typescript@latest` since 7.0) does not. The floor
    moved up from 5.0 because older releases were measured to break: before 5.5,
    Node's ESM loader sees none of TypeScript's named exports, so the CLI and the
    Vite plugin crash on their first `ts.*` access (5.0–5.3 also lack
    `checker.isTypeAssignableTo` and other APIs typesugar calls); 5.5–5.8 lack
    `checker.getNonPrimitiveType()`, so `@impl X<object>` instances never resolve.
    5.9.3 and 6.0.3 build, type-check and pass the core, transformer-core, macros,
    transformer, std and fp suites. The `library` and `macro-plugin` templates that
    `typesugar create` copies peer the same range, and all three templates now
    install `typescript ^5.9.3`.
  - **`typescript` is now an optional peer** of the packages whose runtime `.` entry
    never loads it: codec, collections, contracts, erased, fp, fusion, mapper, parser,
    strings, testing, units, validate and the `typesugar` umbrella. Their `./macros`
    entries still need TypeScript at build time. `check:runtime-purity` now fails if a
    package with an optional peer loads `typescript` from its `.` entry, directly or
    through a dependency.
  - **TypeScript version guard.** `@typesugar/core` exports `assertSupportedTypeScript`,
    `getUnsupportedTypeScriptReason`, `UnsupportedTypeScriptError`,
    `SUPPORTED_TYPESCRIPT_RANGE` and `TYPESCRIPT_SUPPORT_URL`. `@typesugar/macros` runs
    it first thing at load, and the transformer (pipeline, ts-patch factory, and the
    language-service plugin, which checks tsserver's own TypeScript), `transformCode`,
    unplugin, the LSP server and the ESLint processors call it before their first
    compiler-API access. On TypeScript 7 they all stop with
    `[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed the JavaScript
compiler API that typesugar's transformer needs. Install typescript@6 (or 5.9+) as a
devDependency for typesugar (npm i -D typescript@6); see
https://typesugar.org/getting-started/troubleshooting#typescript-7` instead of an
    opaque `Cannot read properties of undefined (reading 'ES2022')`. TypeScript older
    than 5.9, or a module missing `ts.factory` / `ts.createProgram`, is rejected the
    same way.

- Updated dependencies [e92220f]
- Updated dependencies [612112b]
- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [4d4ce68]
- Updated dependencies [f8dcade]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [c5ebf64]
- Updated dependencies [d79d995]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7d84596]
- Updated dependencies [3460709]
- Updated dependencies [810833a]
- Updated dependencies [0435dc6]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [c9a1e3e]
- Updated dependencies [4b0d84d]
- Updated dependencies [977888e]
- Updated dependencies [283fe78]
- Updated dependencies [d7d6236]
- Updated dependencies [eb6e5a8]
- Updated dependencies [0780883]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [c30101d]
- Updated dependencies [4f6ad83]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [563e46b]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [93ea406]
- Updated dependencies [51a72ca]
- Updated dependencies [cf7c08b]
- Updated dependencies [2f1744b]
- Updated dependencies [5d86014]
  - @typesugar/core@0.2.0
  - @typesugar/type-system@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/type-system@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/type-system@0.1.1-rc.0
