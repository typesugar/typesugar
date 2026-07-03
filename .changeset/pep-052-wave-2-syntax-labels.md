---
"@typesugar/core": minor
"@typesugar/std": minor
"@typesugar/contracts": minor
"@typesugar/transformer": minor
"@typesugar/transformer-core": minor
---

PEP-052 Wave 2: labeled-block macros are now import-scoped (`@syntax-labels`
activation), matching the operator/method syntax gates.

- BREAKING (pre-1.0): `let:`/`seq:`/`par:`/`all:` do-notation comprehensions
  only expand in files that import `@typesugar/std/syntax/do`, and bare
  `requires:`/`ensures:` contract blocks only apply `@contract` in files that
  import `@typesugar/contracts/syntax`. The explicit `@contract` decorator form
  is unaffected (importing the symbol is the opt-in).
- NEW: TS9224 warning when a block-shaped label matches a registered macro
  whose syntax is not activated, with a help hint naming the exact import to
  add (unexpanded do-notation is still valid JS — `x << effect()` silently
  becomes a bit-shift — so the hint matters).
- NEW: `@syntax-labels <macroName>` activation-marker tag (read alongside
  `@syntax-operators`/`@syntax-methods`) and an optional `syntaxModule` field
  on `LabeledBlockMacro`/`AttributeMacro` that feeds the TS9224 hint.
- FIXED: activation markers (all kinds, operators/methods included) were
  silently dropped in files rewritten by the expression-comprehension
  preprocessor — the re-parsed file isn't part of the `ts.Program`, so
  checker-based marker resolution failed. Markers now resolve against the
  program's own copy of the file.
- Ordinary loop labels that collide with macro label names (`all: for (…)`)
  are no longer expansion candidates in unactivated files and never warn.
