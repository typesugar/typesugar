## Docs review, group "start": findings

Every claim below was checked with the helper (`doc-example.mjs`, on the built dist), by importing the package dist, or by quoting code. Scratch files are in `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/start/`. Findings 9 and 37–38 are the only ones that were not run.

The only thing I wrote under the repo was helper output under `.typesugar/doc-examples/`, plus one helper file there (`geo.ts`) for a two-file test. No edits, no commits. All helper runs were sequential, and no heavy jobs were run.

### 1. Derived method syntax (`.equals()/.clone()/.debug()/.toJson()`) needs syntax-marker imports. The getting-started examples omit them and crash.

- Severity: high
- Locations:
  - The `typesugar init` example: `packages/transformer/src/init.ts:553-585`, run by `docs/getting-started/index.md:24-28`.
  - `docs/getting-started/app-developer.md:126-145`
  - `docs/getting-started/environments/vitest.md:73-107`
  - `docs/getting-started/environments/jest.md:128-150`
  - `docs/macro-types.md:243-257`
  - `docs/getting-started/troubleshooting.md:126-150`. "@derive Methods Missing" never names the real cause.
- Problem: the docs say `@derive` adds "real methods on the instance". Under PEP-052, method sugar only rewrites in files that import `@typesugar/std/syntax/<tc>`. Without that import the call is left alone and fails at runtime. No diagnostic is emitted, and strictOutput stays silent too because of the std global augmentations.
- Evidence: the init example output keeps `const user2 = user1.clone();`, and running it gives `TypeError: user1.clone is not a function`. The app-developer example gives the same `user.clone is not a function`. With the four `syntax/*` imports added it runs: `User.Eq.equals(user, User.Clone.clone(user))` prints `true`.
- Suggested fix: add `import "@typesugar/std/syntax/eq"; import "@typesugar/std/syntax/clone"; import "@typesugar/std/syntax/debug"; import "@typesugar/std/syntax/json";` to the init template and to every one of these examples. Add "syntax not activated" as cause #1 under troubleshooting's "@derive Methods Missing". Consider having the transformer warn when it sees a method from a derived companion with no marker imported.

### 2. `yield: ({ ... })` is rejected everywhere, and the hint text recommends that same form

- Severity: high
- Locations:
  - `README.md:311`
  - `docs/macro-types.md:176,184`
  - `docs/migration/from-effect.md:46,53,61,126,168,188`
  - `docs/index.md:162`, which uses `yield: { { user, posts, stats } }`
  - Outside my scope, the same form appears about 15 times in `docs/guides/do-notation.md` (59, 95, 210, …), plus `guides/effect.md`, `packages/std/README.md` and `packages/effect/README.md`.
- Problem: `std/src/macros/let-yield.ts:290-295` requires the continuation to be a Block: `if (!ts.isBlock(continuation.statement)) ctx.reportError(continuation, "yield: must be followed by a block { ... }")`. The `{ { … } }` form gets a hint from `comprehension-utils.ts:177-180`, and that hint says "use `yield: ({ user, posts })` with parentheses", which is the rejected form. The only tests for the parenthesised form (`std/tests/yield-syntax.test.ts`) check the parser AST and never run the macro.
- Evidence:
  - `function f(){ let: { a << Promise.resolve(1); b << Promise.resolve(2); } yield: ({ a, b }); }` produces `[error] yield: must be followed by a block { ... }`, and the output keeps a raw `let:` (`SyntaxError: Unexpected strict mode reserved word`).
  - `yield: { ({ user, posts }) }` works and prints `{ user: { id: 1 }, posts: [ 1, 2 ] }`.
  - The home-page form gives `yield: contains a nested block ... use yield: ({ user, posts })`. In expression position (`const result = let: …`) the `const result =` also disappears from the output.
- Suggested fix: either make the macro accept a parenthesised ExpressionStatement (the docs-wide form), or rewrite every doc to `yield: { ({ … }) }` and fix the hint in `comprehension-utils.ts`. Add an execution test for whichever form is chosen.

### 3. Array extension methods from the README are never rewritten and crash at runtime

- Severity: high
- Location: `README.md:211-217` (`arr.head()`, `arr.tail()`, `arr.chunk(2)`); also the `std/src/index.ts` header, which shows `[1,2,3].chunk(2)`.
- Problem: number and string extensions rewrite (`abs(n)`, `capitalize("hello")`), but the generic array ones do not, and nothing is reported. The likely cause is `checkImportedSymbolForExtension` (`transformer-core/src/import-resolution.ts:725`): it calls `isTypeAssignableTo(number[], readonly A[])` with `A` left uninstantiated.
- Evidence: with `import { head, tail, chunk, unique } from "@typesugar/std"`, the output keeps `arr.head()`, and running it gives `TypeError: arr.head is not a function`. `arr.last()` behaves the same.
- Suggested fix: this is a code bug (instantiate or infer the signature before the assignability check). Until it is fixed, remove the array half of the README example.

