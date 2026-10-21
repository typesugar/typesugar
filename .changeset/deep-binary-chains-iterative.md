---
"@typesugar/core": patch
"@typesugar/transformer-core": patch
"@typesugar/transformer": patch
---

A left-nested binary chain deeper than about 2,000 levels (a long string
concatenation or arithmetic line, as generated code has) failed with
"Transform failed: RangeError: Maximum call stack size exceeded": the macro
visitor recursed once per level, as did hygiene's binding scan, the pipeline's
source-map walk and its scratch-token pass. They now walk such chains with a
loop (same steps, same order, same output), and the operator rewrite rejects an
arithmetic operand before the checks that walk up the node's ancestors. A
20,000-term concatenation transforms in well under a second; plain tsc handles
that depth too. `@typesugar/core` exports the iterative walker,
`forEachDescendant`.
