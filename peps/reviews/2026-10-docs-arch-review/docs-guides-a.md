## guides-a findings (docs/guides/: ai-assistants, authoring-libraries, codec, comptime, conditional-compilation, contracts-refined, contracts, derive, developer-experience, do-notation, effect)

I ran every non-trivial example through the helper and checked imports with single-file `tsc --noEmit`. Scratch files are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/guides-a/. All 11 pages are reachable from the sidebar.

### 1. `yield: ({ ... })`, the form the page calls "Correct", never compiles

- Severity: high
- Location: docs/guides/do-notation.md:209-215 ("Correct: `yield: ({ name, age })`"). The same form is used at do-notation.md:59, 95, 235, 256, 289, 351, 358, 415, 527, 559, 578, 596, 625, and in effect.md:55-57, 140-142, 464, 476.
- Problem: In every position (statement, `const r =`, arrow body) the paren form gives `[typesugar] yield: must be followed by a block { ... }`. The comprehension is left unexpanded, so the output is `let: { x << 42; ... }`, which is a SyntaxError or ReferenceError at runtime. Only the block form `yield: { ({ a, b }); }` works.
- Evidence: dn8.ts (statement-position `par:` with the paren form) gives "yield: must be followed by a block { ... }", then at runtime `ReferenceError: user is not defined`. dn3.ts (`const r7 = let:{...} yield: ({ x, y })`) leaves `let: {` in the output, then `SyntaxError: Unexpected strict mode reserved word`.
- Suggested fix: Replace every `yield: ({ ... });` with `yield: { ({ ... }); }`. Rewrite the "Object Literals in Yield" section so the block-wrapped form is the correct one.

### 2. `let:` over fp `Option` emits `.flatMap` on erased values, so the Quick Start throws

- Severity: high
- Location: docs/guides/do-notation.md:39-51 (Quick Start), 70-84, 167-184, 191-196, 326-343, 620-627. The page says (line 32) that "any import from @typesugar/fp brings their instances into scope".
- Problem: `Some(10)` is erased to `10`, but the comprehension still emits receiver calls: `10..flatMap(x => (x * 2).map(y => x + y))`. The page says the result is `Some(30)`; the actual result is `TypeError: 10.flatMap is not a function`. The pure-map, implicit-yield, `seq:` alias and type-inference examples (all Option) fail the same way.
- Evidence: dn2.ts output is `10..flatMap(x => (x * 2).map(y => x + y));`, and running it gives `TypeError: 10.flatMap is not a function`.
- Suggested fix: Fix the Option instance (it needs `@do-methods style=static`, pointing at the companion functions), or switch every Option example to Array or Promise and drop the Option claim at line 32.

### 3. `cfg()` calls function arguments, and the object "string condition" form doesn't exist

- Severity: high
- Location: docs/guides/conditional-compilation.md:101-109 (Debug Logging), 81-89 and 127-135 (String Conditions / Platform-Specific)
- Problem: macros/src/cfg.ts:205-212 invokes an arrow or function branch, giving `(() => …)()`. So `cfg("debug", (...args) => console.log(...), () => {})` makes `debug` the return value of `console.log`, and `debug("Processing", data)` throws. `cfg("platform", { web, node, native })` is just the 2-argument then-form: it returns the whole object whenever `platform` is truthy, and never picks a branch.
- Evidence: cf2.ts output is `const debug = ((...args) => console.log("[DEBUG]", ...args))();`, and running it gives `TypeError: debug is not a function`. cf3.ts with platform=node gives `{ web: 'WebStorage', node: 'FileStorage', native: 'NativeStorage' }`.
- Suggested fix: Document that arrow/function branches are evaluated lazily, i.e. called. For a function value, write `cfg("debug", () => (...args) => console.log(...), () => () => {})`. Replace the object form with `cfg("platform === 'web'", webImpl, cfg("platform === 'node'", nodeImpl, nativeImpl))`.

### 4. The `config` option for setting cfg conditions doesn't exist

- Severity: high
- Location: docs/guides/conditional-compilation.md:36-53 (vite), 57-71 (tsconfig), 259-287 (Full Build Setup)
- Problem: `TypesugarPluginOptions` (unplugin-typesugar/src/unplugin.ts:14-39) has no `config` field, so a TypeScript vite config fails on the excess property. In any case nothing passes cfg values from unplugin. The transformer's key is `cfgConfig` (transformer/src/pipeline.ts:334-335), not `config`. The other mechanism is `TYPESUGAR_CFG_<KEY>=1` env vars (macros/src/cfg.ts:75-92). As written, every condition reads as unset.
- Suggested fix: tsconfig `{ "transform": "@typesugar/transformer", "cfgConfig": { "debug": true } }`. For bundlers, document `TYPESUGAR_CFG_DEBUG=1` (with `__` for a dot, e.g. `TYPESUGAR_CFG_FEATURE__EXPERIMENTAL`). Alternatively, add a `cfgConfig` option to unplugin.