### 4. The README "Typeclasses (Advanced)" and "Operator Overloading" examples do not work

- Severity: high
- Location: `README.md:249-269` and `README.md:275-290`. `docs/macro-triggers.md:310-352` has the same mechanism.
- Problem, part 1: a bare `@instance` (no arguments) is an error: `@impl requires arguments: @impl("Type"), @impl("Typeclass<Type>"), or @impl(Typeclass, Type)` (`macros/src/typeclass.ts:1678-1683`).
- Problem, part 2: `myPoint.serialize()` is never rewritten (custom typeclasses need a `@syntax-methods` marker), so it gives `TypeError: myPoint.serialize is not a function`.
- Problem, part 3: `a + b` on `Vec2` with Semigroup is never rewritten, even with an explicit instance plus `import "@typesugar/std/syntax/semigroup/ops"`. It runs as string concatenation and prints `[object Object][object Object]`. The reason: operator candidates come only from `/** @op */` JSDoc on the typeclass declaration (`macros/src/typeclass-index.ts:63-74`), and std's `Semigroup`, `Monoid`, `Group`, `Numeric`, `Integral` and `Fractional` carry no `@op` tags (`std/src/typeclasses/index.ts:540,850`). So their `/ops` markers do nothing.
- Problem, part 4: the `& Op<"+">` mechanism in `macro-triggers.md` §9 is not read anywhere.
- Evidence: an in-file `/** @typeclass */ interface Add<A> { /** @op + */ add(a,b) }` with `/** @impl Add<Vec2> */` does work. It even inlines to `({ x: a.x + b.x, y: a.y + b.y })`.
- Suggested fix: add `/** @op + */` (and the matching tags for `-`, `*`, `/`) to std's Semigroup and Numeric family. Then rewrite the README examples to use `/** @impl Serialize<Point> */` plus a syntax marker, and drop the `Op<>` section from macro-triggers.

### 5. ESLint config snippets throw: `configs.recommended` is an object, not an array

- Severity: high
- Locations: `docs/reference/config.md:177-189`, `docs/getting-started/editor-setup.md:116-138`, `docs/getting-started/troubleshooting.md:268-282`
- Problem: the docs write `export default [...typesugar.configs.recommended]`.
- Evidence: `Array.isArray(p.configs.recommended)` is `false`, and spreading it gives `p.configs.recommended is not iterable`. The plugin's own header (`eslint-plugin/src/index.ts:9-14`) uses `export default [typesugarPlugin.configs.recommended]`.
- Also: the "Legacy .eslintrc" sections (`config.md:192-199`, `editor-setup.md:152-159`) are dead. The plugin's peerDependencies say `eslint >=9.0.0`, and PEP-059 says flat config only.
- Suggested fix: use `export default [typesugar.configs.recommended]`, and delete the `.eslintrc` sections.

### 6. unplugin `include`/`exclude` are substring matches, not globs. The documented glob values turn the plugin off.

- Severity: high
- Locations:
  - `docs/reference/config.md:58-59,74-75,91-92`
  - `docs/getting-started/environments/vite.md:49-52`
  - `esbuild.md:52-53`
  - `webpack.md:47,207`
  - `docs/getting-started/troubleshooting.md:214-218`, offered as the fix for "Macros Not Expanding"
