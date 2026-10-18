# Deep review findings: libs group

Scope: packages/math, units, sql, graph, fusion, mapper, parser, type-system (src). Read-only review on branch deep-review-1.0, 2026-10-18/19.

Totals: 1 critical, 16 high, 33 medium, 22 low (72 findings).

Each title carries a stable ID in brackets (MU = math/units, SQL = sql, FMG = fusion/mapper/graph, TSP = type-system/parser). Cross-references inside a section ("finding 3", "#12") refer to the number part of an ID with the same prefix, e.g. inside an SQL-\* section, "#12" means SQL-12.

Note: the sql reviewer could not get `sql`/`sql$` to expand in a transformCode harness; MU-1 (item 2) is the cause: imported expression macros used as tagged templates are never expanded. So SQL-2, SQL-4 and SQL-18 describe codegen that is latent today and will surface once MU-1 is fixed.

Repro scripts live next to this file in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/ (sql*.mjs, p1.cjs/p2.cjs, fmg/*.mjs, poly\*.cjs, bridge.mjs, units-macro.mjs, units/t.ts).

### 1. [SQL-1] [sql] `ConnectionIO.flatMap` is a stub that ignores `f`, so every monadic combinator returns `undefined`

- Severity: critical
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/connection-io.ts:158-165
- Problem: `flatMap(f)` returns `new ConnectionIO({ _tag: "Pure", value: undefined })` and never stores `f`. The `ConnectionOp` algebra has no FlatMap node, and `Transactor.interpret` has no case for one. `map`, `ap`, `zip`, `zipLeft`, `zipRight`, `chain`, `andThen`, `sequence`, `traverse`, `parZip`, `parSequence` and `unfold` are all built on `flatMap`, so all of them are broken. The source operation is also dropped and never runs.
- Failure scenario: `xa.run(ConnectionIO.pure(2).map(x => x*10))` gives `undefined`. `xa.run(ConnectionIO.execute(upd).map(n => n+1))` gives `undefined` and never calls `conn.execute` at all, so the write is silently lost. `sequence([pure(1), pure(2)])` gives `undefined`. The tests only check `toBeInstanceOf(ConnectionIO)`. `tests/sql-extended.test.ts:229` even documents "the stub flatMap returns Pure(undefined)".
- Suggested fix: add `{ _tag: "FlatMap"; source: ConnectionIO<unknown>; f: (a: unknown) => ConnectionIO<A> }` to `ConnectionOp`, have `flatMap` build it, and add `case "FlatMap": return this.interpret(op.f(await this.interpret(op.source, conn)), conn)`. Make it stack-safe with a loop or trampoline, because `sequence`/`unfold` build long chains.
- Fix size: M

### 2. [MU-1] [transformer-core, root cause for sql + units] An imported expression macro used as a tagged template never expands: the symbol cache is keyed by symbol only, not by macro kind

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/import-resolution.ts:490-497 (`symbolMacroCache` get/set keyed by `symbolId` alone), together with packages/transformer-core/src/rewriting.ts (tryExpandTaggedTemplate: first `resolveMacroFromSymbol(node.tag, tagName, "tagged-template")`, then `resolveMacroFromSymbol(node.tag, tagName, "expression")`)
- Problem: the first lookup, with kind "tagged-template", finds nothing and caches `null` for the tag's symbol. The second lookup, with kind "expression", hits that cached `null` and returns undefined. So any expression macro used as a tag (`sql`, `sql$`, `units`) never expands when the user imports it, which is the normal usage. It does expand when the identifier has no symbol, because that path skips the cache.
- Failure scenario: `import { units } from "@typesugar/units"; units\`100 km/h\``stays as`units\`100 km/h\``. Without the import it becomes `kilometersPerHour(100)`. `import { sql } from "@typesugar/sql"; sql\`SELECT ... ${id}\``is likewise never expanded, so sql's compile-time validation never runs and the runtime tag is always used. This is why the sql reviewer could not get`sql` to expand. Note that fixing this exposes the latent bare-identifier bugs in sql (sql finding "Macro output references runtime identifiers it never imports") and units (next finding): they are masked today only because the macros never run.
- Suggested fix: key the cache by `${symbolId}:${kind}`. Add a test that imports an expression macro from a package and uses it as a tag.
- Fix size: S

### 3. [MU-2] [units] `Unit<D>` never uses `D` structurally, so there is no compile-time dimension checking at all

- Severity: high
- Confidence: confirmed (tsc 5.9.3 --strict on a 10-line file)
- Location: packages/units/src/types.ts:309-407 (class `Unit<D>` has no member of type `D`)
- Problem: `Unit` declares only `value: number` and `symbol: string`. `D` appears only in method signatures, which are bivariant, so all `Unit<…>` instantiations are mutually assignable. This is the package's headline claim (README line 7, docs/guides/units.md:48/55/109 "✗ Compile error"), and the root README showcases it.
- Failure scenario: `const a: Unit<Mass> = meters(5);`, `meters(1).add(seconds(1))`, and `const c: Unit<Length> = meters(1).mul(meters(1))` all compile with zero errors. A sanity line `const s: number = "x"` in the same file does error, so tsc was checking.
- Suggested fix: add a phantom member such as `declare readonly __dims: D;` (or `private readonly _dims?: D`) to `Unit`, then add `@ts-expect-error` type tests for the three cases above. Expect fallout: `AddMap` saturates at ±5 (see the low finding below), and `mul()`/`div()` results will become strictly checked.
- Fix size: S (plus test fallout)

### 4. [MU-3] [units] The `units` macro emits bare constructor identifiers, and the transformer strips the `units` import, so the expanded code throws ReferenceError

- Severity: high
- Confidence: confirmed (call form repro'd via transformCode; the tagged form is masked by finding 1)
- Location: packages/units/src/macros.ts:94-96, 133-135 (`factory.createIdentifier(fnName)`)
- Problem: the macro emits `kilometersPerHour(100)` as a free identifier. The user imported only `units` (README quick start), and the import cleanup removes that specifier because it resolved to a macro, so nothing binds `kilometersPerHour`. The bare name can also capture a user's local `meters` variable. `ctx.safeRef` / `ctx.ensureImport` (core/src/context.ts:984-989) exist for exactly this.
- Failure scenario: `import { units } from "@typesugar/units"; export const s = units("100 km/h");` transforms to `export const s = kilometersPerHour(100);` with the import line gone, which gives ReferenceError at load. In `function f(){ const meters = 42; return units\`5 m\`; }`the expansion would call the local`meters` once the tagged path works.
- Suggested fix: `ctx.safeRef(fnName, "@typesugar/units")`. Add an expansion test that runs the output; today only the runtime fallback is tested (tests/red-team-units.test.ts, packages/units/tests/units.test.ts).
- Fix size: S

### 5. [MU-4] [math] HALF_CEIL rounds negative values the wrong way, by up to 2 units, in all three rounding implementations

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/rounding.ts (roundBigInt `case "HALF_CEIL"`: `if (moreThanHalf || (isExactlyHalf && !negative)) quotient += 1n; else if (moreThanHalf && negative) …` makes the else branch dead); rounding.ts roundNumber `case "HALF_CEIL"` (`fracPart <= -0.5` returns `intPart`); packages/math/src/types/fixed-decimal.ts:401-405 (fixedDiv, same as roundBigInt)
- Problem: for a negative value with more than half a unit of remainder, the code adds +1 to the truncated quotient instead of -1. In roundNumber it returns the truncated value.
- Failure scenario: `roundBigInt(-27n, 0, 1, "HALF_CEIL")` gives `-1n` (expected -3). `fixedDiv(-27n, 10n, 0, "HALF_CEIL")` gives `-1n`. `roundNumber(-2.7, 0, "HALF_CEIL")` gives `-2`. Every Money/FixedDecimal operation that takes a mode (fixedMul, fixedRound, moneyScale, moneyFromMajor, moneyConvert, …) inherits this. No test covers HALF_CEIL.
- Suggested fix: in the bigint versions, `if (moreThanHalf) quotient += negative ? -1n : 1n; else if (isExactlyHalf && !negative) quotient += 1n;`. In roundNumber, `fracPart < -0.5` should return `intPart - 1`. Add a table test of all 8 modes against ±2.3/±2.5/±2.7.
- Fix size: S

### 6. [MU-5] [math] `rationalToFixed` returns a value 10^10 times too large

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/conversions.ts:71-82
- Problem: the function computes `scaled = num * 10^(scale+10) / den` and then calls `fixed(scaled, scale, mode)`. But `fixed()` with a bigint argument "assumes already scaled" and returns it unchanged, so the 10 guard digits are never rounded away.
- Failure scenario: `fixedToString(rationalToFixed(rational(1n,3n), 2), 2)` gives `"3333333333.33"` (expected `"0.33"`). The conversions module has no tests.
- Suggested fix: `return roundBigInt(scaled, scale, extraScale, mode) as FixedDecimal<N>`. Better, round exactly from num/den with a remainder instead of using guard digits.
- Fix size: S

### 7. [MU-6] [math] `divPoly` / `gcdPoly` loop forever for non-number coefficients (Rational, Complex, …) and return a wrong quotient for float coefficients

- Severity: high
- Confidence: confirmed (repro'd: the Rational case was still running after 4 s and was killed; the float case returned quotient `-1.265e-320` instead of `0.125`)
- Location: packages/math/src/types/polynomial.ts `isZeroCoeff` (only `number`/`bigint` count as zero; `isZeroCoeffWith` is defined but unused), `polynomial()` trimming, and the `divPoly` loop
- Problem: termination depends on `subPoly` producing an exact zero leading coefficient that `polynomial()` then trims. For object coefficients nothing is ever trimmed, so `degree(remainder)` never drops. For floats, the cancellation `leadR - (leadR/leadB)*leadB` is often not exact, so the loop keeps running on a residue and overwrites `quotCoeffs[degDiff]` with garbage until the residue underflows. A related effect is that `subPoly(p, p)` over Rational is not `isZeroPoly`.
- Failure scenario: `divPoly(polynomial([R(1n),R(2n),R(1n)]), polynomial([R(1n),R(1n)]), numericRational, fractionalRational)` hangs, although Fractional coefficients are the documented use case. `divPoly([1, 0.1], [1, 0.7999999999999999])` returns q ≈ 0 (expected 0.125).
- Suggested fix: in each step, drop the leading term explicitly (`remainder.coeffs.slice(0, -1)` after subtracting the lower terms) rather than relying on cancellation, and trim with an `N`-aware zero test (`isZeroCoeffWith`, or an Eq instance). Tests use only `number` coefficients that cancel exactly.
- Fix size: S-M

### 8. [MU-7] [math] `Mod<N>` multiplication and exponentiation silently lose precision for moduli above about 9.5e7 (e.g. 1e9+7)

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/modular.ts:86-88 (`mod(a.value * b.value, …)` in float), modPow, and crt (line 374, `m1 * ((x * (r2 - r1)) % m2)`)
- Problem: `a.value * b.value` exceeds 2^53 once the modulus is above sqrt(2^53) ≈ 9.49e7, so the result is rounded before `%`. `modPow` also uses `e >>>= 1`, which truncates exponents ≥ 2^32.
- Failure scenario: with P = 1_000_000_007, `modMul(mod(999999999,P), mod(999999999,P)).value` gives 63 (exact: 64), and `modPow(mod(2,P), P-2).value` gives 550424600 (exact: 500000004), so Fermat inverses are wrong. 1e9+7 is the most common modulus in practice, and nothing documents or checks the limit.
- Suggested fix: multiply via BigInt when `modulus > 94906265` (or always), use `Math.floor(e/2)` in place of `>>>`, and validate `Number.isSafeInteger(modulus)` and integral values in `mod()`.
- Fix size: S

### 9. [SQL-2] [sql] `sql$` emits params as `{ value: expr }` objects, which no consumer of `TypedFragment` understands

- Severity: high
- Confidence: high (codegen read, runtime shape repro'd)
- Location: packages/sql/src/infer-macro.ts:331-341
- Problem: `createTypedFragmentCall` emits `new TypedFragment<P,R>(segs, [{ value: e0 }, ...])`. But `TypedFragment.params` is `SqlParam[]`, and `toSql()`, `.query`, `Transactor` and every typed combinator pass `params` straight to the driver. Only `SelectBuilder.where` (query-builder.ts:40) expects `{value}`. Unlike `sql``, `sql$` also does not inline Fragment/TypedFragment interpolations, so `sql$`SELECT ... ${whereFrag}`` binds the fragment object as a parameter.
- Failure scenario: `ConnectionIO.query(sql$`SELECT \* FROM users WHERE id = ${5}`.toQuery(), R)` sends `params = [{ value: 5 }]` to the driver. Repro: `new TypedFragment(["... id = ",""],[{value:5}]).toQuery().toSql()` gives `params: [ { value: 5 } ]`. No test exercises `sql$` expansion.
- Suggested fix: emit `[e0, e1, ...]` directly (or call a runtime helper that inlines fragment interpolations, as `__sql_build` does), and change `SelectBuilder.where` to accept a `TypedFragment`/`Fragment`.
- Fix size: S

### 10. [SQL-3] [sql] Typed combinators break the segments/params invariant, so `.query` drops params and emits `?` mixed with `$n`

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typed-fragment.ts:337-347 (inListTyped), 362-366 (valuesTyped), 371-389 (valuesManyTyped), 403-421 (setTyped)
- Problem: these build a single segment that already contains `?` placeholders (`["id IN (?, ?, ?)"]`) plus N params. Everywhere else, `Fragment`/`TypedFragment` assume `segments.length === params.length + 1`. `TypedFragment.query` delegates to `Fragment.query`, which iterates segments, so it appends `$1` after the text and drops the remaining params. Composition through `append`/`intercalateTyped`/`whereAndTyped` then misaligns the params.
- Failure scenario: `inListTyped("id",[1,2,3]).query` gives `{ text: 'id IN (?, ?, ?)$1', params: [1] }`. `whereAndTyped(inListTyped("id",[1,2,3]), eq).query` gives `'WHERE id IN (?, ?, ?) AND name = $1$2', params [1,2]`, so two params are lost and the placeholders are mixed. `toFragment()` into `sql`` composition has the same problem.
- Suggested fix: build these with real segments, e.g. inList: `[`${col} IN (`, ", ", ..., ")"]` with N params, and similarly for values/set, as `Fragment.inList`/`Fragment.values` already do.
- Fix size: S

### 11. [SQL-4] [sql] Macro output references runtime identifiers it never imports; `registerInstanceMethods` is not exported at all

- Severity: high
- Confidence: high (static; `registerInstanceMethods` confirmed module-private)
- Location: packages/sql/src/macro.ts:124,155 (`Fragment`, `__sql_build`); infer-macro.ts:327,343 (`TypedFragment`, `SqlRow`); derive-typeclasses.ts:300,327-331,341-345,436,447-451,460-464,511 (`Get`/`Put`/`Read`/`Write`/`Codec`/`readRegistry`/`writeRegistry`); derive-meta.ts:220-226,247-249,411 (`stringMeta`, `nullable`, `registerInstanceMethods`, ...)
- Problem: generated code uses bare `createIdentifier` names. `MacroContext.ensureImport(symbol, from)` exists for this (core/src/types.ts:193), but the sql macros don't use it, and macro.ts:135 says "Users must import it". `@derive(Meta)` output calls `registerInstanceMethods(...)`. That function is a private no-op in meta.ts:44, not exported from any entry, so the expansion throws `ReferenceError` at module load even if the user imports everything.
- Failure scenario: the README quick start imports only `sql`. Once the macro fires, `sql`SELECT ... ${id}``becomes`**sql_build([...],[id])`, which fails with `ReferenceError: **sql_build is not defined`. `@derive(Read)`with only`Read`imported fails with ReferenceError on`Get`/`readRegistry`.
- Suggested fix: replace each bare runtime identifier with `ctx.ensureImport("<name>", "@typesugar/sql")`. Drop the `registerInstanceMethods` statement from derive-meta (see #12).
- Fix size: S

### 12. [SQL-5] [sql] The documented quick start (README + guide) fails at runtime in three separate ways

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/sql/README.md:24-31; docs/guides/sql.md:41-61, 624-633; packages/sql/src/index.ts:28-43
- Problem: (a) `ConnectionIO.query(sql`...`.toQuery())`: the exported `ConnectionIO` is the typed one and expects a `TypedQuery` + `Read`, but `Fragment.toQuery()` returns an untyped `Query`, which has no `toSql`. (b) `new Transactor(dbConnection)`: the exported `Transactor` takes `(getConnection, release)` functions. (c) `.map(...)` and the static `ConnectionIO.flatMap(a, f)` (guide:630) are, respectively, the stub from #1 and absent on the exported class; only `SimpleConnectionIO` has a static `flatMap`. The docs also import `sqlKind` (and `sql$`) from `@typesugar/sql`. `sqlKind` does not exist anywhere, and `sql$` is not declared in dist/index.d.ts, so the import is a TS2305 error.
- Failure scenario: running the README verbatim gives `op.query.toSql is not a function`, then `this.getConnection is not a function`.
- Suggested fix: make `Fragment` interoperate with the typed API (e.g. `Fragment.toTypedQuery<R>()`), or rewrite the docs against `SimpleConnectionIO`/`SimpleTransactor`. Remove `sqlKind`, or add it as an alias of `sql$`. Add a runtime/ambient declaration for `sql$` (as for `sql`).
- Fix size: M

### 13. [FMG-1] [graph] `stateMachine` macro emits an unbound `__typesugar_createStateMachineInstance` identifier, so `sm.create()` throws ReferenceError

- Severity: high
- Confidence: confirmed (repro'd end-to-end)
- Location: packages/graph/src/macros.ts:153-154
- Problem: the macro emits `factory.createIdentifier("__typesugar_createStateMachineInstance")` as a bare name. The user's file only imports `stateMachine`, and the transformer's import cleanup removes that specifier because it resolved to a macro. Nothing adds an import for the helper. The emitted `create` arrow refers to a name that is not defined anywhere in the output module.
- Failure scenario: `import { stateMachine } from "@typesugar/graph"; const sm = stateMachine\`@initial Idle ...\`; sm.create();`. `transformCode`output has no import line left at all, and`create: () => **typesugar_createStateMachineInstance({...})`. Calling it gives `ReferenceError: **typesugar_createStateMachineInstance is not defined`. The documented main use (`sm.create()`) is broken whenever the macro runs. The macro has no tests, so nothing catches this.
- Suggested fix: use `ctx.ensureImport("__typesugar_createStateMachineInstance", "@typesugar/graph")` (core context.ts:988) or `ctx.safeRef(...)` in place of the bare identifier. Add one expansion test that runs the output.
- Fix size: S

### 14. [FMG-2] [mapper] `transformInto` / `transformArrayInto` never check that field types are compatible: mismatched or optional-to-required fields are copied without a diagnostic

- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:392-399 (and every other `createPropertyAssignment` path in `buildObjectLiteral`)
- Problem: the macro matches fields by name only. It never compares `getTypeOfSymbol(fromProp)` with the target property type. The original call type-checks because its signature is `transformInto<From, To>(source: From, …): To`, so nothing else catches the mismatch, and the replacement object literal is never re-checked.
- Failure scenario: `interface S { id: string } interface D { id: number }`. `transformInto<S, D>(s)` expands to `{ id: s.id }` with zero diagnostics, and `D.id` holds a string at runtime. The same happens for `S { a?: number }` to `D { a: number }` (`transformArrayInto` gives `s.map(i => ({ a: i.a }))`, with no error and `undefined` in a required field). This defeats the point of a "type-safe" mapper (the README advertises Chimney/AutoMapper parity).
- Suggested fix: for each copied, renamed or renamePaths field, call `checker.isTypeAssignableTo(sourceFieldType, targetFieldType)` (exposed on the checker since TS 5.x, or via `ctx.isAssignableTo` if core has it) and `reportError` on failure. For nested or collection fields, recurse as today.
- Fix size: M

### 15. [FMG-3] [fusion] `fused()` changes callback semantics: drops the index and array arguments, re-evaluates the callback expression per element, and rebinds `this`

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

### 16. [TSP-1] [type-system] Most type-system macros have no `module`, so they fire on ANY same-named identifier, including foreign imports (wrong runtime code)

- Severity: high
- Confidence: confirmed (repro'd via transformCode)
- Location: packages/type-system/src/macros.ts:276 (packExists), :317 (useExists), :352 (opaqueModule), :378 (refine), :500-1000 (all 19 type macros Add/Sub/Mul/Div/Mod/Pow/Negate/Abs/Max/Min/Lt/Lte/Gt/Gte/NumEq/Increment/Decrement/IsEven/IsOdd), :128 (existential), :1012 (phantom), :1110 (stateMachine), :1136 (pure). Only wrap/unwrap/newtypeCtor set `module`.
- Problem: per transformer-core/src/import-resolution.ts:331-363 (`fallbackNameLookupWithImports`), a macro without `module` is returned for any identifier whose symbol is unresolved OR is an explicit import from anywhere. `refine` is not even a runtime export of @typesugar/type-system, so the `refine` macro can ONLY fire on someone else's `refine`.
- Failure scenario (repro'd):
  - `import { refine } from "superstruct"; refine(a, "Name", v => v.length > 0)` -> emitted `a.refine("Name")` (third arg silently dropped; wrong runtime behaviour).
  - Undeclared `refine(schema, check)` -> `schema.refine(check)`.
  - `import type { Max } from "some-lib"; type M = Max<[1,2,3]>` -> hard error "Max<A, B> requires exactly 2 type arguments". Same for any library type named Add/Lt/Gt/Abs/Min/Pow/IsEven... (e.g. ts-arithmetic's `Lt` returns 0|1; typesugar would silently rewrite it to `true`/`false`).
- Suggested fix: add `module: "@typesugar/type-system"` to every macro in this file; delete the `refine` macro (no runtime counterpart) or add a real `refine` export and scope it.
- Fix size: S

### 17. [TSP-2] [type-system] `createStateMachine` sets `state` to the transition FUNCTION after any transition; invalid transitions are not rejected

- Severity: high
- Confidence: confirmed (repro'd against dist)
- Location: packages/type-system/src/phantom.ts:185-226
- Problem: the target-state lookup iterates `Object.entries(config)` (i.e. `initial`, `initialData`, `transitions`) and picks the first object containing `name` — which is `config.transitions`, so `targetState = transitions[name]` = the transition function. The state graph `Def` is type-only, so the runtime has no way to know the target. Transitions are callable from any state; the instance param type is `StateMachineInstance<Data, string>`, so there is no compile-time check either. Transition names `create`/`getState`/`is` silently overwrite the module methods.
- Failure scenario: `M = createStateMachine({initial:"closed", initialData:{n:0}, transitions:{open: d=>({n:d.n+1})}}); b = M.open(M.create())` -> `typeof b.state === "function"`, `M.is(b, "open") === false`; `M.open(b)` from "open" is allowed. tests/red-team-type-system.test.ts:748 documents the bug ("FINDING ...") and simply doesn't assert on `state`.
- Suggested fix: require the state table at runtime (e.g. `config.states: Def`), look up `config.states[instance.state][name]`, throw on an undefined transition, and type transition params as `StateMachineInstance<Data, S>` with `S` constrained to states that have that transition. Otherwise remove/mark experimental.
- Fix size: M

### 18. [MU-8] [math] `moneyDivide` with a bigint divisor rounds HALF_UP (and HALF_CEIL/HALF_FLOOR) wrongly for odd divisors

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/money.ts moneyDivide bigint branch (`case "HALF_UP": if (absRemainder >= halfDivisor)` and the `default:` branch)
- Problem: `halfDivisor = absDivisor / 2n` is floored, so for an odd divisor `absRemainder >= halfDivisor` is true below the half point. HALF_CEIL and HALF_FLOOR fall into `default`, which is HALF_UP again and ignores their semantics. This is a hand-rolled copy of `roundBigInt`; HALF_EVEN and HALF_DOWN happen to be right.
- Failure scenario: `moneyDivide(10n, 3n, USD, "HALF_UP")` gives `4n` (3.33 cents should round to 3). `"HALF_CEIL"` also gives `4n`.
- Suggested fix: compare `2n * absRemainder` with `absDivisor`, or delegate to the shared rounding helper once finding 4 is fixed.
- Fix size: S

### 19. [MU-9] [math] `fixed("…e-N", scale)` is off by a factor of 10^(2N)

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/fixed-decimal.ts:125-135
- Problem: for a negative exponent the mantissa is parsed at `scale + |exp|`, which multiplies by 10^|exp| when it should divide by it, and the result is returned as is.
- Failure scenario: `fixed("1e-2", 2)` gives 100.00 (expected 0.01). `fixed("1.5e-1", 2)` gives 15.00 (expected 0.15). Positive exponents are correct.
- Suggested fix: parse the mantissa to an exact (unscaled, inputScale) pair, set `inputScale -= exp`, and call `roundBigInt(unscaled, scale, inputScale, mode)`, applying a positive factor when inputScale < 0.
- Fix size: S

### 20. [MU-10] [math] Money string parsing is lossy and locale-wrong: "1.234,56" gives 1.23 and "1e3" gives 13.00

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/money.ts moneyFromString (`s.replace(/[^\d.\-]/g, "")` then `parseFloat`)
- Problem: the parser strips every character except digits, `.` and `-`, then goes through a float. Comma-decimal locales, exponents and accounting negatives are all misread without an error, and amounts above 2^53 minor units lose precision even though the input is a string.
- Failure scenario: `moneyFromMajor("1.234,56", EUR)` gives 1.23. `moneyFromMajor("1e3", USD)` gives 13.00. `moneyFromMajor("(12.34)", USD)` gives +12.34.
- Suggested fix: reuse the exact decimal string parser (as `fixed(string)` does once finding 9 is fixed), accept only `^[+-]?\d[\d,]*(\.\d+)?$` after stripping a currency symbol, and throw otherwise. Locale-aware parsing could be an explicit option.
- Fix size: S

### 21. [MU-11] [math] Conversions ignore their `mode` argument, or go through float, defeating the exact types

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/conversions.ts: bigDecimalToFixed (`mode === "HALF_EVEN" ? "round" : "round"`), rationalToMoney (truncating `/`, `mode` unused), rationalToBigDecimal (truncates), bigDecimalToMoney (`bigDecimalToNumber` then the float path)
- Problem: the public signatures take a `RoundingMode` that has no effect, and the BigDecimal-to-Money conversion rounds through a JS number.
- Failure scenario: `bigDecimalToFixed(bigDecimal("1.239"), 2, "FLOOR")` gives 1.24. `rationalToMoney(2/3, USD, "HALF_UP")` gives 66n (expected 67n). `bigDecimalToMoney(bigDecimal("1.005"), USD, "HALF_UP")` gives 100n (expected 101n), and `bigDecimal("12345678901234567.89")` becomes 1234567890123456823n.
- Suggested fix: route all of them through `roundBigInt(unscaled, targetScale, sourceScale, mode)` on exact bigint values. For Rational, round `num * 10^s / den` using the remainder.
- Fix size: S

### 22. [MU-12] [math] `moneyAllocate` throws on non-integer ratios and can hand remainder cents to a zero-ratio party

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/money.ts moneyAllocate (`BigInt(ratio)`, `BigInt(total)`; the remainder loop starts at index 0)
- Problem: `ratios: readonly number[]` accepts `[0.3, 0.7]`, but `BigInt(0.3)` throws. The remainder is spread from index 0 regardless of ratio, so a zero-weight recipient can receive money.
- Failure scenario: `moneyAllocate(100n, [0.3, 0.7], USD)` throws "The number 0.3 cannot be converted to a BigInt". `moneyAllocate(10n, [0,3,3,3], USD)` gives `[1n,3n,3n,3n]`.
- Suggested fix: scale ratios to integers (or validate `Number.isInteger` and throw a clear error), and distribute the remainder only to entries with a ratio > 0, ideally by largest fractional remainder.
- Fix size: S

### 23. [MU-13] [math] `numericMatrix(n)` uses `trace` as the scalar view, so `pow(a, one())` is a^n and `toNumber(fromNumber(5))` is 5n

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/matrix.ts:538-562
- Problem: `fromNumber(k)` is `k·I`, whose trace is `n·k`. `pow` reads its exponent as `round(trace(b))` and `toNumber` returns the trace. `abs` is the identity.
- Failure scenario: with `N = numericMatrix(3)`, `N.pow(diag([2,1,1]), N.one())[0]` gives 8 (expected 2). `N.toNumber(N.fromNumber(5))` gives 15.
- Suggested fix: use `b[0]` (or `trace(b)/n`) as the scalar, and use the same in toNumber. Consider not providing `pow`/`abs`/`signum` for matrices at all.
- Fix size: S

### 24. [MU-14] [math] Interval arithmetic does not round outward, so results can fail to contain the true value; `0 × ∞` turns into the empty interval

- Severity: medium
- Confidence: confirmed (by construction; for example `point(0.1)+point(0.2)` gives `{0.30000000000000004}`, which excludes the exact sum of the two float inputs, 0.30000000000000001665…)
- Location: packages/math/src/types/interval.ts add/sub/mul/div/sqrt/pow (round-to-nearest endpoints); mul (`Math.min(...products)` with `0*Infinity = NaN`)
- Problem: the module and docs/guides/math.md:245 sell it for "verified numerical computing" and say it "correctly propagate[s] bounds". Without directed rounding (nextDown on lo, nextUp on hi) the containment guarantee does not hold. Separately, `mul(entire, point(0))` gives NaN bounds, which means "empty", when the answer should be [0,0].
- Failure scenario: error-bound analysis built on this reports bounds that are too tight. `numericInterval.mul(entire, point(0))` returns the empty interval.
- Suggested fix: widen each computed endpoint by one ulp outward (a `nextDown`/`nextUp` helper via Float64Array/BigInt64Array bit tricks), and special-case `0 × ±∞ = 0`. Alternatively, drop the "verified" claim from the docs.
- Fix size: S-M

### 25. [MU-15] [math] `rationalToUnit` throws in the ESM build (`require` inside an ESM bundle)

- Severity: medium
- Confidence: confirmed (repro'd: ESM throws `Dynamic require of "@typesugar/units" is not supported`; CJS works)
- Location: packages/math/src/bridge/units.ts (`const { Unit } = require("@typesugar/units")`; also `require("../types/rational.js")` in unitToRationalPrecise, which tsup happens to inline)
- Problem: the package is `"type": "module"` and its `module` entry is ESM. tsup's `__require` shim throws for externals.
- Failure scenario: `import { rationalToUnit } from "@typesugar/math"` under Node ESM or any bundler throws when called.
- Suggested fix: use a static `import { Unit } from "@typesugar/units"`. Math already depends on units and re-exports it (src/index.ts:539-608), so there is no real cycle.
- Fix size: S

### 26. [MU-16] [math] `BigDecimal` division silently returns 0 for long divisors; `pow` breaks on negative-scale or non-integer exponents

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/bigdecimal.ts:314-337 (numericBigDecimal.div with a fixed 20 extra digits relative to the dividend's unscaled value; pow's `10n ** BigInt(b.scale)`)
- Problem: the quotient precision is fixed at "20 more decimal places than a.scale - b.scale", not 20 significant digits, so a divisor with more than 20 digits yields 0. `pow` with an exponent parsed from "1e1" (scale -1) throws "Exponent must be positive", and a non-integer exponent is silently truncated (2^2.7 gives 4).
- Failure scenario: `numericBigDecimal.div(bigDecimal("1"), bigDecimal("123456789012345678901234567890"))` gives 0. `numericBigDecimal.pow(bigDecimal("2"), bigDecimal("1e1"))` throws.
- Suggested fix: choose the extra scale from the digit counts (`20 + digits(b.unscaled) - digits(a.unscaled)`, min 20). In pow, normalize b first and reject non-integers.
- Fix size: S

### 27. [SQL-6] [sql] The documented `@column("created_at")` JSDoc form yields column name `(created_at)` / `("created_at")`

- Severity: medium
- Confidence: confirmed (repro'd TS JSDoc parsing)
- Location: packages/sql/src/derive-typeclasses.ts:205-219; packages/sql/src/derive-meta.ts:173-181
- Problem: for `/** @column("created_at") */`, the TS JSDoc tag `comment` is `("created_at")`. derive-typeclasses strips the quotes and keeps the parens, giving `(created_at)`. derive-meta keeps everything and then does `createIdentifier('("created_at")')` for `row.<col>`, which prints invalid JS. The derive-typeclasses module docs (lines 15-18) use exactly this form.
- Failure scenario: `@derive(Read)` with `/** @column("created_at") */ createdAt: Date` reads `row["(created_at)"]`, which is always undefined. With #7 that becomes silent garbage (for a string field it is the literal `"undefined"`).
- Suggested fix: parse `^\(?\s*["']?([^"')]+)["']?\s*\)?$`. In derive-meta use `createElementAccessExpression(row, createStringLiteral(col))`, not an identifier.
- Fix size: S

### 28. [SQL-7] [sql] Get/Meta primitives turn a missing column (`undefined`) into `"undefined"` / `NaN` instead of NULL or an error

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typeclasses.ts:149-157; packages/sql/src/meta.ts (stringMeta/numberMeta, ~line 213-225)
- Problem: the decoders check only `v === null`, so `undefined` falls into `String(v)` / `Number(v)`. `Read.make` reads `row[column]` with no presence check, and `Get.nullable` passes `undefined` through to the inner decoder.
- Failure scenario: a column-name mismatch (snake_case or #6) gives `Read.read({created_at:"2020"})` returning `{ createdAt: 'undefined' }`. A number field gives `NaN`. Both pass through `unsafeRead` without throwing. `Get.number.get("abc")` is also `NaN`.
- Suggested fix: treat `v === null || v === undefined` as NULL in every primitive decoder. Return null (not NaN) when `Number(v)` is NaN. Optionally make `Read.make` throw or return null when `!(column in row)`.
- Fix size: S

### 29. [SQL-8] [sql] `orTyped` does not parenthesize, so `andTyped(orTyped(a,b), c)` gets the wrong precedence

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typed-fragment.ts:308-312
- Problem: the untyped `Fragment.or` wraps its result in parens (types.ts:139-141); the typed version does not.
- Failure scenario: `andTyped(orTyped(a=1, b=2), c=3)` gives `a = $1 OR b = $2 AND c = $3`, which SQL evaluates as `a OR (b AND c)`. That is a wrong filter and a possible data leak or overly broad DELETE.
- Suggested fix: `return intercalateTyped(...).parens()` (and do the same for single-element input or not, to match `Fragment.or`).
- Fix size: S

### 30. [SQL-9] [sql] `setTyped(meta, partial)` crashes on omitted Date/bigint fields and writes NULL for omitted optional fields

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typed-fragment.ts:403-421
- Problem: it calls `meta.write(value as A)` on a `Partial<A>`, so every extractor runs on `undefined`. `Put.date.put(undefined)` throws, and so does `Put.bigint`. `Put.optional` maps `undefined` to `null`, which passes the `!== undefined` filter.
- Failure scenario: `setTyped(WriteUser, { name: "Bob" })` throws `Cannot read properties of undefined (reading 'toISOString')` when User has a Date column. With an optional `nickname`, it produces `name = ?, nickname = ?` with `[Bob, null]`, which wipes the column.
- Suggested fix: iterate `meta.columns` alongside the field names, skip fields where `value[field] === undefined` before calling the extractor. This needs Write to expose its field names or a per-field extractor.
- Fix size: M

### 31. [SQL-10] [sql] Placeholder dialect is inconsistent: the typed Transactor sends `?` while Fragment, README and guide render `$n`

- Severity: medium
- Confidence: high
- Location: packages/sql/src/typed-fragment.ts:173-178, 228-233 (`toSql` joins with `?`); connection-io.ts:443-468 (Transactor uses `toSql`); types.ts:64-87 (`$n`)
- Problem: there is no dialect option. `TypedQuery.toSql()` produces `?` (MySQL/SQLite), but `TypedFragment.query` and `Fragment.query` produce `$n` (Postgres). The exported Transactor always uses `toSql`. The guide's examples are Postgres-style.
- Failure scenario: a node-postgres user running `ConnectionIO.query(typedQ, R)` through `Transactor` sends `WHERE id = ?`, and Postgres rejects it with a syntax error.
- Suggested fix: add a `placeholder` / dialect option on Transactor (or on `DbConnection`) and render through a single function; make `toSql` and `query` share it.
- Fix size: M

### 32. [SQL-11] [sql] No identifier quoting anywhere; column/table names are concatenated raw (SQL injection via identifiers)

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/types.ts:186 (`inList` column), 213-218 (`Fragment.set` keys); typed-fragment.ts:346 (inListTyped), 414; query-builder.ts:35-67,82-104 (`from`, `join`, `orderBy`, columns); connection-io.ts:452-455 (RETURNING columns; also its `includes("RETURNING")` check is case-sensitive)
- Problem: values are parameterized, but every identifier-taking API interpolates raw strings, and the package offers no `Fragment.ident` / quoting helper or validation. The red-team tests cover only value injection.
- Failure scenario: `Fragment.set(req.body)` with key `"name = 'x' --"` renders `SET name = 'x' -- = $1`. `select(...).orderBy(req.query.sort)` is injectable in the same way.
- Suggested fix: add `Fragment.ident(name)` (dialect-aware `"..."` quoting with doubled quotes). Use it or validate `/^[A-Za-z_][A-Za-z0-9_.]*$/` in `set`/`inList`/`inListTyped`/the builder, and document that identifiers are not parameterized.
- Fix size: M

### 33. [SQL-12] [sql] CLAUDE.md AST rule: unlisted `ctx.parseExpression` call sites, plus string codegen hidden in identifiers

- Severity: medium
- Confidence: confirmed
- Location: packages/sql/src/derive-typeclasses.ts:300, 436; derive-meta.ts:220-226, 241-246, 405-433
- Problem: derive-typeclasses builds `"Get.nullable(Get.string)"` strings and calls `ctx.parseExpression`. Neither call site is in CLAUDE.md's exhaustive exception list. derive-meta avoids the parser by putting whole expressions into `factory.createIdentifier("nullable(stringMeta)")` (the printer emits identifier text verbatim), which is the same string codegen in disguise. It also emits a `.source`-string DictMethod via `registerInstanceMethods`. CLAUDE.md says nothing should produce that shape any more (PEP-052 Wave 7). The string itself is wrong too: `JSON.stringify` turns `${row.x}` into a quoted string literal, so the "specialized" read would return literal strings. auto-derive-strategies.ts also returns string code, but it is never imported (dead).
- Failure scenario: a review gap per CLAUDE.md. Concretely, the derive-meta `source` would inline `{"id":"${row.id}"}` if anything consumed it.
- Suggested fix: build `Get.nullable(Get.string)` as nested `createCallExpression(createPropertyAccessExpression(...))`. A small recursive `{ctor, args}` descriptor in place of strings works for all three derive files. Delete the `registerInstanceMethods` emission and the dead auto-derive-strategies.ts, or add CLAUDE.md entries.
- Fix size: M

### 34. [SQL-13] [sql] Derives reject `boolean | null`, string-literal unions and enums

- Severity: medium
- Confidence: high (logic traced; TS represents `boolean` as `true | false`)
- Location: packages/sql/src/derive-typeclasses.ts:65-98, 106-139, 147-180; derive-meta.ts:95-131
- Problem: the union branch requires exactly one non-null member. `boolean | null` is `true | false | null`, which has two. `"a" | "b"` members carry StringLiteral flags, not String, so they also fail the primitive checks. Enums fail similarly.
- Failure scenario: `@derive(Read) interface U { isActive: boolean | null }` gives "Cannot derive Read for field 'isActive': unsupported type 'boolean | null'". Nullable boolean columns are very common.
- Suggested fix: after removing null/undefined, treat "all BooleanLiteral" as boolean. Map StringLiteral/NumberLiteral/enum-literal unions to string/number (or check `typeChecker.getBaseTypeOfLiteralType`).
- Fix size: S

### 35. [SQL-14] [sql] `@derive(Meta)` is wired as an attribute macro named `derive`, not as a derive, so it goes through the "Unknown derive" error path

- Severity: medium
- Confidence: medium (dispatch traced in transformer-core; not run end-to-end)
- Location: packages/sql/src/derive-meta.ts:270-272; interacts with transformer-core/src/transformer.ts:1497-1510 and macro-helpers.ts:613-626
- Problem: PEP-032 removed the `derive` attribute macro, and `@derive(X)` now dispatches to `globalRegistry.getDerive(X)`. No derive or GenericDerivation named `Meta` exists, so `expandDeriveDecorator` reports `Unknown derive: 'Meta'` and only then falls through to the sql attribute macro. In `@derive(Meta, Eq)`, Eq succeeds, so the fall-through never happens: Meta is silently dropped, yet the error is still reported. The JSDoc `@derive` path does not fall through at all. The guide documents `@deriving(Meta)`.
- Failure scenario: `@derive(Meta) interface User {...}` reports an error diagnostic even when it does expand. Mixed derive lists lose Meta.
- Suggested fix: re-register it as `defineDeriveMacro({ name: "Meta", ... })` using `DeriveTypeInfo` (like Read/Write/Codec), or fold it into `Codec`.
- Fix size: M

### 36. [FMG-4] [fusion] Mapper and fusion move user expressions into a non-async arrow IIFE: `await` / `yield` in the source becomes a SyntaxError

- Severity: medium
- Confidence: confirmed (mapper, repro'd end-to-end); high (fusion, same construction)
- Location: packages/mapper/src/macros.ts:123-157; packages/fusion/src/macros.ts:568-600 (`wrapInIIFE`, which also moves `take` counts and the `reduce` init into the IIFE preamble)
- Problem: when the source is not an identifier or literal, mapper binds it to a temp inside `(() => { const src = <expr>; return {...}; })()`. Fusion always places the source, init and take-count expressions inside such an arrow. An `await` or `yield` in those expressions ends up inside a non-async, non-generator arrow.
- Failure scenario: `async function f() { return transformInto<S, D>(await get()); }` expands to `(() => { const __typesugar_src_s0_0__ = await get(); … })()`, which Node reports as `SyntaxError: Unexpected reserved word`. `fused((await load()).map(f).toArray())` breaks the same way.
- Suggested fix: hoist the temp out of the arrow (`ctx.hoistVariable` / emit a comma expression `(__src = <expr>, { … })` with a hoisted `let`). Alternatively, when the expression contains `await` / `yield`, emit an `async` arrow and `await` it, or skip the expansion with a diagnostic.
- Fix size: S-M

### 37. [FMG-5] [graph] `stateMachine` macro inlines an interpolated identifier's NAME as DSL text, producing a wrong machine

- Severity: medium
- Confidence: confirmed (repro'd end-to-end)
- Location: packages/graph/src/macros.ts:48 and 56-57
- Problem: the "static span" test is `"text" in span.expression`. `ts.Identifier` has a `text` getter on its prototype, so `in` is true for identifiers, and the identifier's name gets concatenated into the template text in place of its value.
- Failure scenario: `const IDLE = "Idle"; stateMachine\`@initial ${IDLE}\n ${IDLE} --start--> Done\``. The compiled output has `states: ["IDLE","Done"], initial: "IDLE"`, while the runtime `stateMachine`tag (templates.ts) would produce`"Idle"`. Any `inst.current === IDLE` check is then false. The macro also "verifies" the wrong machine.
- Suggested fix: treat a span as static only for `ts.isStringLiteral || ts.isNoSubstitutionTemplateLiteral || ts.isNumericLiteral`. Otherwise fall back to the runtime path (return `node`), or resolve `const` initializers via the checker (guarded with `isSyntheticNode`).
- Fix size: S

### 38. [FMG-6] [mapper] Mapper: an optional/nullable nested source object silently maps to `{}` (data and renames dropped, no error)

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:317-340 (and the plain recursive `buildObjectLiteral` call with a union type)
- Problem: for `address?: SA`, `getTypeOfSymbol` returns `SA | undefined`. `getPropertiesOfType` on that union returns no properties, so the nested literal is empty and no "Cannot map field" error fires. It also never guards `undefined`.
- Failure scenario: `S { address?: { city: string } }` to `D { address?: { location: string } }` with `nested: { address: { rename: { location: "city" } } }` yields `{ address: {} }` with no diagnostic. The city value is lost, and when `s.address` is undefined the output still contains `{}`.
- Suggested fix: strip nullability with `checker.getNonNullableType` before reading properties. Emit `src.x == null ? src.x : { … }` when the source field is optional. Report an error when a non-empty target type yields zero mapped properties.
- Fix size: S-M

### 39. [FMG-7] [mapper] Mapper silently ignores config it cannot parse syntactically: renames and computes are dropped and a same-named field is copied instead

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:562-564, 567, 572, 581
- Problem: `parseConfig` only understands an inline object literal with `PropertyAssignment` entries and string-literal rename values. Each of the following is dropped without a diagnostic: a config held in a variable (`transformInto<S,D>(s, cfg)`), `rename: { name: "fullName" as const }`, method-syntax compute (`compute: { label(x) {…} }`), shorthand (`compute: { label }`), spreads, and `ignore: { target: [...] as const }`. If the source also has a field with the target's name, the macro silently copies that one.
- Failure scenario: `S { name; fullName }` to `D { name }` with `rename: { name: "fullName" as const }` (or with the config in a `const cfg`) yields `{ name: s.name }`, which is the wrong value with no error. `compute: { label(x) { return x.first.toUpperCase(); } }` yields `{ label: s.label }`.
- Suggested fix: `reportError` on any non-literal config argument and on any config member or value shape that is not recognized. Accept `MethodDeclaration` / `ShorthandPropertyAssignment` for compute, and unwrap `AsExpression` / `SatisfiesExpression` around literals.
- Fix size: S

### 40. [FMG-8] [fusion] `LazyPipeline`: `take(n)` placed before `flatMap` truncates the flatMapped output

- Severity: medium
- Confidence: confirmed (repro'd against dist)
- Location: packages/fusion/src/lazy.ts:398-405 (the post-yield "any take counter hit zero, return" check)
- Problem: after every yield, `execute()` stops if any take counter is at zero. A take stage that appears before a flatMap reaches zero while the flatMap's remaining children are still on the `pending` stack, so they are discarded.
- Failure scenario: `lazy([1,2]).take(1).flatMap(x => [x, x]).toArray()` gives `[1]` (expected `[1,1]`). `lazy([1,2,3]).take(2).flatMap(x => [x,x,x]).toArray()` gives `[1,1,1,2]` (expected six elements).
- Suggested fix: only stop early when the zeroed take step is the last length-changing step, i.e. no flatMap after it. Simpler: in the take case, when the counter hits 0, set a "source exhausted" flag that stops pulling new `raw` items but still drains `pending`.
- Fix size: S

### 41. [FMG-9] [graph] `dijkstra` / `dijkstraWith` / `dijkstraWithG` never traverse an undirected edge in its stored-reverse direction

- Severity: medium
- Confidence: confirmed (repro'd; 8959 disagreements with `shortestPath` in a 3000-graph fuzz)
- Location: packages/graph/src/generic-algorithms.ts:300-301 together with 319-325
- Problem: for undirected graphs `edgesFrom` also returns edges whose target is the current node, but the relaxation then uses `neighbor = WGL.edgeTarget(e)`, which is the current node itself. The other endpoint is never relaxed.
- Failure scenario: `createGraph(["A","B"], [["B","A"]])`. `dijkstra(g, "A", "B")` returns `null`, while `shortestPath(g, "A", "B")` returns `["A","B"]`.
- Suggested fix: in the loop, `const neighbor = eq.equals(WGL.edgeSource(e), minNode) ? WGL.edgeTarget(e) : WGL.edgeSource(e);`.
- Fix size: S

### 42. [FMG-10] [graph] `hasCycles` / `isDAG` / `topoSort` / `detectCycles` give wrong answers on undirected graphs

- Severity: medium
- Confidence: confirmed (repro'd; 139 mismatches against a union-find oracle in the fuzz)
- Location: packages/graph/src/generic-algorithms.ts:17-55 (Kahn counts in-degree from `edgeTarget` only, but `successors` is bidirectional for undirected graphs); packages/graph/src/algorithms.ts:65-117
- Problem: the `Graph` type supports `directed: false` and these functions accept it, but the directed algorithms are applied to it unchanged.
- Failure scenario: undirected 4-cycle `n2-n5, n4-n5, n3-n4, n2-n3` gives `hasCycles` = `false`. `detectCycles(createGraph(["A","B"], [["A","B"]]))` returns `[["A","B"]]`, reporting every single edge as a cycle.
- Suggested fix: for `!isDirected`, use union-find / DFS with parent-edge tracking for `hasCycles`, and make `topoSort` / `isDAG` / `detectCycles` reject undirected input or document them as directed-only.
- Fix size: S-M

### 43. [FMG-11] [fusion] `fused()` turns non-array receivers into a for-of that throws at runtime; `find` returns `null` instead of `undefined`

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/fusion/src/macros.ts:123-161 (purely syntactic chain parse, no receiver type check), 497
- Problem: the terminals `toArray/sum/count/first/last` and the intermediate `take` exist on `LazyPipeline`, not on `Array`. The natural spelling `fused(lazy(arr).map(f).toArray())` therefore parses, but then emits `for (const x of lazy(arr))`. `LazyPipeline` has no `[Symbol.iterator]`, so this throws `TypeError: … is not iterable`. Any other receiver with `.map/.filter/.reduce` (RxJS, Immutable, user classes) is rewritten the same way. For real arrays, `fused(arr.find(p))` returns `null` where `arr.find(p)` returns `undefined`.
- Suggested fix: check the receiver type (array or tuple, via the checker, guarded by `isSyntheticNode`) and pass through otherwise, or explicitly unwrap a root `lazy(x)` call to `x`. Return `undefined` from array-chain `find`/`first`/`last`.
- Fix size: S-M

### 44. [FMG-12] [mapper] Mapper `renamePaths`: deeper paths are ignored and unmatched nested target fields are silently omitted

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/mapper/src/macros.ts:457-461, 466-488
- Problem: only `targetSubPath.length === 1` entries are honoured. Any field of the nested target that is neither renamed nor present on the nested source is skipped without an error.
- Failure scenario: `renamePaths: { "a.b.c": "a.b.x" }` yields `{ a: { b: s.a.b } }`, with the rename silently lost. Target `address: { location; zip }` with source `address: { city }` and `renamePaths: { "address.location": "address.city" }` yields `{ address: { location: s.address.city } }`: required `zip` is missing and no diagnostic is reported.
- Suggested fix: recurse for longer sub-paths, and `reportError` for unmapped nested target fields, matching the top-level behaviour at line 402.
- Fix size: S-M

### 45. [TSP-3] [type-system] `packExists` macro changes evaluation semantics: the witness expression is re-evaluated on every `.use`

- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/type-system/src/macros.ts:276-311
- Problem: the macro emits `{ use: f => f(<arg>) }` with the argument expression inlined in the arrow body; the runtime `packExists(witness)` (existential.ts:86) evaluates it once.
- Failure scenario: `let n = 0; const p = packExists({ v: n++ })` -> emitted `{ use: f => f({ v: n++ }) }`; each `useExists(p, ...)` sees a new object and increments `n`. `packExists(openConnection())` opens a connection per use.
- Suggested fix: hoist the argument to a temp (`(w => ({ use: f => f(w) }))(arg)`), or just leave the call to the runtime function (it is already tiny; the "zero-cost" claim is false either way since an object is allocated).
- Fix size: S

### 46. [TSP-4] [parser] Grammar left-recursion check misses nullable prefixes; such grammars stack-overflow at parse time

- Severity: medium
- Confidence: confirmed (repro'd against dist, both runtime and compiled paths)
- Location: packages/parser/src/grammar.ts:368-401 (`firstRefsAre`)
- Problem: for a `sequence` only `rules[0]` is inspected; if that element can match empty (`x?`, `x*`, `!x`, `&x`, or a reference to a nullable rule) the next element is also in left position. `negation`/`lookahead` return false outright.
- Failure scenario: `a = "x"? a "y" | "z"`, `a = !"q" a | "z"`, `a = b a "y" | "z"` with `b = "x"*` all pass `parseGrammarDef` (and the compile-time `grammar` macro's validation), then `parse("z")` throws `RangeError: Maximum call stack size exceeded`.
- Suggested fix: compute a nullable set (fixpoint over rules), and in `sequence` keep walking elements while the previous one is nullable; treat negation/lookahead/optional/repetition(min 0) as nullable and recurse into their inner rule.
- Fix size: M

### 47. [TSP-5] [type-system] `@effect` is defined but never registered, so `@pure` effect checking can never report anything; the registry is a never-cleared global keyed by bare name

- Severity: medium
- Confidence: high (read; `register()` at macros.ts:1281-1310 has no `effectAttribute`, and grep finds no other registration)
- Location: packages/type-system/src/macros.ts:1180 (effectAttribute), :1305 (register), effects.ts:127-200
- Problem: only `registerPure` ever runs at compile time, and `checkEffectCall` only errors when the callee is effectful, so no diagnostic is reachable. Even once fixed: entries are keyed by bare function name (and callee matched by property name, `obj.save()` matches any `save`), the registry lives in a module global that is never cleared between files/programs/watch rebuilds (stale entries after a rename), and checking is order-dependent across files (CLAUDE.md "live registry" rule: this is neither same-pass-keyed nor symbol-keyed). docs/guides/type-system.md:308-325 advertises `@io` (no such decorator) and "assertPure(() => log(...)) // Compile error" (assertPure is a runtime no-op).
- Failure scenario: `@effect("io") function log(){}  @pure function f(){ log() }` -> no error.
- Suggested fix: register `effectAttribute` (scoped by module), key annotations by resolved symbol/declaration, reset the registry per program; or demote the feature to experimental and fix the docs.
- Fix size: M

### 48. [TSP-6] [type-system] `Vec<T, N>` length invariant is not enforced: `Vec.from` check is tautological and the array is mutable

- Severity: medium
- Confidence: high (mutation repro'd; inference point by reading TS return-type inference)
- Location: packages/type-system/src/vec.ts:190-192, 252-254 (`from`), 205-225 (`createVec`)
- Problem: `Vec.from<T, N>(arr)` calls `createVec(arr, arr.length as N)` — the length check compares `arr.length` to itself. `N` is inferred from the contextual return type, so `const v: Vec<number, 3> = Vec.from([1, 2])` typechecks and yields a length-2 "Vec<3>". The Vec type keeps `push/pop/splice`, so `v.push(4)` compiles and `Vec.length(v)` returns 4 typed as `3`. @typesugar/contracts-refined treats `Vec<T,N>.length === N` as a PROVEN type fact (guide: "requires(Vec.length(v) === 3); // PROVEN"), so runtime checks are elided on a false fact.
- Failure scenario: as above; repro: `v = Vec.from([1,2,3]); v.push(4); Vec.length(v) === 4; isVec(v) === true`.
- Suggested fix: type Vec over `readonly T[]` and `Object.freeze` the branded copy; make `from` take a tuple (`from<const A extends readonly T[]>(arr: A): Vec<T, A["length"]>`) or an explicit expected length that is checked.
- Fix size: M

### 49. [TSP-7] [type-system] `opaqueModule` erases the brand to `string`: all opaque modules over the same Repr are interchangeable

- Severity: medium
- Confidence: high (read)
- Location: packages/type-system/src/opaque.ts:140-143, 192-206
- Problem: `opaqueModule<Repr>(brand: string, ...)` has no `Brand` type parameter and `OpaqueModuleResult` uses `Opaque<Repr, string>` throughout, so `UserId.create(1)` is accepted by `OrderId.someOp(...)` — the core promise of an opaque type. Also every op whose return type extends `Repr` is retyped as a validated `Opaque` without running `validate` (e.g. `PositiveInt.toNumber(x)` is typed as an opaque PositiveInt; a user op `negate: n => -n` returns a "PositiveInt" of -5).
- Failure scenario: two `opaqueModule<number>` modules; passing one's value to the other compiles.
- Suggested fix: `opaqueModule<Repr, Brand extends string>(brand: Brand, ...)` and thread `Brand` through `OpaqueModuleResult`; only retype op results as opaque when the op is wrapped with validation.
- Fix size: S

### 50. [TSP-8] [parser] Unlisted string->AST codegen: `grammar` macro builds JS source text and calls `ctx.parseExpression`

- Severity: medium (CLAUDE.md rule: "an unlisted call site is a bug")
- Confidence: confirmed (read)
- Location: packages/parser/src/macros.ts:96 (`return ctx.parseExpression(code)`), code from packages/parser/src/codegen.ts (`generateParserCode`, string concatenation)
- Problem: not in the CLAUDE.md exhaustive exception list; the entire Phase-2 codegen is template strings.
- Failure scenario: rule violation; also the generated text is not hygienic-by-construction (relies on an IIFE scope) and cannot be composed with other AST transforms.
- Suggested fix: since parser is Frozen, add a CLAUDE.md entry with justification (or fall back to emitting the runtime `buildParser(parseGrammarDef(...))` call as AST); migrating codegen.ts to ts.factory is the full fix.
- Fix size: S (doc entry) / L (migration)

### 51. [MU-17] [math] Matrix singularity tests use an absolute 1e-12 threshold, so well-conditioned small-scale matrices are rejected or given det 0

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/matrix.ts:379, 407, 415, 445, 495
- Problem: the threshold is not scale-invariant, and it is applied inconsistently: det uses exact formulas for n ≤ 3 but LU with the threshold for n ≥ 4.
- Failure scenario: `matrixInverse(diag([1e-7, 1e-7]))` throws "Matrix is singular". `det(diag([1e-4,1e-4,1e-4,1e-13]))` gives 0, while the 3×3 analogue gives 1e-21.
- Suggested fix: use a relative tolerance (pivot vs. max-abs element × n × ε), or throw only on an exact 0 pivot.
- Fix size: S

### 52. [MU-18] [math] Matrix element-wise ops never check dimensions at runtime, and `fromRows` always yields `Matrix<number, number>`, so the static check is bypassed

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/matrix.ts:99-113 (R and C are not inferable from `number[][]`), 254-303 (add/sub without a runtime check; matMul has one)
- Failure scenario: `matrixAdd(fromRows([[1,2,3],[4,5,6]]), fromRows([[1,2],[3,4],[5,6]]))` type-checks and returns a 2×3 matrix of element-wise sums of differently shaped data.
- Suggested fix: add the same `rows/cols` RangeError check that matMul has.
- Fix size: S

### 53. [MU-19] [math] Lenient numeric parsing: `bigDecimal("")` is 0, `"0x10"` is 16, `"--5"` is 5, and `"1e"` produces scale NaN; `rat(0.5)` is 0

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/bigdecimal.ts:53-88 (relies on `BigInt(str)`, which accepts "", hex/octal/binary, and a second sign after the stripped one); packages/math/src/types/rational.ts:77-89 (`Math.trunc` on number arguments)
- Problem: malformed input produces a value instead of an error. `rational(1.5, 2)` silently becomes 1/2, and `rationalPow(r, 2.5)` / `numericRational.pow` silently truncate the exponent.
- Suggested fix: validate with `/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i` before parsing. Throw on non-integer number arguments to `rational`/`rat` (point users to `rationalFromNumber`) and on non-integer exponents.
- Fix size: S

### 54. [MU-20] [units] Dimension exponent arithmetic silently saturates at ±5 instead of failing

- Severity: low
- Confidence: high (read: `AddMap["1"]["5"] = P5`, `AddMap["-5"]["-1"] = N5`)
- Location: packages/units/src/types.ts:69-213
- Problem: once finding 2 is fixed, L^5·L would be typed L^5, so it is wrongly compatible with L^5. Overflow should produce `never` or a compile error.
- Suggested fix: map out-of-range sums to `never`, or widen the range.
- Fix size: S

### 55. [MU-21] [units] Unit-alias lookups hit `Object.prototype` keys

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/units/src/unit-aliases.ts (plain object literal), src/index.ts:166-172 (UNIT_CONSTRUCTORS[unitStr]), src/macros.ts:87, 125
- Problem: `UNIT_ALIASES["toString"]` resolves to an inherited function.
- Failure scenario: the runtime `units\`5 toString\``returns the string "[object Undefined]", and`units\`5 hasOwnProperty\``throws an unrelated TypeError. The macro on`units("5 toString")`emits the meaningless`(5)` with no diagnostic.
- Suggested fix: use `Object.hasOwn(UNIT_ALIASES, key)` or a `Map`/null-prototype object.
- Fix size: S

### 56. [MU-22] [math] `vectorSpaceArray(N).vZero()` returns `[]`, which is not an additive identity

- Severity: low
- Confidence: confirmed (repro'd: `vAdd(vZero(), [1,2])` gives `[]`)
- Location: packages/math/src/typeclasses/index.ts (`vZero: () => []`; vAdd iterates `a.length`)
- Problem: this violates the VectorSpace laws, and `normalize`/`project` return `[]` (a length change) for zero input.
- Suggested fix: make vAdd iterate `max(a.length, b.length)`, treating missing entries as `N.zero()`, or make the instance dimension-parameterised.
- Fix size: S

### 57. [SQL-15] [sql] `SimpleTransactor` returns `rows.length` as the affected-row count

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/types.ts:398-402
- Problem: `UpdateIO` returns `result.rows.length`. For pg, `UPDATE`/`DELETE` without RETURNING has `rows = []`; the count is in `rowCount`, which `DbConnection` does not model.
- Failure scenario: an UPDATE affecting 7 rows reports `0` (repro: `affected: 0` with `rowCount: 7`).
- Suggested fix: add `rowCount?: number` to `DbConnection`'s result and return `rowCount ?? rows.length`.
- Fix size: S

### 58. [SQL-16] [sql] Nested-fragment renumbering regex rewrites `$N` inside string literals

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/types.ts:74-77
- Problem: when a Fragment sits in `params`, `.query` renumbers with `/\$(\d+)/g` over the nested rendered text. That also hits `$1` inside quoted literals, comments and dollar-quoted bodies. Reachable via the public `new Fragment(segs, [frag])` (the `sql`` path inlines instead).
- Failure scenario: a nested `note = 'costs $1'` becomes `'costs $2'`.
- Suggested fix: render nested fragments recursively with an offset parameter instead of regex-rewriting text, or flatten nested fragments in the constructor.
- Fix size: S

### 59. [SQL-17] [sql] `Get.array` drops NULL elements, and `Get.number` silently loses precision on int8/numeric strings

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/sql/src/typeclasses.ts:152-155, 275-291
- Problem: `Get.array(Get.number).get([1,null,3])` returns `[1,3]`, which changes length and indices. `Get.number.get("12345678901234567891")` returns `12345678901234567000` with no warning. pg returns BIGINT and NUMERIC as strings by default.
- Failure scenario: positional array data shifts; ids above 2^53 are corrupted silently.
- Suggested fix: keep nulls (type `Get<(A|null)[]>`), or fail the decode. In `Get.number`, reject non-safe integers parsed from strings, or point users to `Get.bigint`.
- Fix size: S

### 60. [SQL-18] [sql] `sql$` calls the checker on interpolations without an `isSyntheticNode` guard, and non-null-asserts `typeToTypeNode`

- Severity: low
- Confidence: high (static)
- Location: packages/sql/src/infer-macro.ts:280-285, 310-312
- Problem: `typeChecker.getTypeAtLocation(span.expression)` runs with no synthetic check (the CLAUDE.md rule), so a `sql$` produced by another macro could throw the `start < 0` crash. `typeToTypeNode(...)!` can return undefined, which leaves an undefined element in the tuple and crashes the printer.
- Failure scenario: a macro that expands to `sql$`...${x}`` throws inside the checker. The error surfaces only as "Tagged template macro expansion failed".
- Suggested fix: when `isSyntheticNode(span.expression)` is true, use `unknown` with a one-line warning; fall back to `unknown` when `typeToTypeNode` returns undefined.
- Fix size: S

### 61. [FMG-13] [graph] Recursive DFS / Tarjan / Johnson overflow the stack on graphs with about 10k+ nodes in a chain

- Severity: low
- Confidence: confirmed (repro'd: `sccG` and `dfsG` on a 20,000-node chain throw `RangeError: Maximum call stack size exceeded`)
- Location: packages/graph/src/generic-algorithms.ts:169-178, 341-367; packages/graph/src/algorithms.ts:84-108
- Problem: recursion depth equals path length. (`findOneCycleG` is already iterative, so the pattern exists in the file.)
- Suggested fix: iterative versions with an explicit stack.
- Fix size: M

### 62. [FMG-14] [fusion] `fused()` with `take` pulls one extra source element and runs upstream side effects on it

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/fusion/src/macros.ts:293-315
- Problem: the counter is checked on the next element, after the upstream maps have already run on it. The runtime `LazyPipeline` avoids this with its post-yield check.
- Failure scenario: `fused(gen().map(log).take(2).toArray())` pulls 3 elements from the generator and logs `[0,1,2]`. On a blocking or expensive iterator this is one extra unit of work, or a hang.
- Suggested fix: after the take decrement, emit `if (__take === 0) { <terminal action>; break; }` (or a post-terminal `if (__take <= 0) break;`).
- Fix size: S

### 63. [FMG-15] [graph] `verify()` (run at compile time by the `stateMachine` macro) enumerates every elementary cycle even though `valid` does not use them

- Severity: low
- Confidence: high (measured growth: 7/8/9 fully connected states give 2,365 / 16,064 / 125,664 cycles; growth is about 8x per state, so 11-12 states means about 10^7 to 10^8 arrays, i.e. an OOM or hang during the build)
- Location: packages/graph/src/state-machine.ts:46-47
- Problem: Johnson's output size is exponential, and a machine with a "reset/cancel from every state" pattern is common.
- Suggested fix: compute cycles lazily or with a cap (or report SCCs), and skip them in the macro path.
- Fix size: S

### 64. [FMG-16] Minor correctness and documentation mismatches (each verified)

- Severity: low
- Confidence: confirmed
- Location / Problem:
  - packages/fusion/src/lazy.ts:83: the `scan` doc says it emits `init` first. The implementation does not: `lazy([1,2,3]).scan((a,b)=>a+b,0)` gives `[1,3,6]`.
  - packages/graph/src/algorithms.ts:234: `transitiveClosure` deletes `u→u` even when `u` lies on a cycle (`A⇄B` gives no `A→A`), contradicting its own "iff v is reachable from u" doc.
  - packages/graph/src/dsl.ts:48-52: `a -> b [x, y]` is split on the comma before label parsing, which creates nodes `"b [x"` and `"y]"`. `a -> b -> c` creates a node named `"b -> c"`. Both happen silently, with no SyntaxError.
  - packages/fusion/src/macros.ts:216: `fusionCounter` is module-global and never reset by the transformer. Generated names depend on how many `fused()` calls the process has expanded before, so builds are not reproducible across watch rebuilds or cache states.
- Suggested fix: fix the doc or the code in each case; throw on a `->` inside targets and on unbalanced `[`; key the counter per file (or use `ctx.generateUniqueName`).
- Fix size: S

### 65. [TSP-9] [parser] `grammar` with interpolations: compile-time path always errors, its fallback emits an undeclared, wrongly-shaped call, and the runtime silently drops interpolations

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/macros.ts:58-91; packages/parser/src/grammar-macro.ts:20-24
- Problem: interpolation positions are replaced by `"???"`, which `parseGrammarDef` always rejects -> `Invalid grammar: ... got "???"` error plus a misleading "falling back to runtime parser" warning. The unreachable fallback would emit `__typesugar_parser.grammar(\`...\`)`(identifier never imported; passes a string where`TemplateStringsArray`is expected ->`strings.join`crash). The runtime`grammar`does`strings.join("")`, discarding `${...}` values without any error.
- Failure scenario: ``grammar`a = "x" ${y}` `` -> build error; at runtime (no transformer) the interpolation vanishes and the grammar silently changes.
- Suggested fix: make interpolation an explicit error in both paths ("not supported"), delete the dead fallback.
- Fix size: S

### 66. [TSP-10] [parser] `regex()` combinator drops the caller's flags

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/combinators.ts:120
- Problem: `new RegExp(pattern.source, "y")` discards `i`, `u`, `s`, `m`.
- Failure scenario: `regex(/abc/i).parse("ABC")` -> `{ok:false}`.
- Suggested fix: `new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "") + "y")`.
- Fix size: S

### 67. [TSP-11] [type-system] `@existential` codegen: unconditional `export`, unhygienic `Exists` reference, and `pack*` body does not satisfy its own return type

- Severity: low
- Confidence: high (read)
- Location: packages/type-system/src/macros.ts:142-271
- Problem: emits `export type AnyX = Exists<X<unknown>>`, `export function packX`, `export function useX` regardless of whether X is exported or where it is declared (inside a namespace/function block an `export function` is a syntax error; in a script file it turns the file into a module). `Exists` is referenced as a bare identifier the user may not have imported. `packX` returns `{ use: ... }` typed as `AnyX`, but `Exists` requires `__exists_brand__`, so the generated code is a type error wherever it is type-checked (d.ts/expansion preview). It also passes `witness: X<T>` where `X<unknown>` is required by `Exists`.
- Suggested fix: copy the interface's export modifier, import/qualify `Exists` hygienically, emit `as AnyX` (or call the runtime `packExists`).
- Fix size: S

### 68. [TSP-12] [parser] Compiled grammar `parseAll` reports a different (worse) error position than the runtime parser

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/codegen.ts:85-96 (`__furthestPos` declared, never updated)
- Problem: runtime `buildParser().parseAll` tracks the furthest failure; the compiled one reports `result.pos`. Repetition swallows the deep failure.
- Failure scenario: grammar `list = item* ";"`, `item = "a" "b"`, input `aaX;`: runtime "line 1, col 2: expected \"b\""; compiled "line 1, col 1: expected \";\"". The compiled path is the default when the transformer runs, so behaviour differs between test (runtime) and build.
- Suggested fix: track furthest failure in the generated `__fail`.
- Fix size: S

### 69. [TSP-13] [type-system] Type-level arithmetic macros: checker call without `isSyntheticNode`, and non-finite / non-integer results emit invalid or nonsense literal types

- Severity: low
- Confidence: medium (synthetic-arg path not repro'd); high for the numeric part (read)
- Location: packages/type-system/src/macros.ts:465 (`getTypeFromTypeNode`), :472-485, :730 (Pow), :985 (IsOdd)
- Problem: `extractNumericLiteral` calls the checker on an arg that may be another macro's synthetic node with no `isSyntheticNode` guard and no warning on failure (CLAUDE.md rule 3). `Pow<-8, 0.5>` -> `createNumericLiteral(NaN)` emits type `NaN`; `Pow<10, 400>` emits `Infinity` (both undefined type names). `IsOdd<2.5>` -> `true`, `IsEven<2.5>` -> `false`.
- Suggested fix: guard with `isSyntheticNode`; report an error for non-finite results; require integers for Div/Mod/IsEven/IsOdd.
- Fix size: S

### 70. [TSP-14] [type-system] `createBuilder` branches share one mutable state object

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/type-system/src/phantom.ts:296-313
- Problem: every `set` mutates the same `data` and returns the same builder, though the type API presents each `set` as a new typed builder.
- Failure scenario: `b1 = B.set("a",1); b2 = B.set("a",2); b1.build()` -> `{a: 2}`.
- Suggested fix: return a new builder over `{...data, [key]: value}`.
- Fix size: S

### 71. [TSP-15] [type-system] Refinement types whose brand ignores their parameters / doc-vs-type mismatches in Vec arithmetic

- Severity: low
- Confidence: high (read)
- Location: packages/type-system/src/refined.ts:532-541 (MaxLength/MinLength), :172-178 (composeRefinements); vec.ts:62-70 (Sub), :74-83 (Min)
- Problem: `MaxLength<T>(5)` and `MaxLength<T>(100)` produce the same type `Refined<T[], "MaxLength">`, so a value checked against 100 typechecks as max-5. `composeRefinements` return brand `B1 & B2 extends string ? ...` collapses to `never` for distinct literal brands. `Sub` is documented as "returns 0 if negative" but returns `number`, so `Min<3, 7>` = `number` (Vec.take loses its length); tables cover 0-10 while the doc says 0-20.
- Suggested fix: include the bound in the brand (`` `MaxLength<${N}>` ``); fix the composed brand type; fix or document the arithmetic.
- Fix size: S

### 72. [TSP-16] [parser] Grammar DSL: no `\u`/`\x` escapes, and parenthesized groups cannot span lines

- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/grammar.ts:58-79 (escapes), :212 (sequence breaks on `\n`)
- Problem: `"A"` becomes the literal `u0041` with no error; `( "a"\n "b" )` is a syntax error (only `|` continuations are allowed across lines).
- Suggested fix: support `\uXXXX`/`\xXX` (or reject unknown escapes); allow newlines inside a group (track paren depth).
- Fix size: S

## 1.0 gaps

### math, units, PEP-048 triage

- PEP-048 status mismatch: the math, units and parser READMEs (and the root README "Frozen" section) say these packages are "excluded from release". PEP-058 Wave 1 superseded that: `.changeset/config.json` has `"ignore": []`, so all three are published at 0.1.1 next to the Keep packages. Update the banners to "published, not maintained".
- The package.json descriptions of every package start with 🧊, the same glyph the READMEs use for the "Frozen" banner, so Keep packages (sql, graph, fusion, mapper, type-system) look frozen in npm listings. Either use a different brand glyph or drop it from the descriptions.
- The root README's showcase ("Tagged Templates", around line 237) leads with `units\`100 km/h\`` "Dimensional analysis" from a Frozen package whose dimensional analysis does not type-check (finding 2) and whose macro never expands (finding 1).
- PEP-048 keep-conditions are still open: mapper #9 and type-system #10 (both OPEN on GitHub, re-triage 2026-12-10). type-system has 0 in-package tests (root red-team tests only). Neither package carries an experimental marker.
- sql is "Keep (Wedge)" on the strength of PEP-043, which is still Draft, and its core monad is a stub (sql finding 1). A credible 1.0 needs either the fix or an "experimental" label.
- math: the conversions module (`*ToFixed/*ToMoney/*ToRational`) has no tests, and findings 5 and 11 live there. No rounding-mode test covers HALF_CEIL/HALF_FLOOR.
- units: no type-level tests (no `@ts-expect-error` / expectTypeOf), and no macro-expansion test; the test suite exercises only the runtime fallback.
- units: stale doc comment on `Unit.to()` (types.ts:379-381) says celsius stores values as-is and absolute conversion does not work. The code now applies the offset (`celsius(100).to(fahrenheit)` gives 212), so absolute conversion works, but a temperature _difference_ converted with `.to()` is now wrong.

### sql

- PEP-048 tiers sql as "Keep — Wedge" justified only by PEP-043 (compile-time schema verification), and PEP-043 is still **Draft**. The package is at 0.1.1 with no stability banner, while its core monad (#1) and typed macro (#2) do not work.
- `@schema` (infer-macro.ts:390-400) is a no-op expression macro, and nothing ever calls `registerSchema`. The documented schema-based result-type inference (`SELECT *` gives `UsersTable`) cannot fire.
- `sql$` has no runtime or ambient declaration in dist/index.d.ts, and the documented `sqlKind<...>` macro does not exist.
- Two parallel, overlapping typeclass APIs ship in the same entry: `meta.ts` (exported as Legacy\* types plus `stringMeta`/`nullable`/...) and `typeclasses.ts` (`Get`/`Put`/`Meta`/`Read`). The typed `ConnectionIO` imports the legacy `Read`. Pick one before 1.0.
- Two ConnectionIO/Transactor implementations (`SimpleConnectionIO`/`SimpleTransactor` vs `ConnectionIO`/`Transactor`) have incompatible `DbConnection` shapes. The docs mix them.
- `parZip`/`parSequence` are documented as parallel but are sequential, and `ConnectionIO.async` is a `Delay` alias.
- `TypedQuery.unique()`/`option()`/`to()` and `TypedUpdate.run()`/`withGeneratedKeys` are type-only no-ops. `unique()` does not enforce exactly one row.
- `auto-derive-strategies.ts` is dead code (never imported); summon-based auto-derivation of Read/Write/Codec is documented in its header but not wired.
- There are no tests of any macro expansion in packages/sql (`sql`, `sql$`, `@derive(Meta)`, `@derive(Read/Write/Codec)`). Every runtime test calls the helpers directly, which is how #2, #4 and #14 went unnoticed.
- `validateSqlSyntax` (macro-utils.ts) is exported but unused. It counts parens inside string literals (`SELECT ')'` raises a hard error), and its "injection pattern" warnings are cosmetic.

### fusion, mapper, graph

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

### type-system, parser

- docs/guides/type-system.md documents APIs that do not exist: `opaqueModule<number,"UserId">({validate,error})` + `.make` (real: `opaqueModule<R>(brand, validate)(ops)` + `.create`), `createStateMachine<S>().state().build()` + `Door.transition(...)` (real: config object; `createStateMachine()` throws), `Vec.concat` (real: `append`), the `@io` decorator, `assertPure` compile errors, and `import { Mul, Div, Mod, Pow }` (only `Add`/`Sub`/`Min` types are exported, and those are the lookup-table types, not the macros).
- type-system Keep condition (PEP-048: "add tests") is still unmet: no in-package tests at all, only the root tests/red-team-type-system.test.ts, which documents bug #2 instead of failing on it. Re-triage date 2026-12-10.
- The `refine` macro claims "validates a literal at compile time"; its comptime branch is an empty block (macros.ts:400-407) and there is no runtime `refine` export. `unsafeRefineMacro` and `effectAttribute` are defined but never registered.
- `widen` claims "at compile time ... verifies the subtyping relationship exists"; there is no widen macro, and `widen<Positive>(Negative.refine(-1))` compiles.
- `@phantom` claims to "generate typed overloads that enforce state transitions"; it only emits a `XStates` type alias.
- `opaqueModule` and `stateMachine` are registered as identity pass-through macros (pure registry noise, and unscoped, see #1).
- `Lowercase`/`Uppercase` exports shadow TypeScript's intrinsic `Lowercase<S>`/`Uppercase<S>` in any file that imports them.
- parser README says Frozen and "excluded from release", but PEP-058 Wave 1 removed the changeset ignore list (`.changeset/config.json` `ignore: []`), so @typesugar/parser is published. The README also says "Phase 2 will add compile-time code generation", which is already shipped and is the default path when the transformer runs.
- parser IR has an `action` rule type with no grammar syntax and a pass-through implementation ("future concern") in both the runtime and the codegen; `Grammar<T>` results are untyped nested arrays (`T` is never inferred), so the public `Grammar<T>` generic is a type that is not checked.
- parser compiled output wraps every sequence/alternation element in a fresh IIFE per call (closure allocation per parse step), which contradicts the "zero-cost" claim in the package description.
