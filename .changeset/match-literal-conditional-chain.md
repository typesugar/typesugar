---
"@typesugar/std": patch
---

`match()`: literal arms compile to a conditional chain, and no dead `MatchError`

- A match whose arms are all plain literals (with any `.or()` literals), ending
  in `.else()`, a `_` arm or an arm that completes a literal union, now compiles
  to `x === "a" || x === "b" ? 1 : x === "c" ? 2 : 3` when the scrutinee is an
  identifier. It used to compile to an arrow IIFE, a closure per evaluation,
  unless it had exactly one arm and an `.else()`. The guide already documented
  `x === "ok" ? 200 : 500` for this shape. A `yield` or `await` in such a match
  now stays in the enclosing function.
- On the IIFE path, an arm that returns unconditionally (a fully covering last
  arm, or an unguarded `_` or binding) is now the end of the generated code. A
  `throw new MatchError(...)` used to follow it, which could never run but
  still added `import { MatchError } from "@typesugar/std"` to the output, so a
  library gained a runtime dependency on `@typesugar/std` for dead code.

Found by the Turf case study (Stage 3), on `@turf/meta`'s `flattenEach`.
