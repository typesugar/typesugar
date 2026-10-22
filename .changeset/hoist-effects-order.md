---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An inlined operator chain no longer moves a side effect in front of an earlier read. In
`pv + (bump() + bump())`, the two `bump()` calls were bound to `const`s before the statement
while `pv` was read in it, after them, so a `bump()` that reassigned `pv` changed the result
(`{ x: 1000, y: 1000 }` instead of `{ x: 1, y: 10 }`; likewise `this.pos + (this.step() +
this.step())`). An operand with side effects is now hoisted only when nothing in the statement
is evaluated before it except literals, `this` and `const` names (checked through the type
checker); otherwise that level is applied as a function call in place. Hoisted `const`s also
go after the statement's leading comments now, with a JSDoc comment staying on the statement.
