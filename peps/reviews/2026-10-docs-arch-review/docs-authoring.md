## Docs review, group "authoring": writing-macros guide and the 34 package READMEs

I touched nothing in the repo. My own output went only to the gitignored `.typesugar/doc-examples/` and to the scratch dir `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/docrev/authoring/`. That dir has two harnesses:

- `harness.mjs` registers a macro written the way the doc writes it, then runs `transformCode` on a file that uses it.
- `tsconfig.json` with `tc/*.ts` type-checks the examples against the built `.d.ts`.

Nothing of mine is still running.

### 1. Every writing-macros tutorial calls `define*Macro` with a two-argument form that doesn't exist, and never registers the macro

- Severity: high
- Location:
  - docs/writing-macros/index.md:47 and 122-140
  - expression-macros.md:18, 43, 122, 141, 172, 194, 222, 249
  - attribute-macros.md:18, 38, 83, 114, 141, 165, 215, 229, 250
  - derive-macros.md:18, 62, 133, 167, 205, 232, 252
  - tagged-template-macros.md:18, 63, 98, 131, 165, 184, 214, 234
  - type-macros.md: every example (18 … 268)
  - labeled-block-macros.md:18, 45, 71, 111, 143, 172, 194, 215, 247, 270
  - quasiquoting.md:241
  - publishing-macros.md:126
  - Contradicting code: packages/core/src/registry.ts:530-592, `defineExpressionMacro(definition: Omit<ExpressionMacro,"kind">)`. It takes one argument and does not register.
- Problem: the doc shows `defineExpressionMacro("double", { expand… })` and implies that registers the macro. In fact the only signature is the single-object one, and registration is a separate `globalRegistry.register(...)` call. Attribute macros also need `validTargets`, which is a required field (types.ts:328).
- Evidence:
  - tsc on index.md's `double` example: `TS2554: Expected 1 arguments, but got 2`.
  - At runtime (harness), the doc version leaves `import { double } from "./double"; const x = double(21);` unchanged, so the placeholder's throw runs.
  - The object form plus `register` gives `const x = (21) + (21);`.
- Suggested fix: use this form everywhere:
  `globalRegistry.register(defineExpressionMacro({ name: "double", expand(ctx, callExpr, args) { … } }));`
  Attribute macros add `validTargets: ["class"]`. Add one sentence saying that defining a macro does not register it.

### 2. The testing-macros page is built on APIs that don't exist

- Severity: high
- Location:
  - testing-macros.md:13-63, 69, 102, 123, 176, 200, 218, 234, 252, 276
  - index.md:78-81
  - derive-macros.md:283
  - tagged-template-macros.md:257
  - type-macros.md:286
  - labeled-block-macros.md:292
- Problem:
  - `assertExpands`, `expandCode` and `expandMacro` are not exported by `@typesugar/testing` (packages/testing/src/index.ts, macro.ts), or by any package in the repo.
  - `result.errors` and `result.warnings` don't exist either.
  - The page also claims `@derive(Eq)` on a class generates `equals(other` and `this.x === other.x`.
- Evidence:
  - `grep -rln "assertExpands\|expandCode" packages/*/src` returns nothing.
  - Running the page's own "integration" example through the real pipeline gives `namespace Config { export const Eq = { equals: (a: Config, b: Config): boolean => a.version === b.version, … } }`.
- Suggested fix: rewrite the page around what exists:
  - `transformCode(code, { fileName })` from `@typesugar/transformer`, which returns `{ code, diagnostics, changed }`.
  - Check errors with `diagnostics.filter(d => d.severity === "error")`.
  - `createMacroTestContext` from `@typesugar/testing/macros` for unit-testing `expand`.
  - Correct the derive assertions to `Point.Eq.equals`.
  - Follow PEP-059 P0-9: tests should run the output, not just match its text.

### 3. A macro written by following the guide can never be loaded

- Severity: high
- Location:
  - publishing-macros.md (whole page, no mention of discovery)
  - packages/transformer/README.md:48 (`macroModules`)
  - docs/reference/config.md:61, 77
