## guides-a docs fix report

All 20 findings and the 1.0 gaps in my scope are dealt with. I re-ran every example I touched, plus every example the review marked failing, through doc-example.mjs against the current dist. I changed no code. Prettier has been run on all 11 files, and none of my processes are still running.

### Per finding

1. **paren `yield: ({...})`: fixed, re-verified.** It now works everywhere. "Object Literals in Yield" now says both forms are correct. It also notes that `yield: { {a,b} }` is an error with a hint, and that `yield: { (a, b) }` is a comma expression that gets no warning.
2. **Option comprehensions: fixed.** The Option examples and the Quick Start run (30, 60, 20, ...). The "compiles to" blocks now show the real `flatMapOption.flatMap(10, …)` output. The page now says that fp types support only `let:`: `par:` and `||`/`??` don't work on them (see the code bugs below).
3. **cfg calls function branches / object form: fixed.** I documented lazy calling with a "Function Branches Are Called" section. Debug Logging returns the function from each branch, and the platform choice uses chained `cfg("platform === 'web'", …)`.
4. **`config` option: fixed.** The page now uses `cfgConfig` (unplugin and tsconfig) and `TYPESUGAR_CFG_*` environment variables (`__` stands for a dot). It notes that dotted conditions read nested objects and that `cfgConfig` replaces the environment variables.
5. **`configure()` modes: cut.** Performance now says `mode: "none"` / `TYPESUGAR_CONTRACTS_MODE=none`, which I verified strips the check.
6. **Effect Quick Start: fixed.** It is rewritten with an `Effect.gen` + `yield* DatabaseTag` layer and `layerMake`, and runs ("Ada"). The `@layer` section, the layerMake "compiles to" output and the debug-tree output are now the real ones. The page says `db << Database` inside `let:` doesn't work yet.
7. **Derived `===` / `<` activation: fixed.** I added an imports block to the hero example, an "Imports and Activation" section with the eq/ord/semigroup ops imports, and import notes on the operator examples.
8. **derive.md items: fixed, cut or marked unsupported.**
   - Functor is cut (moved into a "Not Derivable" list along with Builder).
   - Generic `Box<T>` is marked not yet supported.
   - Clone is described as shallow and returning a plain object.
   - The `@deriving` warning text is re-verified.
   - `deduplicate` uses `= implicit()`.
   - The Json text now covers required fields, the "Missing required field" error, and the plain object it returns.
   - Show output is now `Point(x = 1, y = 2)`.
   - Default is described as returning a plain object.
9. **`par:` results can't be captured: fixed (the code was fixed).** I re-verified `const`, arrow body, `return`, nested `par:` and `export default`. Every form runs.
10. **`||`/`??` in bound comprehensions: fixed (the code was fixed).** I re-verified `const` and arrow body. The fallback example is now Promise-based, and its output is the real `.catch` output.
11. **Effect Rich Diagnostics: fixed.** The section is now "Wiring Diagnostics" and shows the real EFFECT001 and EFFECT020 messages. EFFECT010/030 and the others are marked "Planned — not in 1.0", and the table has a Status column.
12. **conditional-compilation imports and claims: fixed.**
    - Imports now come from `typesugar`.
    - The page says only the declaration is removed and usages must be guarded (otherwise ReferenceError, plus a strictOutput warning).
    - The "Default Values" and "Runtime Access" sections are replaced by "Unset Conditions".
    - `config.evaluate` is gone. I added a "Condition Grammar" section with the real ConfigConditionError text.
13. **contracts imports: fixed.** `comptime` is imported from `typesugar`. The assert/assertNever section and its API bullet are cut. The refinement example uses `Positive` from `@typesugar/type-system`.
14. **Custom prover registrations: fixed.** I added a tip that registrations must run in the transformer process, through a package's `typesugar.macros` entry. contracts-refined.md's Custom Refinements is rewritten. I verified that registering in the transformer process does elide `requires`.
15. **comptime examples: fixed.** Build Info now uses `{ env: "read" }` (runs). The `1/0` example is replaced by `JSON.parse("{")`, which gives a real TS9209 error.
16. **developer-experience: fixed.** `--explain` now points to the /errors/ pages. TS9061 is marked "Planned — not in 1.0", with what actually happens today. The page shows both tsconfig plugin entries.
17. **codec validation: fixed.** It now says validation happens at runtime in `buildCodec()`/`validateSchema()`, the table cell says "Runtime (builder)", and the derive sentence is deleted.
18. **authoring-libraries exports shape: fixed.** The example is the nested import/require types shape from strings, with a TS1479 comment.
19. **Inline `requires()` elision: fixed (the code was fixed).** It is re-verified as elided (`void 0`). I added the `@typesugar/contracts-refined` import the example needs.
20. **Smaller mismatches: fixed.**
    - The formatCertificate example uses `createStep` and shows the real output.
    - The `@decidable` TS1206 behaviour is noted.
    - The undeclared codec decorators (TS2304) are noted.
    - The codec banner no longer says "excluded from release".
    - The effect `/macros`-only exports are marked as such.
    - The contracts-refined re-exports now list `VecConstructors` and say the refinement types are not re-exported.
    - authoring rule 4 is reworded.
    - comptime "Real time" is removed (`new Date()` needs no permission).
    - Default is described as returning a plain object.

