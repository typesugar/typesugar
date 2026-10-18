# transformer-core findings (lead reviewer)

Repro scripts: /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/run-*.cjs, inputs in repro-*/ next to them. All run against packages/transformer/dist + packages/transformer-core/dist via `macroTransformerFactory` / `transformCode` (peak RSS ~350 MB).

### TC1. Disk expansion cache is keyed only by macro name + call-site text: wrong output across files and stale output across builds
- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:136-169, 1311-1362; key in packages/core/src/cache.ts:86-89; enabled by default in packages/transformer/src/pipeline.ts:121-123, 217-218 (`cacheDir` undefined means ".typesugar-cache")
- Problem: `computeCallSiteCacheKey` hashes `[macroName, node.getText(), ...argTexts]`. There is no file path, no type information, no dependency content, no config, and no macro/package version in the key. Every expression macro is cacheable unless it opts out (`cacheable !== false`), and only about 10 do. The cache is on by default, persisted to `.typesugar-cache/expansions.json` by the CLI and unplugin, and shared across every file in the build.
- Failure scenario: (a) `a/main.ts` and `b/main.ts` both contain `includeStr("./data.txt")` but read different files. b gets a's contents ("AAA" emitted for both). (b) Edit `a/data.txt` from "V1" to "V2" and rebuild: the output stays "V1" forever. The same applies to `typeInfo<User>()`/`fieldNames<T>()` when `User` differs per file or is edited, `cfg(...)` after a config change, `includeJson`, `summon<...>` etc. Separately, a cache hit replays none of the expansion's side effects (`ctx.ensureImport` pending imports, hoisted specialisations, registry writes), so cached text that references an aliased import will dangle in another file.
- Suggested fix: make caching opt-in (`cacheable: true` only on macros proven pure in their syntactic input), add `sourceFile.fileName` + package version to the key, and give macros a way to declare file dependencies (includeStr already calls `recordDependency`) whose content hashes go into the key. Until then, default `cacheDir` to `false`.
- Fix size: M

### TC2. `obj.pipe(...)` on any node_modules type is expanded as the `pipe` macro when the file imports `pipe` (receiver silently dropped)
- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:1288-1297 together with packages/transformer-core/src/import-resolution.ts:195-205, 418-455
- Problem: for any `X.name(...)` call, `tryExpandExpressionMacro` uses the method name as the macro name and resolves the property-access symbol. `resolveModuleSpecifier` returns a package name for ANY file under `node_modules/` (and maps any `/packages/<x>/` path to `@typesugar/<x>`), which sets `foundModuleDecl = true`. Execution then falls through to `fallbackNameLookupWithImports(sourceFile, "pipe")`, and that matches because the file imports `pipe` from "typesugar".
- Failure scenario: `import { pipe } from "typesugar"; import { Observable, map } from "rxjs"; obs.pipe(map(f), map(g))` compiles to `map(g)(map(f))`. The `obs` receiver is gone. With one operator it raises a bogus build error ("pipe() requires at least an initial value and one function"). The same applies to any method on a third-party type that shares a name with an imported macro (`compose`, `match`, `extend`, `summon`, ...).
- Suggested fix: in the `X.name()` branch, only treat it as a macro when `X` resolves to a namespace import / module symbol of a recognised macro module. Restrict the name-based fallback in `resolveSymbolToMacro` to recognised `@typesugar/*`/`typesugar` packages (not arbitrary `node_modules` packages or user `packages/*` dirs).
- Fix size: S

### TC3. @opaque constructor/constant erasure matches by bare name across the whole process; it rewrites unrelated code in other files, depending on file order
- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/rewriting.ts:999-1106 (`tryEraseOpaqueConstructorCall`, `tryEraseOpaqueConstantRef`); registry is process-global and never cleared outside tests (packages/core/src/type-rewrite-registry.ts:159-217; packages/transformer-core/src/dts-opaque-discovery.ts:32)
- Problem: once any file causes an @opaque entry to be registered (for example by importing `Some` from `@typesugar/fp`, which triggers .d.ts discovery), every later file in the process has every call to an identifier named `Some`/`Left`/`Ok`/... erased and every identifier named `None` (etc.) replaced by `null`. There is no symbol/import check, and the identifier-position exclusions are incomplete (enum members, property-assignment keys, shorthand properties, method names, type references, default imports).
- Failure scenario: a.ts `import { Some } from "@typesugar/fp"`. b.ts (no fp import): `function Some(x){...}; Some(1)` becomes `1`, `enum Flags { None = 0 }` becomes `enum Flags { null = 0 }` (so `Flags.None` is undefined), `{ None: 1 }` becomes `{ null: 1 }`, `const None = 5; None + 1` becomes `null + 1`, and `{ None }` becomes `{ null }` (a syntax error). Transforming b.ts alone leaves it untouched, so the output depends on file order. It also breaks ts-results/oxide users (`Some`, `None`, `Ok`, `Err`).
- Suggested fix: resolve the callee/identifier symbol through aliases and only erase when its declaration is the registered constructor's declaration (store declaration file + export name in the entry, not just the name). Only erase identifiers in expression positions.
- Fix size: M

