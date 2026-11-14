# PEP-065: `match: switch` — Guards, Nested Tests, and No Silent Value Cases

**Status:** Draft
**Date:** 2026-11-14
**Author:** Claude (with Dean Povey)
**Related:** [PEP-008](PEP-008-pattern-matching.md) (fluent `match()`),
[PEP-025](PEP-025-match-api-consolidation.md) (match API consolidation),
[PEP-052](PEP-052-import-scoped-macro-activation.md) (`@syntax-labels` activation),
Turf case study F21 (the statement form; `typesugar/turf-typesugar` `CASE-STUDY.md`).

## Context

The question that started this PEP was "can we hack `switch` syntax for `match`?". It is
already done: the Turf case study (F21) added `match: switch`, a labelled switch whose case
labels are patterns (`packages/std/src/macros/match-switch.ts`, guide section
"Statement form: `match: switch`"):

```ts
import "@typesugar/std/syntax/match";

match: switch (geom) {
  case { type: "Point", coordinates: [x, y] }:
    draw(x, y);
    break;
  case { type: "LineString", coordinates }:
    for (const [x, y] of coordinates) draw(x, y);
    break;
}
```

It keeps every arm body in place with plain switch control flow (`return`, `break`,
`continue`, `throw`, `await`, fallthrough), which the fluent chain's `.then(expr)` can't
do. It checks that the cases cover the type (TS9226), and compiles to the switch a person
would write: literal cases byte-for-byte, patterns that share a discriminant to
`switch (geom.type) { case "Point": { const [x, y] = geom.coordinates; … } }`, anything
else to `switch (true)`.

So a second switch form is not needed. This PEP covers what the existing one lacks
compared to the fluent `match()`, and three defects found while checking it.

### What the switch form lacks today