### 5. `configure()` and its "enabled/disabled/assume" modes don't exist

- Severity: high
- Location: docs/guides/contracts.md:502-527 ("Runtime modes via configure()", plus its cfg example), 587-589 ("With `mode: "disabled"`")
- Problem: `@typesugar/contracts` exports no `configure`. The only modes are `"full" | "assertions" | "none"` (contracts/src/config.ts:58), and there is no "assume" mode.
- Evidence: tsc gives `TS2305: Module '"@typesugar/contracts"' has no exported member 'configure'`.
- Suggested fix: Delete the configure() section. In "Performance", say `mode: "none"` (or `TYPESUGAR_CONTRACTS_MODE=none`).

### 6. Effect Quick Start / `@layer` + `layerMake` don't work

- Severity: high
- Location: docs/guides/effect.md:38-76 (Quick Start), 135-142, 149-176
- Problem:
  - `layerMake` can't tell what an `@layer`-decorated const provides, so it reports "Missing layers" and emits `Layer.empty`.
  - `db << Database` binds the generated namespace, not an Effect ("Could not infer type constructor"), and the `const userRepoLive =` declaration disappears from the output.
  - The paren `yield:` from finding 1 applies here too.
  - `resolveLayer<R>()` does work with `@layer` consts.
- Evidence: e3.ts (minimal: `@service Database` + `@layer(Database) const databaseLive = {...}` + `layerMake<Database>(databaseLive)`) gives `warning: Could not determine what service 'databaseLive' provides` and `error: Missing layers for: - Database`, then at runtime `Service not found: Database`. In the same file, `Effect.provide(prog, resolveLayer<Database>())` prints `got2 r:x`. e8.ts (`@layer(UserRepo,{requires:[Database]}) const userRepoLive = Effect.gen(function*(){ const db = yield* DatabaseTag; ... })` + resolveLayer) works.
- Suggested fix: Rewrite the Quick Start with an `Effect.gen` layer body (`yield* DatabaseTag`) and `resolveLayer`. Either fix layerMake to recognise `@layer` consts, or document that it only accepts real `Layer` values (as its test does: packages/effect/tests/generated-code.e2e.test.ts:74-105).

### 7. Derived `===` / `<` don't overload without an activation import the page never mentions

- Severity: high
- Location: docs/guides/derive.md:23-26, 56-57, 80, 282-305
- Problem: Under PEP-052, operator syntax needs `import "@typesugar/std/syntax/eq/ops"` (and `.../ord/ops`). Without it, `u1 === u2` stays reference equality (false), although the page says "true (compiles to User.Eq.equals)". No example on the page shows any import at all.
- Evidence: d1.ts with `import { derive, summon, Eq, Clone, Debug, Json } from "typesugar"` prints `false` for `u1 === u2`. d2.ts, with the two ops imports added, gives `v1 < v2` true and `===` true.
- Suggested fix: Add an imports block to the hero example (`import { derive, summon, Eq, ... } from "typesugar"; import "@typesugar/std/syntax/eq/ops"; import "@typesugar/std/syntax/ord/ops";`) and a short "Activation" note like the one in do-notation.md.

### 8. derive.md documents several things that don't work

- Severity: medium
- Location / problem:
  - derive.md:378-391 (Generic Types `Box<T>`): fails with `GenericDerivation failed for Eq ... T lacks Eq` and `TS9001 No instance found for Clone<Box<number>>`. PEP-059 P1 #12 lists this as unfinished.
  - derive.md:239-251 (Functor): `Unknown derive: 'Functor'`. No such derivation is registered (macros/src/auto-derive.ts registers Show, Eq, Ord, Hash, Clone, Debug, Default, Json, TypeGuard, Semigroup, Monoid).
  - derive.md:373 ("Clone deep-copies the nested Address") and the heading at :83: the nested Address is shared (`p2.address !== p1.address` prints false). Clone also returns a plain object, not a class instance.
  - derive.md:417, 423 (`@deriving` "still works but emits a deprecation warning"): `@deriving(Eq)` is silently stripped. No `Q.Eq` is generated and there is no diagnostic.
  - derive.md:332-335 (`deduplicate<A>(..., E: Eq<A> = summon<Eq<A>>())`): `TS9001 No instance found for Eq<A>`.
  - derive.md:153 (Json "validates required fields"): `fromJson({})` returns `{}`; missing fields are accepted (the generated check is `obj.id !== undefined && ...`). It returns the cast object, not a `User` instance (contrary to :168).
  - derive.md:184 (Show `"Point(1, 2)"`): the actual output is `Point(x = 1, y = 2)`.
