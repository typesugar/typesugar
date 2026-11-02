---
"@typesugar/std": patch
---

`match()`: an extractor's binding has the payload's type, and a covering extractor match has no dead `MatchError`

- `Some(v)` over `@typesugar/fp`'s `Option` compiled to `const v = _o`, typed
  `Option<number>`: fp's `Option` is `@opaque`, so `_o != null` doesn't narrow
  it for the checker, and the expanded code failed strict type-checking
  (`typesugar build --strict`, the playground's `strictOutput`) on `v * 2`. The
  binding is now asserted to the payload type the `Destructure` instance's
  `extract` declares (`const v = _o as unknown as number`), worked out by
  matching `extract`'s parameter type against the value's type by identity. The
  same goes for `Some(...)` nested in another extractor (`Right(Some(v))`), for
  nested tests (`Some(5)`), and for the `match: switch` form. Left/Right,
  Cons/Nil, Valid/Invalid and `@derive(Destructure)` extractors bind fields of
  transparent types, which TypeScript narrows itself; they were already typed.
- A match whose extractors cover the type (Some/None, Left/Right, Cons/Nil,
  Valid/Invalid, Ok/Err-style discriminants, derived variant extractors) now
  ends in its last arm with no test: no `throw new MatchError(...)`, so no
  runtime `import { MatchError } from "@typesugar/std"` in the output. The same
  holds for a 7+ literal `switch` that covers its literal union (the last arm
  is the `default:`). A value outside the static type takes the last arm.
- Arms that bind nothing (`None`, `Nil`, `Some(_)`, literals) compile to a
  conditional instead of an IIFE: `match(o).case(None).then("none").case(Some(_)).then("some")`
  is `o == null ? "none" : "some"`. Arms with bindings keep the IIFE, which
  gives their `const`s a block.