| Fluent `match()`                        | `match: switch` today                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Guards `.case(P).if(g)`                 | None ("test the condition in the body", which can't fall through to the next case) |
| Tests at any depth (`{ a: { b: 1 } }`)  | Top-level literals only; deeper literals are errors                                |
| Type tests `String(s)`, `Date(d)`       | Not recognised (see defect 1)                                                      |
| Regex `/re/`                            | Not supported                                                                      |
| Top-level arrays `[a, b]` (length test) | Error ("switch on its length")                                                     |
| `.or()` with bindings, `.as()`          | Stacked cases only without bindings; no `.as()`                                    |

### Defects found (origin/main 325b018f, 2026-11-14)

Reproduced with `transformAndRun` (packages/std/tests/match-exec-helpers.ts, which runs the
emitted JavaScript) and `typesugar check` on a three-file fixture.

**1. A case label the switch form doesn't understand becomes a value case, silently.**
`classify` treats anything that isn't an object/array literal or a built-in extractor call
as a value compared with `===`. Two shapes users will reasonably write compile with **no
transformer error** and throw at run time:

```ts
type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number };
match: switch (s) {
  case { kind: "rect", w, h } && w === h:
    return "square"; // an attempted guard
  case { kind: "rect", w, h }:
    return "rect " + w * h;
  case { kind: "circle", r }:
    return "circle " + r;
}
// emitted: switch (true) { case s === ({ kind: "rect", w, h } && w === h): ...
// f({ kind: "circle", r: 1 }) → ReferenceError: w is not defined

match: switch (
  t // t: string | Date
) {
  case String(s):
    return s.length;
  case Date(d):
    return d.getTime();
  default:
    return -1;
}
// emitted unchanged: case String(s): ...
// g("abc") → ReferenceError: s is not defined
```

`typesugar check` does report both, but as TypeScript noise about the unexpanded code
(TS2872 "always truthy", TS2678, TS2367, TS18004 for the guard; TS2304 and TS2554 for
`String(s)`), not as "this isn't a pattern". A bundler build (no type check) ships them.

**2. A pattern name that is also an outer name produces false errors.** In
`function h(s: Shape) { match: switch (s) { case { kind: "rect", w, h }: return w * h; … } }`
the `h` in the pattern resolves to the function, and `typesugar check` reports TS2678
(`{ kind: string; w: any; h: (s: Shape) => number }` not comparable to `Shape`) and TS2363
on `w * h`. Renaming the function leaves only the real errors. The fluent chain's rule
already handles this (`shadowedNameSubjects`, `RESULT_TYPE_CODES` in
`packages/macros/src/diagnostic-suppression-rules.ts`, rule 7); the MatchSwitch rule
(rule 8) only suppresses TS2304/TS18004. `MatchSwitch` is already in
`strict-check.ts`'s `BLIND_SPOT_RULES`, so the expansion is re-checked and widening the
suppression loses no real errors.

**3. Nested array patterns don't test length, by design, and nothing warns.**
`case { kind: "p", c: [x, y] }:` on `{ kind: "p", c: [5] }` runs the case with
`y === undefined`. This is the documented semantics (destructure below the discriminant,
as `const [x, y] = …` does) and is what keeps Turf's output hand-written. It differs from
the fluent form, which tests the exact length. Listed here because D1 below decides whether
it stays.

What already works and needs no change: pattern-bound names in the editor and
`typesugar check` (the editor plugin and check type-check the expansion; a wrong use such
as `return r.toFixed()` in a `number` function is reported as TS2322 at the line written).

## Design

### Case labels: literal, constant, pattern, or guarded pattern — nothing else

In a `match:` switch a case label is one of:

- a **literal** (`"Point"`, `42`, `null`, `-1`, `undefined`);
- a **constant**: an identifier or qualified name (`K.A`, `MAX`), compared with `===`
  (unchanged; a bare identifier is a value here, not a binding as in the fluent form);
- a **pattern**: object or array literal, extractor call (`Some(v)`, `Point(x, y)`), zero-arg
  extractor in pattern mode (`None`), type test (`String(s)`, `Date(d)`, a class), or
  regex (`/re/`);
- a **guarded case**: `P && guard`, where `P` is any of the above.

Call syntax is how extractors and type tests are written, so a call `F(args)` is a
pattern when `F` resolves (by symbol, through the checker, not by name) to:

- a built-in extractor or a `Destructure` instance in scope: an **extractor** (`Some(v)`,
  `Point(x, y)`), as today;
- a constructor (a value with construct signatures: `String`, `Date`, a class) and no
  `Destructure` instance: a **type test**.

A call to anything else (an ordinary function, `f(x)`, `Symbol.for("a")`) is a value
computed at run time, not a pattern. Arithmetic, `a || b` and template literals are values
too. Any such value is an error: _"a case in a match: switch is a literal, a constant or a
pattern; bind the value to a const and use the const"_. Today the same call compiles as a
value case, and the bound names in it throw at run time (defect 1). Making it an error
means that adding a `Destructure` instance for `f` later turns an error into a pattern,
never one meaning into another.

We considered keeping arbitrary expressions as value cases with parentheses as the escape
(`case (f(x)):` compares, `case f(x):` is a pattern). Rejected: Prettier 3.8.1 removes
those parentheses (`case (a && b):` → `case a && b:`), which would silently change the
meaning of formatted code. A `const` is format-proof.

### Guards: `case P && guard:`

```ts
match: switch (s) {
  case { kind: "rect", w, h } && w === h:
    return "square";
  case { kind: "rect", w, h }:
    return `rect ${w}x${h}`;
  case { kind: "circle", r } && r > 0:
    return "circle";
  default:
    throw new Error("bad shape");
}
```

- A **top-level** `&&` in a case label is always a guard. `&&` isn't a pattern operator
  (OR is `.or()` / stacked cases), so nothing existing changes meaning. `P && g1 && g2` is
  `P` guarded by `g1 && g2` (the left-most operand of the `&&` chain is the pattern).
- A guard that fails **tries the next case**, which is the point: `case P: if (!g) break;`
  leaves the switch instead.
- The guard can use the case's pattern names. The expansion substitutes each bound name
  in the guard with the access path it was read from, using a scoped visitor (a name
  shadowed by a parameter or local inside the guard is left alone). Each substituted node
  keeps the source identifier's text range, so a type error in the guard is reported at
  the name as written:

  ```ts
  switch (true) {
    case s.kind === "rect" && s.w === s.h: {
      const { w, h } = s;
      return "square";
    }
    case s.kind === "rect": {
      const { w, h } = s;
      return `rect ${w}x${h}`;
    }
    case s.kind === "circle" && s.r > 0: {
      const r = s.r;
      return "circle";
    }
    default:
      throw new Error("bad shape");
  }
  ```

  The narrowing `s.kind === "rect" &&` gives `s.w` the variant's type in the expanded
  check. A custom extractor's result is already in a temp (`_ext`), so its bindings
  substitute to `_ext` / `_ext[i]`; an `@opaque` payload goes through `payloadAccess` with
  its typing, as the bindings do. A rest binding (`...rest`) used in a guard is an error
  (no access path; bind it and test in the body).

- Any guarded case puts the switch in the `switch (true)` form; an unguarded switch keeps
  today's output exactly.
- A guarded case covers nothing for exhaustiveness, as `.if()` in the fluent form
  (`match.ts` excludes guarded arms from coverage).

We considered `case when(P, guard):` (rejected: a runtime-looking call that must be
erased, and reads worse) and `case P: if (!g) continue;` (not valid: `continue` needs a
loop).

### Nested tests (D1)

Recommended: **tests where a test is the only possible meaning; destructuring where
destructuring is.** Below the top level,

- literals (`{ a: { b: 1 } }`), extractors (`{ value: Some(v) }`), type tests
  (`{ when: Date(d) }`) and regex **test**: they are errors today, so this adds meaning
  without changing any existing program. They join the case's condition (and so force
  `switch (true)` for that switch, like a guard);
- object and array **shapes** without a test inside keep **destructuring**
  (`coordinates: [x, y]` reads two elements whatever the length), so Turf-style code keeps
  its hand-written output.

