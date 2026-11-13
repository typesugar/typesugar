---
"@typesugar/core": patch
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
"@typesugar/std": patch
---

Fixes from the 2026-11 architecture review (audit/ARCH-REVIEW-2026-11-TRIAGE.md):

- A decorator the file implements itself is no longer taken for a macro of the same name:
  `function reflect(t) { … }  @reflect class A {}` keeps the user's `@reflect` instead of
  dropping it and emitting `__A_meta__`. An ambient declaration (`declare function reflect`)
  still reaches the macro.
- Every opt-out feature in docs/guides/opt-out.md now works. `"use no typesugar typeclasses"`
  turns off `@typeclass`, `@impl`/`@instance` and `summon`/`summonAll` (it was accepted and
  ignored), and `"use no typesugar derive"` covers a JSDoc `/** @derive … */` tag as well as
  the decorator. Core exports the feature names as `OptOutFeature`/`OPT_OUT_FEATURES`, and a
  macro can declare the feature that turns it off (`optOutFeature`), checked by
  `isMacroOptedOut`.
- An expression-position comprehension (`const f = (x) => par: { … } yield: { … }`) in a file
  that hasn't activated the label syntax gets the TS9224 hint, as the block form does, instead
  of only TypeScript's syntax error.
- An ambiguous typeclass method-sugar instance (and a failure resolving one) is reported at the
  call, not at the start of the file.
- TS9602 for an imported generic function says that only same-file functions are specialized,
  instead of advising a different declaration form.
- std's `ordArray(O).lessThan` and the other comparison methods no longer rebuild the `Ord` and
  `Eq` dictionaries on every call.
