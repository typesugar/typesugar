# Deep review findings: core (packages/core/src + packages/transformer-core/src)

Reviewed by 3 agents: transformer-core (lead); core config/registry/cache/safety (core-A); core hygiene/context/diagnostics (core-B). Repro scripts are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/ (run-_.cjs and repro-_/ for transformer-core; coreA/ for core-A; hyg*/ast1/opt1/ctx*/e2e1.cjs for core-B). They were run against the built packages/\*/dist; the largest e2e run peaked at about 460 MB. No repo files were changed.

Duplicates were merged: the expansion cache (found by both the lead and core-A), bare `// @ts-no-typesugar` (lead and core-B), and the name-keyed type-rewrite registry (lead for constructors, core-B for methods).

### 1. Disk expansion cache is keyed only by macro name + call-site text: wrong output across files and stale output across builds

- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:136-169, 1311-1362; key in packages/core/src/cache.ts:86-89; enabled by default in packages/transformer/src/pipeline.ts:121-123, 217-218 (`cacheDir` undefined means ".typesugar-cache")
- Problem: `computeCallSiteCacheKey` hashes `[macroName, node.getText(), ...argTexts]`. There is no file path, no type information, no dependency content, no config, and no macro/package version in the key. Every expression macro is cacheable unless it opts out (`cacheable !== false`), and only about 10 do. The cache is on by default, persisted to `.typesugar-cache/expansions.json` by the CLI and unplugin, and shared across every file in the build.
- Failure scenario: (a) `a/main.ts` and `b/main.ts` both contain `includeStr("./data.txt")` but read different files. b gets a's contents ("AAA" emitted for both). (b) Edit `a/data.txt` from "V1" to "V2" and rebuild: the output stays "V1" forever. The same applies to `typeInfo<User>()`/`fieldNames<T>()` when `User` differs per file or is edited, `cfg(...)` after a config change, `includeJson`, `summon<...>` etc. Separately, a cache hit replays none of the expansion's side effects (`ctx.ensureImport` pending imports, hoisted specialisations, registry writes), so cached text that references an aliased import will dangle in another file.
- Suggested fix: make caching opt-in (`cacheable: true` only on macros proven pure in their syntactic input), add `sourceFile.fileName` + package version to the key, and give macros a way to declare file dependencies (includeStr already calls `recordDependency`) whose content hashes go into the key. Until then, default `cacheDir` to `false`.
- Fix size: M
- Corroborated independently by core-A (its repro scripts are in review/coreA/cache-\*.mjs). Further reproduced effects: `fieldNames<Props>()` in two files with different `Props` both return the first file's fields. `cfg("debug", ...)` built once with `TYPESUGAR_CFG_DEBUG=1` keeps emitting the debug branch after a rebuild with `=0`. On a warm cache, `registerExtension("string", shout); s.shout()` is no longer rewritten, because the registration side effect is skipped, so it is a TypeError at runtime. `TransformationPipeline` (packages/transformer/src/pipeline.ts:1040-1044, 1774-1777) never forwards `options.cacheDir`, so `cacheDir: false` still creates `.typesugar-cache` and the collisions still happen (repro'd). `CACHE_VERSION` is a hard-coded "2", so upgrading macro packages never invalidates entries. The cache has no eviction and its write is not atomic (cache.ts:116-179).

### 2. `obj.pipe(...)` on any node_modules type is expanded as the `pipe` macro when the file imports `pipe` (receiver silently dropped)

- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:1288-1297 together with packages/transformer-core/src/import-resolution.ts:195-205, 418-455
- Problem: for any `X.name(...)` call, `tryExpandExpressionMacro` uses the method name as the macro name and resolves the property-access symbol. `resolveModuleSpecifier` returns a package name for ANY file under `node_modules/` (and maps any `/packages/<x>/` path to `@typesugar/<x>`), which sets `foundModuleDecl = true`. Execution then falls through to `fallbackNameLookupWithImports(sourceFile, "pipe")`, and that matches because the file imports `pipe` from "typesugar".
- Failure scenario: `import { pipe } from "typesugar"; import { Observable, map } from "rxjs"; obs.pipe(map(f), map(g))` compiles to `map(g)(map(f))`. The `obs` receiver is gone. With one operator it raises a bogus build error ("pipe() requires at least an initial value and one function"). The same applies to any method on a third-party type that shares a name with an imported macro (`compose`, `match`, `extend`, `summon`, ...).
- Suggested fix: in the `X.name()` branch, only treat it as a macro when `X` resolves to a namespace import / module symbol of a recognised macro module. Restrict the name-based fallback in `resolveSymbolToMacro` to recognised `@typesugar/*`/`typesugar` packages (not arbitrary `node_modules` packages or user `packages/*` dirs).
- Fix size: S

### 3. @opaque constructor/constant erasure matches by bare name across the whole process; it rewrites unrelated code in other files, depending on file order

- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/rewriting.ts:999-1106 (`tryEraseOpaqueConstructorCall`, `tryEraseOpaqueConstantRef`); registry is process-global and never cleared outside tests (packages/core/src/type-rewrite-registry.ts:159-217; packages/transformer-core/src/dts-opaque-discovery.ts:32)
- Problem: once any file causes an @opaque entry to be registered (for example by importing `Some` from `@typesugar/fp`, which triggers .d.ts discovery), every later file in the process has every call to an identifier named `Some`/`Left`/`Ok`/... erased and every identifier named `None` (etc.) replaced by `null`. There is no symbol/import check, and the identifier-position exclusions are incomplete (enum members, property-assignment keys, shorthand properties, method names, type references, default imports).
- Failure scenario: a.ts `import { Some } from "@typesugar/fp"`. b.ts (no fp import): `function Some(x){...}; Some(1)` becomes `1`, `enum Flags { None = 0 }` becomes `enum Flags { null = 0 }` (so `Flags.None` is undefined), `{ None: 1 }` becomes `{ null: 1 }`, `const None = 5; None + 1` becomes `null + 1`, and `{ None }` becomes `{ null }` (a syntax error). Transforming b.ts alone leaves it untouched, so the output depends on file order. It also breaks ts-results/oxide users (`Some`, `None`, `Ok`, `Err`).
- Suggested fix: resolve the callee/identifier symbol through aliases and only erase when its declaration is the registered constructor's declaration (store declaration file + export name in the entry, not just the name). Only erase identifiers in expression positions.
- Fix size: M
- Method side of the same root cause (core-B, high confidence from code): `findTypeRewrite`/`resolveTypeRewriteName` (core/src/type-rewrite-registry.ts:161-233, rewriting.ts:553-652) match the receiver type by bare symbol name. Any unrelated `class Option { contains(v) {...} }` in a program that uses @typesugar/fp gets `opt.contains("x")` rewritten to fp's `contains(opt, "x")` with an injected import. Two @opaque types with the same name overwrite each other in `byName`. Fix both together by storing the declaring file/module in the entry and comparing it against the receiver's or callee's declaration.

### 4. Instance-call inlining resolves instance dictionaries by bare variable name; an unrelated same-named local gets another file's body, and DCE then deletes it

- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/specialization.ts:762-825 (`resolveInstanceOrIntrinsicMethodsSafely` → `getInstanceMethods(dictName, program)`); registry in packages/macros/src/specialize.ts:430-442
- Problem: `tryInlineDerivedInstanceCall` runs on every `ident.method(args)` call and looks up `ident.text` in a per-Program, name-keyed registry. The shadowing guard the comment describes is applied only to primitive intrinsics, not to user-registered instances.
- Failure scenario: a.ts `/** @impl Eq<Point> */ export const eqPoint = { equals: (a,b) => a.x === b.x }`. b.ts `const eqPoint = { equals: (a: number, b: number) => false }; export const r = eqPoint.equals(1, 2);` compiles to `export const r = 1..x === 2..x;`, and b's own `eqPoint` declaration is removed by DCE. Transforming b.ts alone is correct.
- Suggested fix: resolve `ident` with the checker (follow aliases) and require its declaration to be the registered instance's declaration node/file. Apply the same guard in `recursivelyInlineInstanceCalls` and `tryAutoSpecialize`.
- Fix size: M

### 5. Dead-instance elimination deletes exported declarations and sibling declarators

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/specialization.ts:887-953 (`eliminateDeadDerivedInstances`)
- Problem: any top-level `VariableStatement` holding an object-literal declarator whose name was inlined is dropped when no other statement mentions the name. Export modifiers are not checked, and the whole statement goes, so other declarators in the same `const a = ..., b = ...` go too. The check is name-text based, so it also misses shadowing.
- Failure scenario: `export const eqPoint: Eq<Point> = {...}, VERSION = 3; export const same = eqPoint.equals(p1, p1);` emits neither `eqPoint` nor `VERSION`. Importers of either export break at link/runtime.
- Suggested fix: skip statements with an `export` modifier (and names listed in `export {}`/`export default`), and remove only the dead declarator rather than the whole statement.
- Fix size: S