### TC4. Instance-call inlining resolves instance dictionaries by bare variable name; an unrelated same-named local gets another file's body, and DCE then deletes it
- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/specialization.ts:762-825 (`resolveInstanceOrIntrinsicMethodsSafely` → `getInstanceMethods(dictName, program)`); registry in packages/macros/src/specialize.ts:430-442
- Problem: `tryInlineDerivedInstanceCall` runs on every `ident.method(args)` call and looks up `ident.text` in a per-Program, name-keyed registry. The shadowing guard the comment describes is applied only to primitive intrinsics, not to user-registered instances.
- Failure scenario: a.ts `/** @impl Eq<Point> */ export const eqPoint = { equals: (a,b) => a.x === b.x }`. b.ts `const eqPoint = { equals: (a: number, b: number) => false }; export const r = eqPoint.equals(1, 2);` compiles to `export const r = 1..x === 2..x;`, and b's own `eqPoint` declaration is removed by DCE. Transforming b.ts alone is correct.
- Suggested fix: resolve `ident` with the checker (follow aliases) and require its declaration to be the registered instance's declaration node/file. Apply the same guard in `recursivelyInlineInstanceCalls` and `tryAutoSpecialize`.
- Fix size: M

### TC5. Dead-instance elimination deletes exported declarations and sibling declarators
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/specialization.ts:887-953 (`eliminateDeadDerivedInstances`)
- Problem: any top-level `VariableStatement` holding an object-literal declarator whose name was inlined is dropped when no other statement mentions the name. Export modifiers are not checked, and the whole statement goes, so other declarators in the same `const a = ..., b = ...` go too. The check is name-text based, so it also misses shadowing.
- Failure scenario: `export const eqPoint: Eq<Point> = {...}, VERSION = 3; export const same = eqPoint.equals(p1, p1);` emits neither `eqPoint` nor `VERSION`. Importers of either export break at link/runtime.
- Suggested fix: skip statements with an `export` modifier (and names listed in `export {}`/`export default`), and remove only the dead declarator rather than the whole statement.
- Fix size: S

### TC6. Inlining duplicates argument expressions; side-effecting arguments are evaluated multiple times
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/specialization.ts:815, 857 (call `inlineMethod`), substitution in packages/macros/src/specialize.ts:736-754
- Problem: parameters are substituted textually with the argument AST. A parameter used N times evaluates its argument N times. The same applies to `rewriteDictCallsForAutoSpec`. This runs automatically on every call on a recognised instance; there is no opt-in.
- Failure scenario: `eqPoint.equals(next(), next())` with `equals = (a,b) => a.x === b.x && a.y === b.y` becomes `next().x === next().x && next().y === next().y`: four calls instead of two, and a different result. The same happens with `arr.pop()`, `i++`, `await` etc.
- Suggested fix: when an argument is not a simple identifier/literal and its parameter is referenced more than once (or not at all), bind it to a hygienic temp (an IIFE or comma-sequence temp), or skip inlining.
- Fix size: M

### TC7. Inlined/specialised call sites are returned unvisited, so macros in their arguments are never expanded (and their imports are removed)
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:987-1011 (results of `tryAutoSpecialize`, `tryInlineDerivedInstanceCall`, `tryReturnTypeDrivenSpecialize` are returned without `ts.visitNode`); specialization.ts:433, 451, 711-735, 815
- Problem: these paths build a new call from the original argument nodes and return it straight from `tryTransform`, so the visitor never descends into the arguments.
- Failure scenario: `import { pipe } from "typesugar"; eqPoint.equals(pipe(p1, f), p1); pipe(1, g)` compiles to `pipe(p1, f).x === p1.x`. The `pipe` import is removed because the second call resolved it, so this throws ReferenceError at runtime.
- Suggested fix: visit the arguments (`node.arguments.map(a => ts.visitNode(a, visit))`) before inlining/specialising, as `tryRewriteTypeclassOperator` and method-sugar already do.
- Fix size: S

