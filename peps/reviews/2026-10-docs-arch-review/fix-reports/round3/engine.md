## r3-engine report

All six numbered findings are fixed, along with the extra item from r3-libs and the three items from r3-macros. For every one I wrote a failing test first (most of them execute the generated code), confirmed it failed for the reported reason, then fixed it. I rebuilt the core, macros and transformer-core dists and re-ran the doc examples through `doc-example.mjs`.

### Per finding

1. **Binary `@op` and the right operand's type — fixed.** Test: `docs-review-engine-r3.test.ts` › "v + w dispatches; v + 5 stays native and reports an error", and "an object literal assignable … still dispatches".
   - The typeclass index now records whether each binary op method's right parameter is the type parameter (`A`).
   - When it is, dispatch requires the right operand to be assignable to the instance type. Otherwise the operator stays native and this error is reported: "Operator '+' on 'Vec2' dispatches to VecOps.add, whose right operand must also be 'Vec2', but it is 'number'…".
   - Methods like `scale(a: A, k: number)` are not checked, same as before.
2. **Unary `@op` — fixed (implemented).** Test: "prefix-unary @op" (3 tests).
   - `@op` on a one-parameter method goes into a separate `unaryOpToMethod` map, so `@op -` can name both `sub(a, b)` and `negate(a)`.
   - Prefix `-`, `+`, `!` and `~` dispatch through the new `tryRewriteTypeclassUnaryOperator`. `++`/`--` and primitive operands are never rewritten.
   - `getOperatorCandidates` takes an optional `arity` argument, so no new export was needed from macros' `index.ts`.
3. **Sugar on a variable initialised from a sugared call — fixed.** Tests: "const r3 = (0).to(10).step(5); r3.toArray()…", and "const c = p.dup(); c.same(p)…".
   - New `inferSugaredExpressionType` follows parentheses, calls, and identifiers bound by an un-annotated same-file `const`/`let` to their initializer. It only reads original nodes.
   - New `inferMethodSugarCallType` infers the result type when the typeclass method returns its own type parameter (`clone(a: A): A`).
   - Both the extension path and the method-sugar path use them. The real doc examples `std4` and `p.clone(); c.equals(p)` now run.
4. **EffectExt ambiguity — fixed.** Tests: "the from-effect.md example: map + chained flatMap…", and "`import * as` … still an extension provider".
   - A module namespace imported by name or as a default import (`export * as Effect` re-exports) is no longer an extension provider. The exception is a module that opted in with `"use extension"` or `@extension`. `import * as X` still works.
   - The chain problem was separate: the return type of a generic extension call (`EffectExt.map<…>`) was never inferred. It is now used with its type parameters left uninstantiated. A bare type-parameter return is still rejected.
   - The real from-effect example (map/flatMap/tap/orElseSucceed) runs and prints 4.
5. **`@contract` and third-party JSDoc tags — fixed.** Tests: "/\*_ @contract _/ … is a JSDoc macro tag", plus 3 tests for a custom `@logged` macro (dispatches, ignored without the import, line-start rule kept).
   - `contract` is added to `JSDOC_MACRO_TAGS`.
   - New `jsDocTagMacroName`: a registered attribute macro whose `module` the file imports (exact name or a subpath) is dispatched from JSDoc. The function-target check still applies.
   - Also fixed: with `/** @contract */` but no `contracts/syntax` import, the implicit-label pass emitted a stale TS9224 "not activated" hint. It now skips the hint when the explicit tag is present. I checked this through the doc helper only, not with a unit test, because the contracts macro isn't loadable in transformer-core's tests.
6. **`= implicit()` not specialized — fixed.** Test: "sortWith([3, 1, 2]) fills numberOrd and is then specialized". `tryTransformImplicitsCall` now runs auto-specialization on the completed call.

**Extra (r3-libs) — fixed.** Tests: "auto-specialization of a .d.ts-only instance…" (2 tests) and "a .d.ts instance marked /\*_ @impl _/".

- When an argument is declared only in `.d.ts` files and is an instance, auto-specialization now warns: "[TS9602] … instance 'x' is only visible as a declaration (from a .d.ts) …". "Is an instance" means its declaration has an `@impl` or `@instance` JSDoc tag, or its type is a known typeclass.
- The `@impl` check was needed because `nativeSchema` is typed as `NativeSchema`, which isn't a known typeclass, and that tag survives into the dist `.d.ts`. I verified the warning on the real validate example.

**r3-macros items:**