- Evidence: d3.ts, d4.ts, d4c.ts, d6.ts.
- Suggested fix: Remove the Functor and Generic sections, or mark them unsupported. Say Clone is shallow. Fix the `@deriving` text (or the macro). Pass the instance explicitly in `deduplicate`. Correct the Json and Show descriptions.

### 9. `par:` results can't be captured anywhere

- Severity: medium
- Location: docs/guides/do-notation.md:53-60, 202, 246-267, 361-377; effect.md:469-480
- Problem: Every position that keeps a value fails with "`par:` comprehension in expression position ... is not supported": `const x = par:`, arrow body `=> par:`, and a `let:`/`seq:` with a nested `par:` group. In statement position it compiles, but TS9222 says the result is discarded. So the "Promise.all … All three run concurrently" examples produce a value the reader can't use. The TS9222 help text and the expression-position error both suggest forms (`const result = par:`, arrow body, "after return") that fail.
- Evidence: dn5.ts, dn10.ts and dn11.ts all give that error, followed by broken output (`const p1 = par, { user };`). dn9.ts in statement position gives `Promise.all([...]).then(...)` plus "Result of par: comprehension is discarded".
- Suggested fix: State plainly that `par:` (and `let:` with a nested `par:`) currently works only as a statement, and its value can't be bound. Point readers at `Promise.all` / `Effect.all` directly until this is fixed.

### 10. `||`/`??` fallback in a bound comprehension silently emits broken JS

- Severity: medium
- Location: docs/guides/do-notation.md:121-146
- Problem: In statement position this works (`loadConfig().catch(_ => defaultConfig())`). With `const r =` or an arrow body, the output is `const r = let, { config }; << loadConfig() || ...` with no typesugar error (only a strictOutput warning).
- Evidence: dn13.ts and dn14.ts give broken output and `[strictOutput] Expression expected`. dn15.ts in statement position works.
- Suggested fix: Document the restriction in "Using the Result" (the first statement must be a plain bind with no fallback), and fix the preprocessor so it reports an error.

### 11. The Effect "Rich Diagnostics" section describes errors that are never emitted

- Severity: medium
- Location: docs/guides/effect.md:78-92, 347-414 (EFFECT001/010/020/030), 544-556 (diagnostics table)
- Problem: The EFFECT0xx descriptors are defined and exported (effect/src/diagnostics.ts, index.ts:213-221), but no macro reports them. A missing layer comes out as a plain "Missing layers for:" error, and a cycle as "Circular layer dependency: A → B". Error-handler completeness (EFFECT010) and schema drift (EFFECT030) aren't implemented anywhere.
- Evidence: `grep -rn "EFFECT0[0-9][0-9]" packages/effect/src` finds only diagnostics.ts and the index.ts re-exports.
- Suggested fix: Replace the section with the real messages (layer-make.ts:250-272, resolve-layer.ts:155-221), and mark EFFECT010/030/040 as planned.

### 12. conditional-compilation imports and claims that are false

- Severity: medium
- Location: conditional-compilation.md:10, 24, 292 (`import { cfg / cfgAttr } from "@typesugar/core"`), 171-177, 94, 212-233
- Problem:
  - `@typesugar/core` doesn't export `cfg` or `cfgAttr` (tsc: TS2305). They come from `typesugar`.
  - "Class and all usages removed" (:176) is false: only the declaration goes, so `new AdminPanel()` gives `ReferenceError: AdminPanel is not defined` (cf4.ts).
  - `config.get`/`config.evaluate` read core's config store (TYPESUGAR*\*, typesugar.config.ts), not the cfg store (TYPESUGAR_CFG*\*, cfgConfig). So "Default Values" doesn't describe the same conditions cfg uses.
  - "Runtime Access … evaluated at runtime" means importing @typesugar/core (and the TypeScript compiler it imports) into the app bundle, where it reads the runtime env, not the build config.
- Suggested fix: Import from `"typesugar"`. Say usages must be guarded themselves. Remove the "Runtime Access" section and fix or remove "Default Values".

### 13. contracts.md imports that don't exist