- **1.0 gaps: done.**
  - comptime editor switches (`typesugar.comptimeInEditor` / `TYPESUGAR_COMPTIME_IN_EDITOR=1`).
  - comptime fs root is the tsconfig directory.
  - cfg grammar, `cfgConfig` and the environment variables.
  - The derive imports note.
  - The llms.txt links are now site-relative instead of pointing at typesugar.org (PEP-059 decision 1).
  - The do-notation per-position table.

### Examples re-run

| Page                                             | Examples                                        | Passing                                                                                      |
| ------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| do-notation                                      | 22                                              | 22 (fp Option/Either `par:` and Option fallback fail; the page now says they're unsupported) |
| effect                                           | 8                                               | 8                                                                                            |
| conditional-compilation                          | 16 (2 configurations)                           | 16                                                                                           |
| comptime                                         | 3                                               | 3                                                                                            |
| contracts                                        | 5                                               | 5                                                                                            |
| contracts-refined                                | 2                                               | 2                                                                                            |
| derive                                           | 20                                              | 18 (Box and Functor fail; the page marks them unsupported)                                   |
| codec                                            | 1                                               | 1                                                                                            |
| developer-experience / authoring / ai-assistants | text or config only, checked against the source | —                                                                                            |

### Code bugs still open

1. **`par:` over fp Option/Either** compiles to `1..map(a => b => …).ap(2)`, which gives a runtime TypeError, with only a strictOutput warning. There is no ParCombine instance for the fp types. Repro: `const e = par: { a << Right(1); b << Right(2); } yield: a + b`.
2. **`||`/`??` fallback on fp Option** emits `flatMapOption.orElse(...)`, which doesn't exist (TypeError). `@do-methods` on fp has no `orElse=`, and the macro should error instead of emitting the call. Repro: `let: { v << parse("x") ?? Some(0); } yield: { v }`.
3. **strictOutput warnings on every fp Option comprehension**, e.g. "Argument of type 'number' is not assignable to parameter of type 'Option<unknown>'". This is the known annotation/erasure issue (the instance params are typed `Option<A>`, but the values are erased).
4. **`/** @impl FlatMap<Task> \*/`companion** emits`namespace Task { export const FlatMap = flatMapTask as FlatMap<Task>; }`, which gives strictOutput warnings: FlatMap is not imported as a type, and `Task` needs a type argument (macros/typeclass.ts).
5. **Derive markers exported from `typesugar` (Eq, Clone, …) are values only.** `summon<Eq<User>>()` with that import is TS2749 under plain tsc. Importing the std type instead makes `@derive(Eq)` TS2693. No single import is clean under tsc.
6. **`Show`/`Semigroup`/`Monoid` derive markers** are missing from the `typesugar` umbrella; only `@typesugar/macros` has them. The `Show` type is only in `@typesugar/fp`, and std doesn't export it, although other docs pages say `import { Show } from "@typesugar/std"` (outside my scope).
7. **The `@typesugar/effect` package import line is dropped from the output** while decorators are expanded. This is harmless, noted only.

### Files changed

All in /Users/deapovey/src/personal/typesugar/docs/guides/: ai-assistants.md, authoring-libraries.md, codec.md, comptime.md, conditional-compilation.md, contracts-refined.md, contracts.md, derive.md, developer-experience.md, do-notation.md, effect.md.

Scratch examples are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docfix/guides-a/. Some of my early examples reused file names (d1.ts, dn1.ts, …) in the shared repo `.typesugar/doc-examples` directory the helper copies into. Another agent using the same names could have collided with them.