### TC8. Block-bodied arrow functions bypass `tryTransform` and implicit-parameter scope entirely
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:323-351 (the `isArrowFunction && isBlock(body)` early return precedes the `hasImplicitParams` check and `tryTransform`)
- Problem: every `(…) => { … }` takes the comprehension-simplification path and returns after `visitEachChild`. The implicit-scope push (342-351) and all `tryTransform` handling of the arrow node itself (e.g. opaque return-type stripping at 947-964) never run for block-bodied arrows.
- Failure scenario: `export const f = <A,>(a: A, S: Show<A> = implicit()): string => { return display(a); }` gives TS9001 "No instance found for Show<A>" and `display(a)` is left unfilled. The identical `function` form and the expression-bodied arrow both correctly produce `display(a, S)`.
- Suggested fix: move the arrow-body simplification after the implicit-params/tryTransform dispatch (apply it to the result of normal visiting), or run the implicit-scope push inside that branch.
- Fix size: S

### TC9. Symbol→macro cache ignores macro kind: an expression macro is invoked as an attribute macro, and the decorated class is deleted
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/import-resolution.ts:489-498 (`symbolMacroCache` keyed by symbol id only); callers pass different `kind`s for the same symbol (transformer.ts:1302, 1406, 1515; rewriting.ts:81, 113, 175)
- Problem: the first lookup's result for a symbol is returned for every later lookup of any kind. `impl`, `instance`, `typeclass` and `config.when` are each registered as BOTH expression and attribute macros under the same export, and the preprocessor rewrites `@impl` on consts into `impl(...)` calls, so mixed use in one file is the normal case.
- Failure scenario: a file has `dual(1)` and later `@dual class X {}` (same import, both kinds registered). The expression macro's `expand` is called with the `Decorator` as its call node, its NumericLiteral result replaces the class, and `visitStatementContainer` drops the non-statement. Class `X` vanishes from the output with no diagnostic. The reverse order sends a decorator into the expression path.
- Suggested fix: key the cache by `${symbolId}:${kind}`.
- Fix size: S

### TC10. A throwing attribute macro recurses until the stack overflows (927 expansions, 1854 diagnostics for one decorator)
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:1550-1578
- Problem: on `expand` throwing, the decorator is pushed back into `remainingDecorators`. Since the count is unchanged, the node is not rewritten, so `ts.visitNode(currentNode, visit)` re-enters `tryExpandAttributeMacros` on the identical node, which throws again, and so on until a RangeError. Each unwinding level then adds an error diagnostic. `tryExpandImplicitLabelMacro` (1659-1672) has the same unbounded re-entry if a trigger-label macro ever returns a node that still has its trigger label.
- Failure scenario: any attribute macro bug or a user-input error that throws produces ~1000 identical errors, ~75 ms of stack churn per decorator, and potentially a stack overflow in deeper contexts (e.g. inside LSP).
- Suggested fix: after a failure, strip the failed decorator (or mark the node) before re-visiting, or visit with `visitEachChild(currentNode)` rather than `visit(currentNode)` when `currentNode === node`.
- Fix size: S

### TC11. Macro import specifiers are removed even when the name is still referenced at runtime
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/import-resolution.ts:89-183 (`cleanupMacroImports`), fed by `recordMacroImport` on the first successful resolution
- Problem: the specifier is dropped once any one call site resolves to a macro. Remaining references are not checked: calls in `"use no typesugar"` functions or opted-out lines, value references (`const f = pipe`, `export { pipe }`), and calls left unexpanded by TC7/TC8.
- Failure scenario: `import { pipe } from "typesugar"; const a = pipe(1, f); function raw() { "use no typesugar"; return pipe(1, g); }` drops the import while `raw()` still calls `pipe`, so ReferenceError. The documented opt-out therefore breaks at runtime whenever the same macro is used elsewhere in the file.
- Suggested fix: before removing a specifier, scan the transformed statements for remaining identifier references bound to that import (or record unexpanded uses) and keep the specifier when any exist.
- Fix size: M

### TC12. JSDoc-macro targets are returned unvisited, so nothing inside a `/** @derive */` class or `/** @impl */` initializer is expanded
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transformer.ts:1032-1037; packages/transformer-core/src/macro-helpers.ts:193-209
- Problem: `tryExpandJSDocMacros` returns `[currentNode, ...results]` and `tryTransform` returns that directly. The decorator path visits its result (1574), but the JSDoc path never does.
- Failure scenario: `/** @derive(Eq) */ export class P { f() { return pipe(1, g); } }` emits `pipe(1, g)` unexpanded while the identical `@derive(Eq)` decorator form expands it. Combined with TC11, the `pipe` import is removed, so ReferenceError.
- Suggested fix: run `ts.visitNode(currentNode, visit)` (via the same visitEachChild-on-original fallback as the decorator path) before returning.
- Fix size: S

