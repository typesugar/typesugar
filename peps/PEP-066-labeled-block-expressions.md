# PEP-066: Labeled-Block Macros in Expression Position

**Status:** Draft
**Date:** 2026-11-15
**Author:** Claude (with Dean Povey)
**Related:** [PEP-052](PEP-052-import-scoped-macro-activation.md) (`@syntax-labels` activation),
[PEP-065](PEP-065-match-switch-guards-and-tests.md) (`match: switch`, the other labeled-block
macro), docs review 2026-10 A#9/A#10/S#2 (the do-notation expression positions).

## Context

`LabeledBlockMacro` (`packages/core/src/types.ts`) is a general macro kind: any package can
register `foo: { … }`, with aliases, continuation labels (`yield:`), the statement it attaches
to (a block or a switch) and PEP-052 activation. Its `expand` returns statements, because a
labeled statement is a statement: `const x = foo: { … }` does not parse as written.

Do-notation (`let:`/`seq:`, `par:`/`all:`) gets around this, and its values can be used in a
`const` initializer, after `return`, as an arrow body and after `export default`
(`docs/guides/do-notation.md`, "Using the Result"). The mechanism has three parts:

1. **A text rewrite before parsing** (`packages/transformer/src/arrow-comprehension-preprocess.ts`).
   In the broken parse the label is an identifier (`(x) => let`). The rewrite re-parses the
   text from the label on its own, where it is a clean labeled statement plus continuation,
   moves it to statement position with MagicString, and follows it with a statement that
   reads its value through a synthetic tag:

   ```ts
   (x) => let: {…} yield: {…}     →  (x) => { let: {…} yield: {…}; return __letyield_0; }
   const r = let: {…} yield: {…}  →  let: {…} yield: {…}; const r = __letyield_0;
   ```

2. **The macro fills the slot.** std's `findValueSlot`/`emitComprehensionResult`
   (`packages/std/src/macros/comprehension-utils.ts`) see the tag statement after the
   comprehension and emit `const __letyield_0 = <chain>;` instead of an expression statement.
   `let-yield.ts` and `par-yield.ts` call it at each of their return points (seven sites).

3. **The transformer collapses the pair** (`collapseCompValueSlots`,
   `tryExtractCompReturnExpr` in `packages/transformer-core/src/transformer-utils.ts`) back
   to `=> E`, `return E`, `const r = E`, `export default E`. This part is already generic.

Everything outside part 3 names do-notation:

| Where                                                   | What is hard-coded                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrow-comprehension-preprocess.ts`                     | `MAIN_LABELS` (`let par seq all`), `CONTINUATION_LABELS` (`yield pure return in`), the prefilter regex                                                            |
| `comprehension-gate.ts`                                 | `mayContainComprehension` regex; `isComprehensionSyntaxActivatedIn` checks only the `let` and `par` macros                                                        |
| `comprehension-utils.ts` (std)                          | the slot helpers, so each macro must know to call them                                                                                                            |
| tag name `__letyield_`                                  | preprocessor, std slot helpers, `transformer-utils.ts` collapse, `diagnostic-suppression-rules.ts` (TS2304 on the tag), `comprehension-gate.ts` diagnostic mapper |
| `transformer.ts` (`const x = let;` merges)              | `"let" \|\| "seq"`, for the error-recovered parse in hosts that cannot rewrite text (ts-patch `tsc`)                                                              |
| `transformer-utils.ts` `isPreprocessedCompWrapperBlock` | `let par seq all`, for a `{ { … } }` wrapper the current preprocessor no longer emits                                                                             |

So a third-party labeled-block macro that produces a value works only as a statement on its
own. And even do-notation works only in those four positions: not as a call argument, an
operand, an array element or a property value.

## Goals

- Any labeled-block macro can produce an expression, and its label works in every position
  do-notation's labels work in today, with no code in the macro about slots or tags.
- The positions extend to most expression positions, with the evaluation order unchanged.
- Do-notation moves onto the general mechanism with identical output.

## Design

### 1. An expression-returning expand

Add to `LabeledBlockMacro`:

```ts
/**
 * Expand to a value. When present, the label may be used in expression position
 * (see PEP-066), and at statement position the transformer emits the expression as
 * a statement and warns that the value is discarded (TS9222).
 */
