# Partial findings: core-B (hygiene, context, source-map, resolution-scope/trace, diagnostics*, import-suggestions, ast-utils, types, type-rewrite-registry, type-string-utils, syntax-marker-fallback, test-helpers)

Repro scripts used (all against `packages/*/dist`, built 2026-10-18) are in
`/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/`
(`hyg1.cjs`, `hyg2.cjs`, `ast1.cjs`, `opt1.cjs`, `ctx1.cjs`, `ctx2.cjs`, `e2e1.cjs`).
All were small `node` runs except `e2e1.cjs`, a single transformer-dist run that peaked at about 458 MB, over the brief's ~300 MB guideline. No other e2e runs were made.

### 1. Reference hygiene only sees top-level bindings, so the emitted reference is captured by nested locals or parameters
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
      return map(o, (n) => n + map.size);   // calls the Map parameter → TypeError at runtime
  }
  ```
  Option's erased methods are `map`, `filter`, `fold`, `match`, `contains`, `tap`, `zip`, `exists`… Local variables with these names are common, so this is a likely user-facing runtime crash.
- Suggested fix: be conservative. Make `localDecls` collect every binding identifier anywhere in the file (one `forEachChild` walk over declarations, parameters, binding elements, catch clauses and import-equals), so any same-named binding forces the alias path. Over-aliasing is harmless. The precise alternative is `checker.getSymbolsInScope(callSite, Value)` at the use site, but that needs the call-site node threaded through the API.
- Fix size: S

### 2. `cfg()` / `@cfgAttr` conditions using `===` or `!==` always evaluate to false and silently strip code
- Severity: high
- Confidence: confirmed (repro against core dist)
- Location: packages/core/src/ast-utils.ts:444-460 (`evaluateConditionExpr`), used by packages/macros/src/cfg.ts:130-133
- Problem: the equality regexes accept only `==` and `!=`. `platform === 'node'` fails both, falls through to the "simple key" truthy check on the path `"platform === 'node'"`, and returns `undefined`, which is false. Any expression the parser doesn't recognise silently becomes `false`. The project's own guide documents the `===` form: docs/guides/conditional-compilation.md:193 `@cfgAttr("platform === 'node'")` and :206 `cfg("platform === 'web' || platform === 'native'", ...)`.
- Failure scenario: with config `{platform:"node", env:"prod"}`: `"platform === 'node'"` → false, `"env !== 'dev'"` → false, `"platform === 'web' || platform === 'node'"` → false. Meanwhile `"platform == 'node'"` → true. The function behind `@cfgAttr("platform === 'node'")` is removed from every build with no diagnostic.
- Suggested fix: change the regexes to `={2,3}` and `!={1,2}`. Accept a bare key only if it matches `^[\w.]+$`; otherwise throw or report "unsupported cfg condition". Add tests for `===` and `!==`.
- Fix size: S

### 3. The documented line opt-out `// @ts-no-typesugar` (without a feature) does nothing for every production caller
- Severity: high
- Confidence: confirmed (repro against core dist)
- Location: packages/core/src/resolution-scope.ts:465-472 (`hasInlineOptOut`). All production callers pass a feature: transformer-core/src/transformer.ts:623,1278,1413,1475,1491,1646; rewriting.ts:73,153,218,413; method-sugar.ts:117; macro-helpers.ts:108; specialization.ts:304; label-activation.ts:40.
- Problem: when `feature` is set, the function returns true only for `@ts-no-typesugar <feature>` or `@ts-no-typesugar-all`. The plain `@ts-no-typesugar` documented in docs/index.md:392 (`(42).clamp(0, 100); // @ts-no-typesugar  // one line`) and in the opt-out table ("Skips transformation of that line") is ignored, because every caller asks with a feature. The unit tests (tests/opt-out.test.ts:140-157) call `hasInlineOptOut` without a feature, so they pass. The intended end-to-end test, tests/red-team-transformer.test.ts:238, is an empty stub. A secondary problem: matching is a raw substring check on the line, so the marker inside a string literal (`const s = "@ts-no-typesugar"; a === b`) also opts the line out.
- Failure scenario: `hasInlineOptOut(sf, stmt, "extensions")` on `(42).clamp(0, 100); // @ts-no-typesugar` → `false`, and `isInOptedOutScope(..., "extensions")` → `false`. The line is still rewritten.
- Suggested fix: when `feature` is given, also return true if the line contains `@ts-no-typesugar` not followed by `[ \t]+\w` (that is, the bare form). Scan only comment ranges (`ts.getLeadingCommentRanges`/`getTrailingCommentRanges` for the line) instead of the raw line text. Make the red-team test real.
- Fix size: S

