# Findings: fusion, mapper, graph (libs group, part fmg)

Repro scripts: /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/fmg/
(`e2e.mjs` runs `transformCode` from packages/transformer/dist on a virtual file; `mapper.mjs` drives the mapper macro through `createMacroContext` the way `tests/mapper-expansion.test.ts` does; `fuse.mjs` expands `fused()` and evaluates the output against the unfused expression.)

### 1. `stateMachine` macro emits an unbound `__typesugar_createStateMachineInstance` identifier, so `sm.create()` throws ReferenceError
- Severity: high
- Confidence: confirmed (repro'd end-to-end)
- Location: packages/graph/src/macros.ts:153-154
- Problem: the macro emits `factory.createIdentifier("__typesugar_createStateMachineInstance")` as a bare name. The user's file only imports `stateMachine`, and the transformer's import cleanup removes that specifier because it resolved to a macro. Nothing adds an import for the helper. The emitted `create` arrow refers to a name that is not defined anywhere in the output module.
- Failure scenario: `import { stateMachine } from "@typesugar/graph"; const sm = stateMachine\`@initial Idle ...\`; sm.create();`. `transformCode` output has no import line left at all, and `create: () => __typesugar_createStateMachineInstance({...})`. Calling it gives `ReferenceError: __typesugar_createStateMachineInstance is not defined`. The documented main use (`sm.create()`) is broken whenever the macro runs. The macro has no tests, so nothing catches this.
- Suggested fix: use `ctx.ensureImport("__typesugar_createStateMachineInstance", "@typesugar/graph")` (core context.ts:988) or `ctx.safeRef(...)` in place of the bare identifier. Add one expansion test that runs the output.
- Fix size: S

### 2. `transformInto` / `transformArrayInto` never check that field types are compatible: mismatched or optional-to-required fields are copied without a diagnostic
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:392-399 (and every other `createPropertyAssignment` path in `buildObjectLiteral`)
- Problem: the macro matches fields by name only. It never compares `getTypeOfSymbol(fromProp)` with the target property type. The original call type-checks because its signature is `transformInto<From, To>(source: From, …): To`, so nothing else catches the mismatch, and the replacement object literal is never re-checked.
- Failure scenario: `interface S { id: string } interface D { id: number }`. `transformInto<S, D>(s)` expands to `{ id: s.id }` with zero diagnostics, and `D.id` holds a string at runtime. The same happens for `S { a?: number }` to `D { a: number }` (`transformArrayInto` gives `s.map(i => ({ a: i.a }))`, with no error and `undefined` in a required field). This defeats the point of a "type-safe" mapper (the README advertises Chimney/AutoMapper parity).
- Suggested fix: for each copied, renamed or renamePaths field, call `checker.isTypeAssignableTo(sourceFieldType, targetFieldType)` (exposed on the checker since TS 5.x, or via `ctx.isAssignableTo` if core has it) and `reportError` on failure. For nested or collection fields, recurse as today.
- Fix size: M

### 3. `fused()` changes callback semantics: drops the index and array arguments, re-evaluates the callback expression per element, and rebinds `this`
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/fusion/src/macros.ts:272, 287, 354, 482, 503, 520, 535 (every `createCallExpression(step.fn, undefined, [currentValue])`)
- Problem: `fused(arr.map(f)…)` is documented as a fusion of plain array chains (macros.ts:592-609). Array callbacks receive `(value, index, array)` (and reduce receives `(acc, value, index, array)`), but the fused loop passes only `value`. Also, `step.fn` is placed verbatim as the callee inside the loop body, so a non-literal callback expression is evaluated once per element, and a member expression is called with the object as `this`.
- Failure scenario (from `fuse.mjs`, `arr = [1,2,3]`):
  - `fused(arr.map((x, i) => x * i).reduce((a, b) => a + b, 0))` returns `NaN`; unfused gives `8`.
  - `fused(arr.reduce((a, b, i) => a + b * i, 0))` returns `NaN`; unfused gives `8`.
  - `fused(arr.map(parseInt).toArray())` returns `[1,2,3]`; plain `arr.map(parseInt)` gives `[1,NaN,NaN]`.
  - `fused(arr.map(makeMapper())…)` calls `makeMapper()` N times. `arr.map(obj.m)` now runs with `this === obj`.
- Suggested fix: hoist each callback into a `const __fN = <fn>` in the IIFE preamble, keep a loop index (`let __i = 0`, using `for (let i = 0; i < src.length; i++)` when the source is an array), and call `__fN(v, __i, src)`. Alternatively, refuse to fuse (pass through) when a callback literal declares more than one parameter. Note that for map-after-filter the "index" that Array semantics would see is the index in the intermediate array, so each stage needs its own counter.
- Fix size: M

### 4. Mapper and fusion move user expressions into a non-async arrow IIFE: `await` / `yield` in the source becomes a SyntaxError
- Severity: medium
- Confidence: confirmed (mapper, repro'd end-to-end); high (fusion, same construction)
- Location: packages/mapper/src/macros.ts:123-157; packages/fusion/src/macros.ts:568-600 (`wrapInIIFE`, which also moves `take` counts and the `reduce` init into the IIFE preamble)
- Problem: when the source is not an identifier or literal, mapper binds it to a temp inside `(() => { const src = <expr>; return {...}; })()`. Fusion always places the source, init and take-count expressions inside such an arrow. An `await` or `yield` in those expressions ends up inside a non-async, non-generator arrow.
- Failure scenario: `async function f() { return transformInto<S, D>(await get()); }` expands to `(() => { const __typesugar_src_s0_0__ = await get(); … })()`, which Node reports as `SyntaxError: Unexpected reserved word`. `fused((await load()).map(f).toArray())` breaks the same way.
- Suggested fix: hoist the temp out of the arrow (`ctx.hoistVariable` / emit a comma expression `(__src = <expr>, { … })` with a hoisted `let`). Alternatively, when the expression contains `await` / `yield`, emit an `async` arrow and `await` it, or skip the expansion with a diagnostic.
- Fix size: S-M

### 5. `stateMachine` macro inlines an interpolated identifier's NAME as DSL text, producing a wrong machine
- Severity: medium
- Confidence: confirmed (repro'd end-to-end)
- Location: packages/graph/src/macros.ts:48 and 56-57
- Problem: the "static span" test is `"text" in span.expression`. `ts.Identifier` has a `text` getter on its prototype, so `in` is true for identifiers, and the identifier's name gets concatenated into the template text in place of its value.
- Failure scenario: `const IDLE = "Idle"; stateMachine\`@initial ${IDLE}\n ${IDLE} --start--> Done\``. The compiled output has `states: ["IDLE","Done"], initial: "IDLE"`, while the runtime `stateMachine` tag (templates.ts) would produce `"Idle"`. Any `inst.current === IDLE` check is then false. The macro also "verifies" the wrong machine.
- Suggested fix: treat a span as static only for `ts.isStringLiteral || ts.isNoSubstitutionTemplateLiteral || ts.isNumericLiteral`. Otherwise fall back to the runtime path (return `node`), or resolve `const` initializers via the checker (guarded with `isSyntheticNode`).
- Fix size: S

### 6. Mapper: an optional/nullable nested source object silently maps to `{}` (data and renames dropped, no error)
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:317-340 (and the plain recursive `buildObjectLiteral` call with a union type)
- Problem: for `address?: SA`, `getTypeOfSymbol` returns `SA | undefined`. `getPropertiesOfType` on that union returns no properties, so the nested literal is empty and no "Cannot map field" error fires. It also never guards `undefined`.
- Failure scenario: `S { address?: { city: string } }` to `D { address?: { location: string } }` with `nested: { address: { rename: { location: "city" } } }` yields `{ address: {} }` with no diagnostic. The city value is lost, and when `s.address` is undefined the output still contains `{}`.
- Suggested fix: strip nullability with `checker.getNonNullableType` before reading properties. Emit `src.x == null ? src.x : { … }` when the source field is optional. Report an error when a non-empty target type yields zero mapped properties.
- Fix size: S-M

### 7. Mapper silently ignores config it cannot parse syntactically: renames and computes are dropped and a same-named field is copied instead
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:562-564, 567, 572, 581
- Problem: `parseConfig` only understands an inline object literal with `PropertyAssignment` entries and string-literal rename values. Each of the following is dropped without a diagnostic: a config held in a variable (`transformInto<S,D>(s, cfg)`), `rename: { name: "fullName" as const }`, method-syntax compute (`compute: { label(x) {…} }`), shorthand (`compute: { label }`), spreads, and `ignore: { target: [...] as const }`. If the source also has a field with the target's name, the macro silently copies that one.
- Failure scenario: `S { name; fullName }` to `D { name }` with `rename: { name: "fullName" as const }` (or with the config in a `const cfg`) yields `{ name: s.name }`, which is the wrong value with no error. `compute: { label(x) { return x.first.toUpperCase(); } }` yields `{ label: s.label }`.
- Suggested fix: `reportError` on any non-literal config argument and on any config member or value shape that is not recognized. Accept `MethodDeclaration` / `ShorthandPropertyAssignment` for compute, and unwrap `AsExpression` / `SatisfiesExpression` around literals.
- Fix size: S

### 8. `LazyPipeline`: `take(n)` placed before `flatMap` truncates the flatMapped output
- Severity: medium
- Confidence: confirmed (repro'd against dist)
- Location: packages/fusion/src/lazy.ts:398-405 (the post-yield "any take counter hit zero, return" check)
- Problem: after every yield, `execute()` stops if any take counter is at zero. A take stage that appears before a flatMap reaches zero while the flatMap's remaining children are still on the `pending` stack, so they are discarded.
- Failure scenario: `lazy([1,2]).take(1).flatMap(x => [x, x]).toArray()` gives `[1]` (expected `[1,1]`). `lazy([1,2,3]).take(2).flatMap(x => [x,x,x]).toArray()` gives `[1,1,1,2]` (expected six elements).
- Suggested fix: only stop early when the zeroed take step is the last length-changing step, i.e. no flatMap after it. Simpler: in the take case, when the counter hits 0, set a "source exhausted" flag that stops pulling new `raw` items but still drains `pending`.
- Fix size: S

### 9. `dijkstra` / `dijkstraWith` / `dijkstraWithG` never traverse an undirected edge in its stored-reverse direction
- Severity: medium
- Confidence: confirmed (repro'd; 8959 disagreements with `shortestPath` in a 3000-graph fuzz)
- Location: packages/graph/src/generic-algorithms.ts:300-301 together with 319-325
- Problem: for undirected graphs `edgesFrom` also returns edges whose target is the current node, but the relaxation then uses `neighbor = WGL.edgeTarget(e)`, which is the current node itself. The other endpoint is never relaxed.
- Failure scenario: `createGraph(["A","B"], [["B","A"]])`. `dijkstra(g, "A", "B")` returns `null`, while `shortestPath(g, "A", "B")` returns `["A","B"]`.
- Suggested fix: in the loop, `const neighbor = eq.equals(WGL.edgeSource(e), minNode) ? WGL.edgeTarget(e) : WGL.edgeSource(e);`.
- Fix size: S

### 10. `hasCycles` / `isDAG` / `topoSort` / `detectCycles` give wrong answers on undirected graphs
- Severity: medium
- Confidence: confirmed (repro'd; 139 mismatches against a union-find oracle in the fuzz)
- Location: packages/graph/src/generic-algorithms.ts:17-55 (Kahn counts in-degree from `edgeTarget` only, but `successors` is bidirectional for undirected graphs); packages/graph/src/algorithms.ts:65-117
- Problem: the `Graph` type supports `directed: false` and these functions accept it, but the directed algorithms are applied to it unchanged.
- Failure scenario: undirected 4-cycle `n2-n5, n4-n5, n3-n4, n2-n3` gives `hasCycles` = `false`. `detectCycles(createGraph(["A","B"], [["A","B"]]))` returns `[["A","B"]]`, reporting every single edge as a cycle.
- Suggested fix: for `!isDirected`, use union-find / DFS with parent-edge tracking for `hasCycles`, and make `topoSort` / `isDAG` / `detectCycles` reject undirected input or document them as directed-only.
- Fix size: S-M

### 11. `fused()` turns non-array receivers into a for-of that throws at runtime; `find` returns `null` instead of `undefined`
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/fusion/src/macros.ts:123-161 (purely syntactic chain parse, no receiver type check), 497
- Problem: the terminals `toArray/sum/count/first/last` and the intermediate `take` exist on `LazyPipeline`, not on `Array`. The natural spelling `fused(lazy(arr).map(f).toArray())` therefore parses, but then emits `for (const x of lazy(arr))`. `LazyPipeline` has no `[Symbol.iterator]`, so this throws `TypeError: … is not iterable`. Any other receiver with `.map/.filter/.reduce` (RxJS, Immutable, user classes) is rewritten the same way. For real arrays, `fused(arr.find(p))` returns `null` where `arr.find(p)` returns `undefined`.
- Suggested fix: check the receiver type (array or tuple, via the checker, guarded by `isSyntheticNode`) and pass through otherwise, or explicitly unwrap a root `lazy(x)` call to `x`. Return `undefined` from array-chain `find`/`first`/`last`.
- Fix size: S-M

### 12. Mapper `renamePaths`: deeper paths are ignored and unmatched nested target fields are silently omitted
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:457-461, 466-488
- Problem: only `targetSubPath.length === 1` entries are honoured. Any field of the nested target that is neither renamed nor present on the nested source is skipped without an error.
- Failure scenario: `renamePaths: { "a.b.c": "a.b.x" }` yields `{ a: { b: s.a.b } }`, with the rename silently lost. Target `address: { location; zip }` with source `address: { city }` and `renamePaths: { "address.location": "address.city" }` yields `{ address: { location: s.address.city } }`: required `zip` is missing and no diagnostic is reported.
- Suggested fix: recurse for longer sub-paths, and `reportError` for unmapped nested target fields, matching the top-level behaviour at line 402.
- Fix size: S-M

### 13. Recursive DFS / Tarjan / Johnson overflow the stack on graphs with about 10k+ nodes in a chain
- Severity: low
- Confidence: confirmed (repro'd: `sccG` and `dfsG` on a 20,000-node chain throw `RangeError: Maximum call stack size exceeded`)
- Location: packages/graph/src/generic-algorithms.ts:169-178, 341-367; packages/graph/src/algorithms.ts:84-108
- Problem: recursion depth equals path length. (`findOneCycleG` is already iterative, so the pattern exists in the file.)
- Suggested fix: iterative versions with an explicit stack.
- Fix size: M

### 14. `fused()` with `take` pulls one extra source element and runs upstream side effects on it
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/fusion/src/macros.ts:293-315
- Problem: the counter is checked on the next element, after the upstream maps have already run on it. The runtime `LazyPipeline` avoids this with its post-yield check.
- Failure scenario: `fused(gen().map(log).take(2).toArray())` pulls 3 elements from the generator and logs `[0,1,2]`. On a blocking or expensive iterator this is one extra unit of work, or a hang.
- Suggested fix: after the take decrement, emit `if (__take === 0) { <terminal action>; break; }` (or a post-terminal `if (__take <= 0) break;`).
- Fix size: S

### 15. `verify()` (run at compile time by the `stateMachine` macro) enumerates every elementary cycle even though `valid` does not use them
- Severity: low
- Confidence: high (measured growth: 7/8/9 fully connected states give 2,365 / 16,064 / 125,664 cycles; growth is about 8x per state, so 11-12 states means about 10^7 to 10^8 arrays, i.e. an OOM or hang during the build)
- Location: packages/graph/src/state-machine.ts:46-47
- Problem: Johnson's output size is exponential, and a machine with a "reset/cancel from every state" pattern is common.
- Suggested fix: compute cycles lazily or with a cap (or report SCCs), and skip them in the macro path.
- Fix size: S

### 16. Minor correctness and documentation mismatches (each verified)
- Severity: low
- Confidence: confirmed
- Location / Problem:
  - packages/fusion/src/lazy.ts:83: the `scan` doc says it emits `init` first. The implementation does not: `lazy([1,2,3]).scan((a,b)=>a+b,0)` gives `[1,3,6]`.
  - packages/graph/src/algorithms.ts:234: `transitiveClosure` deletes `u→u` even when `u` lies on a cycle (`A⇄B` gives no `A→A`), contradicting its own "iff v is reachable from u" doc.
  - packages/graph/src/dsl.ts:48-52: `a -> b [x, y]` is split on the comma before label parsing, which creates nodes `"b [x"` and `"y]"`. `a -> b -> c` creates a node named `"b -> c"`. Both happen silently, with no SyntaxError.
  - packages/fusion/src/macros.ts:216: `fusionCounter` is module-global and never reset by the transformer. Generated names depend on how many `fused()` calls the process has expanded before, so builds are not reproducible across watch rebuilds or cache states.
- Suggested fix: fix the doc or the code in each case; throw on a `->` inside targets and on unbalanced `[`; key the counter per file (or use `ctx.generateUniqueName`).
- Fix size: S

## 1.0 gaps

- fusion: `fused` is not exported (no runtime stub and no type declaration) from the `.` entry, so `import { fused } from "@typesugar/fusion"` is a TS error in user code. The Phase 2 macro is effectively unreachable from typed code.
- fusion: status claims contradict each other. The README says "Phase 2 will add compile-time macro analysis"; index.ts and macros.ts say "Phase 2 (implemented)"; index.ts also claims Functor/Filterable/Foldable are "registered with the global typeclass registry", but nothing registers them.
- fusion: `fused-macro.test.ts` only string-matches the printed output and never executes it. That is how findings 3, 11 and 14 went unnoticed.
- fusion: the `fused()` macro supports only map, filter and take as intermediates, while `LazyPipeline` has 10 step types; there is no diagnostic when a chain falls back to pass-through.
- mapper: api.ts JSDoc marks `nested`, `renamePaths` and `collections` as "@experimental — currently ignored by the macro", but they are implemented (partially). `ignore.source` is parsed but there is no unused-source check for it to suppress.
- mapper: still a conditional Keep in PEP-048 (#9, re-triage 2026-12-10). Without field-type checking (finding 2) it should not be called type-safe at 1.0, and package.json/README carry no experimental marker.
- graph: the `stateMachine` docs (templates.ts:59-77) promise "type-safe state and event union types / instance.current is typed as 'Idle' | 'Running' | 'Done'". Nothing generates them (macros.ts:136-137 says "In a full implementation…"), and `create<S, E>()` defaults to `string`.
- graph: the `stateMachine` macro has zero tests (graph tests cover only the runtime), which hid findings 1 and 5.
- graph: every algorithm goes through `graphLike.successors`, which scans all edges per call, so BFS, DFS, topoSort and SCC are O(V·E). Undirected semantics for the cycle and topo functions are unspecified.
- graph: verification checks only reachability, dead ends and nondeterminism. A trap cycle with no path to any terminal state passes as `valid: true`, and the docs say "verified".
- all three: version 0.1.1 with no stability/experimental marker in package.json or README, despite the gaps above.