This leaves one documented difference from the fluent form (nested array length), which the
guide already describes. The alternative, D1-b, is full fluent semantics (every nested
array tests its length, every nested property tests presence): consistent with `match()`,
but it changes the meaning and output of existing `match: switch` code and adds
`Array.isArray`/length tests to traversal loops where the type already guarantees the shape.

### Top-level type tests and regex

`case String(s):`, `case Date(d):`, `case MyClass(x):` (no `Destructure` instance: an
`instanceof` test binding the whole value), and `case /re/:` on a string scrutinee are
supported at the top level, with `typeof`/`instanceof`/`.test()` tests reused from the
fluent form (`buildCondition`). Their coverage follows the fluent form's (`String(s)` covers
the `string` member of `string | Date`). Regex is test-only; capture groups need `.as()`,
which stays fluent-only.

### Name clashes (defect 2)

Rule 8 (MatchSwitch) gets the fluent rule's handling: the codes TypeScript reports when a
pattern name resolves to an outer declaration (`RESULT_TYPE_CODES` and the shadowed-name
codes) are suppressed when the subject is a name bound by the enclosing case's pattern (or
guard), in a file that activates `match:`. The guarded-case codes TS2872, TS2678 and TS2367
on a guarded label are suppressed too. The expansion check (`BLIND_SPOT_RULES`) reports a
wrong use of the binding itself.

### ESLint

The recommended config (lightweight processor) lints unexpanded source. Rules that would
fire on a pattern switch are `no-undef` (pattern names; usually off under
typescript-eslint), `no-fallthrough` (no change from a plain switch) and
`no-constant-binary-expression` / `no-constant-condition` on a guarded label whose
pattern is an object literal (`{…} && g` is always-truthy on the left). Wave 2 checks
these against the repo's ESLint setup and, if they fire, the lightweight processor
handles `match:` labels the way it already handles contract labels (`processor.ts`
`CONTRACT_LABELS`). Not yet verified.

## No-gos

- **No second switch form** (`switch (match(x)) { … }`). Considered first: it would make the
  no-transformer failure loud (the `match(x)` call throws before any case runs), but it
  duplicates a shipped feature and its activation path, and the diagnostic rules would
  need a second set of triggers.
- **No `.or()` with bindings** (stacked cases that bind names) and **no `.as()`**. The
  scrutinee is already a name in a switch; for a nested value, destructure the field.
- **No top-level array patterns**: `switch (xs.length)` is the switch idiom; arrays stay
  fluent-only.
- **No expression form**: `switch` is a statement; the fluent chain stays the way to match
  in an expression.

## Waves

| Wave | Scope                                                                                                                                                                                                                                              | Branch                       | Status      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------- |
| 1    | Defects 1 and 2: case-label classification (literal / constant / pattern, anything else an error naming the fix); `P && g` an error pointing at Wave 2 until it lands; MatchSwitch suppression for shadowed names; exec tests for each probe above | `pep-065-wave-1-case-labels` | Not started |
| 2    | Guards: `case P && g:`, scoped substitution of bound names with source ranges, `switch (true)` lowering, coverage excludes guarded cases, suppression of TS2872/TS2678/TS2367 on guarded labels, ESLint check                                      | `pep-065-wave-2-guards`      | Not started |
| 3    | Nested tests per D1 and top-level type tests and regex; coverage through `findMissingCases`                                                                                                                                                        | `pep-065-wave-3-tests`       | Not started |

Each wave updates the guide's "Statement form" section, `docs/macro-triggers.md`,
`docs/reference/packages.md`, the std README and the playground's match example, and the
`match-switch.ts` header, in the same PR.

## Open decisions (for Dean)

- **D1: nested semantics.** Recommended D1-a (nested literals/extractors/type tests test;
  nested shapes destructure). D1-b is full fluent semantics.
- **D2: guard syntax.** Recommended `case P && g:`. Alternative `case when(P, g):`.
- **D3: reject computed value cases**: calls to ordinary functions (not extractors or
  constructors, which stay patterns), `case a + 1:`, `case a || b:`. Recommended yes:
  typesugar is pre-release, and the only other rule that tells such a case apart from a
  pattern (parentheses) doesn't survive Prettier.

## Risks

- **Without the transformer, a pattern switch is still valid JavaScript.** A case with
  bindings throws ReferenceError when reached; a case without (`case { type: "Polygon" }:`)
  never matches and falls to `default` or off the end. The fluent chain fails loudly
  (`.case` is not a function). Unchanged by this PEP; the TS9224 warning covers the
  missing-import case, not a missing transformer.
- **Guards change the output shape.** One guarded case turns a discriminant switch into
  `switch (true)` for the whole switch. Measured cost is expected to be nil (an if-chain
  over a string compare), but Wave 2 checks it on Turf's `coordEach` benchmark.
- **Substituted guard reads repeat property access.** `s.w === s.h` reads `s.w` again in
  the body's destructure; a getter runs twice. Documented; the scrutinee itself is still
  read once.
