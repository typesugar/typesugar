---
"@typesugar/std": patch
---

`break match;` inside a `match:` switch works: when a case names the label, the
expanded switch keeps it (renamed, with its `break`s, when a nested `match:`
switch would clash). It used to be removed, leaving `break match;` a
`SyntaxError: Undefined label 'match'`.