- Severity: medium
- Location: contracts.md:231-246 (`assert`, `assertNever`), 294 and 641 (`comptime` from contracts), 460-469 (`import { Refined, Positive, NonEmpty } from "@typesugar/contracts-refined"`, `Refined<number, Positive>`)
- Problem: All of these are TS2305 errors. `assert`/`assertNever` exist nowhere in contracts, and the Assertions example fails at ESM link time once they are used. contracts-refined doesn't re-export `Refined` or any refinement type. `Refined<number, Positive>` passes a type where a brand string is expected. contracts/src/index.ts:107-111 says comptime is not re-exported.
- Suggested fix: Import `comptime` from `"typesugar"`. Import `Refined`/`Positive`/`NonEmpty` from `@typesugar/type-system` and write `Positive` directly (it is already `Refined<number,"Positive">`). Remove the assert/assertNever section and API bullet, or implement them.

### 14. Custom prover registrations in app code never reach the compiler, so the "Provable!" example is false

- Severity: medium
- Location: contracts-refined.md:59-73; contracts.md:316-325, 362-373, 433-452 (registerDecidability / registerSubtypingRule / registerAlgebraicRule)
- Problem: `registerRefinementPredicate(...)` written in a user's source file runs at app runtime. The prover runs inside the transformer, so it never sees the registration. `ensures: { result > 0 } // Provable!` keeps its runtime check even with `proveAtCompileTime`. The page's own Quick Start says the prover "has no facts about `result`".
- Evidence: cr2.ts (with TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME=1) output still has `if (!(result > 0)) throw new PostconditionError(...)`, and `registerRefinementPredicate(...)` stays in the runtime output.
- Suggested fix: Say that custom predicates and rules must be registered from a module the transformer loads (a `typesugar.macros` entry), and drop "Provable!".

### 15. comptime examples that contradict the page's own rules

- Severity: medium
- Location: comptime.md:136-141 (Build Information), 250-251
- Problem: `comptime({ ..., commit: process.env.GIT_COMMIT ?? "dev" })` has no `env` permission, so it fails with TS9209 "permission denied: Environment variable read requires { env: 'read' | true }". `comptime(1 / 0)` is not a build error: it becomes `const c = Infinity;`.
- Evidence: ct1.ts and ct2.ts.
- Suggested fix: Use `comptime({ env: "read" }, () => ({ ... }))`. Replace the division example with a real throw (e.g. `JSON.parse("{")`).

### 16. developer-experience.md documents a CLI flag and a diagnostic that don't exist

- Severity: medium
- Location: developer-experience.md:35 and 191 (`npx typesugar --explain TS9001`), 50-59 (TS9061 "Did you mean to import?"), 128
- Problem:
  - cli.ts has no `--explain`.
  - TS9061 is defined (core/src/diagnostics.ts:511) but never emitted: an unimported `comptime(...)` gives 0 diagnostics and is left as-is (dx3.ts).
  - The language-service plugin doesn't activate "automatically when @typesugar/transformer is in your tsconfig plugins". It needs its own `{ "name": "@typesugar/transformer/language-service" }` entry (transformer/src/init.ts:235, 340).
- Suggested fix: Point to the /errors/ pages instead of `--explain`. Remove or mark the TS9061 example. Show both tsconfig plugin entries.

### 17. codec: `@codec` does no compile-time validation, and there is no derive integration

- Severity: medium
- Location: codec.md:54, 236 ("Compile-time validation | Phase 2 (implemented)"), 226 ("compatible with @typesugar/derive for auto-deriving codec instances")
- Problem: `@codec(3)` with `@since(5)` and no default compiles cleanly, and `defineSchema` doesn't validate either. Only the `schema()` builder's `.build()`/`.buildCodec()` and `validateSchema()` check, both at runtime. No codec derivation exists in derive/macros.
- Evidence: c5.ts gives 0 diagnostics and `{"name":"x","type":"string","since":5}`.
- Suggested fix: Say validation happens when `buildCodec()`/`validateSchema()` runs. Change the table cell to "Runtime (builder)". Delete the derive sentence.

### 18. authoring-libraries teaches the exports shape that causes TS1479