expandExpression?(
  ctx: MacroContext,
  mainBlock: ts.LabeledStatement,
  continuation: ts.LabeledStatement | undefined
): ts.Expression;
```

The transformer, not the macro, decides what to do with the expression: fill the slot when
the tag statement follows (the logic of `findValueSlot`, moved into transformer-core),
otherwise emit an expression statement with the TS9222 warning that `valueProducing` drives
today. `expandExpression` implies `valueProducing`. A macro may define `expand`,
`expandExpression` or both; with both, `expand` is used at statement position.

On failure the macro reports an error and throws or returns a sentinel (D1); the
transformer leaves the source as it was, as it does for `expand` now.

Do-notation migrates to `expandExpression`. Its seven `emitComprehensionResult` calls
become plain returns of the chain expression, and the std slot helpers are deleted.

### 2. Registry-driven rewrite and gate

`preprocessExpressionComprehensions(source, fileName)` gains a parameter:

```ts
interface LabelExpressionSyntax {
  /** Main labels of activated macros that define expandExpression. */
  main: ReadonlySet<string>;
  /** Their continuation labels. */
  continuation: ReadonlySet<string>;
}
```

The prefilter regex is built from `main`. The gate (`comprehension-gate.ts`, renamed
`label-expression-gate.ts`) computes the set: it already loads the file's macro packages and
scans its imports before the rewrite, so the registry and activation are both known at that
point. It returns the labels of every activated macro with `expandExpression`, instead of
checking `let` and `par` by name. `sites` and the TS9224 not-activated hints already look up
each label in the registry and need no change beyond the label set.

The tag becomes `__labelvalue_N`. It is internal (it never appears in user source or in
output), so all five matchers change together with no compatibility path. Wave 1 checks
that the expansion caches (`transformer.ts`, `auto-derive.ts`) cannot serve text cached
with the old tag across an upgrade.

### 3. More positions: the in-place arrow wrapper

Hoisting the block to statement position is safe only when the labeled expression is the
whole value of its statement. In `f(x(), foo: {…})` it would run `foo` before `x()`. For
every other position the rewrite wraps the block where it stands:

```ts
f(x(), foo: {…} yield: …)
→ f(x(), (() => { foo: {…} yield: …; return __labelvalue_0; })())
```

The macro fills the slot inside the arrow as before. The transformer then collapses
`(() => { const __labelvalue_N = E; return __labelvalue_N; })()` to `E`, so no wrapper
reaches the output. An arrow keeps `this`, `arguments`, `super` and `new.target`, so the
only things the wrapper changes before it collapses are `await`, `yield` and jumps out of
the block (below).

**Where a label is rewritten.** The broken parse leaves the label as an identifier. It is a
candidate only where `IDENT: {` cannot be valid JavaScript, which is decided from the
identifier's parent in the broken parse, never from the text:

| Rewritten                                                                             | Not rewritten (valid JavaScript there)                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| arrow body, `return`, `export default`, `const`/`let` initializer (hoisted, as today) | ternary true-branch: `c ? par : { x }`                      |
| call and `new` argument, array element, spread                                        | `case par: {`                                               |
| binary and unary operand, `await` operand                                             | object-literal key: `{ par: { x } }`                        |
| property-assignment value: `{ k: par: {…} }`                                          | parameter, property or variable name with a type annotation |
| parenthesised expression, template span                                               | named tuple member, labeled statement                       |

Parentheses are the escape hatch for the excluded positions: `c ? (par: {…} yield: …) : d`
is a parenthesised expression, so it is rewritten.

**`await` inside the block.** Inside a plain arrow, `await` is TS1308 in the intermediate
program and types oddly. The rewrite emits `async () => …` when the block's tokens contain
`await` (outside nested functions), so the intermediate program type-checks, and the
collapse removes the arrow either way. Decision D2 is whether to do that or to reject
`await` in wrapped positions.

**Macros that look at their enclosing function** (to ask "am I in an async function?",
find `this`'s class, or decide where to hoist) would see the wrapper. Add
`enclosingFunction(node)` to `@typesugar/core`, which skips a wrapper recognised by its tag,
and audit the existing labeled-block macros' parent walks to use it.

**Jumps out of the block.** `break`/`continue` to an outer label, or a bare `return`
directly in the block, would target the wrapper. The rewrite rejects them with a new error
(next free code; 9227 unless PEP-065 takes it) naming the position. A `return` inside a
nested function in the block is fine.

**`yield` inside the block** (in a generator) cannot be wrapped. Rejected with the same
error. (`await let:` is already unsupported; the guide says to bind to a `const` first.)

### 4. Hosts that cannot rewrite text

ts-patch's `tsc` hands typesugar an already-parsed program, so none of this runs there; the
do-notation guide already says to use `typesugar build` or a bundler plugin for these
positions. The `const x = let;` merges in `transformer.ts` repair the error-recovered parse
for `const` only, for `let`/`seq` only, and are the reason `const r = let: …` works under
ts-patch. Decision D3 is whether to keep them frozen for do-notation or remove them in favour
of a clear error.

`isPreprocessedCompWrapperBlock` and the flattening that uses it handle a `{ { … } }` shape
the current preprocessor does not emit. Wave 1 confirms it is unreachable (coverage over the
do-notation suites) and deletes it.

### 5. String-codegen exception

The preprocessor is a documented exception to the AST-only rule (its file header): the
broken parse is too fragile to repair with `factory.update*`. This PEP widens it from four
labels to any registered one, and from four positions to the table above. The file header is
updated with the new positions, and the "Patching a real, human-authored file" section of
`CLAUDE.md` gains an entry for it, since it rewrites user text before parsing. Everything
after the reparse (slot filling, collapse) stays AST-based.

### 6. Docs

- `docs/macro-triggers.md` §6: `expandExpression`, the positions table, the escape hatch, the
  ts-patch limit, and a worked third-party example.
- `docs/guides/do-notation.md` "Using the Result": the new positions.
- The playground examples and package READMEs that show do-notation results, per the
  whole-package sweep rule.

## No-gos

- Type positions, class members, decorators and parameter defaults are not expression
  positions this PEP touches. (A parameter default is an expression, but it is evaluated
  in the parameter scope; it can be added later if asked.)
- Unparenthesised ternary branches, `case` labels and object keys stay ordinary JavaScript.
- `yield` inside a wrapped block, and jumps out of it.
- ts-patch `tsc` support for the new positions.
- Statement-only macros (`match: switch`, the contract trigger labels) are unchanged.

## Waves

| Wave | Content                                                                                                                                                                                                                                                             | Behaviour change                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1    | `expandExpression`; slot filling moved into transformer-core; registry-driven label sets and gate; `__labelvalue_N`; do-notation migrated; dead wrapper-block path removed; a test-only third-party label macro (`sum: { … }`) covering the four existing positions | None for do-notation (same output on every existing test); third-party macros gain the four positions |
| 2    | The in-place arrow wrapper and its collapse; position detection by parent kind; `async` wrapper (per D2); jump and `yield` errors; `enclosingFunction` and the parent-walk audit                                                                                    | New positions for every expression-producing label                                                    |
| 3    | Docs sweep (§6), playground example, D3 outcome                                                                                                                                                                                                                     | Docs only, plus D3                                                                                    |

Tests per wave: the do-notation suites unchanged and green; for the test macro, each row of
the positions table in both columns (rewritten, and left alone); evaluation order
(`f(log(1), sum: {…})` logs before the block runs); `this` and `arguments` inside a wrapped
block; source maps and diagnostic positions in a wrapped block (an error inside it lands on
the user's line); TS9224 when the label is not activated; the CLI (`build`, `check`,
`watch`, `expand`), the unplugin and the language service all running the same rewrite.

## Decisions (open)

- **D1. Failure contract for `expandExpression`.** (a) throw, and the transformer reports
  and leaves the source unchanged; (b) return `undefined`. Recommend (b): it keeps exceptions for bugs, and
  the transformer can tell "reported and declined" from "crashed".
- **D2. `await` in wrapped positions.** (a) emit an `async` wrapper when the block contains
  `await`; (b) reject it with the jump error. Recommend (a): the wrapper never reaches the
  output, so the only cost is the token scan, and `await` inside a `let:` is common.
- **D3. The `const x = let;` merges for ts-patch.** (a) keep them, frozen, for `let`/`seq`;
  (b) remove them and emit an error under ts-patch pointing at `typesugar build`. Recommend
  (a) for now: removing them breaks code that works today, and they cost nothing while
  frozen.

## Risks

- **False positives in position detection.** A user identifier that matches an activated
  label, followed by `:` in a position the table missed, would be rewritten. Detection runs
  only for activated labels, uses the broken parse's parent kinds rather than text, and the
  clean reparse must produce a labeled block followed by valid continuation, or nothing is
  rewritten. The test macro's suite covers every row of the "not rewritten" column.
- **Wrapper left in output.** If expansion fails, the wrapper and an undeclared tag remain.
  The macro's error is already reported; the transformer additionally refuses to emit a file
  with an unfilled tag (hard error naming the label), so a broken build fails loudly.
- **Checker on the intermediate program.** The wrapped block is type-checked before
  expansion inside an arrow the user did not write. Inference of the block's binds should be
  unaffected (the arrow is transparent for everything but `await`/`yield`, handled above),
  but contextual typing from the outer position (`f(foo: {…})` against `f`'s parameter
  type) is lost until expansion. Wave 2 tests one contextually typed case and records the
  result.
- **Language-service positions.** Hover and go-to-definition inside a wrapped block go
  through one more source map. PEP-036's source-map tests extend to the new positions.