### 6. Inlining duplicates argument expressions; side-effecting arguments are evaluated multiple times

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/specialization.ts:815, 857 (call `inlineMethod`), substitution in packages/macros/src/specialize.ts:736-754
- Problem: parameters are substituted textually with the argument AST. A parameter used N times evaluates its argument N times. The same applies to `rewriteDictCallsForAutoSpec`. This runs automatically on every call on a recognised instance; there is no opt-in.
- Failure scenario: `eqPoint.equals(next(), next())` with `equals = (a,b) => a.x === b.x && a.y === b.y` becomes `next().x === next().x && next().y === next().y`: four calls instead of two, and a different result. The same happens with `arr.pop()`, `i++`, `await` etc.
- Suggested fix: when an argument is not a simple identifier/literal and its parameter is referenced more than once (or not at all), bind it to a hygienic temp (an IIFE or comma-sequence temp), or skip inlining.
- Fix size: M

### 7. Inlined/specialised call sites are returned unvisited, so macros in their arguments are never expanded (and their imports are removed)

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:987-1011 (results of `tryAutoSpecialize`, `tryInlineDerivedInstanceCall`, `tryReturnTypeDrivenSpecialize` are returned without `ts.visitNode`); specialization.ts:433, 451, 711-735, 815
- Problem: these paths build a new call from the original argument nodes and return it straight from `tryTransform`, so the visitor never descends into the arguments.
- Failure scenario: `import { pipe } from "typesugar"; eqPoint.equals(pipe(p1, f), p1); pipe(1, g)` compiles to `pipe(p1, f).x === p1.x`. The `pipe` import is removed because the second call resolved it, so this throws ReferenceError at runtime.
- Suggested fix: visit the arguments (`node.arguments.map(a => ts.visitNode(a, visit))`) before inlining/specialising, as `tryRewriteTypeclassOperator` and method-sugar already do.
- Fix size: S

### 8. Block-bodied arrow functions bypass `tryTransform` and implicit-parameter scope entirely

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:323-351 (the `isArrowFunction && isBlock(body)` early return precedes the `hasImplicitParams` check and `tryTransform`)
- Problem: every `(…) => { … }` takes the comprehension-simplification path and returns after `visitEachChild`. The implicit-scope push (342-351) and all `tryTransform` handling of the arrow node itself (e.g. opaque return-type stripping at 947-964) never run for block-bodied arrows.
- Failure scenario: `export const f = <A,>(a: A, S: Show<A> = implicit()): string => { return display(a); }` gives TS9001 "No instance found for Show<A>" and `display(a)` is left unfilled. The identical `function` form and the expression-bodied arrow both correctly produce `display(a, S)`.
- Suggested fix: move the arrow-body simplification after the implicit-params/tryTransform dispatch (apply it to the result of normal visiting), or run the implicit-scope push inside that branch.
- Fix size: S

### 9. Auto-specialisation hoists a copy of the callee body into the caller's scope (free-variable capture; type args left on an untyped function)