- Severity: medium
- Location: docs/guides/authoring-libraries.md:96-114
- Problem: The flat `{ "types": "./dist/x.d.ts", "import", "require" }` shape gives CJS consumers ESM types (TS1479). The review fixed exactly this in every package (findings-tooling.md #20). The real packages/strings/package.json now nests `types` under `import` and `require` (`.d.cts` for require).
- Suggested fix: Copy the current strings `exports` block (`"import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }, "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }`).

### 19. Inline `requires()` is not elided by the prover

- Severity: low
- Location: contracts.md:113 ("elided when proveAtCompileTime is on (Positive type)")
- Evidence: k7.ts (with contracts-refined imported and prove on) still emits `amount > 0 || (() => { throw new PreconditionError(...) })()`. The block form at contracts.md:486-491 is elided.
- Suggested fix: Drop the comment, or use the block form in the example.

### 20. Smaller mismatches

- Severity: low
- contracts.md:426-431: the `formatCertificate` output is a different layout ("Proof Certificate / Goal: / Status: ✓ PROVEN …", and "Summary: Proven by linear: undefined"). That last line is also a small code bug.
- contracts.md:324-325: `@decidable(...)` on a `type` alias is TS1206 "Decorators are not valid here" in tsc and editors.
- codec.md:202-213: `codec`/`since`/`removed`/`defaultValue` aren't declared anywhere, so plain tsc/IDE reports TS2304 on each one.
- codec.md:5 says "excluded from release", but `npm view @typesugar/codec version` returns 0.1.1 and the Quick Start says `npm install` (this is PEP-059 decision 3).
- effect.md:529-531: `formatDebugTree`, `serviceRegistry` and `layerRegistry` exist only in `@typesugar/effect/macros`, not the root.
- contracts-refined.md:89-93: `Vec` is re-exported as `VecConstructors`, and the refinement types themselves are not re-exported.
- authoring-libraries.md:49: rule 4 says core should be a peer/dev dep, but the worked example (strings) lists `@typesugar/core` in `dependencies`.
- comptime.md:60 lists "Real time" as blocked/not implemented, yet `new Date()` works and is used in the examples.
- derive.md:148: Default (like Clone) returns a plain object, not an `Options` instance.

## 1.0 gaps

- comptime editor gate: comptime.md:11-12 says editors evaluate comptime only "if explicitly enabled", but never says how. The switches are the VS Code setting `typesugar.comptimeInEditor` or `TYPESUGAR_COMPTIME_IN_EDITOR=1` (lsp-server/src/server.ts:842-845; transformer/src/language-service.ts:137).
- conditional-compilation has no section on the condition grammar or the new ConfigConditionError compile error (e.g. "Unsupported config condition ... Supported: dotted paths, 'strings', ..."). It also doesn't document `cfgConfig` or `TYPESUGAR_CFG_*`.
- derive.md never shows imports. The Show/Semigroup/Monoid markers aren't exported from the `typesugar` umbrella (Show only from `@typesugar/macros`, which pulls in TypeScript). The PEP-052 operator/method activation imports aren't mentioned.
- comptime: the fs "project root" is `process.cwd()`, not the tsconfig dir. Running a build from another directory fails with "outside the project root" (I hit this), and the page doesn't say so.
- ai-assistants.md:93-98: the llms.txt / llms-full.txt links go to typesugar.org, which currently serves the Squarespace page (PEP-059 decision 1).
- do-notation: the page has no list of which positions a comprehension's value can be used in for each form (let vs par, with or without fallback). Readers find out from compiler errors.

## Examples checked

| Page                    | Examples                                                         | Passed |
| ----------------------- | ---------------------------------------------------------------- | ------ |
| ai-assistants           | 3 (CLI flags/files checked against cli.ts/init.ts/ai-context.ts) | 3      |
| authoring-libraries     | 2                                                                | 1      |
| codec                   | 7                                                                | 6      |
| comptime                | 16                                                               | 14     |
| conditional-compilation | 14                                                               | 6      |
| contracts-refined       | 2                                                                | 1      |
| contracts               | 24                                                               | 16     |
| derive                  | 20                                                               | 9      |
| developer-experience    | 6                                                                | 4      |
| do-notation             | 25                                                               | 8      |
| effect                  | 14                                                               | 8      |

## Summary

- Counts: 7 high, 11 medium, 2 low (finding 20 bundles 9 small mismatches).
- Top 1: do-notation's recommended `yield: ({...})` form never compiles, and Option comprehensions emit `.flatMap` on erased values, so the Quick Start throws.
- Top 2: cfg is mis-documented end to end. The `config` option doesn't exist, function branches are invoked, and the object form returns the whole object.
- Top 3: Effect's Quick Start (`@layer` + `layerMake`) fails, its EFFECT0xx diagnostics are never emitted, and contracts' `configure()`/`assert`/`assertNever` don't exist.
- Most of the rest are imports that don't resolve and capability claims (generic derive, Functor, deep Clone, codec compile-time validation, `--explain`, TS9061) the code doesn't back.
