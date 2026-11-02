---
"@typesugar/testing": patch
"@typesugar/macros": patch
---

`assert(p === q)` on a type with an `Eq` operator printed an empty diagram
(`__powerAssertFail("p === q", [], …)`): the operator rewrite passes copies of
the operands, which have no source position, so nothing was recorded. A copy
is now drawn at the column of the source expression it copies, so the diagram
shows `p` and `q`. That includes an in-file instance whose method is inlined
(`p.x === q.x`): an inlined argument keeps its link to the caller's source
node when that node is in the file being transformed.
