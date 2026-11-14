---
"@typesugar/std": patch
---

`match()` compiles nested extractor arms to a decision tree. `Ok(Ok(v))`, `Ok(Err(e))`, `Err(e)` used to become three independent `if`s that repeated the outer test (`"value" in _r && (_r.value != null && typeof _r.value === "object" && "value" in _r.value)`) and ended in `throw new MatchError(_r)`, a runtime import of `@typesugar/std`. Adjacent arms with the same outer extractor now share one test, bind the payload to a const that TypeScript narrows, and match the inner patterns on it; the last branch of a level the arms provably cover has no test, so a covering match has no throw and no import, and its output type-checks. The payload's null/object guard is dropped only when its type rules out `null` and primitives. Arm order is kept: a guard, `.or()` or `.as()` between two arms ends the group, and anything the tree can't express keeps the flat form. Single-level matches emit what they did.