- Severity: high
- Confidence: confirmed (repro'd: output `function g() { const __typesugar___addN_number_0__ = (x: number) => x + n; const n = 99; return __typesugar___addN_number_0__(1); }`)
- Location: packages/transformer-core/src/specialization.ts:186-274, 436-451; hoisting at transformer.ts:793-840
- Problem: the specialised arrow is built from the callee's body and hoisted to the top of the CALL SITE's nearest Block/SourceFile. Free identifiers in that body are re-bound in the caller's scope, so a caller-local with the same name captures them. The rewritten call also keeps `node.typeArguments` although the hoisted arrow has had its type parameters stripped.
- Failure scenario: `const n = 10; const addN = (E: Num<number>, x: number) => E.add(x, n); function g() { const n = 99; return addN(numInst, 1); }` hoists `const __addN_spec = (x) => x + n` into g's body, so it yields 100 instead of 11. `f<number>(inst, x)` becomes `__spec<number>(x)`, which is TS2558 in any type-checked/`expand` output.
- Suggested fix: hoist to the scope where the callee is declared (or the source-file level when it is top-level), or refuse to specialise when any free identifier of the body resolves differently at the hoist site. Drop `typeArguments` on the rewritten call.
- Fix size: M

### 10. Symbol→macro cache ignores macro kind: an expression macro is invoked as an attribute macro, and the decorated class is deleted

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/import-resolution.ts:489-498 (`symbolMacroCache` keyed by symbol id only); callers pass different `kind`s for the same symbol (transformer.ts:1302, 1406, 1515; rewriting.ts:81, 113, 175)
- Problem: the first lookup's result for a symbol is returned for every later lookup of any kind. `impl`, `instance`, `typeclass` and `config.when` are each registered as BOTH expression and attribute macros under the same export, and the preprocessor rewrites `@impl` on consts into `impl(...)` calls, so mixed use in one file is the normal case.
- Failure scenario: a file has `dual(1)` and later `@dual class X {}` (same import, both kinds registered). The expression macro's `expand` is called with the `Decorator` as its call node, its NumericLiteral result replaces the class, and `visitStatementContainer` drops the non-statement. Class `X` vanishes from the output with no diagnostic. The reverse order sends a decorator into the expression path.
- Suggested fix: key the cache by `${symbolId}:${kind}`.
- Fix size: S

### 11. Macro import specifiers are removed even when the name is still referenced at runtime

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/import-resolution.ts:89-183 (`cleanupMacroImports`), fed by `recordMacroImport` on the first successful resolution
- Problem: the specifier is dropped once any one call site resolves to a macro. Remaining references are not checked: calls in `"use no typesugar"` functions or opted-out lines, value references (`const f = pipe`, `export { pipe }`), and calls left unexpanded by TC7/TC8.
- Failure scenario: `import { pipe } from "typesugar"; const a = pipe(1, f); function raw() { "use no typesugar"; return pipe(1, g); }` drops the import while `raw()` still calls `pipe`, so ReferenceError. The documented opt-out therefore breaks at runtime whenever the same macro is used elsewhere in the file.
- Suggested fix: before removing a specifier, scan the transformed statements for remaining identifier references bound to that import (or record unexpanded uses) and keep the specifier when any exist.
- Fix size: M

### 12. JSDoc-macro targets are returned unvisited, so nothing inside a `/** @derive */` class or `/** @impl */` initializer is expanded

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:1032-1037; packages/transformer-core/src/macro-helpers.ts:193-209
- Problem: `tryExpandJSDocMacros` returns `[currentNode, ...results]` and `tryTransform` returns that directly. The decorator path visits its result (1574), but the JSDoc path never does.
- Failure scenario: `/** @derive(Eq) */ export class P { f() { return pipe(1, g); } }` emits `pipe(1, g)` unexpanded while the identical `@derive(Eq)` decorator form expands it. Combined with TC11, the `pipe` import is removed, so ReferenceError.
- Suggested fix: run `ts.visitNode(currentNode, visit)` (via the same visitEachChild-on-original fallback as the decorator path) before returning.
- Fix size: S

### 13. A throwing attribute macro recurses until the stack overflows (927 expansions, 1854 diagnostics for one decorator)

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:1550-1578
- Problem: on `expand` throwing, the decorator is pushed back into `remainingDecorators`. Since the count is unchanged, the node is not rewritten, so `ts.visitNode(currentNode, visit)` re-enters `tryExpandAttributeMacros` on the identical node, which throws again, and so on until a RangeError. Each unwinding level then adds an error diagnostic. `tryExpandImplicitLabelMacro` (1659-1672) has the same unbounded re-entry if a trigger-label macro ever returns a node that still has its trigger label.
- Failure scenario: any attribute macro bug or a user-input error that throws produces ~1000 identical errors, ~75 ms of stack churn per decorator, and potentially a stack overflow in deeper contexts (e.g. inside LSP).
- Suggested fix: after a failure, strip the failed decorator (or mark the node) before re-visiting, or visit with `visitEachChild(currentNode)` rather than `visit(currentNode)` when `currentNode === node`.
- Fix size: S

### 14. Reference hygiene only sees top-level bindings, so the emitted reference is captured by nested locals or parameters

- Severity: high
- Confidence: confirmed (repro'd end-to-end through `packages/transformer/dist/pipeline.cjs`)
- Location: packages/core/src/hygiene.ts:256-263, 306-350 (binding scan), 417-432 (`safeRef` "not in scope" path), 465-475 (`ensureImport` "not in scope" path). The emitted bare identifier is used by packages/transformer-core/src/rewriting.ts:674-676 (@opaque method erasure), rewriting.ts:500-504 (operator → instance) and method-sugar.ts:218-222.
- Problem: `FileBindingCache` builds `localDecls` only from `sourceFile.statements`, so it covers top-level declarations only. Function parameters, function-local `const`/`let`, catch bindings, loop variables and nested functions are not seen. When the symbol is "not in scope" by this test, `ensureImport` returns a **bare** identifier and adds a top-level `import { sym }`. Inside any nested scope that binds the same name, that bare identifier resolves to the user's local instead of the import. The module doc ("Tier 2: local declarations") does say file level, but the contract `ensureImport` documents ("GUARANTEES the symbol is imported", so the reference resolves to it) does not hold.
- Failure scenario (actual output from the transformer dist):
  ```ts
  import { Some, type Option } from "@typesugar/fp";
  export function f(map: Map<string, number>, o: Option<number>) {
    return o.map((n) => n + map.size);
  }
  ```
  becomes
  ```ts
  import { map } from "@typesugar/fp/data/option";
  export function f(map: Map<string, number>, o: Option<number>) {
    return map(o, (n) => n + map.size); // calls the Map parameter → TypeError at runtime
  }
  ```
  Option's erased methods are `map`, `filter`, `fold`, `match`, `contains`, `tap`, `zip`, `exists`… Local variables with these names are common, so this is a likely user-facing runtime crash.
- Suggested fix: be conservative. Make `localDecls` collect every binding identifier anywhere in the file (one `forEachChild` walk over declarations, parameters, binding elements, catch clauses and import-equals), so any same-named binding forces the alias path. Over-aliasing is harmless. The precise alternative is `checker.getSymbolsInScope(callSite, Value)` at the use site, but that needs the call-site node threaded through the API.
- Fix size: S

### 15. `ensureImport` treats `import type` (and a default import) as a value import of the named export, which leaves a dangling reference at runtime

- Severity: high
- Confidence: confirmed (unit repro on `FileBindingCache`); the transformer path is from code reading
- Location: packages/core/src/hygiene.ts:276-301 (`collectImportBindings` ignores `importClause.isTypeOnly` and `element.isTypeOnly`, and maps default imports into the same table as named ones), 453-457 (`ensureImport` "already imported from same module" fast path), 400-411 (`safeRef` tier 1)
- Problem: `import type { Point } from "./point"` and `import { type Point } from "./point"` put `Point → "./point"` into `importMap`. `ensureImport("Point", "./point")` then returns bare `Point` and registers **no** import. TypeScript, esbuild and other bundlers erase type-only imports, so the emitted `Point.Eq.equals(a, b)` throws `ReferenceError: Point is not defined`. The method-sugar call site explicitly expects this case to work (method-sugar.ts:358-363: "imported even when only … `import type` was present"). typescript-eslint's `consistent-type-imports` rewrites imports used only as types into exactly this form, so the pattern is common. A default import `import Point from "./point"` is wrongly treated as the named export `Point` in the same way.
- Failure scenario: repro output: `import type { Point } from "./point"` → `ensureImport("Point","./point")` returns `Point` with no pending import. The same happens for `import { type Point }` and `import Point from`. With method sugar (`p.equals(q)` → `Point.Eq.equals(p, q)`), the emitted file has only the erased type import.
- Suggested fix: record imports as `{module, kind: "named"|"default"|"type"}`. Only a non-type named import counts as "already imported". For a type-only or default import of the same name, use the alias path (`import { Point as __Point_ts0__ }`), since adding a second plain `Point` binding would be a duplicate identifier. Unverified variant worth checking: in a tsc + ts-patch emit, TS also elides a _value_ import whose binding the original program only used as a type, because synthesized references don't mark the alias as referenced. That would hit the same fast path.
- Fix size: S

### 16. `cfg()` / `@cfgAttr` conditions using `===` or `!==` always evaluate to false and silently strip code

- Severity: high
- Confidence: confirmed (repro against core dist)
- Location: packages/core/src/ast-utils.ts:444-460 (`evaluateConditionExpr`), used by packages/macros/src/cfg.ts:130-133
- Problem: the equality regexes accept only `==` and `!=`. `platform === 'node'` fails both, falls through to the "simple key" truthy check on the path `"platform === 'node'"`, and returns `undefined`, which is false. Any expression the parser doesn't recognise silently becomes `false`. The project's own guide documents the `===` form: docs/guides/conditional-compilation.md:193 `@cfgAttr("platform === 'node'")` and :206 `cfg("platform === 'web' || platform === 'native'", ...)`.
- Failure scenario: with config `{platform:"node", env:"prod"}`: `"platform === 'node'"` → false, `"env !== 'dev'"` → false, `"platform === 'web' || platform === 'node'"` → false. Meanwhile `"platform == 'node'"` → true. The function behind `@cfgAttr("platform === 'node'")` is removed from every build with no diagnostic.
- Suggested fix: change the regexes to `={2,3}` and `!={1,2}`. Accept a bare key only if it matches `^[\w.]+$`; otherwise throw or report "unsupported cfg condition". Add tests for `===` and `!==`.
- Fix size: S

### 17. The documented line opt-out `// @ts-no-typesugar` (without a feature) does nothing for every production caller

- Severity: high
- Confidence: confirmed (repro against core dist)
- Location: packages/core/src/resolution-scope.ts:465-472 (`hasInlineOptOut`). All production callers pass a feature: transformer-core/src/transformer.ts:623,1278,1413,1475,1491,1646; rewriting.ts:73,153,218,413; method-sugar.ts:117; macro-helpers.ts:108; specialization.ts:304; label-activation.ts:40.
- Problem: when `feature` is set, the function returns true only for `@ts-no-typesugar <feature>` or `@ts-no-typesugar-all`. The plain `@ts-no-typesugar` documented in docs/index.md:392 (`(42).clamp(0, 100); // @ts-no-typesugar  // one line`) and in the opt-out table ("Skips transformation of that line") is ignored, because every caller asks with a feature. The unit tests (tests/opt-out.test.ts:140-157) call `hasInlineOptOut` without a feature, so they pass. The intended end-to-end test, tests/red-team-transformer.test.ts:238, is an empty stub. A secondary problem: matching is a raw substring check on the line, so the marker inside a string literal (`const s = "@ts-no-typesugar"; a === b`) also opts the line out.
- Failure scenario: `hasInlineOptOut(sf, stmt, "extensions")` on `(42).clamp(0, 100); // @ts-no-typesugar` → `false`, and `isInOptedOutScope(..., "extensions")` → `false`. The line is still rewritten.
- Suggested fix: when `feature` is given, also return true if the line contains `@ts-no-typesugar` not followed by `[ \t]+\w` (that is, the bare form). Scan only comment ranges (`ts.getLeadingCommentRanges`/`getTrailingCommentRanges` for the line) instead of the raw line text. Make the red-team test real.
- Fix size: S
- Also reproduced end-to-end by the transformer-core reviewer: `export const b = pipe(2, f); // @ts-no-typesugar` is still expanded through `macroTransformerFactory`.

### 18. The standalone-extension registry is process-global with no file or program scope, so `@extension` functions leak into files that never imported them

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/core/src/registry.ts:615-653 (`standaloneExtensionRegistry` on `globalThis`, `registerStandaloneExtensionEntry`, `findStandaloneExtension`). Consumed at packages/transformer-core/src/rewriting.ts:293-301.
- Problem: `@extension` / `registerExtension` push `{methodName, forType, qualifier}` into one array on `globalThis`. Nothing in production code ever clears it; only tests do `standaloneExtensionRegistry.length = 0`. `findStandaloneExtension(method, type)` ignores which file is asking. Any later file, any later program in the same process (watch mode, LSP, vite dev server) and any later edit of the same file will rewrite `recv.method()` to the registered callee. The callee may not be in scope there, or may resolve to an unrelated local with the same name (a hygiene problem). Entries for deleted or renamed extensions are never removed, and the result depends on file processing order.
- Failure scenario: `transformCode(a.ts)` contains a non-exported `@extension function clamp(n: number, lo, hi)`. A separate `transformCode(b.ts)` with no import contains `const x: number = 5; x.clamp(0, 1)`. b's output is `clamp(x, 0, 1)`, a ReferenceError at runtime (`ext-leak.mjs`).
- Suggested fix: key entries by the declaring module or file and only rewrite when that module is imported into the current file (or it is the same file). Reset or partition the registry per `ts.Program` with `getOrCreateWeak`, as weak-cache.ts already suggests. Comment which CLAUDE.md shape it uses, since this registry is cited there as the "correct" one but has no scoping.
- Fix size: M

### 19. `cosmiconfig` is not a dependency of any published package, so config files are silently ignored in real installs (including the PEP-055 allowlist)

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:272-277 (`nodeRequire("cosmiconfig")`); packages/core/package.json (no cosmiconfig in dependencies or peerDependencies); packages/core/tsup.config.ts (`external: ["cosmiconfig"]`). The only declaration is in the private workspace root package.json:98.
- Problem: `@typesugar/core` resolves `cosmiconfig` from its own install location, but neither core nor transformer/typesugar/unplugin declares it. In this monorepo it only works because the root package.json hoists it. In a user's pnpm install it can never resolve. In npm/yarn it resolves only if some unrelated tool happens to hoist it. The `catch {}` at :315 turns the failure into "no config file", with no output.
- Failure scenario: I copied `@typesugar/core` dist and its declared deps into an isolated `node_modules` with a `typesugar.config.ts` next to it. `config.getConfigFilePath()` returned `undefined` and `security` was `undefined` (`iso/`). Consequences: `security.allowedMacroPackages` written by `typesugar approve-macros` is never read, so approved third-party macro packages stay blocked. `contracts.mode` and other file settings are ignored without notice.
- Suggested fix: add `cosmiconfig` (^9) to `@typesugar/core` `dependencies`, or to peerDependencies with a loud warning when it is missing. Test the published-tarball layout.
- Fix size: S

### 20. Every config-load failure is swallowed silently; `approve-macros` then overwrites the user's existing config file

- Severity: high
- Confidence: high (the swallow is repro'd; the overwrite is clear from code)
- Location: packages/core/src/config.ts:315-318 (`catch {}`) and :387-390 (`getConfigFilePath`). Consumer: packages/transformer/src/approve-macros.ts:88-92 and packages/transformer/src/config-writer.ts:57-60.
- Problem: a config file that throws, fails to transpile, cannot be written as a temp `.cjs` (see #5), or cannot be found because cosmiconfig is missing (#3) or cwd is wrong (#6) all look the same: an empty config and `getConfigFilePath() === undefined`. There is no warning, which breaks CLAUDE.md's "a caught failure must leave a visible trace" rule. `writeApprovedMacroPackages` treats `existingConfigPath === undefined` as "no config exists" and runs `fs.writeFileSync(path.join(projectRoot, "typesugar.config.ts"), fresh)` without checking `existsSync`.
- Failure scenario: `typesugar.config.ts` contains `throw new Error("boom")` (or reads an unset env var, imports a missing module, and so on). Then `config.getConfigFilePath()` is `undefined` and all settings are dropped silently (`err2/`). Running `typesugar approve-macros --yes` in that project replaces the hand-written config, comments included, with a fresh file containing only `security.allowedMacroPackages`.
- Suggested fix: in `loadConfigFromFiles`, tell "cosmiconfig not available" apart from "config file found but failed", and `console.warn` (or throw) the second with the filepath and error. Expose the failure (for example `config.getLoadError()`). In config-writer, refuse to create a file when `typesugar.config.ts` already exists at the target.
- Fix size: S

### 21. `findGeneratedPosition` returns the first segment on the line, not the nearest one, so original→transformed positions are wrong after any earlier expansion on the line

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/source-map-utils.ts:302-327 (used by `SourceMapPositionMapperCore.toTransformed`, position-mapping-core.ts:128-134)
- Problem: it returns the first segment with `sourceColumn <= target` instead of the greatest such column. It is also O(total segments) per lookup.
- Failure scenario: map with segments gen0→src0 and gen20→src10. Querying src col 12 returns gen col 12 (expected 22). IDE features that map original→transformed (hover, completion, go-to-definition, rename via LSP/ts-plugin) land on the wrong token whenever a macro on the same line, before the cursor, changed length.
- Suggested fix: track the best (max `sourceColumn <= target`) segment over all segments for that source line. Build a reverse index once in the mapper constructor.
- Fix size: S

### 22. `transformCode().changed` is false (and no source map) for rewrites that do not go through the ExpansionTracker

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transform.ts:272-277
- Problem: `changed = globalExpansionTracker.count > 0`. Instance inlining, auto/return-type specialisation, implicit-param filling, operator rewriting, HKT, opaque annotation stripping, import cleanup and DCE never record an expansion. The returned `code` is rewritten while `changed: false`, `sourceMap: null` and an Identity mapper claim otherwise.
- Failure scenario: `const eqPoint: Eq<Point> = {...}; eqPoint.equals(p1, p1)` returns `changed: false`, but `code` has the declaration removed and the call inlined. The playground (packages/playground/src/index.ts:100-119) caches and reports it as unchanged, and positions are mapped with identity.
- Suggested fix: compute `changed` as `transformedCode !== printer.printFile(sourceFile)` (or track a dirty flag in MacroTransformer). Generate a map from the printer's source-map writer instead of only from tracked expansions.
- Fix size: S

### 23. Method sugar emits an unimported companion reference when the receiver's type comes from a module the file doesn't import

- Severity: medium
- Confidence: high
- Location: packages/transformer-core/src/method-sugar.ts:286-293, 368-383
- Problem: `moduleSpecifierForType` returns `undefined` both for "declared in this file" and for "declared elsewhere but not imported here". In the second case `sourceModule` is undefined, so no `ensureImport` happens and a bare `Point.Eq.equals(...)` is emitted.
- Failure scenario: `import { makePoint } from "./factory"; makePoint().equals(q)` with `@derive(Eq) class Point` in ./point.ts produces `Point.Eq.equals(makePoint(), q)` with no `Point` binding, so ReferenceError.
- Suggested fix: when the declaring file differs and no existing import matches, compute a module specifier for `declFile` (relative path from the current file) and `ensureImport` it, or skip the rewrite with a diagnostic.
- Fix size: S

### 24. Generic Eq derive injects `import { Eq } from "@typesugar/macros"` once per derived type, giving a duplicate-binding SyntaxError

- Severity: medium
- Confidence: confirmed (repro'd output; duplicate ESM import verified to throw in node)
- Location: packages/macros/src/typeclass.ts:3127-3154
- Problem: `alreadyImported` scans the pre-transform `ctx.sourceFile.statements`, which is exactly the snapshot anti-pattern in CLAUDE.md rule 2. Two `@derive(Eq)` types with primitive fields in a file with no `Eq` import each inject the import.
- Failure scenario: two `@derive(Eq)` classes in one file emit two `import { Eq } from "@typesugar/macros"`, which fails with "SyntaxError: Identifier 'Eq' has already been declared" on load.
- Suggested fix: use `ctx.ensureImport("Eq", "@typesugar/macros")` (file-scoped, deduped) and use the identifier it returns.
- Fix size: S

### 25. Pending imports and hoisted specialisations are inserted ahead of a `"use client"`/`"use strict"` directive prologue

- Severity: medium
- Confidence: high (code reading; lead from core-B)
- Location: packages/transformer-core/src/transformer.ts:797-811
- Problem: `insertIndex` is the end of the leading run of `ImportDeclaration`s. When the file starts with a directive (an `ExpressionStatement` string literal), the loop breaks at index 0, and `ensureImport` imports and hoisted `const` specialisations are spliced in BEFORE the directive. A directive that is no longer first in the prologue is ignored, which breaks `"use client"` for React Server Components and silently drops `"use strict"`. core's `generateImportFix` (import-suggestions.ts:759-793) has the same problem.
- Failure scenario: a `"use client"` component file that triggers method sugar or opaque erasure (both call `ensureImport`) emits `import { map } from ...; "use client";`, and Next.js treats the component as a server component.
- Suggested fix: skip leading prologue directives (`ts.isPrologueDirective`) before scanning for imports.
- Fix size: S

### 26. `ensureImport` can emit a second binding for a name that is already bound, which is a SyntaxError (duplicate declaration)

- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/hygiene.ts:465-469 (plain pending import keyed by `symbol\0from` only), 290-300 and 306-350 (namespace imports and `import X = require()` are not recorded anywhere)
- Problem: (a) the "not in scope" path registers `import { symbol } from "from"` without checking whether another pending plain import already claims `symbol`. Two different modules wanting bare `map` produce `import { map } from "A"; import { map } from "B"`. (b) `import * as Eq from "x"` and `import Eq = require("x")` are not added to `importMap` or `localDecls`, so `ensureImport("Eq", other)` adds `import { Eq } from other` next to the existing `Eq` binding.
- Failure scenario: repro output: `ensureImport("map","@typesugar/fp/data/option")` followed by `ensureImport("map","@typesugar/fp/data/either")` emits both `import { map } from ".../option"` and `import { map } from ".../either"`. That happens in any file calling `.map` on two user `@opaque` types from different modules. Separately, `import * as Eq from "./x"` plus `ensureImport("Eq","@typesugar/std")` emits `import { Eq } from "@typesugar/std"`, giving "Identifier 'Eq' has already been declared".
- Suggested fix: keep a `boundNames` set covering imports of every form, top-level declarations, and names claimed by pending plain imports. If the name is already claimed by a different `(symbol, from)`, use `getOrCreateAlias`. Record namespace-import and import-equals names in `localDecls`.
- Fix size: S

### 27. Known-global short-circuit ignores user imports/declarations and never imports a companion whose name matches a global

- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/hygiene.ts:63-67 (claim "cannot be shadowed by imports"), 385-394 (`safeRef` tier 0), 451 (`ensureImport`)
- Problem: the comment is wrong. Names in `KNOWN_GLOBALS` are routinely shadowed by imports: `import { Map, Set } from "immutable"`, `Request`/`Response` from express or undici, `Worker` from worker_threads, `File`/`Blob` from buffer, `history` from "history", `URL` from "url". `ensureImport` returns a bare identifier for any of these names **without** registering an import. Method sugar calls `ensureImport(<companion base type name>, module)` (method-sugar.ts:219-222), so a user type named `File`, `Request`, `Response`, `Headers`, `Worker`, `Iterator`, `Generator`… resolves to the runtime global.
- Failure scenario: `ensureImport("File", "./models")` in a file that doesn't import `File` → bare `File` with 0 pending imports (repro). `a.equals(b)` on a user `@derive(Eq) interface File` becomes `File.Eq.equals(a, b)` against Node's global `File` → `TypeError: Cannot read properties of undefined`. `safeRef("Map", …)` in a file with `import { Map } from "immutable"` returns bare `Map`, which is the Immutable binding (repro).
- Suggested fix: in `ensureImport`, apply the global fast path only when the caller wants the global (that is, a `from` sentinel or a separate `globalRef()` API), never for module symbols. In `safeRef`'s tier 0, check `importMap` and `localDecls` first and alias through `globalThis.X` when the name is shadowed.
- Fix size: S

### 28. `generateUniqueName` returns the _same_ identifier for repeated prefixes within one macro expansion

- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/context.ts:925-933, packages/core/src/hygiene.ts:650-662
- Problem: every macro expansion runs inside `hygiene.withScope` (transformer.ts:527,646,1342,1422,1525,1659; macro-helpers.ts:514,603; rewriting.ts:98,123,184). Inside a scope, `generateUniqueName(prefix)` delegates to `hygiene.createIdentifier`, which is memoised per name ("same scope, same name"). Two calls with the same prefix therefore return the same name, contradicting `MacroContext.generateUniqueName`'s contract ("Generate a unique identifier to avoid name collisions", types.ts:135-136). In-repo callers currently get away with it because the duplicate bindings happen to nest (mapper `item`, `src`; effect `composeFunctions` `x`). A third-party macro that allocates two temps (`swap`, multi-temp lowering) gets `const t = a; const t = b;`. Separately, outside a scope `MacroContextImpl.uniqueNameCounter` and `HygieneContext.globalCounter` both mint `__typesugar_${prefix}_${n}__` from independent counters, so they collide (repro: both produce `__typesugar_v_0__`).
- Failure scenario: `withScope(() => [ctx.generateUniqueName("tmp"), ctx.generateUniqueName("tmp")])` → `['__typesugar_tmp_s0_0__', '__typesugar_tmp_s0_0__']`.
- Suggested fix: give `HygieneContext` a `freshName(prefix)` that always increments the scope counter, and have `generateUniqueName` use it. Keep `createIdentifier` memoised for "same logical name" use. Remove the `MacroContextImpl` counter so there is a single source of fresh names.
- Fix size: S

### 29. `parseStatements` never checks parse errors, and `parseExpression` silently drops everything after the first comma or statement

- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/context.ts:120-148 (`parseExpression`), 150-161 (`parseStatements`)
- Problem: `parseStatements` returns whatever the error-recovering parser produced. Broken generated code is emitted as broken JS, with no diagnostic pointing at the macro. `parseExpression` wraps the input as `const __expr__ = ${code};` and returns `declarations[0].initializer`, so `a, b` parses as two declarators and `x; sideEffect()` as two statements. No parse diagnostic fires and the tail is silently dropped. These are the primitives behind every CLAUDE.md-listed string-codegen site, and behind about 20 _unlisted_ ones (see cross-scope leads). User-defined `syntax-macro.ts` macros also feed user strings through them.
- Failure scenario: `parseExpression("a, b")` → `a`. `parseExpression("x; sideEffect()")` → `x`. `parseStatements("const x = ;\nif (y {")` → prints `const x = ; if (y) { }` and does not throw.
- Suggested fix: `parseExpression`: wrap as `(${code})`, and require exactly one statement with exactly one declarator and no parse diagnostics. `parseStatements`: check `parseDiagnostics` and throw the same `Failed to parse` error, so the transformer's catch turns it into a visible macro diagnostic.
- Fix size: S

### 30. `jsValueToExpression` (comptime/include output) turns NaN into `-Infinity` and silently turns Map/Set/Date/vm-realm RegExp into `{}`

- Severity: medium
- Confidence: confirmed (unit repro; cross-realm RegExp repro'd with `vm`)
- Location: packages/core/src/ast-utils.ts:238-252 (number branch), 271 (`instanceof RegExp`), 278-291 (generic object branch). Callers: packages/macros/src/comptime.ts:447 (value from `vm.runInContext`), packages/macros/src/include.ts:251
- Problem: (a) `NaN` is not finite and not > 0, so `!isFinite` returns `createIdentifier("-Infinity")`, and the `isNaN` branch is unreachable. The function doc claims NaN support. `-0` becomes `0`. (b) Any non-array object goes through `Object.entries`, so `Map`, `Set`, `Date`, typed arrays and class instances become `{}` with no error. (c) comptime results come from a separate vm realm. A regex literal evaluated there is not `instanceof` the host `RegExp`, so `comptime(() => /ab+/g)` also becomes `{}`. (d) A JSON key `"__proto__"` (include.ts parses JSON) is emitted as `{ __proto__: {...} }`, which sets the prototype instead of creating an own property.
- Failure scenario: `comptime(() => 0/0)` → `-Infinity`. `comptime(() => new Map([[1,2]]))` → `{}`. `comptime(() => new Date(0))` → `{}`. All are silent and type-incorrect.
- Suggested fix: check `Number.isNaN` first and emit `NaN`, and emit `-0` as `-0`. Detect RegExp and Date with `Object.prototype.toString.call(v)`. Report an error for any object whose prototype isn't `Object.prototype`/`null`, unless explicitly supported (Map/Set can be emitted as `new Map([...])`). Emit `__proto__` as a computed key `["__proto__"]`. Add a cycle guard.
- Fix size: S

### 31. `comptime(<simple expr>)` that evaluates to a negative number crashes with a TS Debug Failure

- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/context.ts:996-1000 (`comptimeValueToExpression` number branch), caller packages/macros/src/comptime.ts:382-387 (lightweight evaluator path for non-function arguments)
- Problem: `factory.createNumericLiteral(-1)` asserts ("Negative numbers should be created in combination with createPrefixUnaryExpression"). `NaN` and `Infinity` are emitted as numeric literals with text `NaN`/`Infinity` (they print, but are not literals). `ast-utils.jsValueToExpression` already handles negatives correctly, while this sibling doesn't.
- Failure scenario: `comptime(1 - 2)` or `comptime(-LIMIT)` → `Debug Failure. False expression: Negative numbers should be created in combination with createPrefixUnaryExpression`, which surfaces as an internal error instead of `-1`.
- Suggested fix: delegate the number, bigint and null cases to `jsValueToExpression` (after fixing #8), or add `value < 0 || Object.is(value, -0)` → `createPrefixUnaryExpression(MinusToken, …)` plus NaN/Infinity identifiers.
- Fix size: S

### 32. The hard-coded import-suggestion table tells users to import symbols that don't exist

- Severity: medium
- Confidence: confirmed (checked each entry against the package dist runtime keys and .d.ts)
- Location: packages/core/src/import-suggestions.ts:72-437 (`defaultExports`). Consumers: packages/macros/src/typeclass.ts:2526-2528 (TS9001 "Add: import …" help), macros/src/implicits.ts:524, transformer-core/src/macro-helpers.ts:614 (unknown derive)
- Problem: these entries name modules that don't export the symbol. `Show` and `Default` from `@typesugar/std` (std has `Printable` and `Defaultable` instead). `Traversable`, `Result`, `Ok`, `Err` from `@typesugar/fp`. `match`, `impl`, `quote`, `Option`, `Some`, `None`, `Either`, `Result`, `Show` from `typesugar`. TS9001, the most common resolution error, appends `Add: import { Show } from "@typesugar/std";`, and following that advice produces TS2305.
- Failure scenario: `summon<Show<Point>>()` with no instance → help text says `Add: import { Show } from "@typesugar/std";` → the user adds it → "Module '@typesugar/std' has no exported member 'Show'".
- Suggested fix: generate the table from package manifests or exports at build time (or validate it in a test that imports each package's dist). Short term, fix the wrong rows.
- Fix size: S (fix rows) / M (generate)

### 33. MacroGenerated suppression rule keeps the first project's closure for the life of the process (multi-project tsserver)

- Severity: medium
- Confidence: high (code reading; not repro'd)
- Location: packages/core/src/diagnostic-suppression.ts:76, 99-105 (`registerDiagnosticSuppressionRuleOnce` dedupes by name into a module-global array); producer packages/transformer/src/language-service.ts:298-311 (per-project `create()` closes over that project's `getMapper` and `getTransformResult`)
- Problem: tsserver loads the plugin module once (Node require cache) and calls the language-service `create()` once per project. The first project registers `MacroGenerated` with a `positionMapFn` bound to _its_ pipeline and transform cache. Every later project's `registerAllDiagnosticSuppressionRules({positionMapFn})` is a no-op because of the "Once" dedupe. Project 2's diagnostics are then mapped through project 1's pipeline. `shouldTransform` misses → `IdentityPositionMapper.toOriginal(pos)` returns `pos` (position-mapping-core.ts:160), never `null`, so nothing is suppressed. The closure also keeps project 1's language service alive after that project closes, and a project reload keeps using the stale one.
- Failure scenario: a monorepo with two tsconfigs open in VS Code. Spurious TS2304/2339/2451/6133 from macro-generated code show up in the second project only. If project 1 has the same file name in its pipeline (shared sources), positions are mapped with the wrong file's mapper.
- Suggested fix: don't capture per-project state in a global rule. Either pass the mapper through `filterDiagnostics(..., { positionMapFn })` and the rule's `shouldSuppress` args, or make the registry per program or per language service (for example, a `WeakMap<ts.Program, rules[]>`). At minimum, have "Once" replace the existing rule instead of keeping it.
- Fix size: M

### 34. `.ts` config loading writes a temp `.cjs` next to the config and deletes it afterwards, which races between concurrent processes and fails on read-only trees

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:296-310 (the `.ts` search places use cosmiconfig's default `loadTsSync`, node_modules/cosmiconfig/dist/loaders.js:77-101).
- Problem: cosmiconfig's sync TS loader writes `<config>.cjs` beside the source, `require`s it, then `rmSync`s it in `finally`. Two processes starting at the same time in the same project race: one deletes the file while the other is about to require it, and the error is swallowed (#4). Read-only checkouts (Nix store, Bazel sandbox, read-only Docker mounts) always fail. A crash between write and delete leaves `typesugar.config.cjs` behind. That file comes before `.ts` in `searchPlaces`, so it then shadows later edits to the `.ts` file permanently.
- Failure scenario: 12 rounds of 3 concurrent `node` processes loading `ts1/typesugar.config.ts` gave 27 OK and 9 MISS. A quarter of the processes saw no `allowedMacroPackages`. Real-world triggers are parallel jest/vitest workers, tsserver plus a build starting together, or `turbo` tasks sharing a cwd. The result is flaky "macro package not approved" errors or non-deterministic `contracts.mode` output.
- Suggested fix: pass a custom `loaders: { ".ts": ... }` that transpiles with `ts.transpileModule` and evaluates in memory (`module._compile` on a `Module` instance), or writes to a unique `os.tmpdir()` path.
- Fix size: S

### 35. The config is a process-wide singleton, searched once in `process.cwd()` only (no parent lookup), never reloaded, and not per project

- Severity: medium
- Confidence: high (parent-dir miss is repro'd; IDE cwd behavior is not verified)
- Location: packages/core/src/config.ts:99-101, :285-310 (`cosmiconfigSync(...).search()` with no `searchFrom`/`stopDir`, and cosmiconfig 9 defaults `searchStrategy: 'none'`), :328-347 (`configLoaded` latch). Consumers: approve-macros.ts:89-90 (`projectRoot = dirname(--project)` versus lookup in cwd).
- Problem: (1) Running from a subdirectory finds nothing (`ts1/sub` gives `undefined`), because the default strategy only looks in the start directory. (2) The first `config.get()` decides the config for the whole process: one tsserver or vite process serving several projects (monorepo, multi-root workspace) applies one project's config to all of them. (3) Nothing outside tests calls `config.reset()`, so editing `typesugar.config.ts` (including via `approve-macros` in another terminal) has no effect in the LSP, `tsc --watch` or the vite dev server until restart. (4) `approve-macros -p packages/app/tsconfig.json`, run from the repo root, reads config from the root and writes or creates it under `packages/app`. The created file is then only found when the build runs with cwd `packages/app`.
- Suggested fix: add `config.load({ searchFrom: projectRoot })`, keyed per root (Map<root, config>) or keyed off the `ts.Program`'s tsconfig directory. Use `searchStrategy: "project"`. Have the transformer, LSP and approve-macros pass the tsconfig directory. Invalidate on config-file mtime in watch/LSP hosts.
- Fix size: M

### 36. A `typesugar.config.js` written as ESM in a `"type": "module"` project yields the module namespace as the config, so every setting is dropped

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:302, :305 (`.js` in sync searchPlaces), :311-313 (no `.default` unwrap).
- Problem: cosmiconfig's `loadJsSync` uses `require()`. On Node ≥20.19/22.12 `require(esm)` returns the namespace object `{ __esModule, default }`, which is used as the config unchanged. On older Node it throws `ERR_REQUIRE_ESM` and is swallowed (#4). Either way an ESM `.js` config, the natural choice in a `type: module` project, does nothing.
- Failure scenario: `js1/` contains `package.json {"type":"module"}` and `typesugar.config.js: export default { security: { allowedMacroPackages: ["foo-macros"] } }`. `getConfigFilePath()` points at the file, `getAll()` keys are `[debug, contracts, features, __esModule, default]`, and `security` is `undefined` (ESM and CJS dist alike).
- Suggested fix: after `search()`, unwrap `result.config.default` when `__esModule` or `Symbol.toStringTag === "Module"` is present, or use the async explorer.
- Fix size: S

### 37. A package's own `package.json` `"typesugar"` field (the PEP-055 macros manifest) shadows its `typesugar.config.ts`

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:296-297 (`"package.json"` is the first search place, with key `typesugar`).
- Problem: the `typesugar` key in package.json is used both for a library's macro manifest (`{"typesugar": {"macros": "./dist/macros.js"}}`, read by macro-loader.ts:207) and for project config. cosmiconfig stops at the first hit, so any package that declares macros (a macro library, or a monorepo package that ships local macros and also consumes third-party ones) never reads its `typesugar.config.ts`.
- Failure scenario: `pj/` has `package.json {"name":"my-macro-lib","typesugar":{"macros":"./dist/macros.js"}}` and a `typesugar.config.ts` with `allowedMacroPackages`. `getConfigFilePath()` returns `.../package.json`, `security` is `undefined`, and `config.get("macros")` is `"./dist/macros.js"`. `approve-macros` then returns `manual` because it can't patch package.json.
- Suggested fix: use a distinct package.json key for project config (for example `typesugarConfig`) or drop `package.json` from searchPlaces. At minimum, prefer `typesugar.config.*` over package.json.
- Fix size: S

### 38. Typeclass coherence is documented as enforced, but nothing checks it; duplicate instances compile silently

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/coherence.ts (whole file; `globalCoherenceChecker` has no callers outside index.ts:130-138). Diagnostics TS9050/TS9051 (diagnostics.ts:424) and TS9006 are defined but never emitted. Docs: docs/guides/typeclasses.md:593-612 ("Defining multiple instances for the same type is a compile error", comparison table "Coherence: Enforced").
- Problem: `CoherenceChecker` is never instantiated or called by the instance macros. Its logic also has dead branches: :159 can never fire because nothing has priority < `explicit` (1), and :174-181 is redundant. Two `@instance const S1/S2: Showy<number>` in one file transform with `diagnostics: []` (`coh.mjs`), and which instance wins at resolution is unspecified.
- Suggested fix: wire `registerInstance` into `@instance`/`@derive` registration, reset per program, and emit TS9050. Otherwise remove the docs claim for 1.0 and mark coherence.ts experimental.
- Fix size: M

### 39. The capability system is not wired anywhere, yet the security docs say it partially mitigates file access

- Severity: medium
- Confidence: high
- Location: packages/core/src/capabilities.ts:36-129; docs/SECURITY-REVIEW.md:220-231; docs/architecture.md:650-665.
- Problem: `createRestrictedContext` and `resolveCapabilities` have no callers. `MacroDefinitionBase` (types.ts) has no `capabilities` field, so the JSDoc example `defineExpressionMacro({ capabilities: {...} })` doesn't even type-check. The proxy does not handle `needsFileSystem` at all. SECURITY-REVIEW F4 says "`DEFAULT_CAPABILITIES` now defaults `needsFileSystem: false` ... so file access is opt-in", which is false: nothing reads that flag. The advisory label in SECURITY.md understates it, because the feature is absent rather than advisory.
- Failure scenario: a third-party macro package approved by a user who read SECURITY-REVIEW F4 can read any file via `fs` regardless of declared capabilities. The documented mitigation does not exist.
- Suggested fix: correct SECURITY-REVIEW F4 and architecture.md to say capabilities are not enforced (and not attached to macro definitions), and mark capabilities.ts `@experimental`. Alternatively, add `capabilities` to `MacroDefinitionBase` and wrap `ctx` in `createRestrictedContext` in transformer-core's expand calls.
- Fix size: S (docs) / M (wire it)

### 40. Name-keyed global macro maps make same-name macros from different packages mutually exclusive, and the loader hides the resulting throw

- Severity: medium
- Confidence: high (code path; no current in-repo collision)
- Location: packages/core/src/registry.ts:292-396 (maps keyed by `macro.name` / exportName / label), :270-290 (`isSameMacro`); packages/transformer/src/macro-loader.ts:368-401 (`catch { return false }`).
- Problem: although macros carry `module` and a `module::exportName` index exists, `register()` first checks the name-only map. A second package exporting an expression macro with a common name (`sql`, `match`, `assert`, `when`) throws "already registered". `tryLoadModule` catches every error as "module not resolvable" and returns false silently. `loadedPackages.add(pkg)` already ran, and with the `__typesugar_macros__` convention any macros before the colliding one stay registered. In the other direction, `isSameMacro` treats any two `@typesugar/*` macros with the same kind and name as identical and silently drops the second, without indexing its `module::exportName`. A labeled-block macro whose first label already exists returns early (:368) and skips the remaining labels, the module index and the `syntaxModule` registration. exportName aliases (:305-307) overwrite another macro registered under that name without any check.
- Failure scenario: an approved `acme-sql` package registers expression macro `sql`, and `@typesugar/sql` is also installed. Whichever loads second fails to load with no message (unless verbose), and calls into it are left unexpanded.
- Suggested fix: key the primary maps by `module::exportName` (keep the name maps only for module-less legacy macros). Make the loader report register errors separately from resolution failures. Check for conflicts before mutating anything in `register()`.
- Fix size: M

### 41. `ExpansionTracker.generateSourceMap` describes a different text from the code `transformCode` returns

- Severity: low
- Confidence: high (code reading)
- Location: packages/core/src/source-map.ts:130-176 (map built by MagicString over the original text with only the call sites replaced), consumer packages/transformer-core/src/transform.ts:265-276 (returns `printer.printFile(...)` output but pairs it with that map and builds `createPositionMapper(sourceMap, code, transformedCode)` from it)
- Problem: the printer reformats the whole file (drops blank lines, normalizes quotes and indentation), so line/column mappings in the returned `sourceMap` and mapper are wrong outside trivial inputs. The map is only valid for `generateExpandedCode()` output. The only consumer is the playground (packages/playground/src/index.ts:100-118), which caches and serves this map.
- Failure scenario: a file with blank lines or comments before a macro call → playground/IDE position mapping points to the wrong line in the expanded output.
- Suggested fix: in transformer-core `transformCode`, either return `generateExpandedCode()` as the code or generate the map from the printer (`ts.createPrinter` with a source-map writer, or the pipeline's approach). Document on `generateSourceMap` that it pairs only with `generateExpandedCode`.
- Fix size: S

### 42. Opaque method inlining uses a fixed `_opt` parameter name (capture) and evaluates arguments lazily

- Severity: low
- Confidence: high
- Location: packages/transformer-core/src/rewriting.ts:820-845, 915-994
- Problem: `((_opt) => _opt != null ? fn(_opt) : null)(receiver)` shadows any user `_opt` referenced inside `fn`. Also, method arguments (e.g. `getOrElse(compute())`) now only evaluate on one branch, which differs from the eager evaluation of the original method call.
- Failure scenario: `const _opt = 3; getOpt().map(x => x + _opt)` reads the receiver instead of 3.
- Suggested fix: use `ctx.generateUniqueName("opt")`. Bind non-trivial args to temps before the ternary.
- Fix size: S

### 43. Silent `catch {}` on checker/resolution failures in transformer-core (CLAUDE.md rule 3)

- Severity: low
- Confidence: high
- Location: method-sugar.ts:282-284; rewriting.ts:441-443, 630-635, 724-728; macro-helpers.ts:641-651, 666-670 (extractTypeInfo returns zero fields); import-resolution.ts:479-484; specialization.ts:108-127, 412-422
- Problem: these degrade without any visible warning. In `extractTypeInfo` a checker throw yields `fields: []`. For a type alias, derive then proceeds and generates, e.g., an Eq that compares nothing (always true); for classes it emits a misleading "empty type" TS9104.
- Suggested fix: emit a one-line `ctx.reportWarning` where a degrade changes output (at minimum extractTypeInfo and method-sugar), and use `isSyntheticNode` guards instead of catch-all.
- Fix size: S

### 44. `tryShortName` doesn't check what its contract promises (parameters and nested scopes), so short temp names can capture user locals

- Severity: low
- Confidence: confirmed (unit repro of the name check); capture scenario from code reading
- Location: packages/core/src/context.ts:935-981; contract in packages/core/src/types.ts:138-146 ("imports, top-level declarations, parameter names"); callers packages/std/src/macros/match.ts:843 (`_<scrutinee>`/`_m`), 1974 (`_r`), 2046 (`_ext`)
- Problem: `nameConflictsWithScope` scans only top-level statements. It also misses destructured top-level names, `namespace`/`module`, and `import X = require`. A user parameter or local `_x`, `_r` or `_m` is not detected, so `match`'s generated temp of the same name can shadow it inside an arm body.
- Failure scenario: `tryShortName("_x")` in `function f(_x: number) {…}` returns `_x` (repro). If match lowers with a temp (non-identifier scrutinee, regex arm, or switch with ≥7 arms) and an arm body references the user's `_r`/`_m`, it reads the temp instead.
- Suggested fix: share the "all bindings anywhere in file" set from #1 and treat any hit as a conflict.
- Fix size: S

### 45. The compile-time evaluator (used to _elide contract checks_) has JS-semantics bugs

- Severity: low
- Confidence: confirmed (unit repro for NaN)
- Location: packages/core/src/context.ts:869-886 (`comptimeToBoolean`), 571-613 (arrow functions use dynamic scope via `this.scope`), 899-913 (`comptimeToString` arrays and objects). Consumers: packages/contracts/src/macros/requires.ts:67-71 and prover/index.ts:202-205, which drop the runtime check when the result is `true`.
- Problem: `NaN` is treated as truthy (`value !== 0`), so `!(0/0)` → `false` while JS gives `true`. Arrow closures are evaluated with whatever `this.scope` holds at _call_ time, not definition time, so a curried closure called later reads the wrong binding. Template and `+` stringification of arrays and objects produces `[1, 2]` / `{ a: 1 }`, while JS produces `1,2` / `[object Object]`. `isComptime` gates contracts tightly (no calls or property access), so the practical blast radius is small, but a wrong `true` removes a runtime precondition.
- Failure scenario: `ev("!(0/0)")` → `{kind:"boolean", value:false}` (JS: true).
- Suggested fix: use `!Number.isNaN(v) && v !== 0`. Capture `new Map(this.scope)` when the arrow is created and evaluate its body against that. Use JS `String()` semantics for arrays and objects, or return an error.
- Fix size: S

### 46. Diagnostic message interpolation treats `$` patterns in arguments as regex replacement tokens

- Severity: low
- Confidence: confirmed (unit repro)
- Location: packages/core/src/diagnostics.ts:251-256
- Problem: `message.replace(regex, value)` interprets `$&`, `` $` ``, `$'` and `$$` inside type names or text passed via `withArgs`. Values are also substituted sequentially, so a value containing `{type}` is substituted again.
- Failure scenario: `withArgs({ type: "Foo$&Bar" })` → "No instance found for `Eq<Foo{type}Bar>`". Template-literal types like `` `${string}$` `` are similarly mangled.
- Suggested fix: do a single pass, `template.replace(/\{(\w+)\}/g, (m, k) => args[k] ?? m)`.
- Fix size: S

### 47. Type-string utilities treat the `>` of `=>` as a closing bracket

- Severity: low
- Confidence: confirmed (unit repro)
- Location: packages/core/src/type-string-utils.ts:65-80, 113-123; consumers macros/src/hkt.ts:96-101, diagnostic-suppression-rules.ts:966-969, instance-scanner.ts:374,453
- Problem: function types in type arguments break bracket matching.
- Failure scenario: `extractTypeArgumentsContent("Option<(x: number) => string>")` → `"(x: number) ="`. `parseTypeInstantiation("Eq<() => void>")` → `args: "() ="`. `splitTopLevelTypeArgs("(a: A) => B, C")` → one part.
- Suggested fix: skip `>` when the previous character is `=`, and track `(`/`[`/`{` depth when splitting on commas.
- Fix size: S

### 48. The `isSyntheticNode` predicate misses synthesized nodes that were given a real text range; `MacroContextImpl` checker wrappers don't use it

- Severity: low
- Confidence: confirmed (unit repro)
- Location: packages/core/src/ast-utils.ts:128-130; packages/core/src/context.ts:167-218 (`getTypeOf`, `getTypeString`, `getSymbol`, `assertTypeReliable`); example producer transformer-core/src/macro-helpers.ts:259-277 (`createSyntheticDecorator` does `ts.setTextRange(decorator, tag)`)
- Problem: CLAUDE.md names `isSyntheticNode` as _the_ guard. It checks only `pos/end === -1`. A factory node with a copied range (JSDoc-derived decorators) returns `false`, and `node.getText()` then throws (repro: "Cannot read properties of undefined (reading 'text')"). Current callers survive only because they also wrap the call in try/catch. Separately, the context's checker wrappers call the checker without any synthetic check. On a synthetic node, `assertTypeReliable` reports the misleading "the type of 'foo.bar' could not be resolved. Fix upstream type errors first." (repro), even when there are no type errors.
- Suggested fix: `return node.pos < 0 || node.end < 0 || (!ts.isParseTreeNode(node) && !ts.getParseTreeNode(node))`, or check `node.flags & NodeFlags.Synthesized` without a parent. In `assertTypeReliable`, skip or word the warning differently for synthetic nodes.
- Fix size: S

### 49. `renderDiagnosticCLI` ignores its `colors` option and crashes on a synthetic primary span

- Severity: low
- Confidence: confirmed (code reading; `colors` is never read)
- Location: packages/core/src/diagnostics.ts:1563-1571 (`colors?` documented), 1489-1502 (`color()` reads env only), 1609 and 1615-1616 (`node.getStart()` without a source file)
- Problem: `{colors:false}` still emits ANSI codes. A diagnostic built with `.at(syntheticNode)` throws inside the renderer. This is exported public API with no in-repo caller.
- Suggested fix: thread `options.colors` into `color()`. Use `node.getStart(sourceFile)` and skip spans when `isSyntheticNode`.
- Fix size: S

### 50. A suppression rule that throws is skipped with no visible trace (outside audit mode)

- Severity: low
- Confidence: high (code reading)
- Location: packages/core/src/diagnostic-suppression.ts:193-200
- Problem: this violates CLAUDE.md's "a caught exception with no visible trace is worse". A buggy rule (for example, a checker call on a synthetic node) silently stops suppressing, and the user sees false TS errors with no hint why.
- Suggested fix: log once per rule name, unconditionally (`console.warn` or the LSP log), and keep the detailed log for audit mode.
- Fix size: S

### 51. `config.evaluate` / `config.when` silently evaluates unparseable conditions as false

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:409-448.
- Problem: anything not matching `path == 'str'`, `path != 'str'` or a bare path falls through to `!!get(<whole expression>)`, which is false. There is no diagnostic. Also, `||` and `&&` are split before quoted strings are considered.
- Failure scenario: `contracts.mode === "full"` gives false, as do `debug == true` and `level == 2`, all with TYPESUGAR_DEBUG=1 and LEVEL=2. Meanwhile `nonexistent == 'undefined'` gives true. A `config.when("contracts.mode === 'full'", A, B)` silently always emits B.
- Suggested fix: have the bare-path branch accept only `/^[\w.]+$/`. Throw on anything else, so config-when.ts reports it through `ctx.reportError`. Accept `===`/`!==` and unquoted literals.
- Fix size: S

### 52. Env-var mapping turns `_` and `__` both into `.`, so camelCase keys are unreachable and the "double underscore" contract is false

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/core/src/config.ts:107-146.
- Problem: `.toLowerCase().replace(/__/g,".").replace(/_/g,".")`: every underscore becomes a separator and case is lost. `TYPESUGAR_CONTRACTS_PROVEATCOMPILETIME=1` produces `contracts.proveatcompiletime` (ignored), and `..._PROVE_AT_COMPILE_TIME` produces `contracts.prove.at.compile.time`. Every unrelated `TYPESUGAR_*` var (`TYPESUGAR_PROFILE`, `TYPESUGAR_NO_COLOR`, ...) is merged into config. Results also depend on environment order: with `TYPESUGAR_CONTRACTS=0` and `TYPESUGAR_CONTRACTS_MODE=none` set, the earlier keys are wiped. `"0"` becomes `false`, not `0`.
- Failure scenario: a user sets `TYPESUGAR_CONTRACTS_PROVE_AT_COMPILE_TIME=1` (the name documented in contracts/src/config.ts) and expects `config.get("contracts.proveAtCompileTime")` to be true. It stays false. contracts reads `process.env` directly, which masks this for that one key.
- Suggested fix: use only `__` as the nesting separator, map single-`_` segments to camelCase, and allowlist known top-level keys.
- Fix size: S

### 53. Config file loading silently does nothing on Node 20.0-20.15, although `engines` allows `>=20`

- Severity: low
- Confidence: high
- Location: packages/core/src/config.ts:261-270 (`process.getBuiltinModule`, added in v20.16.0/v22.3.0); packages/core/package.json `"engines": {"node": ">=20"}`.
- Problem: on an older Node 20, `getNodeRequire()` returns undefined and the code falls back to "no config" with no warning.
- Suggested fix: bump engines to `>=20.16`, or warn once when `getBuiltinModule` is missing under a real Node (`process.versions.node` present).
- Fix size: S

### 54. `debugOnly` / `invariant` JSDoc promise production stripping that doesn't exist

- Severity: low
- Confidence: high
- Location: packages/core/src/safety.ts:8-10, :30, :46, :70-76, :164-186.
- Problem: `debugOnly` "Completely erased in production" always expands to `fn()` (the comment at :183 says "For now, we always inline"), and the runtime function always calls `fn`. `invariant` is "Stripped in production builds", but nothing reads any production flag (for example `contracts.mode`). Users who put expensive validation in `debugOnly` ship it.
- Suggested fix: honor a config flag (for example `config.get("debug")` or a `safety.strip` key) in the macros to emit `void 0`, or fix the JSDoc.
- Fix size: S

### 55. `MacroExpansionCache` never evicts and writes non-atomically

- Severity: low
- Confidence: high
- Location: packages/core/src/cache.ts:116-124, :160-179.
- Problem: there is no age or size eviction. Every edit to a cached call site adds an entry forever, and the whole JSON is loaded into memory and pretty-printed on every save. `writeFileSync` without temp-file-plus-rename means concurrent builds can tear the file. That is only silently recovered as an empty cache, and the write failure is swallowed (:176).
- Suggested fix: write to a temp file and rename. Drop entries not hit during the current run, or cap the size with LRU on `timestamp`.
- Fix size: S

## Cross-scope leads (code outside core/transformer-core)

- packages/macros/src/typeclass.ts:3127-3154: see finding 24 (duplicate `import { Eq }`).
- packages/macros/src/comptime.ts:560-600: the vm sandbox exposes host `Object`, so `Object.constructor("return process")()` returns the real `process`. The permission-checked fs/process wrappers can be bypassed, and comptime "permissions" are not a security boundary (core-B, repro'd).
- CLAUDE.md's "exhaustive" parse* exception list is missing about 20 real `ctx.parse*` call sites: contracts/src/macros/laws.ts:153,202; codec/src/macros.ts:282; effect/src/derive/hash.ts:97,136, equal.ts:85,122, schema.ts:228,265; sql/src/derive-typeclasses.ts:300,436; parser/src/macros.ts:96; testing/src/macro.ts:210,359,490,709,948,1224,1327 (core-B).
- packages/transformer/src/macro-loader.ts:37-38, 108-122: package.json lookup uses the transformer's own `createRequire`, not the project root, so third-party macro packages in the project's node_modules may go undiscovered under pnpm (core-A, medium confidence).
- packages/macros/src/specialize.ts:736-754 (`inlineFromNode`): the substitution behind finding 6.

## 1.0 gaps

- transformer-core claims "ZERO Node.js dependencies"/browser-compatible (transformer.ts:5, transform.ts:9), but dts-opaque-discovery.ts imports `path` and @typesugar/macros pulls in `fs`. Either document the required polyfills or move the Node bits behind the injected `DtsFileAccess`.
- `transformCode({ strictOutput: true })` type-checks against an in-memory host whose lib files are empty strings (transform.ts:135-137), so it can only work for code that never touches globals. Document it as experimental or ship real lib text.
- The `JSDOC_MACRO_TAGS` entries `operators`/`operator` are known-dead (macro-helpers.ts:48-53) but still warn "Unknown JSDoc macro tag". JSDoc tags such as `@extension`/`@instance`/`@reflect` in ordinary documentation comments trigger macro dispatch with no import/activation gate.
- `offsetToLineColumn` is a linear scan per call (position-mapping-core.ts:73-81). LSP-scale mapping (semantic tokens, many diagnostics) is O(tokens × lines), so it should use binary search.
- Process-global mutable state (type-rewrite registry, `scannedDtsFiles`, `globalExpansionTracker`, `globalResolutionScope`) is never reset between builds in watch mode/LSP. Stale or cross-project entries persist (this is the root of TC3), so 1.0 needs a documented per-program reset.

- `resolution.mode` / `resolution.fileOverrides` (config.ts:48-62, :511-538) are documented (docs/guides/opt-out.md:190-210 shows them as tsconfig plugin options; docs/errors/TS9702.md says "switch to automatic mode"), but `FileResolutionScope.mode` is computed and never read anywhere, and the plugin options are not fed into `config`. The glob matcher also anchors against absolute paths (`*` crosses `/`, Windows `\` is unhandled).
- `config.isInPrelude` / `config.isTracingEnabled` are exported but unused.
- prelude.ts as a whole is dead (no callers) and contradicts PEP-052: `getPreludeTypeclasses()` returns 11 default typeclasses when unconfigured, while `config.isInPrelude` says nothing is in the prelude by default. `OPERATOR_TO_TYPECLASS` maps `/` to Integral (last write wins). `generatePreludeDeclaration()` emits only comments. Remove it or mark it internal/experimental.
- manifest.ts (`typesugar.manifest.json` discovery, `getManifestRegistry`) is exported but has no callers, and it overlaps or conflicts with PEP-055's `typesugar.macros` package.json field. Remove it or mark it experimental.
- coherence.ts and capabilities.ts are unwired public APIs (see #9 and #10). They need an `@experimental` marking or removal before 1.0.
- pipeline.ts `MacroPipeline` has no users. It wraps expression macros with a synthetic `CallExpression` that has no `typeArguments`, so any wrapped macro that reads type args or calls the checker on the call or args will throw or misbehave (CLAUDE.md synthetic-node rule). `build()` registers globally by default. Mark it experimental.
- core index.ts exports mutable internals with no stability marking (`standaloneExtensionRegistry` array, `globalCoherenceChecker`, `globalHygiene`, `MacroExpansionCache`, `profiler`). Decide which are public API and tag the rest `@internal`.
- There are no user docs listing the supported config filenames. `.mjs`, `.mts`, `.cts` and the `.config/` directory forms are unsupported (cosmiconfig's sync defaults include `.config/*`), nothing says cosmiconfig must be installed (#3), and nothing says config is read from cwd only (#6).
- Config-file loading tests (tests/config.test.ts:506-540) cover only the `.ts` happy path. There is nothing for ESM `.js`, a throwing config, parent-dir or cwd mismatch, or the published-package layout. Each of these hid a bug above.

- `ResolutionTracer` / `globalResolutionTracer` (resolution-trace.ts:73-276, 503) are exported with inlay-hint, hover and CLI formatting APIs, plus a `tracing` config key, but nothing in the repo ever calls `record()`. The feature is dead. Wire it up, or remove it or mark it experimental.
- test-helpers.ts documents `import … from "@typesugar/core/test-helpers"`, but package.json exports only `"."` and index.ts doesn't re-export it. The doc also says the helpers "save and restore" registry state, but they only clear it, which wipes rules registered by module side effects.
- Process-global singletons with no per-program isolation: `globalHygiene`, `globalExpansionTracker`, `globalResolutionScope`, the diagnostic-suppression rule list, the type-rewrite registry, the syntax-marker fallback and the import-suggestion index. This is unsafe for multi-project tsserver and for long-lived watch processes (see #9 and #10). Either document a supported isolation story for 1.0 or scope them per program.
- `MacroContext.evaluate()` / `ComptimeValue` is public API (docs/architecture.md:273). The `"type"` kind is never produced, and the evaluator's limits (no calls except `comptime`, NaN, closure semantics) are undocumented. Mark it experimental or document it.
- The inline opt-out semantics (same line only, feature vs bare form, `-all`) are not specified in API docs. tests/red-team-transformer.test.ts:230-241 has empty opt-out test bodies that pass vacuously.
- The import-suggestion data is a hand-maintained static table (#13) and will drift. 1.0 needs it generated from manifests, or validated in CI.