### TC13. `findGeneratedPosition` returns the first segment on the line, not the nearest one, so original→transformed positions are wrong after any earlier expansion on the line
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/source-map-utils.ts:302-327 (used by `SourceMapPositionMapperCore.toTransformed`, position-mapping-core.ts:128-134)
- Problem: it returns the first segment with `sourceColumn <= target` instead of the greatest such column. It is also O(total segments) per lookup.
- Failure scenario: map with segments gen0→src0 and gen20→src10. Querying src col 12 returns gen col 12 (expected 22). IDE features that map original→transformed (hover, completion, go-to-definition, rename via LSP/ts-plugin) land on the wrong token whenever a macro on the same line, before the cursor, changed length.
- Suggested fix: track the best (max `sourceColumn <= target`) segment over all segments for that source line. Build a reverse index once in the mapper constructor.
- Fix size: S

### TC14. `transformCode().changed` is false (and no source map) for rewrites that do not go through the ExpansionTracker
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/transform.ts:272-277
- Problem: `changed = globalExpansionTracker.count > 0`. Instance inlining, auto/return-type specialisation, implicit-param filling, operator rewriting, HKT, opaque annotation stripping, import cleanup and DCE never record an expansion. The returned `code` is rewritten while `changed: false`, `sourceMap: null` and an Identity mapper claim otherwise.
- Failure scenario: `const eqPoint: Eq<Point> = {...}; eqPoint.equals(p1, p1)` returns `changed: false`, but `code` has the declaration removed and the call inlined. The playground (packages/playground/src/index.ts:100-119) caches and reports it as unchanged, and positions are mapped with identity.
- Suggested fix: compute `changed` as `transformedCode !== printer.printFile(sourceFile)` (or track a dirty flag in MacroTransformer). Generate a map from the printer's source-map writer instead of only from tracked expansions.
- Fix size: S

