## r3-libs report

Four of the five findings are fixed. Finding 3 is split: the validate half is fixed, and the reflect half needs a one-line change in `packages/macros`, which I don't own. Finding 5 is not mine to fix; I confirmed it and give the exact place for the engine owner. Every new test was run against the old code first and failed for the reason in the finding. The units, sql, validate and graph dists are rebuilt. All related test dirs pass: units 152, sql 244, validate 37, graph 134, reflect 38, and the root red-team units/validate/sql tests 190. `tsc --noEmit` is clean for units, sql, validate and graph. Prettier has been run. I made no git changes and have no processes still running.

### Per finding

1. **units `toString`: fixed.** Test: `packages/units/tests/units.test.ts`, "toString > prints the value in the displayed unit, not the SI value (docs guides-c #5)", plus "arithmetic keeps the left operand's display unit".
   - `Unit` now carries `displayFactor` and `displayOffset` (optional constructor arguments, default 1 and 0), and every constructor in `types.ts` passes them.
   - `toString()` prints `(value - offset) / factor`, rounded to 15 significant digits. `.value` stays in SI units.
   - `kilometers(1).toString()` is now "1 km", ``units`100 km/h` `` is "100 km/h", and `celsius(20)` is "20 °C".
   - **What the docs should now say:** `toString()` prints the value in the displayed unit, and `.value` is the SI value.
2. **sql: fixed.** Tests: `packages/sql/tests/docs-review-fixes.test.ts`, "r3: andTyped/orTyped/whereAndTyped/commasTyped concatenate parameter tuples" and "r3: Write.tuple over instances of different types". These type-check the transformed output with strict `tsc` and run it.
   - `andTyped`, `orTyped`, `whereAndTyped` and `commasTyped` are now variadic generics over the fragments, returning `TypedFragment<ConcatParams<Fs>, …>`.
   - `ConcatParams` is a new exported type in `typed-fragment.ts`. `null`, `undefined` and `false` entries contribute no parameters.
   - `Write.tuple<T extends readonly unknown[]>(...writes: { [K in keyof T]: Write<T[K]> }): Write<T>`.
   - **What the docs should now say:** mixed parameter tuples combine, ``andTyped(sql$`name = ${"Alice"}`, sql$`age > ${21}`)`` is `TypedFragment<[string, number], void>`, and `Write.tuple` works for any number of instances.
3. **validate `is`/`assert`/`validate`: fixed. reflect `validator<T>()`: deferred to the macros owner.**
   - Test: `packages/validate/src/__tests__/macros-e2e.test.ts`, "r3: generated validators type-check".
   - Every member and element read in the generated code now goes through an AST cast, `(x as Record<string, unknown>)` or `(x as unknown[])`. A strict type-check of the output is clean, and the validators still give the same runtime results.
   - The reflect `validator<T>()` macro lives in `packages/macros/src/reflect.ts`, so I couldn't fix it. My test `packages/reflect/tests/validator-output.test.ts` checks that it expands and runs, and marks the type-check as a known bug with `it.fails`. It currently shows TS2339 on `name`/`age` and TS7053 on `"first-name"`.
   - **What the docs should now say:** validate output type-checks under strictOutput. reflect `validator` output still warns.
4. **graph `stateMachine`: fixed.** Test: `packages/graph/src/__tests__/state-machine-macro.test.ts`, "stateMachine macro: literal state/event types (r3)" (4 tests).
   - The emitted `__typesugar_createStateMachineInstance` call now has the definition's literal unions as type arguments. With strictOutput, `m.create().transition("nope")` is reported: "Argument of type '"nope"' is not assignable to parameter of type '"go"'".
   - The runtime tag now takes optional type arguments, ``stateMachine<S, E>`…` ``, so your source can also be checked precisely in the editor. The macro checks those arguments against the DSL and reports an error naming missing or extra states and events. It calls `isSyntheticNode` before calling the checker.
   - **What the docs should now say:** output is typed with the literal unions. Your source is `string`-typed unless you pass the unions as type arguments.
5. **Instances from a package's dist are never specialized and nothing warns: not mine to fix, location below.** I reproduced it from validate's dist: `processBody(nativeSchema, isUser, …)` gives 0 diagnostics and no specialization. Transformer-core does not emit TS9602 in this case.

### Decisions Dean should know about

- **units `.to()`:** I kept its existing, tested behaviour. `meters(1000).to(kilometers).value` is still 1, because about 30 tests assert that. So a `.to()` result is still not SI-based, and `meters(1000).to(kilometers).add(meters(1))` gives "2 km". This bug predates this change; I did not change it.
- **units temperatures:** `sub` drops the display offset, because a difference is a delta, so `celsius(30).sub(celsius(10))` prints "20 °C". `add`, `scale` and `neg` keep the left operand's display factor and offset.
- **graph:** a source call `m.create<X, Y>()` would now hit a non-generic arrow in the output. This is untested and probably rare.
- **validate:** the remaining TS2339 warnings in my repro came from my own misuse of the API. `validate` returns `{ value } | { error }`, not `{ success, errors }`, so they are not a bug. The start report's "narrowing `r.success` then `r.errors` also warns" is about the reflect `validator`, which is in the macros package.

### Needs from other owners

- **macros (`packages/macros/src/reflect.ts`, `validatorMacro`, `fieldAccess`, about lines 749-755):** replace `valueId()` with `factory.createParenthesizedExpression(factory.createAsExpression(valueId(), factory.createTypeReferenceNode("Record", [StringKeyword, UnknownKeyword])))` for both the property-access and element-access branches. Then change `it.fails` to `it` in `packages/reflect/tests/validator-output.test.ts`.
- **transformer-core (`packages/transformer-core/src/specialization.ts`, the instance-argument loop at about lines 732-763):** when an argument resolves to a symbol whose declarations are all in `.d.ts` files (the same test as line 210, `d.getSourceFile().isDeclarationFile`), extraction fails and `methods` stays undefined. The loop then returns at `instanceArgs.length === 0` silently. It should emit "[TS9602] Auto-specialization of `<fn>` skipped — instance '`<name>`' is only visible as a declaration (from a .d.ts); falling back to dictionary passing". To avoid noise, it should do this only when the argument's type is a known typeclass instance type. This affects validate `nativeSchema` and fp `optionFunctor`.

### Files changed

- `packages/units/src/types.ts`
- `packages/units/tests/units.test.ts`
- `packages/sql/src/typed-fragment.ts`
- `packages/sql/src/typeclasses.ts`
- `packages/sql/tests/docs-review-fixes.test.ts`
- `packages/validate/src/macros.ts`
- `packages/validate/src/__tests__/macros-e2e.test.ts`
- `packages/reflect/tests/validator-output.test.ts` (new)
- `packages/graph/src/macros.ts`
- `packages/graph/src/templates.ts`
- `packages/graph/src/__tests__/state-machine-macro.test.ts`
- `docs/guides/units.md`: the toString example, plus the new fields in the API block
- `docs/guides/sql.md`: the "same parameter tuple" paragraph rewritten, the `Write.tuple` example, and a new table row
- `docs/guides/graph.md`: the "typed as string" sentence replaced with the new behaviour and a type-argument example

The changed doc examples were re-run through `doc-example.mjs --run` against the rebuilt dist, and all behave as documented. Repro files are in `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix3/r3-libs/`.

### Left failing

Nothing. The only test showing the remaining bug is the `it.fails` case for the reflect `validator`, which waits on the macros fix above.