### 4. `ensureImport` treats `import type` (and a default import) as a value import of the named export, which leaves a dangling reference at runtime
- Severity: high
- Confidence: confirmed (unit repro on `FileBindingCache`); the transformer path is from code reading
- Location: packages/core/src/hygiene.ts:276-301 (`collectImportBindings` ignores `importClause.isTypeOnly` and `element.isTypeOnly`, and maps default imports into the same table as named ones), 453-457 (`ensureImport` "already imported from same module" fast path), 400-411 (`safeRef` tier 1)
- Problem: `import type { Point } from "./point"` and `import { type Point } from "./point"` put `Point → "./point"` into `importMap`. `ensureImport("Point", "./point")` then returns bare `Point` and registers **no** import. TypeScript, esbuild and other bundlers erase type-only imports, so the emitted `Point.Eq.equals(a, b)` throws `ReferenceError: Point is not defined`. The method-sugar call site explicitly expects this case to work (method-sugar.ts:358-363: "imported even when only … `import type` was present"). typescript-eslint's `consistent-type-imports` rewrites imports used only as types into exactly this form, so the pattern is common. A default import `import Point from "./point"` is wrongly treated as the named export `Point` in the same way.
- Failure scenario: repro output: `import type { Point } from "./point"` → `ensureImport("Point","./point")` returns `Point` with no pending import. The same happens for `import { type Point }` and `import Point from`. With method sugar (`p.equals(q)` → `Point.Eq.equals(p, q)`), the emitted file has only the erased type import.
- Suggested fix: record imports as `{module, kind: "named"|"default"|"type"}`. Only a non-type named import counts as "already imported". For a type-only or default import of the same name, use the alias path (`import { Point as __Point_ts0__ }`), since adding a second plain `Point` binding would be a duplicate identifier. Unverified variant worth checking: in a tsc + ts-patch emit, TS also elides a *value* import whose binding the original program only used as a type, because synthesized references don't mark the alias as referenced. That would hit the same fast path.
- Fix size: S

### 5. `ensureImport` can emit a second binding for a name that is already bound, which is a SyntaxError (duplicate declaration)
- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/hygiene.ts:465-469 (plain pending import keyed by `symbol\0from` only), 290-300 and 306-350 (namespace imports and `import X = require()` are not recorded anywhere)
- Problem: (a) the "not in scope" path registers `import { symbol } from "from"` without checking whether another pending plain import already claims `symbol`. Two different modules wanting bare `map` produce `import { map } from "A"; import { map } from "B"`. (b) `import * as Eq from "x"` and `import Eq = require("x")` are not added to `importMap` or `localDecls`, so `ensureImport("Eq", other)` adds `import { Eq } from other` next to the existing `Eq` binding.
- Failure scenario: repro output: `ensureImport("map","@typesugar/fp/data/option")` followed by `ensureImport("map","@typesugar/fp/data/either")` emits both `import { map } from ".../option"` and `import { map } from ".../either"`. That happens in any file calling `.map` on two user `@opaque` types from different modules. Separately, `import * as Eq from "./x"` plus `ensureImport("Eq","@typesugar/std")` emits `import { Eq } from "@typesugar/std"`, giving "Identifier 'Eq' has already been declared".
- Suggested fix: keep a `boundNames` set covering imports of every form, top-level declarations, and names claimed by pending plain imports. If the name is already claimed by a different `(symbol, from)`, use `getOrCreateAlias`. Record namespace-import and import-equals names in `localDecls`.
- Fix size: S