- Problem: `unplugin-typesugar/src/unplugin.ts:56-87` does `include.some((pattern) => normalizedId.includes(pattern))`. No module id contains the literal text `**/*.ts`, so nothing is transformed. Passing any `exclude` array also replaces the default `/node_modules/` exclusion, and `"node_modules/**"` never matches as a substring.
- Suggested fix: document the real semantics ("RegExp, or substrings of the module id; default `/\.[jt]sx?$/`"), with an example like `include: /src\/.*\.tsx?$/`. Better: implement real globs (picomatch, or unplugin's `createFilter`).

### 7. `config.md` documents plugin options that don't exist and leaves out the real config system

- Severity: high
- Location: `docs/reference/config.md:55-78, 155-171, 282-297`
- Problem:
  - The unplugin options are only `tsconfig`, `include`, `exclude`, `verbose`, `diskCache` and `strict` (boolean or `"incremental"`) (`unplugin.ts:14-38`). `macroModules` and `config` do not exist.
  - The tsconfig transformer key for cfg values is `cfgConfig` (`transformer/src/pipeline.ts:62-80`, applied at `:334`). The documented `"config"` key is ignored.
  - `comptimeTimeout` does not exist; the timeout is hard-coded (`macros/src/comptime.ts:85`, `COMPTIME_TIMEOUT_MS = 5000`).
  - There is no unplugin route for passing cfg values at all; the only other route is `TYPESUGAR_CFG_*` env vars (`macros/src/cfg.ts:75-91`).
  - Also missing: `typesugar.config.ts` / `.typesugarrc` with `defineConfig`, the `TypesugarConfig` keys (`debug`, `contracts.{mode,proveAtCompileTime,strip}`, `resolution`, `features`, `security.allowedMacroPackages`), and the `TYPESUGAR_*` env overrides (`core/src/config.ts:1-31, 44-102, 142-200`).
- Suggested fix: rewrite config.md around `typesugar.config.ts` and its env overrides, list only the six real unplugin options, rename the tsconfig key to `cfgConfig`, and delete the comptime-timeout section.

### 8. Webpack CommonJS snippets call the module object

- Severity: high
- Location: `docs/getting-started/environments/webpack.md:16,31,84,89` and `docs/reference/config.md:84-88`
- Evidence: `require("unplugin-typesugar/webpack")` returns `{ default: [Function] }`, so `typesugar()` throws "typesugar is not a function". The esbuild page (`.default()`), the FAQ, and init's own injector (`init.ts:504-505`) already use `.default`.
- Suggested fix: `const typesugar = require("unplugin-typesugar/webpack").default;`

### 9. The Jest (ts-jest) `astTransformers` config points at a module with no `factory` export

- Severity: high (not run: ts-jest is not installed in the repo)
- Location: `docs/getting-started/environments/jest.md:20-30, 46-56, 79-90, 191-197, 230-238`; `docs/reference/config.md:247-268`; `troubleshooting.md:225-238`
- Problem: ts-jest's custom AST transformer contract requires the module to export `name`, `version` and `factory(tsCompiler, opts)`. `@typesugar/transformer` exports only a default `(program, config, extras)` factory (`transformer/src/index.ts:41-47`). Nothing in the repo uses ts-jest.
- Suggested fix: ship a ts-jest adapter entry (for example `@typesugar/transformer/ts-jest`), or remove the Jest page and point readers to Vitest.

### 10. `validator<T>()` is documented as a boolean type guard but returns a result object, so invalid data passes

- Severity: high (validation silently accepts anything)
- Location: `docs/getting-started/app-developer.md:185-189`. Every validator example in `docs/migration/from-zod.md` is built on this (`:24-27, 45, 88-95, 133, 196, 224-227, 244-246`).
- Evidence: `const validate = validator<User>(); if (validate(42)) console.log("treated as User:", 42)` prints `treated as User: 42`. The generated validator returns `{ success: true, value } | { success: false, errors }`. The output also carries three strictOutput type errors ("Property 'id' does not exist on type 'object'").
- Suggested fix: use `const r = validator<User>()(data); if (r.success) { r.value… }`. Or point Zod users at `@typesugar/validate`'s `is<T>()`, which the Zod migration page never mentions.

### 11. The macro-authoring docs teach an API that doesn't exist

- Severity: high (for extension authors)
- Locations: `docs/getting-started/extension-author.md:69-259, 280-307`; `docs/reference/index.md:42-83`; `docs/reference/macro-context.md:337-367`; `docs/migration/from-ts-macros.md` (every definition); `docs/getting-started/environments/monorepo.md:150-195`
- Problems:
  - (a) `defineExpressionMacro("double", {expand})` has the wrong signature. It takes a single object, `defineExpressionMacro({ name, module, expand })`, and it only returns the definition; it does not register it (`core/src/registry.ts:530-536`). Registration is `globalRegistry.register(...)` / `registerMacros(...)`.
  - (b) `@typesugar/core/quote` does not exist. Core exports only `"."`; `quote`, `quoteStatements`, `ident` and `spread` come from `@typesugar/macros`.
  - (c) `@typesugar/testing` has no `expandMacro`, `expandCode` or `assertExpands`. Its exports are `assert`, `staticAssert`, `typeAssert`, `forAll`, `createMacroTestContext`, and so on.
  - (d) `cfg` and `cfgAttr` are not exported by `@typesugar/core`.
  - (e) The publishing `package.json` (and the monorepo `@myorg/macros` one) has no `typesugar.macros` manifest field. Since PEP-055 the transformer only loads packages that declare it (`transformer/src/macro-loader.ts:66-79`), and anything outside `@typesugar/*` additionally needs `security.allowedMacroPackages` / `typesugar approve-macros`. As documented, the macros are never loaded.
  - (f) In the monorepo layout, PEP-059 P1 #18 (`resolveModuleSpecifier` maps any `/packages/<x>/` path to `@typesugar/<x>`) affects exactly the `packages/macros` example.
- Suggested fix: correct the signatures and import paths, add the `typesugar.macros` field plus the approval step, and replace the testing examples with real exports.

### 12. The `Builder` derive is advertised but not registered

- Severity: high
- Location: `docs/getting-started/app-developer.md:150,219`; `docs/macro-types.md:235,244-257`; `docs/reference/packages.md:267`; `docs/index.md:222`
- Evidence: `@derive(Eq, Ord, Clone, Debug, Json, Builder)` gives `[error] Unknown derive: 'Builder'. Not a registered derive macro...`, then `Config.builder is not a function`. `Builder` is only a marker symbol (`macros/src/derive.ts:98`); no derive macro implements it.
- Suggested fix: remove Builder from every list (and from the `typesugar`/`@typesugar/derive` marker exports), or implement it.

### 13. The tsc page promises "full typechecking in the same pass" and recommends `tsc --noEmit` as the check

- Severity: high (the recommended CI gate reports phantom errors and never runs macros)
- Location: `docs/getting-started/environments/tsc.md:31-32, 76-84`; `vite.md:70-73`; `esbuild.md:69-72, 151`; `monorepo.md:247-257`; `troubleshooting.md:254`
- Problem: ts-patch's `type: "program"` transformer runs at emit time, after type checking, and `--noEmit` skips it entirely. `docs/PERFORMANCE.md:144-148, 220-224` says this correctly ("tsc type-checks the original source"), so the pages contradict each other.
- Evidence: plain `tsc --noEmit` on `@derive(Eq) interface P {…}` gives `error TS1206: Decorators are not valid here.` Method sugar and `let:` labels likewise type-check as unexpanded source.
- Suggested fix: make `typesugar check` the type-check and CI gate everywhere, and delete the "same pass" claim.

### 14. AGENTS.md gives agents false or contradictory instructions

- Severity: high (it steers agent-written code)
- Location: `AGENTS.md:23, 33, 42, 48, 83, 107, 116, 153, 167, 241-262`
- Problems:
  - Principle 2 states "`p1 === p2` compiles to `p1.x === p2.x && p1.y === p2.y`, not `Point.Eq.equals(p1, p2)`". The actual output is `Point.Eq.equals(p1, p2)` (verified).
  - Principles 9 and "When Adding Features #5" say "Use `quote()` … Never use raw `ts.factory` calls". That is the opposite of the repo's CLAUDE.md rule (build with `ts.factory`; string→AST is the exception list).
  - `typeclassRegistry`, `instanceRegistry`, `findInstance()` and `registerFlatMap` do not exist (missing from the dist exports).
  - The package tree lists `hlist/`, `symbolic/` and `prettier-plugin/`, none of which exist.
  - `import "@typesugar/std/macros"` is shown as the way to activate `let:`; activation is now `@typesugar/std/syntax/do`.
  - The "Auto-derivation (default) … Always" table contradicts principle 2's "instances are never ambient". With ops activated and no derive, `===` stays native.
  - The quick-lookup `defineExpressionMacro(name, macro)` signature is wrong.
- Suggested fix: rewrite these lines to match the code and CLAUDE.md.

### 15. The VS Code extension ID is wrong

- Severity: high
- Location: `docs/getting-started/editor-setup.md:18`
- Evidence: `packages/vscode/package.json` publisher.name is `typesugar.typesugar-vscode`. The doc says `code --install-extension typesugar.vscode-typesugar`.
- Suggested fix: `code --install-extension typesugar.typesugar-vscode`

### 16. The end-user guide omits macro-package approval, so third-party typesugar libraries fail the build

- Severity: high
- Location: `docs/getting-started/end-user.md:9-21, 93-101` ("You're done! … no need to change anything")
- Problem: a non-`@typesugar/*` package that declares `typesugar.macros` throws `UnapprovedMacroPackagesError` ("…Run `typesugar approve-macros`…") until it is listed in `security.allowedMacroPackages` (`transformer/src/macro-loader.ts:54-64, 184-195`). The page never mentions `approve-macros`, and neither do `cli.md` or `config.md`.
- Suggested fix: add a step: "Run `npx typesugar approve-macros` and commit the `typesugar.config.ts` it writes."

### 17. "Zero-cost / no dictionary lookup" claims for derived instances are false

- Severity: medium
- Location: `README.md:31, 38, 184-185`; `docs/index.md:79, 87-94`; `docs/getting-started/index.md:36-38`
- Evidence: `alice === bob` compiles to `User.Eq.equals(alice, bob)`, `alice < bob` to `User.Ord.lessThan(alice, bob)`, and `p1.clone()` to `Point.Clone.clone(p1)`. The README comments say `alice.id === bob.id && ...` and `{ x: p1.x, y: p1.y }`. Only in-file `@op` typeclasses were seen to inline (see 4).
- Suggested fix: change the "Compiles to:" comments to the real output, e.g. `// → User.Eq.equals(alice, bob) (a direct call to a generated function)`, or make derived companions inline.

### 18. README "Safety" overstates the comptime sandbox

- Severity: medium
- Location: `README.md:52, 337`
- Problem: the README says "restricted vm context (no filesystem, network, or process access)". `docs/SECURITY.md:107-111` says vm "is not an isolation boundary… a determined comptime block can reach the host realm". Filesystem and env access are also opt-in grants (`ComptimePermissions`, `macros/src/comptime.ts:64-69`).
- Suggested fix: "comptime runs in a `vm` context with IO off by default. Not a security boundary; see SECURITY.md."

### 19. `npx typesugar --explain TSxxxx` does not exist

- Severity: medium
- Location: `README.md:369`; `docs/index.md:368`
- Evidence: `cli.ts:85-105` treats the first argument as a command, so this prints "Unknown command: --explain" and exits 1. Grepping for `explain` across `transformer/src` finds nothing.
- Suggested fix: remove the claim (or point to https://typesugar.org/errors/TSxxxx), or implement the flag.

### 20. The "Did you mean to import…?" diagnostics (TS9061/TS9062) are never emitted

- Severity: medium
- Location: `README.md:373-388`; `docs/index.md:371-383`; `docs/errors/TS9061.md`, `TS9062.md`
- Evidence: `const x = comptime(() => 1 + 1);` with no import, and `value.clamp(0,100)` with no import, both produce zero diagnostics. `TS9061`/`TS9062` appear only in `core/src/diagnostics.ts`. `getSuggestionsForSymbol` is called only for unknown derive names (`transformer-core/src/macro-helpers.ts:662`).
- Suggested fix: limit the claim to unknown `@derive` names, or implement it.

### 21. `cli.md` is incomplete or wrong in several places

- Severity: medium
- Location: `docs/reference/cli.md` throughout; `troubleshooting.md:185`
- Undocumented but real:
  - the `approve-macros` command, with `-p` / `-y` / `-v`
  - init's `--yes`, `--persona`, `--ai` and `--no-ai`
  - `expand --js`
  - `--strict=incremental` (build/check)
  - `--show-suppressed-diagnostics`
  - `run` refusing to execute on macro errors
- Wrong:
  - "Project references: Via tsconfig / Incremental: Via tsconfig" (`:384-385`) and tip 2 "enable `incremental`" (`:409-417`). The CLI uses plain `ts.createProgram` (`cli.ts:504`), with no references, builder or tsbuildinfo, which matches PEP-059 P0 #8.
  - The exit-code table: `run` returns the child's exit code (`cli.ts:1245-1247`).
  - The doctor checklist: it is missing "skipLibCheck enabled", "@typesugar/transformer installed" and "Macro registration". Doctor also warns "skipLibCheck is not enabled — @typesugar/fp declarations may produce errors" (`doctor.ts:558-564`), which contradicts `cli.md:100-102` ("skipLibCheck is not required").
  - `troubleshooting.md:185`'s `typesugar build --manifest` flag doesn't exist (unknown flags are silently ignored).
  - The npm-scripts example uses `check --strict`, which `cli.md:92-94` itself says is experimental and "not a substitute".
- Suggested fix: regenerate the page from `printHelp()` (`cli.ts:258-330`), and drop the references/incremental rows and the `--manifest` line.

### 22. Several home-page tour snippets fail

- Severity: medium
- Location: `docs/index.md`
- Failures:
  - `comptime(fibonacci(50))` (`:193`) fails with TS9209 "fibonacci is not defined". Module functions aren't visible in the sandbox (and fib(50) naive would never finish).
  - `ensures: { result => result >= 0 }` (`:167`) compiles to `if (!(result => result >= 0))`. That condition is always false, so the postcondition is silently never checked; strictOutput says "This kind of expression is always truthy". Use `ensures: { result >= 0 }`.
  - `[1, 2, 3, 4, 5].sum()` (`:237`): there is no `sum` array extension.
  - `forAll(Point, …)` with a class (`:338-339`) gives `TypeError: Class constructor Point cannot be invoked without 'new'`.
  - `defineSyntaxMacro("unless", …)` (`:115-126`) can't be defined and used in one file, and `typesugar/core` doesn't export it (it lives in `@typesugar/macros`). The umbrella's own comment (`packages/typesugar/src/index.ts:58-60`) is wrong about this too.
  - `collectTypes()` (`:187`) has no runtime stub export.
- Suggested fix: replace them with the working forms above, or remove them.

### 23. The README SQL example binds a table name as a parameter

- Severity: medium
- Location: `README.md:239`
- Evidence: `query.query` is `{ text: 'SELECT * FROM $1 WHERE id = $2', params: ['users', 5] }`, which is invalid SQL.
- Suggested fix: ``sql`SELECT * FROM ${Fragment.ident(table)} WHERE id = ${id}` `` (`Fragment.ident` is at `sql/src/types.ts:184`), or use a literal table name.

### 24. The Json derive is documented as string in / string out. `User.fromJson(str)` miscompiles.

- Severity: medium
- Location: `docs/getting-started/app-developer.md:143-148`; `docs/macro-types.md:234,256`; `docs/migration/from-zod.md:185-195`
- Evidence: `toJson` returns an object (`{ id: 1, name: 'Alice', … }`), and `fromJson` takes `unknown`, not a JSON string. `User.fromJson('{"id":1,…}')` compiles to `typeof User.Json.fromJson(User, '{...}')`: it passes the class as the json argument, adds a spurious `typeof`, and throws "Expected object". That is a code bug.
- Suggested fix: document `User.Json.toJson(u)` / `User.Json.fromJson(JSON.parse(s))`, and fix the static-call rewrite.

### 25. Wrong imports on the Zod migration page

- Severity: medium
- Location: `docs/migration/from-zod.md:156-157, 168-170`
- Problem: `Refined` and `Positive` are not exported by `@typesugar/contracts-refined`. `Refined<Base, Brand extends string>` comes from `@typesugar/type-system`, and `Positive` is already `Refined<number,"Positive">` there. `newtype` is not exported; the exports are `wrap`, `unwrap` and `newtypeCtor`.
- Suggested fix: `import { Positive } from "@typesugar/type-system"; type PositiveNumber = Positive;` and `const userId = wrap<UserId>("user-123")`.

### 26. `reference/packages.md` export lists name things that don't exist

- Severity: medium
- Location: `docs/reference/packages.md`
- Missing exports, checked by importing each package's dist:
  - core: `cfg`, `cfgAttr`
  - macros: `typeclassRegistry`, `instanceRegistry`, `extractTypeInfo`
  - std: `titleCase`, `strip`, `groupBy` (it's `arrayGroupBy`)
  - typeclass: `summonAll`
  - derive: `deriveIgnore`, `deriveWith`
  - type-system: `refine` (removed per PEP-059)
  - contracts: `assert`, `configure` (the real names are `setContractConfig`/`getContractConfig`)
  - validate: `Schema`
  - fp root: `Option`, `Result`, `Ok`, `Err`, `Either`, `List` (`Option`/`Either` values live at `@typesugar/fp/data`; fp has no `Result`/`Ok`/`Err`)
  - effect: `formatDebugTree`
- Also: "typesugar … Includes: core, derive, reflect, typeclass" (`:9-15`) is stale. The root is runtime-only now and the authoring APIs are at `typesugar/core`.
- Suggested fix: regenerate the lists from the dist exports.

### 27. `macro-context.md` documents `ctx.evaluate` wrongly

- Severity: medium
- Location: `docs/reference/macro-context.md:277-292, 353-356`
- Problem: the doc says it returns "the JS value … `undefined` if evaluation fails". It actually returns the tagged union `ComptimeValue` (`{ kind: "number", value }` … `{ kind: "error", message }`) (`core/src/types.ts:223-234`). So the example's `(value as number) * 2` evaluates to `NaN`.
- Suggested fix: show `if (v.kind === "number") return ctx.createNumericLiteral(v.value * 2)`.

### 28. The two editor-setup pages disagree, and the Zed instructions point at a directory that doesn't exist

- Severity: medium
- Location: `docs/editor-setup.md` (unreachable from the sidebar) vs `docs/getting-started/editor-setup.md`
- Problem: the root page centres on `@typesugar/lsp-server`, which the README lists as Frozen ("use `@typesugar/ts-plugin` instead"). Its Zed section says to install from `packages/zed/` and `cargo build` there; `packages/zed` does not exist.
- Suggested fix: delete or merge the root page, or at least drop the Zed section.

### 29. Error pages: examples that don't trigger the documented code

- Severity: medium
- Location: `docs/errors/*`. I spot-checked 11 pages: TS9001–9003, 9005–9007, 9101–9104 and 9201.
- Results:
  - **TS9001** example 1 (`p1 === p2`, no derive, ops imported): no diagnostic; it silently stays native `===`. Example 3 (`summon<Eq<T>>()`) does emit TS9001.
  - **TS9002** (`@impl` on a function): no diagnostic at all.
  - **TS9003**: emits the uncoded "@impl requires arguments…" twice.
  - **TS9006**: emits an uncoded "already provided by 'eqPoint'" warning twice.
  - **TS9007**: emits TS9001 instead.
  - **TS9201**: `summon()` gives TS9005 and `summon<Eq, Ord>()` gives TS9008. TS9201 is never emitted.
  - **TS9101/TS9102**: the error is "GenericDerivation failed for Eq: Error: cannot derive Eq for 'User'" with a good field trace but no code, unlike the Rust-style TS9101 shown on the home page.
  - **TS9103, TS9104, TS9005**: correct.
  - **Fixes**: those for 9002, 9007, 9101 and 9103 all run (`true` / `(1, 2)`).
- A grep finds about 35 catalogued codes that are never referenced outside `diagnostics.ts`: 9002–9004, 9006, 9007, 9052, 9060–9063, 9102, 9105, 9201, 9202, 9204, 9207, 9208, 9210, 9211, 9214–9216, 9218, 9220, 9301, 9401, 9501, 9502, 9701–9703, 9800–9803. (By grep; a dynamically built `TS${n}` would be missed.)
- Suggested fix: emit the descriptors at these sites (`ctx.diagnostic(TS9002)` and so on), or mark the never-emitted codes "reserved" in the generator.

### 30. Smaller macro-triggers and FAQ errors

- Severity: medium
- `macro-triggers.md` §8 (`:284-307`) omits the required syntax activation.
- `macro-triggers.md` "Built-in operator mappings" gives `Eq ===→eq`; the method is `equals`. Semigroup's `+` mapping doesn't work (see 4).
- `faq.md:107-114`, `comptime(fs.readFileSync(...))`, fails with "comptime permission denied: File read requires { fs: 'read' }". It should show `comptime({ fs: "read" }, () => …)` with the sandbox helpers.
- `faq.md:146-148` says results "aren't cached across builds", but `--cache` and unplugin `diskCache` exist (and PERFORMANCE.md documents them).

### 31. Minor links, labels and claims (low)

- Severity: low
- Broken internal links (grep check of the whole `docs/` tree):
  - `errors/TS9201.md:78` → `/reference/macros.md`
  - `guides/do-notation.md:631,633` → `../reference/typeclasses.md#flatmap`, `../reference/macro-types.md#…`
  - `guides/index.md:65,69,74` → `hlist.md`, `collections.md`, `symbolic.md`
  - `reference/index.md:22-23` → `./macro-types.md`, `./macro-triggers.md` (the pages live at `/macro-types` and `/macro-triggers`)
  - `reference/packages.md:637` → `/guides/collections`
  - `index.md:249` anchor `/guides/typeclasses#pattern-matching`
  - `vision/effect-integration.md:344` → `../../packages/effect/README.md`
  - Nine `plans/*.md` links go to `../../peps/*` (outside the site)
  - `config.ts:156` has `ignoreDeadLinks: true`, which hides all of these.
- Mislabelled link: `index.md:129` "Macro Types Reference" points at `/reference/macro-context`.
- Next.js note (`webpack.md:125`, "`next build` always uses Webpack"): likely stale, since recent Next defaults to Turbopack. Not verified here.
- `monorepo.md:241-248` uses turbo.json `pipeline` and `command` keys. Turbo v2 uses `tasks` and runs package scripts. Not verified here.
- README "Frozen … excluded from release" (`:121-124`) is contradicted by PEP-059 decision 3 (they are published).
- `getting-started/index.md:142` "six full app scenarios you can `typesugar run`": these are `examples/dry-runs/*` workspace fixtures that don't install outside the repo (per `examples/README.md`).
- `config.md:205-219` leaves out three VS Code settings: `useLegacyPlugin`, `enableVerboseLogging`, and `comptimeInEditor` (default false, so comptime inlay results are off by default in the editor).

## Site structure

- Every sidebar entry resolves to an existing page.
- Unreachable from the sidebar, the nav and other pages:
  - `editor-setup.md`
  - `playground-test.md` (a Monaco dev test page that is still built and published)
  - `showcase/effect-comparison/README.md`
  - `ANALYSIS-language-design.md`, `PLAN-language-service-v2.md`, `VISION-WEB-FRAMEWORK.md`
  - `design/parameterized-instance.md`, `rfcs/001-macro-composition-api.md`
  - eight `plans/PLAN-*.md` files
- Not in the sidebar, reached only from page content: `macro-types.md`, `macro-triggers.md`, `writing-macros.md` (a root page that duplicates the `writing-macros/` section), `SECURITY.md`, `PERFORMANCE.md`, `SECURITY-REVIEW.md`, `vision/*`, `plans/PLAN-api-reference.md`, and every `errors/TS*.md` (reached via `/errors/`).
- Aspirational pages:
  - All `plans/*`, `vision/*`, `rfcs/*`, `design/*`, `ANALYSIS-*` and `PLAN-language-service-v2` carry a "HISTORICAL DOCUMENT" warning banner. `PLAN-api-reference` and `SECURITY-REVIEW` are clearly dated or status-labelled.
  - `VISION-WEB-FRAMEWORK.md` has no banner (only "Vision:" in the title), but it is unreachable.
  - The home page (`index.md:487-493`) links `/vision/*` as "Long-term vision… roadmap" while those pages call themselves historical. `migration/from-effect.md:306` calls `vision/effect-integration` "the full roadmap". The wording is mismatched, but no page presents them as shipped.

## 1.0 gaps

- There is no reference for `typesugar.config.ts` / `TypesugarConfig` / `TYPESUGAR_*` env vars / `security.allowedMacroPackages` anywhere in the reference section.
- `approve-macros` (PEP-055) is undocumented in cli.md, config.md and the getting-started guides.
- The PEP-052 syntax activation markers (`@typesugar/std/syntax/*`, `/ops`, `@syntax-methods` for custom typeclasses) have no reference page. Most getting-started examples predate them (finding 1).
- `macro-context.md` omits `diagnostic()`, `getDiagnostics()`, `tryShortName`, `safeRef`, `ensureImport`, `isTypeReliable`/`assertTypeReliable` and `hygiene`.
- There is no documented working way to unit-test a custom macro with `@typesugar/testing` (only `createMacroTestContext` exists).
- About 35 error-catalog pages document codes the compiler never emits.
- The unplugin `strict: "incremental"` and `diskCache` options appear only in PERFORMANCE.md, not in config.md.
- The CLI has no `--explain`. The README promises it, and the error descriptors already carry the explanation text.

## Examples checked

| Page                                            | Examples                    | Passed                                                            |
| ----------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| README.md                                       | 11                          | 4 (comptime, reflect, `use extension` across files, opt-out)      |
| docs/index.md                                   | 9                           | 3 (tailrec, match/words, lazy fusion)                             |
| getting-started/index.md (init example)         | 1                           | 0                                                                 |
| getting-started/app-developer.md                | 4                           | 2 (comptime, sql)                                                 |
| getting-started/end-user.md                     | setup steps                 | 0 (missing approve-macros)                                        |
| getting-started/extension-author.md             | 5 (checked against the API) | 0                                                                 |
| getting-started/editor-setup.md                 | 3                           | 1 (settings keys)                                                 |
| getting-started/troubleshooting.md              | 3                           | 0                                                                 |
| environments/vite, esbuild, webpack, tsc        | 8                           | 3                                                                 |
| environments/vitest, jest, monorepo             | 5                           | 0                                                                 |
| environments/bun                                | 0 (prose and config only)   | n/a                                                               |
| docs/editor-setup.md                            | 2                           | 1 (lsp bin)                                                       |
| reference/cli.md                                | every flag against `cli.ts` | see 21                                                            |
| reference/config.md                             | 7 config blocks             | 2 (ts-patch, prepare)                                             |
| reference/macro-context.md, reference/index.md  | 3                           | 0                                                                 |
| reference/packages.md                           | 22 package export lists     | 9 fully correct                                                   |
| faq.md                                          | 2                           | 1 (Next.js)                                                       |
| macro-types.md / macro-triggers.md              | 5                           | 0                                                                 |
| migration/from-zod, from-effect, from-ts-macros | 6                           | 0                                                                 |
| errors/\* (11 pages)                            | 16 (11 trigger + 5 fix)     | trigger: 4 correct, 3 partial (no code), 4 wrong; all 5 fixes run |
| SECURITY.md, PERFORMANCE.md                     | claims vs code              | consistent (bench script exists)                                  |

## Summary

- Counts: 16 high, 15 medium, 1 low entry (31, which bundles about 10 minor items).
- Top problem 1: the getting-started path is broken end to end. The `init` example and the persona and test-runner guides call derived methods without the PEP-052 syntax imports and crash. `yield: ({…})`, used across about 30 snippets, is rejected by the macro. Array extensions in the README crash.
- Top problem 2: setup and config references describe options that don't exist or behave differently. These are glob `include` (substring match), `config`/`macroModules`/`comptimeTimeout`, `...configs.recommended`, the webpack `require` without `.default`, the ts-jest path, the extension ID, `tsc --noEmit` as the CI gate, and the missing approve-macros step.
- Top problem 3: the macro-authoring docs (extension-author, reference/index, macro-context, from-ts-macros, AGENTS.md) teach wrong signatures, a nonexistent `@typesugar/core/quote`, nonexistent test helpers, and no `typesugar.macros` manifest. AGENTS.md also contradicts CLAUDE.md on `quote()` vs `ts.factory` and misstates what `===` compiles to.
- Several of these are code bugs rather than doc bugs, and should be fixed in code: findings 2, 3, 4 (std `@op` tags), 12 (Builder), 24 (`fromJson` rewrite), 22 (`ensures` arrow) and 29 (codes never emitted).