- Problem:
  - publishing-macros never mentions the `"typesugar": { "macros": "./macros" }` package.json field, `typesugar approve-macros`, or `security.allowedMacroPackages`. Those are the only ways the transformer finds third-party macros (packages/transformer/src/macro-loader.ts:62-80).
  - `macroModules`, the documented "custom macro module paths to load" option, is dead. It is declared at packages/transformer/src/pipeline.ts:67 and never read anywhere.
  - So there is no documented way to load project-local macros either.
  - The page's `src/index.ts` re-exports placeholders from the file that registers the macros. That pulls `typescript` and `@typesugar/core` into app bundles, the same problem as PEP-059 finding #16.
- Evidence: `grep -rn macroModules packages/*/src` finds only the declaration at pipeline.ts:67. docs/guides/authoring-libraries.md:44-70 documents the real mechanism; publishing-macros neither links to it nor matches it.
- Suggested fix:
  - Add a "Getting discovered" section: a separate `./macros` entry, the `typesugar.macros` field, approve-macros. Link authoring-libraries.md.
  - Remove `macroModules` from the README and config.md, or implement it.

### 4. The derive-macros patterns produce broken output, and the documented types and helpers are wrong

- Severity: high
- Location:
  - derive-macros.md:27-30, 69-77, 151, 182, 214, 236, 269 (`${target}` in the returned statements)
  - :37-54 (DeriveTypeInfo)
  - :105-128 (simplified API)
  - :233 (`requires`)
- Problem:
  - A derive's statements are added after the declaration, so splicing `${target}` back in duplicates the class or interface, along with its `@derive` decorator.
  - `DeriveTypeInfo` has no `isClass` or `isInterface`, and a variant has `tag`/`typeName`, not `discriminant`/`name`. The real fields are `kind`, `variants`, `discriminant`, `isRecursive` (types.ts:403-453).
  - `DeriveMacro` has no `requires` field.
  - `defineCustomDerive` and `defineFieldDerive` are exported from `@typesugar/macros`, not core. Their callbacks are `(ctx, info) => ts.Statement[]` and `(ctx, typeName, field) => ts.Statement[]`; the doc shows them returning strings (packages/macros/src/custom-derive.ts:145, 252).
- Evidence:
  - Printable tutorial output: `class User {…}` then `@derive(Printable) class User {…}`. Running it fails with `SyntaxError: Identifier 'User' has already been declared`.
  - tsc: `'requires' does not exist in type 'Omit<DeriveMacro,"kind">'`; `Property 'isClass' does not exist on type 'DeriveTypeInfo'`; `Type 'string' is not assignable to type 'Statement[]'`.
- Suggested fix: return only the new statements, and fix the types block to match types.ts. Show `defineCustomDerive` imported from `@typesugar/macros` with an AST-returning callback, and delete `requires`.

### 5. The `@typesugar/core/quote` import path doesn't exist

- Severity: high
- Location: expression-macros.md:120, attribute-macros.md:36, derive-macros.md:16 and 60, tagged-template-macros.md:95, labeled-block-macros.md:69
- Problem: core's `exports` has only `"."`. `quote`, `quoteStatements`, `ident` and `spread` come from `@typesugar/macros`, which quasiquoting.md already uses correctly.
- Evidence: `@typesugar/core` package.json exports keys are `.` only.
- Suggested fix: change the import to `from "@typesugar/macros"`.

### 6. The do-notation examples in the std README no longer compile