### TC15. Auto-specialisation hoists a copy of the callee body into the caller's scope (free-variable capture; type args left on an untyped function)
- Severity: high
- Confidence: confirmed (repro'd: output `function g() { const __typesugar___addN_number_0__ = (x: number) => x + n; const n = 99; return __typesugar___addN_number_0__(1); }`)
- Location: packages/transformer-core/src/specialization.ts:186-274, 436-451; hoisting at transformer.ts:793-840
- Problem: the specialised arrow is built from the callee's body and hoisted to the top of the CALL SITE's nearest Block/SourceFile. Free identifiers in that body are re-bound in the caller's scope, so a caller-local with the same name captures them. The rewritten call also keeps `node.typeArguments` although the hoisted arrow has had its type parameters stripped.
- Failure scenario: `const n = 10; const addN = (E: Num<number>, x: number) => E.add(x, n); function g() { const n = 99; return addN(numInst, 1); }` hoists `const __addN_spec = (x) => x + n` into g's body, so it yields 100 instead of 11. `f<number>(inst, x)` becomes `__spec<number>(x)`, which is TS2558 in any type-checked/`expand` output.
- Suggested fix: hoist to the scope where the callee is declared (or the source-file level when it is top-level), or refuse to specialise when any free identifier of the body resolves differently at the hoist site. Drop `typeArguments` on the rewritten call.
- Fix size: M

### TC16. `// @ts-no-typesugar` (bare, as documented) does not opt a line out of macros
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/core/src/resolution-scope.ts:465-472, called with feature "macros"/"extensions" from transformer.ts:1278 and rewriting.ts:73,153,218,413
- Problem: when a feature is passed, only `@ts-no-typesugar <feature>` or `@ts-no-typesugar-all` match, so the documented bare form (docs/index.md:392, "Skips transformation of that line") is ignored by every macro/extension call site.
- Failure scenario: `export const b = pipe(2, f); // @ts-no-typesugar` is still expanded.
- Suggested fix: with a feature, accept a bare `@ts-no-typesugar` not followed by a feature word (`/@ts-no-typesugar(?![\w-])/`) as well.
- Fix size: S

### TC17. Method sugar emits an unimported companion reference when the receiver's type comes from a module the file doesn't import
- Severity: medium
- Confidence: high
- Location: packages/transformer-core/src/method-sugar.ts:286-293, 368-383
- Problem: `moduleSpecifierForType` returns `undefined` both for "declared in this file" and for "declared elsewhere but not imported here". In the second case `sourceModule` is undefined, so no `ensureImport` happens and a bare `Point.Eq.equals(...)` is emitted.
- Failure scenario: `import { makePoint } from "./factory"; makePoint().equals(q)` with `@derive(Eq) class Point` in ./point.ts produces `Point.Eq.equals(makePoint(), q)` with no `Point` binding, so ReferenceError.
- Suggested fix: when the declaring file differs and no existing import matches, compute a module specifier for `declFile` (relative path from the current file) and `ensureImport` it, or skip the rewrite with a diagnostic.
- Fix size: S

### TC18. Opaque method inlining uses a fixed `_opt` parameter name (capture) and evaluates arguments lazily
- Severity: low
- Confidence: high
- Location: packages/transformer-core/src/rewriting.ts:820-845, 915-994
- Problem: `((_opt) => _opt != null ? fn(_opt) : null)(receiver)` shadows any user `_opt` referenced inside `fn`. Also, method arguments (e.g. `getOrElse(compute())`) now only evaluate on one branch, which differs from the eager evaluation of the original method call.
- Failure scenario: `const _opt = 3; getOpt().map(x => x + _opt)` reads the receiver instead of 3.
- Suggested fix: use `ctx.generateUniqueName("opt")`. Bind non-trivial args to temps before the ternary.
- Fix size: S

### TC19. Silent `catch {}` on checker/resolution failures in transformer-core (CLAUDE.md rule 3)
- Severity: low
- Confidence: high
- Location: method-sugar.ts:282-284; rewriting.ts:441-443, 630-635, 724-728; macro-helpers.ts:641-651, 666-670 (extractTypeInfo returns zero fields); import-resolution.ts:479-484; specialization.ts:108-127, 412-422
- Problem: these degrade without any visible warning. In `extractTypeInfo` a checker throw yields `fields: []`. For a type alias, derive then proceeds and generates, e.g., an Eq that compares nothing (always true); for classes it emits a misleading "empty type" TS9104.
- Suggested fix: emit a one-line `ctx.reportWarning` where a degrade changes output (at minimum extractTypeInfo and method-sugar), and use `isSyntheticNode` guards instead of catch-all.
- Fix size: S

## Cross-scope (found via the transformer-core path, code lives in @typesugar/macros)
### X1. Generic Eq derive injects `import { Eq } from "@typesugar/macros"` once per derived type, giving a duplicate-binding SyntaxError
- Severity: medium
- Confidence: confirmed (repro'd output; duplicate ESM import verified to throw in node)
- Location: packages/macros/src/typeclass.ts:3127-3154
- Problem: `alreadyImported` scans the pre-transform `ctx.sourceFile.statements`, which is exactly the snapshot anti-pattern in CLAUDE.md rule 2. Two `@derive(Eq)` types with primitive fields in a file with no `Eq` import each inject the import.
- Failure scenario: two `@derive(Eq)` classes in one file emit two `import { Eq } from "@typesugar/macros"`, which fails with "SyntaxError: Identifier 'Eq' has already been declared" on load.
- Suggested fix: use `ctx.ensureImport("Eq", "@typesugar/macros")` (file-scoped, deduped) and use the identifier it returns.
- Fix size: S

## 1.0 gaps (transformer-core)
- transformer-core claims "ZERO Node.js dependencies"/browser-compatible (transformer.ts:5, transform.ts:9), but dts-opaque-discovery.ts imports `path` and @typesugar/macros pulls in `fs`. Either document the required polyfills or move the Node bits behind the injected `DtsFileAccess`.
- `transformCode({ strictOutput: true })` type-checks against an in-memory host whose lib files are empty strings (transform.ts:135-137), so it can only work for code that never touches globals. Document it as experimental or ship real lib text.
- The `JSDOC_MACRO_TAGS` entries `operators`/`operator` are known-dead (macro-helpers.ts:48-53) but still warn "Unknown JSDoc macro tag". JSDoc tags such as `@extension`/`@instance`/`@reflect` in ordinary documentation comments trigger macro dispatch with no import/activation gate.
- `offsetToLineColumn` is a linear scan per call (position-mapping-core.ts:73-81). LSP-scale mapping (semantic tokens, many diagnostics) is O(tokens × lines), so it should use binary search.
- Process-global mutable state (type-rewrite registry, `scannedDtsFiles`, `globalExpansionTracker`, `globalResolutionScope`) is never reset between builds in watch mode/LSP. Stale or cross-project entries persist (this is the root of TC3), so 1.0 needs a documented per-program reset.