1. **TS9106 — fixed.** `macro-helpers.ts` now calls `reportGenericDeriveFailure`. `packages/macros/tests/docs-r3-review.test.ts` passes.
2. **`as const` in compile-time evaluation — fixed.** `evaluateNode` and `isComptime` in `context.ts` now look through parentheses, `as`, `satisfies`, `<T>x` and `x!`. The `static-assert.test.ts` `as const` test passes.
3. **Token offsets in ast-utils — fixed.** `stripPositions` and `stripCommentsDeep` now walk with `forEachChild`, which reaches tokens. `cloneNodeDeep` passes a `tokenVisitor`. New test: `packages/core/tests/ast-utils-tokens.test.ts`. It reproduced the bug: printing `x ? 1 : (a) => a` leaked the user's `/*n*/` comments.

### Decisions Dean should know about

- **Implicit calls are now specialized.** This reverses a deliberate PEP-056 parity choice (commit 7210ac66), so 3 existing tests in packages/transformer now fail (listed below). It does make the docs' "any call that passes a known instance is specialized" claim true.
- **Third-party JSDoc tags need an import of the macro's module.** They dispatch only when the file imports that module by exact name or a subpath. I didn't use the looser `moduleMatchesMacro` rule, which would have switched on tags like `@pure`/`@invariant` in any file importing any `@typesugar/*` package.
  - Side effect: a typesugar attribute macro whose `module` the file imports (e.g. `/** @codec */` in a file importing `@typesugar/codec`) now dispatches from JSDoc. It used to be silently ignored, and this exposed a codec bug (below).
- **By-name module namespaces are no longer extension providers.** This affects any by-name import of an `export * as X` module, e.g. `import { FunctorOps } from "@typesugar/fp"`.

### Needs from other owners

- **packages/transformer/tests/implicit-no-autospec.test.ts:** both tests assert `showValue(42, showNumber)` and no `__typesugar__`. Change them to expect a hoisted `__typesugar___showValue_…__(42)` and that the output still runs. Or drop the file, if Dean agrees with the decision above.
- **packages/transformer/tests/typeclass-example.test.ts:17-18:** expects `show(42, showNumber)` and `show("hello", showString)`. The output is now `__typesugar___show_number_0__(42)` and `__typesugar___show_string_1__("hello")`, and it still runs correctly.
- **packages/codec/src/macros.ts:384:** the `@codec` expansion emits a bare `defineSchema` identifier and never imports it. Now that `/** @codec */` dispatches, `packages/transformer/tests/strict-output.test.ts` › "codec/schema-codec.ts" fails with "Cannot find name 'defineSchema'". Fix: use `ctx.ensureImport("defineSchema", "@typesugar/codec")` and the identifier it returns.
- **Unrelated, seen while re-running examples:** `start/fe3.ts` imports `flatMap` from `@typesugar/fp`, which does not export it (runtime SyntaxError). That's an fp or docs issue. The EffectExt part of fe3 works.

### What the docs should now say (sentences updated)

- `docs/guides/operators.md`:
  - The unary section now describes `@op` on a one-parameter method.
  - "Type Safety" now says `v + 5` is left native and reports an error.
- `docs/getting-started/troubleshooting.md` (Cause #2): the type is inferred through extension calls and through typeclass methods that return their own type parameter; otherwise annotate.
- `docs/migration/from-effect.md`: the "Not working in 1.0" warning is replaced by a tip that a by-name `Effect` import doesn't compete with `EffectExt`.
- `docs/migration/from-ts-macros.md`: the JSDoc form works in files that import the macro's module.
- `docs/guides/specialize.md`: `= implicit()` calls are specialized; a propagated dictionary is not.
- `docs/guides/validate.md`: TS9602 is now emitted for a `.d.ts` instance.
- `docs/guides/error-messages.md` and `docs/guides/derive.md`: real TS9106 output.
- `docs/guides/testing.md`: `as const` works.

### Files changed

- packages/macros/src/typeclass-index.ts
- packages/transformer-core/src/{rewriting,method-sugar,import-resolution,macro-helpers,specialization,transformer}.ts
- packages/core/src/{context,ast-utils}.ts
- New tests:
  - packages/transformer-core/tests/docs-review-engine-r3.test.ts (20 tests)
  - packages/core/tests/ast-utils-tokens.test.ts
- The docs listed above.

`operators.ts` didn't need changes: the unary token mapping lives in `rewriting.ts`.

### Test status

- core and transformer-core: 717/717 pass.
- macros: 995/995 pass, including `docs-r3-review` and `static-assert`.
- transformer: 1039/1043. The 4 failures are the three tests listed under "Needs from other owners" plus the codec strictOutput test.
- tsc is clean for core, macros and transformer-core. All three dists are rebuilt, and none of my processes are still running.
- No new `parseStatements`/`parseExpression` call sites, so CLAUDE.md is unchanged.