- Severity: high
- Location: packages/std/README.md:149-156, 193-199, 222-226
- Problem:
  - The `let:` example puts a guard on a Promise, which is now a compile error (one of PEP-059's breaking changes).
  - `yield: ({ … })` in the paren form is an error.
  - Neither snippet shows the `import "@typesugar/std/syntax/do"` it needs.
  - The bare statements trigger TS9222 ("result discarded").
- Evidence:
  - `let: guards (\`if (cond) {}\`) … are supported for Array, Iterable and AsyncIterable, not Promise`
  - `yield: must be followed by a block { ... }`
  - This version works and prints `{"user":…,"first":"p1"}`:
    `const r1 = let: { user << fetchUser(id); posts << fetchPosts(user.id); first = posts[0]; } yield: { ({ user, first }) }`
- Suggested fix: drop the guard from the Promise example (or switch it to Array), use `const x = let: … yield: { ({…}) }`, put `par:` in statement position, and show the marker import.

### 7. The std README's dot-syntax examples throw at runtime

- Severity: high
- Location: packages/std/README.md:33, 70, 77-79, 314-327
- Problem: Number and String extensions get rewritten. Array extensions do not, and neither do these Range methods: `forEach`, `map`, `filter`, `size`, `last`, `isEmpty`, `reduce`, and `.toArray()` after `.step()`. This holds even when the names are imported, and even on a Range variable.
- Evidence:
  - `TypeError: [1,2,3].head is not a function`, `xs.head is not a function`, `to(...).forEach is not a function`, `r.map is not a function`, `step(...).toArray is not a function`, `to(...).size is not a function`.
  - No std test exercises array or range dot syntax.
- Suggested fix: this is an engine/std bug (rewriting.ts:263-276, the `existingProp` / `resolveExtensionFromImports` path). Until it's fixed, cut those lines from the README and show the function forms (`head(xs)`, `forEach(r, fn)`).

### 8. The collections README hero example crashes

- Severity: high
- Location: packages/collections/README.md:17-38, 64-88, 160-188
- Problem: the README says `new HashSet<Point>()` gets Eq/Hash auto-derived through `= implicit()`. The constructor is actually `constructor(eq: Eq<K>, hash: Hash<K>)`, with both required.
- Evidence: `TypeError: Cannot read properties of undefined (reading 'hash')` at the first `HashSet.add`. Adding `import "@typesugar/std"` doesn't help.
- Suggested fix: pass instances explicitly, e.g. `new HashSet<number>(eqNumber, hashNumber)`, or implement implicit resolution for constructors.

### 9. The contracts README quick start silently skips its checks

- Severity: high (the reader believes the checks run)
- Location: packages/contracts/README.md:15-28
- Problem:
  - Without `import "@typesugar/contracts/syntax"`, `requires:`/`ensures:` are left as inert labels. The only signal is a TS9224 warning.
  - `old()` then reports an error.
  - `withdraw(acc, 100)` returns normally.
- Evidence: as written, `== run` prints `7` then `no throw`. With the import added it prints `threw: PreconditionError Insufficient funds`.
- Suggested fix: add `import "@typesugar/contracts/syntax";` to the snippet.

### 10. The derive README hero example is false

- Severity: high
- Location: packages/derive/README.md:5, 15-28
- Problem:
  - No import and no `@derive`.
  - The claims that `alice === bob` compiles to a field compare, that `alice < bob` is lexicographic, and that `alice.show()` / `alice.clone()` exist are all false.
  - `Show` is not a derive; the package exports Eq, Ord, Clone, Debug, Hash, Default, Json, Builder, TypeGuard.
- Evidence:
  - Output is unchanged; the run prints `false false undefined undefined`.
  - Even with `@derive(Eq, Ord, Clone)` and `import "@typesugar/std"`, `===` and `<` are not rewritten.
  - Derives generate `namespace User { export const Eq = {…} }`.
- Suggested fix: replace with `@derive(Eq, Ord, Clone) interface User {…}` and `User.Eq.equals(alice, bob)`, `User.Clone.clone(alice)`.

### 11. The effect README hero example doesn't compile

- Severity: high
- Location: packages/effect/README.md:14-28
- Evidence: TS9224 (no do-syntax import), then `a decorator on a variable statement needs exactly one declaration`, then the paren-`yield:` problem. With the import and a block `yield:` it still fails: `Could not infer type constructor from expression`. There is no end-to-end test of `@layer` with `let:`; tests/macros.test.ts only covers the registry.
- Suggested fix: replace it with an example taken from a passing test, and add such a test.

### 12. Quasiquote examples that throw or emit garbage

- Severity: medium
- Location:
  - quasiquoting.md:47 (`quote(ctx)\`const ${ident(x)} = 42\``)
  - :313 (`[${spread(exprs)}]`)
  - :224 (`quoteFunction(ctx,"add",["a","b"],…)`)
  - attribute-macros.md:51 (`quote(ctx)\`{ …statements… }\``)
  - tagged-template-macros.md:118-121 (`params.map(p=>p).join(", ")`, which stringifies AST nodes)
- Evidence:
  - `quote: Failed to parse expression template: const myVariable = 42`
  - `…: [1` for the array spread
  - `…: {` for the @logged body
  - quoteFunction throws `Cannot read properties of undefined (reading 'length')`; its signature takes `Array<{name; type?}>` (macros/src/quote.ts)
- Suggested fix: use `quoteStatements` for declarations and `quoteBlock` for bodies, build array literals with `factory.createArrayLiteralExpression`, and use `quoteFunction(ctx, "add", [{name:"a"},{name:"b"}], …)`. Per the CLAUDE.md AST rule, prefer `ts.factory` in the tutorials.

### 13. The labeled-block expand signature and the "multi-block" example are wrong

- Severity: medium
- Location: labeled-block-macros.md:19, 111-136, 174, 220, 250, 272
- Problem:
  - `expand` receives `(ctx, mainBlock: ts.LabeledStatement, continuation: ts.LabeledStatement | undefined)`. It gets one continuation, not a `ts.Block` and several blocks.
  - `try:`, `catch:` and `finally:` are reserved words and can't be labels.
  - The `measure:` output keeps the `measure:` label; it is not `{ … }`.
- Evidence:
  - tsc: `Property 'statements' does not exist on type 'LabeledStatement'. Did you mean 'statement'?`
  - TS parse of `try: {…}`: `'{' expected.`, `'try' expected.`
- Suggested fix: use `mainBlock.statement` (a Block) and one continuation, and pick a non-reserved label for the example.

### 14. The stale top-level docs/writing-macros.md duplicates the guide and disagrees with it

- Severity: medium
- Location: docs/writing-macros.md, linked from docs/faq.md:176 and docs/macro-types.md:292. It is not in the sidebar, which uses /writing-macros/.
- Problems in it:
  - `export const myMacro` and `export function myMacro` together (TS2300 duplicate identifier).
  - `expand(ctx, node: ts.ClassDeclaration)` for an attribute macro (TS2322) with no `validTargets`.
  - `MacroContext.config` doesn't exist (TS2339).
  - `transformFile` doesn't exist in @typesugar/transformer (TS2614).
  - The assert example emits `factory.createIdentifier("(() => { throw new Error(...) })")`.
- Suggested fix: delete it and repoint the two links to /writing-macros/.

### 15. Core README API errors

- Severity: medium
- Location: packages/core/README.md:104, 135, 153, 156
- Evidence from tsc:
  - `ctx.generateUniqueName` returns `Identifier`, not `string`.
  - `globalRegistry.get` and `getByModule` don't exist; the real methods are `getExpression` etc. and `getByModuleExport`.
  - The tagged-template `expand(ctx, taggedTemplate, tag, template)` is not assignable to `(ctx, node) => Expression`.

### 16. Editor and syntax claims that are false

- Severity: medium
- Location:
  - ts-plugin/README.md:7, 33-52, 56-69, 79-80
  - ts-plugin/src/index.ts:8
  - unplugin-typesugar/README.md:90-91, 149
- Problem:
  - `|>` and `::` are not supported. `1 |> f` comes out as `1 |  > f` (SyntaxError), and `1 :: xs` silently comes out as `const ys = 1, xs;`.
  - The ts-plugin options `extensions` and `legacyMode` are never read; language-service.ts reads only `verbose`.
  - The VS Code settings `typesugar.useLegacyPlugin` and `enableVerboseLogging` are declared in package.json but no source reads them.
  - The unplugin `extensions` option is not in `TypesugarPluginOptions` (excess-property error), and `strict: "incremental"` is undocumented.

### 17. VS Code README

- Severity: medium
- Location: packages/vscode/README.md:1, 74, 94, 163-166, 185, 199
- Problem:
  - The package is `typesugar-vscode` and private, not `@typesugar/vscode`, so `pnpm --filter @typesugar/vscode` fails. The umbrella README table (typesugar/README.md:102) repeats the wrong name.
  - `typesugar build --manifest` doesn't work: cli.ts's argument loop (lines 189-235) has no `--manifest`, and nothing writes typesugar.manifest.json. That means the extension's `generateManifest` command does nothing.
  - `typesugar.addDerive` is not in `contributes.commands`.
  - The `compile` and `watch` scripts don't exist.

### 18. Stability claims don't match what is published

- Severity: medium (PEP-059 decision 3)

Nothing is private except playground and vscode. `.changeset/config.json` has `ignore: []` and the CI publishes `pnpm -r --filter '!typesugar-vscode'`.

| Package                                                 | README claim                        | package.json                                                                      |
| ------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| codec, erased, math, parser, strings, units, lsp-server | "Frozen … excluded from release"    | public, will publish                                                              |
| collections                                             | Frozen, still published             | public (consistent)                                                               |
| macros                                                  | "internal package"                  | public; writing-macros directs authors to it for `quote` and `defineCustomDerive` |
| playground                                              | `npm install @typesugar/playground` | private, so install fails; `preprocessCode` is not exported                       |
| all except lsp-common and lsp-server                    | none                                | every description starts with 🧊, the README "Frozen" badge                       |

### 19. The umbrella `typesugar` README describes the old behaviour

- Severity: medium
- Location: packages/typesugar/README.md:11, 53, 138-150
- Problem:
  - The root is now runtime-only and exports core as types only (src/index.ts:67). Authoring APIs moved to `typesugar/core`, and the README never mentions that subpath.
  - `registerAllMacros()` is a deprecated no-op (src/index.ts:89-95).
  - "Re-exported Namespaces reflect/derive/typeclass" are runtime stubs, not namespaces.
  - The line `Generates: userEq(), debugUser(), cloneUser()` is wrong. The actual output is `namespace User { export const Eq … Debug … Clone }`. The hero example itself runs and prints `120 42`.

### 20. Macros README

- Severity: medium
- Location: packages/macros/README.md:49, 54-56
- Problem: the `comptime(() => JSON.parse(fs.readFileSync(...)))` example fails, and "all macros compile away completely, no overhead" is false. For example, `match` emits an IIFE plus a `MatchError` import, derives emit runtime companions, and testing imports runtime helpers.
- Evidence: `TS9209 … comptime permission denied: File read requires { fs: 'read' | true }`.
- Suggested fix: `comptime({ fs: "read" }, () => …)` and drop the guarantee.

### 21. contracts-refined says the check is "eliminated at compile-time"

- Severity: medium
- Location: packages/contracts-refined/README.md:20-24
- Evidence: the output keeps `if (!(a > 0 && b > 0)) { throw new PreconditionError(…) }` and the postcondition check.

### 22. transformer-core README basic example errors

- Severity: medium
- Location: packages/transformer-core/README.md:34-37
- Evidence: `staticAssert<true>()` gives `staticAssert expects 1-2 arguments: staticAssert(condition, message?)`.
- Suggested fix: `staticAssert(1 + 1 === 2)`.

### 23. Engine bug found while checking type-macros: a later `Readonly<…>` is expanded by the wrong macro

- Severity: medium; this is an engine bug, not a doc defect, so it needs its own ticket.
- Location: type-macros.md:140 (the `Readonly` example), packages/transformer-core/src/rewriting.ts:147-196
- Evidence: register type macros `Nullable` and `Readonly`, then compile
  `type W = Nullable<string>; type C = Readonly<{a:1}>;`
  The output is `type C = {a:1} | null | undefined`, and the log shows `NULLABLE CALLED on Readonly<{ a: 1 }>`. With only `Readonly<…>` before `Wrap<…>`, neither macro fires.

### 24. Low-severity items

- expression-macros.md:203: `ctx.evaluate` returns `ComptimeValue` (`{kind, value}`), so `typeof result === "number"` is never true. index.md:112 types it as `unknown`. Its `comptime` example name collides with the built-in `comptime@typesugar`.
- attribute-macros.md:96: `@singleton` generates a `const` that is then reassigned (`Cannot assign to '__typesugar_instance…' because it is a constant`).
- labeled-block `measure:` usage only expands with a `@syntax-labels` marker import; otherwise it's TS9224.
- quoteBlock example (quasiquoting.md:121) with braces gives a nested block.
- parser README:
  - The transformer-inlined grammar throws a plain `Error`, not `ParseError` (README:27), so `instanceof ParseError` fails when the transformer is on.
  - There is no install line.
  - The recursive combinator example needs type annotations under `strict`.
- strings README:24: the real output escapes `'` as `&#039;`.
- fp README:19: the output is `getOrElse(filter(map(5,…)))` calls imported from `@typesugar/fp/data/option`, not "plain null checks", and that output has type errors under strictOutput.

## 1.0 gaps

- The authoring docs have no supported way to register project-local (non-package) macros (see finding 3).
- MacroContext members are undocumented on both the writing-macros pages and reference/macro-context.md: `safeRef`, `ensureImport`, `tryShortName`, `diagnostic()`, `markPure`, `isTypeReliable`/`assertTypeReliable`, `hygiene`, `transformContext`.
- Definition fields are undocumented: `module` and `exportName` (import scoping), `validTargets` (required!), `cacheable`, `chainable`, `triggerLabels`, `valueProducing`.
- `@typesugar/testing/macros` `createMacroTestContext`, `defineCustomDeriveAst`, `defineTypeFunctionDerive` and `defineSyntaxMacro` have no page.
- Nothing tells authors that a placeholder declared in the same file as its use is not expanded (I observed this with the harness).
- The writing-macros pages promote quasiquoting ("Prefer quasiquoting") against the project's own AST-first rule in CLAUDE.md.
- No end-to-end test exists for the effect `@layer` + `let:` README pattern, or for std array/range dot syntax.
- I could not verify the validate README: in this harness `is<User>()` was left unexpanded with zero diagnostics because `@typesugar/validate` isn't resolvable from the transformer's location. A missing macro package producing no diagnostic at all may itself be worth a look.

## Examples checked

| Page                                  | Examples    | Passed                                              |
| ------------------------------------- | ----------- | --------------------------------------------------- |
| writing-macros.md (legacy)            | 6           | 1                                                   |
| writing-macros/index.md               | 3           | 0                                                   |
| expression-macros.md                  | 8           | 0 as written (3 pass once the define form is fixed) |
| attribute-macros.md                   | 9           | 0 (2 once fixed)                                    |
| derive-macros.md                      | 9           | 0                                                   |
| tagged-template-macros.md             | 8           | 0 (2 once fixed)                                    |
| type-macros.md                        | 11          | 0 (Nullable works once fixed)                       |
| labeled-block-macros.md               | 9           | 0 (measure works once fixed and activated)          |
| quasiquoting.md                       | 20          | 15                                                  |
| testing-macros.md                     | 12          | 0                                                   |
| publishing-macros.md                  | 4           | 0                                                   |
| typesugar README                      | 3           | 2                                                   |
| std README                            | 14          | 6                                                   |
| fp                                    | 1           | 1                                                   |
| macros                                | 1           | 0                                                   |
| transformer                           | 3           | 2                                                   |
| unplugin                              | 2           | 1                                                   |
| core                                  | 4           | 1                                                   |
| derive                                | 1           | 0                                                   |
| reflect                               | 1           | 1                                                   |
| typeclass                             | 1           | 1                                                   |
| type-system                           | 1           | 1                                                   |
| collections                           | 3           | 0                                                   |
| sql                                   | 1           | 1                                                   |
| testing                               | 1           | 1                                                   |
| units                                 | 1           | 1                                                   |
| math                                  | 1           | 1                                                   |
| parser                                | 2           | 2                                                   |
| codec                                 | 1           | 1                                                   |
| mapper                                | 1           | 1                                                   |
| graph                                 | 1           | 1                                                   |
| effect                                | 1           | 0                                                   |
| contracts                             | 1           | 0                                                   |
| contracts-refined                     | 1           | 1 (but the claim about it is false)                 |
| validate                              | 1           | unverified                                          |
| erased                                | 1           | 1                                                   |
| strings                               | 1           | 1                                                   |
| fusion                                | 1           | 1                                                   |
| transformer-core                      | 2           | 1                                                   |
| ts-plugin                             | 2           | 0                                                   |
| vscode                                | 2           | 0                                                   |
| playground                            | 1           | 0                                                   |
| eslint-plugin, lsp-common, lsp-server | config only | n/a                                                 |

Links in all READMEs and the writing-macros pages resolve. Custom `{#id}` anchors in reference/packages.md cover the `#x` links.

## Summary

- Counts: 11 high, 12 medium, plus about 10 low items (bundled as finding 24).
- Top problem 1: the macro-author guide cannot produce a working macro. Every page uses a define form that doesn't exist and never registers; the testing APIs don't exist; and the documented ways to load a macro (`macroModules`, or publishing without the `typesugar.macros` manifest field) don't work.
- Top problem 2: several README hero examples break at runtime or compile time: std do-notation and array/range dot syntax, collections HashSet, derive operators, effect `@layer`, contracts without the syntax import (checks silently skipped).
- Top problem 3: stability and editor claims are false: "frozen / excluded from release" packages are published, `|>` / `::` and several ts-plugin and vscode options do nothing, `typesugar build --manifest` doesn't exist, and the umbrella README still describes the pre-PEP-059 root exports.
- Also found: an engine bug (finding 23), where a type macro expands a later, unrelated `Readonly<…>`.
