---
"@typesugar/macros": patch
---

`typesugar check`/`build`: a fluent `match()` pattern name that shadows an outer declaration is
no longer checked as that declaration. In `function len(s: Seg) { return
match(s).case({ kind: "line", len }).then(len + 1)… }`, TypeScript checked `len + 1` against
the function `len` before expansion and reported TS2365, though the arm's `len` is the
`number` the pattern binds. The MacroCallChain rule now hides the errors that come from the
outer declaration's type for a name the arm binds (as ComprehensionBlock does for
do-notation), on the name, a member/call chain starting at it, or a binary expression it is
an operand of. The chain's expansion is still type-checked, so a wrong use of the binding
(`len.toUpperCase()`) is reported at the line you wrote.
