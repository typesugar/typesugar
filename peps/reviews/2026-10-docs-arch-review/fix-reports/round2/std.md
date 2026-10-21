## GROUP std: report

All five findings plus the follow-up items (a), (b) and the Range exports are fixed. (c) is deferred. Each finding got a test first, which I ran and saw fail for the reason in the report. After the fix it passes. The std and transformer dists are rebuilt.

### Per finding

- **1 (S#2 / A#1 / W#6): fixed.** Test: `packages/transformer/tests/comprehension-value-positions.test.ts`, "yield: <expression>" block (10 tests).
  - `yield: <expr>` now means the same as `yield: { <expr> }` for let:, seq: and par:. It works in statement position, `const r =` (module level and inside a function), an arrow body, and after `return`.
  - The block form still works.
  - The `yield: { { a, b } }` hint and the comma-expression hint already suggested `yield: ({ user, posts })`, which now works. Non-expression continuations get a clear error.
  - **Docs should say:** both `yield: ({ a, b })` and `yield: { ({ a, b }) }` are correct, everywhere.
- **2 (A#9): fixed, with value positions implemented rather than turned into errors.** Tests: "par: in value positions" (8 tests). The old TS9226 cases in `comprehension-expression-review.test.ts` are flipped to executed assertions.
  - These now compile and run: `const x = par:` (module level and inside a function), `=> par:`, `return par:`, and `let:` with a leading or nested `par:` group.
  - The TS9226 "unsupported shape" error is no longer emitted.
  - The TS9222 help ("assign it (const result = par: …), or return it from an arrow function") now describes forms that work.
  - **Docs should say:** `par:` results can be bound anywhere a `let:` result can (`Promise.all(...).then(...)`).
- **3 (A#10): fixed.** Tests: "fallback on the first bind in value positions" (3 tests), plus "a generic type argument inside the first bind" and "a failed expansion is a clean error and keeps the declaration".
  - `||` / `??` on the first bind works in `const r =` and arrow bodies.
  - A bind like `x << (expr as Promise<number>)` (item b) works.
  - A failed expansion now reports the macro's error and keeps `const r = __letyield_N`. It no longer silently drops the declaration.
  - **Docs should say:** no restriction on the first statement.
- **4 (B#1): fixed.** Test: `packages/std/tests/match-fp-extractors.test.ts` (8 tests, all executed; it mirrors fp's shapes because std's tests can't load @typesugar/fp at runtime). I also checked it against real `@typesugar/fp` with `doc-example.mjs`.
  - Some/None/Left/Right/Cons/Nil now match fp's real representations:
    - `Some(v)` matches `x != null` and binds the value itself; `None` matches `== null`.
    - `Right(v)` matches `"right" in x`, binding `.right`; `Left(e)` matches `"left" in x`, binding `.left`.
    - `Cons(h, t)` matches `!= null`, binding `.head` / `.tail`; `Nil` matches `== null`.
  - The `_tag` scheme is still used when the scrutinee's type has a `_tag` property (Effect, hand-written unions); the existing `_tag` test still passes. Ok/Err are unchanged (fp's zero-cost Result already uses the `ok` field).
  - Exhaustiveness: Some+None and Left+Right no longer need `.else()`.
  - **Docs should say:** the extractors work with @typesugar/fp's Option/Either/List; `match(Some(5)).case(Some(v)).then(v*2).else(-1)` gives 10.
- **5 (S#4 part 3, B#13): fixed.** Test: `packages/std/tests/std-operator-syntax.test.ts` (6 tests, all executed).
  - `@op` tags added:
    - Semigroup.combine: `+`
    - Monoid: `+` (I restated `combine` on Monoid because `@op` tags are not inherited)
    - Group.combine: `+`
    - Numeric: `+` add, `-` sub, `*` mul
    - Integral: `/` div, `%` mod
    - Fractional: `/` div
  - I also checked Rational from @typesugar/math with the numeric and fractional ops imports: `a + b`, `a * b` and `a / b` give 5/6, 1/6 and 3/2.
  - **Docs should say:** for a type with an instance, `a + b` dispatches after `import "@typesugar/std/syntax/semigroup/ops"` (or the numeric ops import); `/` needs the fractional or integral ops import.
- **(a) fp self-receiver import: fixed.** The fp `it.fails` "Option without importing the instance" test is flipped to `it` and passes.
  - A new `importSelfReceiver` helper in comprehension-utils.ts applies whenever `@do-methods style=static receiver=<the instance's own name>`. It imports the instance from std's do marker for std's instances; otherwise from the provider's `@do-instance-module`, then `KNOWN_DO_INSTANCE_MODULES`. An instance declared in the same file is left alone.
  - Used in let-yield (main chain and nested par groups) and par-yield.
- **Range exports (W#7): fixed.** Test: `packages/std/tests/range-readme-exec.test.ts` (runs the README Range lines plus `[1,2,3].last()`).
  - The root now exports `size`, `isEmpty`, `forEach`, `map`, `filter` and `reduce` from extensions/range.
  - `last` at the root is now an overloaded function that handles both an Array and a Range. This was the only name collision.
- **(c): deferred.** The same-pass `@service` tag (`db << DatabaseTag`) and `Cons(...)` inferring brand `Cons` (TS9225) need inference changes that aren't small.

### Decisions Dean should know about

- **New approach in the comprehension preprocessor.** Every expression-position comprehension is now moved into statement position, where it parses cleanly. It is followed by a statement that reads its value through a synthetic tag:
  - arrow body / `return`: `{ COMP; return __letyield_N; }`
  - `const` and `export default`: `COMP; const r = __letyield_N;`
  - The std macros spot that tag statement (`findValueSlot`) and emit `const __letyield_N = <chain>;`.
  - Arrow bodies and returns collapse back to `=> chain` / `return chain`, as before.
- **Output change for module-level `const r = let: …`.** It is now always rewritten this way, including the plain-bind shape the old transformer-core merge handled. The old merge is what mangled generic type arguments in a bind and fallback first binds. The output is now `const __letyield_0 = chain; const r = __letyield_0;` instead of `const r = chain`.
  - I relaxed the one test that pinned the old form (`std/tests/arrow-let-yield.test.ts`).
  - The preprocessor stays a MagicString text rewrite, which is that file's existing documented exception. It now re-parses the comprehension text cleanly instead of scanning tokens. No new `parseStatements` / `parseExpression` call sites.
- **Numeric's `/` is not tagged.** With it, a type that has both Numeric and Fractional instances (Rational) became an "Ambiguous operator '/'" error.

### Needs from other owners

- **transformer-core `transformer.ts` (optional, cosmetic):** collapse `const __letyield_N = E; <decl> x = __letyield_N;` when the tag is used once, giving `<decl> x = E`. That would restore the direct `const r = chain` output. The `const x = let;` merge and the `isPreprocessedCompWrapperBlock` flatten are now never reached from the pipeline. They are still used by direct transformer-core callers, so they could be left alone or removed.
- **transformer-core TS9222 help text:** "At module top level assign it…" can drop "At module top level": `const result =` now works inside functions too.
- **transformer-core extension rewriting:** a Range method called on the result of another rewritten call is not rewritten. `(1).to(5).reversed().toArray()` and `(0).to(100).step(10).toArray()` give "Property 'toArray' does not exist on type 'Range'", then a runtime TypeError, presumably because the inner rewrite leaves a synthetic receiver. The README's own Range lines are not affected.

### Files changed

- `packages/std/src/macros/let-yield.ts`
- `packages/std/src/macros/par-yield.ts`
- `packages/std/src/macros/comprehension-utils.ts`
- `packages/std/src/macros/match.ts`
- `packages/std/src/typeclasses/index.ts`
- `packages/std/src/extensions/index.ts`
- `packages/transformer/src/arrow-comprehension-preprocess.ts`
- `packages/transformer/tests/comprehension-expression-review.test.ts`
- `packages/std/tests/arrow-let-yield.test.ts`
- `packages/fp/src/do-notation.e2e.test.ts` (one line, `it.fails` to `it`)
- New: `packages/transformer/tests/comprehension-value-positions.test.ts`
- New: `packages/std/tests/match-fp-extractors.test.ts`
- New: `packages/std/tests/std-operator-syntax.test.ts`
- New: `packages/std/tests/range-readme-exec.test.ts`

### Test status

- Passing:
  - std package: 22 of 23 test files (475 tests).
  - transformer comprehension tests, the fp do-notation e2e test and the transformer-core comprehension test: 39 tests.
  - std typecheck is clean, prettier is clean, and none of my processes are still running.
- **Still failing, not mine:** `packages/std/tests/match-execution.test.ts` fails to load. Vitest's typesugar plugin now expands the aliased import `match as runtimeMatch` at line 391 (`runtimeMatch("b" as string, {...} as never)`) as the `match()` macro, which errors with "match() second argument must be an object literal { variant: handler }". My match.ts changes don't touch that object-handler path. The likely cause is another agent's change to transformer-core `import-resolution.ts`.