### 6. Known-global short-circuit ignores user imports/declarations and never imports a companion whose name matches a global
- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/hygiene.ts:63-67 (claim "cannot be shadowed by imports"), 385-394 (`safeRef` tier 0), 451 (`ensureImport`)
- Problem: the comment is wrong. Names in `KNOWN_GLOBALS` are routinely shadowed by imports: `import { Map, Set } from "immutable"`, `Request`/`Response` from express or undici, `Worker` from worker_threads, `File`/`Blob` from buffer, `history` from "history", `URL` from "url". `ensureImport` returns a bare identifier for any of these names **without** registering an import. Method sugar calls `ensureImport(<companion base type name>, module)` (method-sugar.ts:219-222), so a user type named `File`, `Request`, `Response`, `Headers`, `Worker`, `Iterator`, `Generator`… resolves to the runtime global.
- Failure scenario: `ensureImport("File", "./models")` in a file that doesn't import `File` → bare `File` with 0 pending imports (repro). `a.equals(b)` on a user `@derive(Eq) interface File` becomes `File.Eq.equals(a, b)` against Node's global `File` → `TypeError: Cannot read properties of undefined`. `safeRef("Map", …)` in a file with `import { Map } from "immutable"` returns bare `Map`, which is the Immutable binding (repro).
- Suggested fix: in `ensureImport`, apply the global fast path only when the caller wants the global (that is, a `from` sentinel or a separate `globalRef()` API), never for module symbols. In `safeRef`'s tier 0, check `importMap` and `localDecls` first and alias through `globalThis.X` when the name is shadowed.
- Fix size: S

### 7. `generateUniqueName` returns the *same* identifier for repeated prefixes within one macro expansion
- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/context.ts:925-933, packages/core/src/hygiene.ts:650-662
- Problem: every macro expansion runs inside `hygiene.withScope` (transformer.ts:527,646,1342,1422,1525,1659; macro-helpers.ts:514,603; rewriting.ts:98,123,184). Inside a scope, `generateUniqueName(prefix)` delegates to `hygiene.createIdentifier`, which is memoised per name ("same scope, same name"). Two calls with the same prefix therefore return the same name, contradicting `MacroContext.generateUniqueName`'s contract ("Generate a unique identifier to avoid name collisions", types.ts:135-136). In-repo callers currently get away with it because the duplicate bindings happen to nest (mapper `item`, `src`; effect `composeFunctions` `x`). A third-party macro that allocates two temps (`swap`, multi-temp lowering) gets `const t = a; const t = b;`. Separately, outside a scope `MacroContextImpl.uniqueNameCounter` and `HygieneContext.globalCounter` both mint `__typesugar_${prefix}_${n}__` from independent counters, so they collide (repro: both produce `__typesugar_v_0__`).
- Failure scenario: `withScope(() => [ctx.generateUniqueName("tmp"), ctx.generateUniqueName("tmp")])` → `['__typesugar_tmp_s0_0__', '__typesugar_tmp_s0_0__']`.
- Suggested fix: give `HygieneContext` a `freshName(prefix)` that always increments the scope counter, and have `generateUniqueName` use it. Keep `createIdentifier` memoised for "same logical name" use. Remove the `MacroContextImpl` counter so there is a single source of fresh names.
- Fix size: S

