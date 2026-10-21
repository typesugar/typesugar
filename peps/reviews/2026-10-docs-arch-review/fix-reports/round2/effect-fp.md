## effect-fp fix report

**Per finding**

- **A#2 (fp `let:` over Option/Either): partially fixed.** Test: `packages/fp/src/do-notation.e2e.test.ts`, which transforms the examples and runs the output against fp dist.
  - Before the fix, the output was `10..flatMap(...)` (TypeError), and the Either and IO versions threw `Right(...).flatMap is not a function` the same way.
  - The fix adds `@do-methods bind=flatMap map=map style=static receiver=<instance>` to all four fp FlatMap instances (`flatMapOption`, `flatMapEitherInstance`, `flatMapIO`, `flatMapList`). Output is now `flatMapOption.flatMap(10, x => flatMapOption.map(x * 2, y => x + y))`, which gives 30. None short-circuits to null, Right gives `{right: 30}`, Left stays Left, and IO runs to 30.
  - **Still broken:** the doc Quick Start doesn't import `flatMapOption`, so the output hits a ReferenceError. The test "Option without importing the instance" is marked `it.fails` and documents this. It needs the std change below.
  - fp dist is rebuilt.
- **A#6 / W#11 (effect `layerMake` over `@layer` consts): fixed for layerMake. The `let:` Quick Start is not fixable in my packages.** Tests: `packages/effect/tests/generated-code.e2e.test.ts`, describe "layerMake<R>() over @layer consts".
  - `layerMake` now looks each argument up in the same `layerRegistry` that `resolveLayer` uses, before trying the type. It follows import aliases with the checker, guarded by `isSyntheticNode`, and warns if the checker fails.
  - The type check alone can't do this: the checker sees the undecorated initializer, and an `Effect.gen` body would be misread as a Layer.
  - Through dist, the Quick Start in `Effect.gen` + `yield* DatabaseTag` form runs and prints `got rows for SELECT 42`.
  - **Not fixed:** `db << Database` / `db << DatabaseTag` inside `let:` still fails with "Could not infer type constructor". The `@service` tag/namespace is generated in the same pass, so the checker has never seen it. Type inference for that lives in std (see Needs).
  - The vanishing `const userRepoLive =` is not specific to effect: `const r = let: { x << thing; } yield: {x}` with an un-inferable `thing` also drops the declaration on the error path (std/preprocessor).
  - Effect dist is rebuilt.
- **A#11 (EFFECT001/EFFECT020 codes): fixed.** Tests: the same describe block (the EFFECT001 tests for layerMake and resolveLayer, and the EFFECT020 cycle test).
  - A new helper, `reportEffectDiagnostic(ctx, descriptor)` in `effect/src/diagnostics.ts` (also exported from index), sends these through `ctx.diagnostic`.
  - Missing layers now give one error per service, e.g. `[TS9901] [EFFECT001] No layer provides \`Database\``, with a note naming the layer that requires it (or the out-of-scope provider) and a help line.
  - Cycles give `[TS9920] [EFFECT020] Circular layer dependency detected` with the note `Dependency cycle: A → B → A`.
  - EFFECT002/003/010/011/021/030/040 remain defined but unemitted.

**What the docs should now say**

- fp Option/Either/IO/List comprehensions compile to static instance calls. Until the std change lands, examples must import the instance (`flatMapOption`, `flatMapEitherInstance`, `flatMapIO`).
- `layerMake<R>(...)` accepts `@layer` consts as well as real Layer values.
- Effect layer bodies should use `Effect.gen(function* () { const db = yield* DatabaseTag; ... })`, not `let: { db << Database }`.
- Error text is `[EFFECT001] No layer provides \`X\``(with note and help) and`[EFFECT020] Circular layer dependency detected` (note: the cycle). It is not the Rust-style multi-span rendering the guide shows. EFFECT010/030/040 are planned, not implemented.

**Decisions**

- Each fp instance is its own static receiver.
- Diagnostics carry both the numeric code (TS99xx, so tooling sees it) and an `[EFFECTnnn]` prefix in the message.
- layerMake reports one EFFECT001 per missing service rather than one combined list.

**Needs from other owners**

1. **std `packages/std/src/macros/let-yield.ts` (around lines 250-258).** Today the self-receiver import only happens for std's Iterable instances (`STD_SELF_RECEIVER_INSTANCES`). Generalise it:
   ```ts
   if (doMeta.style === "static" && doMeta.receiver === scoped.exportName) {
     const from = STD_SELF_RECEIVER_INSTANCES.has(scoped.exportName)
       ? STD_DO_MODULE
       : scoped.modulePath
         ? (getDoInstanceModule(ctx.program, typeConstructorName) ??
           KNOWN_DO_INSTANCE_MODULES[typeConstructorName])
         : undefined;
     if (from) doMeta = { ...doMeta, receiver: ctx.ensureImport(scoped.exportName, from).text };
   }
   ```
   `par-yield.ts` probably needs the same. After that, flip `it.fails` to `it` in `packages/fp/src/do-notation.e2e.test.ts`.
2. **std `comprehension-utils.ts` `inferTypeConstructor`.** It can't type a same-file `@service` tag (`db << DatabaseTag` / `db << Database`), because the tag is generated in the same pass. This needs a live-registry-based hook if the `let:` Quick Start form is to be supported.
3. **std/transformer preprocessor.**
   - A failed `const x = let: ... yield: ...` expansion drops the `const x =` declaration.
   - `x << (None as Option<number>)` (generic `<...>` inside a bind) is mangled into `let, { x }; <(None, as, Option, , number) => >`.
4. **Separate issue (not fixed):** `let:` over a List built with `Cons(...)` infers brand `Cons` and reports TS9225 "No FlatMap instance for 'Cons'".

**Files changed**

- `/Users/deapovey/src/personal/typesugar/packages/fp/src/instances.ts`
- `/Users/deapovey/src/personal/typesugar/packages/fp/src/do-notation.e2e.test.ts` (new)
- `/Users/deapovey/src/personal/typesugar/packages/effect/src/diagnostics.ts`
- `/Users/deapovey/src/personal/typesugar/packages/effect/src/index.ts`
- `/Users/deapovey/src/personal/typesugar/packages/effect/src/macros/layer-make.ts`
- `/Users/deapovey/src/personal/typesugar/packages/effect/src/macros/resolve-layer.ts`
- `/Users/deapovey/src/personal/typesugar/packages/effect/tests/generated-code.e2e.test.ts`
- fp and effect dist (rebuilt)

**Status**

- The fp e2e file passes 4/4 (one of them is the expected `it.fails`).
- Effect `generated-code.e2e` passes 35/35, and layer-make, diagnostics, macros and layer-graph pass 45/45.
- tsc is clean for both packages and prettier has been run.
- Nothing is left failing, and no processes of mine are still running.
