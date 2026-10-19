## r3-std report

Five findings are fixed; #5 is partially fixed. Every test below executes the generated code through the real transformer against rebuilt dists. I confirmed each test failed before its fix and passes after. I rebuilt the std, fp and effect dists, then re-ran the docs examples through doc-example.mjs and they pass. Typecheck is clean (`tsc --noEmit`) for std, fp and effect. Regression runs all pass: std do-notation, match and infer tests (7+3+1 files), root `tests/match*.test.ts`, the fp typeclasses/data/syntax tests, and effect `generated-code.e2e` + `macros`. `generate-error-docs --check` passes ("72 codes, all pages current"). Nothing of mine is still running.

### Per finding

1. **`par:` over fp Option/Either: fixed.** Test: `packages/fp/src/do-notation.e2e.test.ts`, "par: over fp types …" (2 tests, including a nested `par:` inside `let:`).
   - If no ParCombine instance is in scope but the brand's FlatMap instance is static style, `par:` now chains the independent binds through that instance. Example output: `flatMapEitherInstance.flatMap(Right(1), a => flatMapEitherInstance.map(Right(2), b => a + b))`.
   - Brands with method-style instances still get `.map().ap()`.
   - Docs should say: `par:` works for fp Option/Either/List/IO, runs the binds in sequence, and does not accumulate errors (an Either `par:` stops at the first Left).
2. **`||`/`??` fallback on fp Option: fixed.** Test: same file, "let: fallback (||/??) over fp types …" (2 tests).
   - `flatMapOption` and `flatMapEitherInstance` now have an `orElse` method and `orElse=orElse` in their `@do-methods`.
   - A static-style instance with no `orElse=` (List, IO) now gets a clean compile error ("…declares no orElse= in its @do-methods…") instead of emitting a call to a method that doesn't exist.
   - Docs should say: `v << parse(s) ?? Some(0)` compiles to `flatMapOption.orElse(parse(s), _ => 0)`; List/IO fallbacks are a compile error.
3. **`import "@typesugar/fp/syntax/show"` alone: fixed.** Test: `packages/fp/src/syntax/show-activation.e2e.test.ts`.
   - Cause: the marker didn't pull the `@typeclass Show` declaration into the program, so method sugar couldn't find `.show`.
   - Fix: `syntax/show.ts` now has `export type { Show } from "../typeclasses/show.js"` (type-only, so the marker still has no runtime imports).
   - Docs should say: the marker import is enough on its own.
4. **Object-form `match()` strictOutput errors: fixed.** Test: `packages/std/tests/match-object-form-strict.test.ts` (the kind/type examples from the docs, plus the legacy `{Ok, Err}` form over a `tag` union).
   - The discriminant is now read once into `const _k = _m.kind`. TS narrows `_m` through that alias, and the non-exhaustive throw names `_k` instead of reading a property on `never`.
   - Inline handlers that take no parameters are now called without an argument.
   - All of this is built with `ts.factory`, no string codegen.
   - Docs should say: the output type-checks under `strict: true`.
5. **TS9999 user errors: partially fixed.** Test: same file, "match() argument errors carry catalogue codes".
   - `match()` with too few arguments now emits TS9216, and a non-object handlers argument emits TS9202. I took both out of RESERVED_CODES and regenerated the error pages. The orchestrator has already committed the regenerated `docs/errors/*` and the script change in dad847b1, but my `match.ts` change that actually emits these codes is not committed yet. Commit it with them, or `--check` fails on HEAD.
   - **Non-exhaustive match is still TS9999.** No fitting code exists in the catalogue, and adding one needs `packages/core` (see below).
6. **`let:` binding a same-file `@service` Tag: fixed.** Test: `packages/effect/tests/generated-code.e2e.test.ts`, "let: over a same-file @service Tag" (runs against real Effect and returns 2).
   - std now has a live, same-pass registry (`registerSynthesizedTypeConstructor` / `getSynthesizedTypeConstructor` in comprehension-utils.ts). It is commented as the safe "live keyed registry" shape from CLAUDE.md.
   - `@service` writes `<Name>Tag → "Effect"` into it as it expands. `inferTypeConstructor` reads it only when the checker gives `any` for a bare identifier.
   - Docs should say: `db << DatabaseTag` works in `let:`, compiling to `Effect.flatMap(DatabaseTag, db => …)`. Binding `Database` (the namespace) does not.

### Decisions for Dean

- `par:` without ParCombine on static-style brands runs the binds in sequence (monadic), not applicatively. That is correct for Option/Either/List/IO, but there is no error accumulation.
- `flatMapEitherInstance` is now `{ ...flatMapEither<unknown>(), orElse }` rather than the bare factory result.
- The synthesized-binding registry is stored on `globalThis` under `Symbol.for(...)`, so effect's macro and std's reader share one table even if the ESM and CJS dists both load.
- `@typesugar/effect`'s `service.ts` now imports `@typesugar/std/macros`, which is build-time only.

### Needs from other owners

- **`packages/core/src/diagnostics.ts`:** add a descriptor for non-exhaustive match. Suggested shape: code 9226, error, MacroSyntax, `messageTemplate: "Non-exhaustive match — missing {what}: {missing}"`, with an explanation that points to `.else()` / `_`. After that, std's `checkExhaustiveness` (3 `ctx.reportError` sites in `packages/std/src/macros/match.ts`, around lines 938, 961 and 970) can switch to `ctx.diagnostic(TS9226)`. I can do that half once the descriptor exists.
- The other TS9999 cases from guides-b #9 (`@tailrec`, GenericDerivation) are in the macros package. Its agent already moved TS9220/TS9106.

### Files changed

- std: `packages/std/src/macros/comprehension-utils.ts`, `par-yield.ts`, `let-yield.ts`, `match.ts`; new test `packages/std/tests/match-object-form-strict.test.ts`
- fp: `packages/fp/src/instances.ts`, `packages/fp/src/syntax/show.ts`, `packages/fp/src/do-notation.e2e.test.ts`; new test `packages/fp/src/syntax/show-activation.e2e.test.ts`
- effect: `packages/effect/src/macros/service.ts`, `packages/effect/tests/generated-code.e2e.test.ts`
- `scripts/generate-error-docs.mjs` (removed TS9202 and TS9216 from RESERVED_CODES), plus the regenerated `docs/errors/TS9202.md`, `TS9216.md` and `index.md` (already committed). My regenerate run also created `docs/errors/TS9106.md`, which belongs to the macros agent's code and is now committed too.
- Docs: `docs/guides/do-notation.md` (the fp-types sentence, the fallback paragraph, a new par table row that prettier realigned, and the ParCombine paragraph), `docs/guides/match.md` (the known-issue paragraph is replaced), `docs/guides/effect.md` (the service sentence), `docs/macro-triggers.md` (removed the `import type { Show }` workaround).
- I did not need to change `packages/transformer/src/arrow-comprehension-preprocess.ts`.

### Left failing

Nothing. The fp Option examples still give strictOutput warnings like "number not assignable to Option<unknown>". That is the known annotation/erasure issue (guides-a open bug #3) and was not in my findings.

Repro files are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/fix3/r3-std/ (p1.ts, s1.ts, m1.ts, e6.ts).
