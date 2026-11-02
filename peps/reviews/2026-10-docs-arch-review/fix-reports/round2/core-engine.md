## core-engine report (packages/transformer-core only)

All 7 findings and the 3 coordinator add-ons are fixed. Each one got a failing test first. The tests transform real code and run the output where that makes sense. For #6 I also removed the fix temporarily and confirmed the dedup tests fail without it. transformer-core results: 21 test files, 367 tests pass, and `tsc --noEmit` is clean. dist is rebuilt. Spot-checks against dist with doc-example.mjs pass, and the related suites in transformer, std and root `tests/` pass too (19 files).

### Per finding

1. **Generic first-param extensions (B#2, S#3, W#7, B#11): fixed.** Test: `docs-review-engine.test.ts` › "extensions with a generic first parameter". The cause was in `checkImportedSymbolForExtension`: it compared the receiver against the uninstantiated `readonly A[]`. A new `receiverMatchesFirstParam` tries plain assignability first. For a generic signature it then falls back to an erased match: a type parameter matches up to its constraint (a constraint violation still doesn't rewrite), arrays and tuples match element-wise with readonly respected, and the same generic reference matches its arguments pairwise. On dist, `arr.head()`, `arr.chunk(2)` and `[1,2,3].head()` now rewrite and run.
   - **What docs should say:** generic Array extensions work with a named import.
   - **Range part of B#11 is not a transformer-core bug.** `step(...).toArray()` works when `toArray` is imported. `to(1,3).forEach/map/filter/size/last/isEmpty/reduce` fail because `@typesugar/std`'s root never exports those Range functions (see `std/src/extensions/index.ts:106`). See Needs.
2. **Namespace-import extensions (B#12): fixed, by supporting them.** Test: "namespace-import extensions". Namespace imports were already scanned, but the match was dropped as a "native method" because std's `declare global { interface Number { clamp } }` stub counted as one. New `isGlobalAugmentationStub` excludes properties declared only inside `declare global`. Real lib methods still win (`[1,2].map` stays native). `(42).clamp(0,10)` now becomes `std.clamp((42), 0, 10)` and runs (prints 10). **Docs:** `import * as std` works.
3. **`subpathFor` (C#1): fixed.** Test: "@opaque companion import subpath". The new `packageEntryDir` finds the bare package's entry dir by stripping the specifier's subpath from the resolved file. If an exports map renames the path, it falls back to the user's own specifier. On dist, importing from `@typesugar/fp/data/option` now emits `from "@typesugar/fp/data/option"` and prints 84. **Docs:** the zero-cost example works as written.
   - That example also shows a pre-existing strictOutput warning, "Type 'number' is not assignable to type 'Option<number>'", because the `: Option<number>` annotation is kept after `Some(42)`→`42`. That is the separate annotation-erasure issue, not part of this finding.
4. **JSDoc tags on functions (B#4): fixed.** Tests: "JSDoc attribute tags on function declarations", plus 2 updated tests in `macro-helpers.test.ts` that asserted the old behaviour.
   - Function declarations are now JSDoc targets, and `tailrec` is added to `JSDOC_MACRO_TAGS`.
   - On a function, only attribute macros whose `validTargets` include `"function"` run. Any other tag, `@derive` included, gets the warning "JSDoc macro tag @X is not supported on a function declaration and was ignored."
   - The line-start rule is unchanged and tested.
   - **Docs:** `/** @tailrec */` and `/** @extension */` on functions work (I checked deep recursion on dist). A tag must start its comment line.
5. **Type-macro mis-dispatch (W#23): fixed.** Tests: "type macros dispatch by their own name" and "unresolved type-macro names do not share a cache slot". `symbolMacroCache` was keyed by the checker's `symbol.id`. That id is 0 until assigned, and every unresolved name shares the checker's `unknownSymbol`, so different macros landed in the same cache slot. The key is now our own WeakMap per-symbol id + kind + macroName.
6. **Duplicate diagnostics (C#27, S#29): fixed, both causes were in transformer-core.** Tests: "each diagnostic is reported once per site" and "a failed inner expression macro is expanded once".
   - (a) A failed `/** @impl */ const` was dispatched again on the VariableDeclaration, which inherits its statement's JSDoc. This duplicated "@impl requires arguments" (TS9003) and "already provided by 'eqPoint'" (TS9006). Fix: `markJSDocExpanded(node)` now runs even when expansion returns undefined.
   - (b) `withPreVisitedArgs` memoised only arguments that changed. An unchanged argument such as `out.log(f(xs, inst))` or `console.log(summon<…>()…)` was visited again in the normal descent, duplicating TS9602, "Ambiguous … instance" and TS9001. Fix: every visited argument is now memoised.
7. **`User.fromJson(...)` miscompile (S#24): fixed (method-sugar.ts).** Test: "static companion calls on a derived class". New `staticCompanionReceiver` handles a receiver that is a class, or an interface/type alias merged with a namespace. Resolution uses the instance type, and the class is no longer passed as an argument. On dist, `User.fromJson({...})` becomes `User.Json.fromJson({...})` and runs.
   - **Docs:** `fromJson` takes a parsed object, not a string, so a string needs `User.fromJson(JSON.parse(s))`. `toJson` returns an object. This sugar needs `import "@typesugar/std/syntax/json"`.

### Coordinator add-ons

- **`["schema","schema"]` added to `JSDOC_MACRO_TAGS`.** Test: "/\*_ @schema _/ is a JSDoc macro tag". The test only checks that the tag is recognised. It does not run the sql macro, because sql is not a dependency of transformer-core.
- **`@deriving` is now a deprecated alias of `@derive`.** In transformer.ts the decorator path and its opt-out check treat `deriving` like `derive`. `expandDeriveDecorator` warns "@deriving is deprecated: use @derive(...) (identical behaviour)", which covers both the decorator and JSDoc forms. Test: "@deriving is a deprecated alias of @derive" checks that both forms derive and warn exactly once, and that `@derive` does not warn.
- **The macros agent's `summon<Show<number[]>>()` repro** is covered by fix 6(b). It only duplicated when nested as an argument of an `ident.method(...)` call; standalone and `const` forms already reported once.

### Decisions

- **Function JSDoc dispatch:** limited to macros with a `"function"` target, and every other macro tag on a function warns. It is not wildcard dispatch of every registered attribute name, because names like `@pure` and `@effect` are common JSDoc prose. A function JSDoc line starting with `@typeclass`, `@impl` and similar used to do nothing silently; it now warns.
- **Generic matching** uses an erasure approximation, because the checker's public API cannot infer type arguments. Receivers of unrelated generic types are not matched.
- **Static companion detection** applies only to Class symbols and to interface/type-alias symbols that have a merged value module. Lib globals declared as `var` (`Promise`, `Array`) are unaffected.

### Needs from other owners

- **std:** export the Range methods `forEach`, `map`, `filter`, `size`, `last`, `isEmpty` and `reduce` under names the extension resolver can match. Alternatively, docs should show `import { forEach } from "@typesugar/std/extensions/range"` or the function forms. Today `to(1,3).forEach(...)` type-checks through the augmentation but has no matching import, so it crashes.
- **macros (cosmetic, low priority):** the `@derive(Json)` companion leaks the class's leading JSDoc comment into the generated body (`typeof json !== /** @derive(Json) */ "object"`). It is harmless. It probably comes from a `getText()`/clone that keeps comments in the Json derive.

### Files changed

- `packages/transformer-core/src/import-resolution.ts`
- `packages/transformer-core/src/dts-opaque-discovery.ts`
- `packages/transformer-core/src/macro-helpers.ts`
- `packages/transformer-core/src/transformer.ts`
- `packages/transformer-core/src/method-sugar.ts`
- `packages/transformer-core/tests/macro-helpers.test.ts` (2 tests updated for the new behaviour)
- `packages/transformer-core/tests/docs-review-engine.test.ts` (new, 24 tests)
- dist rebuilt: `packages/transformer-core/dist/`

Nothing is left failing. No processes of mine are running; the vitest still running belongs to the std agent. Scratch repros are in `/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix2/core-engine/`. No CLAUDE.md change was needed: no `parseStatements`/`parseExpression` call sites were added or removed.