### 8. `jsValueToExpression` (comptime/include output) turns NaN into `-Infinity` and silently turns Map/Set/Date/vm-realm RegExp into `{}`
- Severity: medium
- Confidence: confirmed (unit repro; cross-realm RegExp repro'd with `vm`)
- Location: packages/core/src/ast-utils.ts:238-252 (number branch), 271 (`instanceof RegExp`), 278-291 (generic object branch). Callers: packages/macros/src/comptime.ts:447 (value from `vm.runInContext`), packages/macros/src/include.ts:251
- Problem: (a) `NaN` is not finite and not > 0, so `!isFinite` returns `createIdentifier("-Infinity")`, and the `isNaN` branch is unreachable. The function doc claims NaN support. `-0` becomes `0`. (b) Any non-array object goes through `Object.entries`, so `Map`, `Set`, `Date`, typed arrays and class instances become `{}` with no error. (c) comptime results come from a separate vm realm. A regex literal evaluated there is not `instanceof` the host `RegExp`, so `comptime(() => /ab+/g)` also becomes `{}`. (d) A JSON key `"__proto__"` (include.ts parses JSON) is emitted as `{ __proto__: {...} }`, which sets the prototype instead of creating an own property.
- Failure scenario: `comptime(() => 0/0)` → `-Infinity`. `comptime(() => new Map([[1,2]]))` → `{}`. `comptime(() => new Date(0))` → `{}`. All are silent and type-incorrect.
- Suggested fix: check `Number.isNaN` first and emit `NaN`, and emit `-0` as `-0`. Detect RegExp and Date with `Object.prototype.toString.call(v)`. Report an error for any object whose prototype isn't `Object.prototype`/`null`, unless explicitly supported (Map/Set can be emitted as `new Map([...])`). Emit `__proto__` as a computed key `["__proto__"]`. Add a cycle guard.
- Fix size: S

### 9. MacroGenerated suppression rule keeps the first project's closure for the life of the process (multi-project tsserver)
- Severity: medium
- Confidence: high (code reading; not repro'd)
- Location: packages/core/src/diagnostic-suppression.ts:76, 99-105 (`registerDiagnosticSuppressionRuleOnce` dedupes by name into a module-global array); producer packages/transformer/src/language-service.ts:298-311 (per-project `create()` closes over that project's `getMapper` and `getTransformResult`)
- Problem: tsserver loads the plugin module once (Node require cache) and calls the language-service `create()` once per project. The first project registers `MacroGenerated` with a `positionMapFn` bound to *its* pipeline and transform cache. Every later project's `registerAllDiagnosticSuppressionRules({positionMapFn})` is a no-op because of the "Once" dedupe. Project 2's diagnostics are then mapped through project 1's pipeline. `shouldTransform` misses → `IdentityPositionMapper.toOriginal(pos)` returns `pos` (position-mapping-core.ts:160), never `null`, so nothing is suppressed. The closure also keeps project 1's language service alive after that project closes, and a project reload keeps using the stale one.
- Failure scenario: a monorepo with two tsconfigs open in VS Code. Spurious TS2304/2339/2451/6133 from macro-generated code show up in the second project only. If project 1 has the same file name in its pipeline (shared sources), positions are mapped with the wrong file's mapper.
- Suggested fix: don't capture per-project state in a global rule. Either pass the mapper through `filterDiagnostics(..., { positionMapFn })` and the rule's `shouldSuppress` args, or make the registry per program or per language service (for example, a `WeakMap<ts.Program, rules[]>`). At minimum, have "Once" replace the existing rule instead of keeping it.
- Fix size: M

### 10. The type-rewrite registry is keyed by bare type name, so any unrelated type named like a registered @opaque type gets its methods rewritten
- Severity: medium
- Confidence: high (code reading of registry plus consumer)
- Location: packages/core/src/type-rewrite-registry.ts:161-171 (`byName.set(entry.typeName, …)`, last wins), 220-233 (`findTypeRewrite`), consumer packages/transformer-core/src/rewriting.ts:553-566 (`resolveTypeRewriteName` matches `typeToString` / `symbol.name`) and 640-652 (no check that the type's declaration comes from `entry.sourceModule`)
- Problem: the registry is process-global and name-keyed. Once fp's `Option` is registered (any file in the program imports @typesugar/fp, or .d.ts discovery runs), *every* type whose symbol is named `Option` qualifies for method erasure. That includes a user `class Option` (CLI/UI "option" classes are common), a third-party `Option`, or a second user `@opaque Option` in another package. A call to any method in the registered table (`map`, `filter`, `contains`, `match`, `toArray`, `zip`, …) is rewritten into fp's standalone function, with an injected import. Two @opaque types with the same name in different modules silently overwrite each other in `byName`, although `byModule` keeps both.
- Failure scenario: `class Option { constructor(public values: string[]) {} contains(v: string) { … } }` in an app that also uses @typesugar/fp. `opt.contains("x")` is rewritten to `contains(opt, "x")` imported from `@typesugar/fp/data/option`, which gives wrong results at runtime with no diagnostic.
- Suggested fix: key entries by `(sourceModule or declaration file, typeName)`. In the consumer, require that the receiver type's symbol declaration resolves to the entry's source module or .d.ts. Store the declaration `fileName` at registration and compare it against `type.symbol.declarations[0].getSourceFile().fileName`.
- Fix size: M

### 11. `parseStatements` never checks parse errors, and `parseExpression` silently drops everything after the first comma or statement
- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/context.ts:120-148 (`parseExpression`), 150-161 (`parseStatements`)
- Problem: `parseStatements` returns whatever the error-recovering parser produced. Broken generated code is emitted as broken JS, with no diagnostic pointing at the macro. `parseExpression` wraps the input as `const __expr__ = ${code};` and returns `declarations[0].initializer`, so `a, b` parses as two declarators and `x; sideEffect()` as two statements. No parse diagnostic fires and the tail is silently dropped. These are the primitives behind every CLAUDE.md-listed string-codegen site, and behind about 20 *unlisted* ones (see cross-scope leads). User-defined `syntax-macro.ts` macros also feed user strings through them.
- Failure scenario: `parseExpression("a, b")` → `a`. `parseExpression("x; sideEffect()")` → `x`. `parseStatements("const x = ;\nif (y {")` → prints `const x = ; if (y) { }` and does not throw.
- Suggested fix: `parseExpression`: wrap as `(${code})`, and require exactly one statement with exactly one declarator and no parse diagnostics. `parseStatements`: check `parseDiagnostics` and throw the same `Failed to parse` error, so the transformer's catch turns it into a visible macro diagnostic.
- Fix size: S

### 12. `comptime(<simple expr>)` that evaluates to a negative number crashes with a TS Debug Failure
- Severity: medium
- Confidence: confirmed (unit repro)
- Location: packages/core/src/context.ts:996-1000 (`comptimeValueToExpression` number branch), caller packages/macros/src/comptime.ts:382-387 (lightweight evaluator path for non-function arguments)
- Problem: `factory.createNumericLiteral(-1)` asserts ("Negative numbers should be created in combination with createPrefixUnaryExpression"). `NaN` and `Infinity` are emitted as numeric literals with text `NaN`/`Infinity` (they print, but are not literals). `ast-utils.jsValueToExpression` already handles negatives correctly, while this sibling doesn't.
- Failure scenario: `comptime(1 - 2)` or `comptime(-LIMIT)` → `Debug Failure. False expression: Negative numbers should be created in combination with createPrefixUnaryExpression`, which surfaces as an internal error instead of `-1`.
- Suggested fix: delegate the number, bigint and null cases to `jsValueToExpression` (after fixing #8), or add `value < 0 || Object.is(value, -0)` → `createPrefixUnaryExpression(MinusToken, …)` plus NaN/Infinity identifiers.
- Fix size: S

### 13. The hard-coded import-suggestion table tells users to import symbols that don't exist
- Severity: medium
- Confidence: confirmed (checked each entry against the package dist runtime keys and .d.ts)
- Location: packages/core/src/import-suggestions.ts:72-437 (`defaultExports`). Consumers: packages/macros/src/typeclass.ts:2526-2528 (TS9001 "Add: import …" help), macros/src/implicits.ts:524, transformer-core/src/macro-helpers.ts:614 (unknown derive)
- Problem: these entries name modules that don't export the symbol. `Show` and `Default` from `@typesugar/std` (std has `Printable` and `Defaultable` instead). `Traversable`, `Result`, `Ok`, `Err` from `@typesugar/fp`. `match`, `impl`, `quote`, `Option`, `Some`, `None`, `Either`, `Result`, `Show` from `typesugar`. TS9001, the most common resolution error, appends `Add: import { Show } from "@typesugar/std";`, and following that advice produces TS2305.
- Failure scenario: `summon<Show<Point>>()` with no instance → help text says `Add: import { Show } from "@typesugar/std";` → the user adds it → "Module '@typesugar/std' has no exported member 'Show'".
- Suggested fix: generate the table from package manifests or exports at build time (or validate it in a test that imports each package's dist). Short term, fix the wrong rows.
- Fix size: S (fix rows) / M (generate)

### 14. `tryShortName` doesn't check what its contract promises (parameters and nested scopes), so short temp names can capture user locals
- Severity: low
- Confidence: confirmed (unit repro of the name check); capture scenario from code reading
- Location: packages/core/src/context.ts:935-981; contract in packages/core/src/types.ts:138-146 ("imports, top-level declarations, parameter names"); callers packages/std/src/macros/match.ts:843 (`_<scrutinee>`/`_m`), 1974 (`_r`), 2046 (`_ext`)
- Problem: `nameConflictsWithScope` scans only top-level statements. It also misses destructured top-level names, `namespace`/`module`, and `import X = require`. A user parameter or local `_x`, `_r` or `_m` is not detected, so `match`'s generated temp of the same name can shadow it inside an arm body.
- Failure scenario: `tryShortName("_x")` in `function f(_x: number) {…}` returns `_x` (repro). If match lowers with a temp (non-identifier scrutinee, regex arm, or switch with ≥7 arms) and an arm body references the user's `_r`/`_m`, it reads the temp instead.
- Suggested fix: share the "all bindings anywhere in file" set from #1 and treat any hit as a conflict.
- Fix size: S

### 15. `ExpansionTracker.generateSourceMap` describes a different text from the code `transformCode` returns
- Severity: low
- Confidence: high (code reading)
- Location: packages/core/src/source-map.ts:130-176 (map built by MagicString over the original text with only the call sites replaced), consumer packages/transformer-core/src/transform.ts:265-276 (returns `printer.printFile(...)` output but pairs it with that map and builds `createPositionMapper(sourceMap, code, transformedCode)` from it)
- Problem: the printer reformats the whole file (drops blank lines, normalizes quotes and indentation), so line/column mappings in the returned `sourceMap` and mapper are wrong outside trivial inputs. The map is only valid for `generateExpandedCode()` output. The only consumer is the playground (packages/playground/src/index.ts:100-118), which caches and serves this map.
- Failure scenario: a file with blank lines or comments before a macro call → playground/IDE position mapping points to the wrong line in the expanded output.
- Suggested fix: in transformer-core `transformCode`, either return `generateExpandedCode()` as the code or generate the map from the printer (`ts.createPrinter` with a source-map writer, or the pipeline's approach). Document on `generateSourceMap` that it pairs only with `generateExpandedCode`.
- Fix size: S

### 16. The compile-time evaluator (used to *elide contract checks*) has JS-semantics bugs
- Severity: low
- Confidence: confirmed (unit repro for NaN)
- Location: packages/core/src/context.ts:869-886 (`comptimeToBoolean`), 571-613 (arrow functions use dynamic scope via `this.scope`), 899-913 (`comptimeToString` arrays and objects). Consumers: packages/contracts/src/macros/requires.ts:67-71 and prover/index.ts:202-205, which drop the runtime check when the result is `true`.
- Problem: `NaN` is treated as truthy (`value !== 0`), so `!(0/0)` → `false` while JS gives `true`. Arrow closures are evaluated with whatever `this.scope` holds at *call* time, not definition time, so a curried closure called later reads the wrong binding. Template and `+` stringification of arrays and objects produces `[1, 2]` / `{ a: 1 }`, while JS produces `1,2` / `[object Object]`. `isComptime` gates contracts tightly (no calls or property access), so the practical blast radius is small, but a wrong `true` removes a runtime precondition.
- Failure scenario: `ev("!(0/0)")` → `{kind:"boolean", value:false}` (JS: true).
- Suggested fix: use `!Number.isNaN(v) && v !== 0`. Capture `new Map(this.scope)` when the arrow is created and evaluate its body against that. Use JS `String()` semantics for arrays and objects, or return an error.
- Fix size: S

### 17. Diagnostic message interpolation treats `$` patterns in arguments as regex replacement tokens
- Severity: low
- Confidence: confirmed (unit repro)
- Location: packages/core/src/diagnostics.ts:251-256
- Problem: `message.replace(regex, value)` interprets `$&`, `` $` ``, `$'` and `$$` inside type names or text passed via `withArgs`. Values are also substituted sequentially, so a value containing `{type}` is substituted again.
- Failure scenario: `withArgs({ type: "Foo$&Bar" })` → "No instance found for `Eq<Foo{type}Bar>`". Template-literal types like `` `${string}$` `` are similarly mangled.
- Suggested fix: do a single pass, `template.replace(/\{(\w+)\}/g, (m, k) => args[k] ?? m)`.
- Fix size: S

### 18. Type-string utilities treat the `>` of `=>` as a closing bracket
- Severity: low
- Confidence: confirmed (unit repro)
- Location: packages/core/src/type-string-utils.ts:65-80, 113-123; consumers macros/src/hkt.ts:96-101, diagnostic-suppression-rules.ts:966-969, instance-scanner.ts:374,453
- Problem: function types in type arguments break bracket matching.
- Failure scenario: `extractTypeArgumentsContent("Option<(x: number) => string>")` → `"(x: number) ="`. `parseTypeInstantiation("Eq<() => void>")` → `args: "() ="`. `splitTopLevelTypeArgs("(a: A) => B, C")` → one part.
- Suggested fix: skip `>` when the previous character is `=`, and track `(`/`[`/`{` depth when splitting on commas.
- Fix size: S

### 19. The `isSyntheticNode` predicate misses synthesized nodes that were given a real text range; `MacroContextImpl` checker wrappers don't use it
- Severity: low
- Confidence: confirmed (unit repro)
- Location: packages/core/src/ast-utils.ts:128-130; packages/core/src/context.ts:167-218 (`getTypeOf`, `getTypeString`, `getSymbol`, `assertTypeReliable`); example producer transformer-core/src/macro-helpers.ts:259-277 (`createSyntheticDecorator` does `ts.setTextRange(decorator, tag)`)
- Problem: CLAUDE.md names `isSyntheticNode` as *the* guard. It checks only `pos/end === -1`. A factory node with a copied range (JSDoc-derived decorators) returns `false`, and `node.getText()` then throws (repro: "Cannot read properties of undefined (reading 'text')"). Current callers survive only because they also wrap the call in try/catch. Separately, the context's checker wrappers call the checker without any synthetic check. On a synthetic node, `assertTypeReliable` reports the misleading "the type of 'foo.bar' could not be resolved. Fix upstream type errors first." (repro), even when there are no type errors.
- Suggested fix: `return node.pos < 0 || node.end < 0 || (!ts.isParseTreeNode(node) && !ts.getParseTreeNode(node))`, or check `node.flags & NodeFlags.Synthesized` without a parent. In `assertTypeReliable`, skip or word the warning differently for synthetic nodes.
- Fix size: S

### 20. `renderDiagnosticCLI` ignores its `colors` option and crashes on a synthetic primary span
- Severity: low
- Confidence: confirmed (code reading; `colors` is never read)
- Location: packages/core/src/diagnostics.ts:1563-1571 (`colors?` documented), 1489-1502 (`color()` reads env only), 1609 and 1615-1616 (`node.getStart()` without a source file)
- Problem: `{colors:false}` still emits ANSI codes. A diagnostic built with `.at(syntheticNode)` throws inside the renderer. This is exported public API with no in-repo caller.
- Suggested fix: thread `options.colors` into `color()`. Use `node.getStart(sourceFile)` and skip spans when `isSyntheticNode`.
- Fix size: S

### 21. A suppression rule that throws is skipped with no visible trace (outside audit mode)
- Severity: low
- Confidence: high (code reading)
- Location: packages/core/src/diagnostic-suppression.ts:193-200
- Problem: this violates CLAUDE.md's "a caught exception with no visible trace is worse". A buggy rule (for example, a checker call on a synthetic node) silently stops suppressing, and the user sees false TS errors with no hint why.
- Suggested fix: log once per rule name, unconditionally (`console.warn` or the LSP log), and keep the detailed log for audit mode.
- Fix size: S

## 1.0 gaps
- `ResolutionTracer` / `globalResolutionTracer` (resolution-trace.ts:73-276, 503) are exported with inlay-hint, hover and CLI formatting APIs, plus a `tracing` config key, but nothing in the repo ever calls `record()`. The feature is dead. Wire it up, or remove it or mark it experimental.
- test-helpers.ts documents `import … from "@typesugar/core/test-helpers"`, but package.json exports only `"."` and index.ts doesn't re-export it. The doc also says the helpers "save and restore" registry state, but they only clear it, which wipes rules registered by module side effects.
- Process-global singletons with no per-program isolation: `globalHygiene`, `globalExpansionTracker`, `globalResolutionScope`, the diagnostic-suppression rule list, the type-rewrite registry, the syntax-marker fallback and the import-suggestion index. This is unsafe for multi-project tsserver and for long-lived watch processes (see #9 and #10). Either document a supported isolation story for 1.0 or scope them per program.
- `MacroContext.evaluate()` / `ComptimeValue` is public API (docs/architecture.md:273). The `"type"` kind is never produced, and the evaluator's limits (no calls except `comptime`, NaN, closure semantics) are undocumented. Mark it experimental or document it.
- The inline opt-out semantics (same line only, feature vs bare form, `-all`) are not specified in API docs. tests/red-team-transformer.test.ts:230-241 has empty opt-out test bodies that pass vacuously.
- The import-suggestion data is a hand-maintained static table (#13) and will drift. 1.0 needs it generated from manifests, or validated in CI.

## Cross-scope leads (outside core-B; verified enough to hand off)
- packages/macros/src/comptime.ts:560-600: the vm sandbox exposes host `Object`, `Function` (via `Object.constructor`) and the other host constructors. `Object.constructor("return process")()` returns the **real** `process` (repro'd with `vm.createContext({Object})`), which bypasses the permission-checked `fs`/`process`/`require` wrappers. vm is not a security boundary, so any "permissions" claim for comptime is void.
- CLAUDE.md's "exhaustive" `parseStatements`/`parseExpression` exception list is missing these real `ctx.parse*` call sites: contracts/src/macros/laws.ts:153,202; codec/src/macros.ts:282; effect/src/derive/hash.ts:97,136, equal.ts:85,122, schema.ts:228,265; sql/src/derive-typeclasses.ts:300,436; parser/src/macros.ts:96; testing/src/macro.ts:210,359,490,709,948,1224,1327. Combined with #11 (no parse-error check), malformed generated code from these sites is emitted silently.
- packages/transformer-core/src/transformer.ts:797-811: hygiene pending imports and hoisted specializations are inserted after the leading run of `ImportDeclaration`s, starting at index 0 when the file begins with a directive. In a `"use client"` / `"use strict"` file without imports first, they land **before** the directive prologue, so the directive stops being a directive (this breaks React Server Components `"use client"`). core's `generateImportFix` (import-suggestions.ts:759-793) has the same directive problem.
