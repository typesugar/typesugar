# Findings: packages/type-system/src + packages/parser/src

Repro scripts: /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/p1.cjs (parser dist) and
/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/p2.cjs (transformCode + type-system/parser macros; note: this one peaked at ~840 MB footprint, above the brief's ~300 MB guidance; run once, ~2 s).

### 1. Most type-system macros have no `module`, so they fire on ANY same-named identifier, including foreign imports (wrong runtime code)
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

### 2. `createStateMachine` sets `state` to the transition FUNCTION after any transition; invalid transitions are not rejected
- Severity: high
- Confidence: confirmed (repro'd against dist)
- Location: packages/type-system/src/phantom.ts:185-226
- Problem: the target-state lookup iterates `Object.entries(config)` (i.e. `initial`, `initialData`, `transitions`) and picks the first object containing `name` — which is `config.transitions`, so `targetState = transitions[name]` = the transition function. The state graph `Def` is type-only, so the runtime has no way to know the target. Transitions are callable from any state; the instance param type is `StateMachineInstance<Data, string>`, so there is no compile-time check either. Transition names `create`/`getState`/`is` silently overwrite the module methods.
- Failure scenario: `M = createStateMachine({initial:"closed", initialData:{n:0}, transitions:{open: d=>({n:d.n+1})}}); b = M.open(M.create())` -> `typeof b.state === "function"`, `M.is(b, "open") === false`; `M.open(b)` from "open" is allowed. tests/red-team-type-system.test.ts:748 documents the bug ("FINDING ...") and simply doesn't assert on `state`.
- Suggested fix: require the state table at runtime (e.g. `config.states: Def`), look up `config.states[instance.state][name]`, throw on an undefined transition, and type transition params as `StateMachineInstance<Data, S>` with `S` constrained to states that have that transition. Otherwise remove/mark experimental.
- Fix size: M

### 3. `packExists` macro changes evaluation semantics: the witness expression is re-evaluated on every `.use`
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/type-system/src/macros.ts:276-311
- Problem: the macro emits `{ use: f => f(<arg>) }` with the argument expression inlined in the arrow body; the runtime `packExists(witness)` (existential.ts:86) evaluates it once.
- Failure scenario: `let n = 0; const p = packExists({ v: n++ })` -> emitted `{ use: f => f({ v: n++ }) }`; each `useExists(p, ...)` sees a new object and increments `n`. `packExists(openConnection())` opens a connection per use.
- Suggested fix: hoist the argument to a temp (`(w => ({ use: f => f(w) }))(arg)`), or just leave the call to the runtime function (it is already tiny; the "zero-cost" claim is false either way since an object is allocated).
- Fix size: S

### 4. Grammar left-recursion check misses nullable prefixes; such grammars stack-overflow at parse time
- Severity: medium
- Confidence: confirmed (repro'd against dist, both runtime and compiled paths)
- Location: packages/parser/src/grammar.ts:368-401 (`firstRefsAre`)
- Problem: for a `sequence` only `rules[0]` is inspected; if that element can match empty (`x?`, `x*`, `!x`, `&x`, or a reference to a nullable rule) the next element is also in left position. `negation`/`lookahead` return false outright.
- Failure scenario: `a = "x"? a "y" | "z"`, `a = !"q" a | "z"`, `a = b a "y" | "z"` with `b = "x"*` all pass `parseGrammarDef` (and the compile-time `grammar` macro's validation), then `parse("z")` throws `RangeError: Maximum call stack size exceeded`.
- Suggested fix: compute a nullable set (fixpoint over rules), and in `sequence` keep walking elements while the previous one is nullable; treat negation/lookahead/optional/repetition(min 0) as nullable and recurse into their inner rule.
- Fix size: M

### 5. `@effect` is defined but never registered, so `@pure` effect checking can never report anything; the registry is a never-cleared global keyed by bare name
- Severity: medium
- Confidence: high (read; `register()` at macros.ts:1281-1310 has no `effectAttribute`, and grep finds no other registration)
- Location: packages/type-system/src/macros.ts:1180 (effectAttribute), :1305 (register), effects.ts:127-200
- Problem: only `registerPure` ever runs at compile time, and `checkEffectCall` only errors when the callee is effectful, so no diagnostic is reachable. Even once fixed: entries are keyed by bare function name (and callee matched by property name, `obj.save()` matches any `save`), the registry lives in a module global that is never cleared between files/programs/watch rebuilds (stale entries after a rename), and checking is order-dependent across files (CLAUDE.md "live registry" rule: this is neither same-pass-keyed nor symbol-keyed). docs/guides/type-system.md:308-325 advertises `@io` (no such decorator) and "assertPure(() => log(...)) // Compile error" (assertPure is a runtime no-op).
- Failure scenario: `@effect("io") function log(){}  @pure function f(){ log() }` -> no error.
- Suggested fix: register `effectAttribute` (scoped by module), key annotations by resolved symbol/declaration, reset the registry per program; or demote the feature to experimental and fix the docs.
- Fix size: M

### 6. `Vec<T, N>` length invariant is not enforced: `Vec.from` check is tautological and the array is mutable
- Severity: medium
- Confidence: high (mutation repro'd; inference point by reading TS return-type inference)
- Location: packages/type-system/src/vec.ts:190-192, 252-254 (`from`), 205-225 (`createVec`)
- Problem: `Vec.from<T, N>(arr)` calls `createVec(arr, arr.length as N)` — the length check compares `arr.length` to itself. `N` is inferred from the contextual return type, so `const v: Vec<number, 3> = Vec.from([1, 2])` typechecks and yields a length-2 "Vec<3>". The Vec type keeps `push/pop/splice`, so `v.push(4)` compiles and `Vec.length(v)` returns 4 typed as `3`. @typesugar/contracts-refined treats `Vec<T,N>.length === N` as a PROVEN type fact (guide: "requires(Vec.length(v) === 3); // PROVEN"), so runtime checks are elided on a false fact.
- Failure scenario: as above; repro: `v = Vec.from([1,2,3]); v.push(4); Vec.length(v) === 4; isVec(v) === true`.
- Suggested fix: type Vec over `readonly T[]` and `Object.freeze` the branded copy; make `from` take a tuple (`from<const A extends readonly T[]>(arr: A): Vec<T, A["length"]>`) or an explicit expected length that is checked.
- Fix size: M

### 7. `opaqueModule` erases the brand to `string`: all opaque modules over the same Repr are interchangeable
- Severity: medium
- Confidence: high (read)
- Location: packages/type-system/src/opaque.ts:140-143, 192-206
- Problem: `opaqueModule<Repr>(brand: string, ...)` has no `Brand` type parameter and `OpaqueModuleResult` uses `Opaque<Repr, string>` throughout, so `UserId.create(1)` is accepted by `OrderId.someOp(...)` — the core promise of an opaque type. Also every op whose return type extends `Repr` is retyped as a validated `Opaque` without running `validate` (e.g. `PositiveInt.toNumber(x)` is typed as an opaque PositiveInt; a user op `negate: n => -n` returns a "PositiveInt" of -5).
- Failure scenario: two `opaqueModule<number>` modules; passing one's value to the other compiles.
- Suggested fix: `opaqueModule<Repr, Brand extends string>(brand: Brand, ...)` and thread `Brand` through `OpaqueModuleResult`; only retype op results as opaque when the op is wrapped with validation.
- Fix size: S

### 8. Unlisted string->AST codegen: `grammar` macro builds JS source text and calls `ctx.parseExpression`
- Severity: medium (CLAUDE.md rule: "an unlisted call site is a bug")
- Confidence: confirmed (read)
- Location: packages/parser/src/macros.ts:96 (`return ctx.parseExpression(code)`), code from packages/parser/src/codegen.ts (`generateParserCode`, string concatenation)
- Problem: not in the CLAUDE.md exhaustive exception list; the entire Phase-2 codegen is template strings.
- Failure scenario: rule violation; also the generated text is not hygienic-by-construction (relies on an IIFE scope) and cannot be composed with other AST transforms.
- Suggested fix: since parser is Frozen, add a CLAUDE.md entry with justification (or fall back to emitting the runtime `buildParser(parseGrammarDef(...))` call as AST); migrating codegen.ts to ts.factory is the full fix.
- Fix size: S (doc entry) / L (migration)

### 9. `grammar` with interpolations: compile-time path always errors, its fallback emits an undeclared, wrongly-shaped call, and the runtime silently drops interpolations
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/macros.ts:58-91; packages/parser/src/grammar-macro.ts:20-24
- Problem: interpolation positions are replaced by `"???"`, which `parseGrammarDef` always rejects -> `Invalid grammar: ... got "???"` error plus a misleading "falling back to runtime parser" warning. The unreachable fallback would emit `__typesugar_parser.grammar(\`...\`)` (identifier never imported; passes a string where `TemplateStringsArray` is expected -> `strings.join` crash). The runtime `grammar` does `strings.join("")`, discarding `${...}` values without any error.
- Failure scenario: ``grammar`a = "x" ${y}` `` -> build error; at runtime (no transformer) the interpolation vanishes and the grammar silently changes.
- Suggested fix: make interpolation an explicit error in both paths ("not supported"), delete the dead fallback.
- Fix size: S

### 10. `regex()` combinator drops the caller's flags
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/combinators.ts:120
- Problem: `new RegExp(pattern.source, "y")` discards `i`, `u`, `s`, `m`.
- Failure scenario: `regex(/abc/i).parse("ABC")` -> `{ok:false}`.
- Suggested fix: `new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "") + "y")`.
- Fix size: S

### 11. `@existential` codegen: unconditional `export`, unhygienic `Exists` reference, and `pack*` body does not satisfy its own return type
- Severity: low
- Confidence: high (read)
- Location: packages/type-system/src/macros.ts:142-271
- Problem: emits `export type AnyX = Exists<X<unknown>>`, `export function packX`, `export function useX` regardless of whether X is exported or where it is declared (inside a namespace/function block an `export function` is a syntax error; in a script file it turns the file into a module). `Exists` is referenced as a bare identifier the user may not have imported. `packX` returns `{ use: ... }` typed as `AnyX`, but `Exists` requires `__exists_brand__`, so the generated code is a type error wherever it is type-checked (d.ts/expansion preview). It also passes `witness: X<T>` where `X<unknown>` is required by `Exists`.
- Suggested fix: copy the interface's export modifier, import/qualify `Exists` hygienically, emit `as AnyX` (or call the runtime `packExists`).
- Fix size: S

### 12. Compiled grammar `parseAll` reports a different (worse) error position than the runtime parser
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/codegen.ts:85-96 (`__furthestPos` declared, never updated)
- Problem: runtime `buildParser().parseAll` tracks the furthest failure; the compiled one reports `result.pos`. Repetition swallows the deep failure.
- Failure scenario: grammar `list = item* ";"`, `item = "a" "b"`, input `aaX;`: runtime "line 1, col 2: expected \"b\""; compiled "line 1, col 1: expected \";\"". The compiled path is the default when the transformer runs, so behaviour differs between test (runtime) and build.
- Suggested fix: track furthest failure in the generated `__fail`.
- Fix size: S

### 13. Type-level arithmetic macros: checker call without `isSyntheticNode`, and non-finite / non-integer results emit invalid or nonsense literal types
- Severity: low
- Confidence: medium (synthetic-arg path not repro'd); high for the numeric part (read)
- Location: packages/type-system/src/macros.ts:465 (`getTypeFromTypeNode`), :472-485, :730 (Pow), :985 (IsOdd)
- Problem: `extractNumericLiteral` calls the checker on an arg that may be another macro's synthetic node with no `isSyntheticNode` guard and no warning on failure (CLAUDE.md rule 3). `Pow<-8, 0.5>` -> `createNumericLiteral(NaN)` emits type `NaN`; `Pow<10, 400>` emits `Infinity` (both undefined type names). `IsOdd<2.5>` -> `true`, `IsEven<2.5>` -> `false`.
- Suggested fix: guard with `isSyntheticNode`; report an error for non-finite results; require integers for Div/Mod/IsEven/IsOdd.
- Fix size: S

### 14. `createBuilder` branches share one mutable state object
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/type-system/src/phantom.ts:296-313
- Problem: every `set` mutates the same `data` and returns the same builder, though the type API presents each `set` as a new typed builder.
- Failure scenario: `b1 = B.set("a",1); b2 = B.set("a",2); b1.build()` -> `{a: 2}`.
- Suggested fix: return a new builder over `{...data, [key]: value}`.
- Fix size: S

### 15. Refinement types whose brand ignores their parameters / doc-vs-type mismatches in Vec arithmetic
- Severity: low
- Confidence: high (read)
- Location: packages/type-system/src/refined.ts:532-541 (MaxLength/MinLength), :172-178 (composeRefinements); vec.ts:62-70 (Sub), :74-83 (Min)
- Problem: `MaxLength<T>(5)` and `MaxLength<T>(100)` produce the same type `Refined<T[], "MaxLength">`, so a value checked against 100 typechecks as max-5. `composeRefinements` return brand `B1 & B2 extends string ? ...` collapses to `never` for distinct literal brands. `Sub` is documented as "returns 0 if negative" but returns `number`, so `Min<3, 7>` = `number` (Vec.take loses its length); tables cover 0-10 while the doc says 0-20.
- Suggested fix: include the bound in the brand (`` `MaxLength<${N}>` ``); fix the composed brand type; fix or document the arithmetic.
- Fix size: S

### 16. Grammar DSL: no `\u`/`\x` escapes, and parenthesized groups cannot span lines
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/parser/src/grammar.ts:58-79 (escapes), :212 (sequence breaks on `\n`)
- Problem: `"A"` becomes the literal `u0041` with no error; `( "a"\n "b" )` is a syntax error (only `|` continuations are allowed across lines).
- Suggested fix: support `\uXXXX`/`\xXX` (or reject unknown escapes); allow newlines inside a group (track paren depth).
- Fix size: S

## 1.0 gaps

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
