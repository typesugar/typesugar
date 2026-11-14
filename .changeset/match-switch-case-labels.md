---
"@typesugar/std": patch
"@typesugar/macros": patch
---

`match: switch` case labels are literals, constants or patterns. A label the switch form didn't recognise used to compile, with no error, as a value compared with `===`, and the names in it threw `ReferenceError` at run time: an attempted guard (`case { kind: "rect", w, h } && w === h:`) or a type test (`case String(s):`). Anything else is now a compile error that names the fix; a call is a pattern only when its callee has an extractor. `typesugar check` no longer reports false errors on pattern cases: TS2678 "not comparable" on a pattern that lacks some of the variant's fields (`case { kind: "rect", w }:`), and errors from an outer declaration whose name a pattern also binds.
