---
"@typesugar/core": patch
"@typesugar/fp": patch
"@typesugar/std": patch
"@typesugar/macros": patch
"typesugar": patch
---

Docs and comments brought in line with the extractor typing, covering-match,
marker-type and scoping fixes: the fp README's `Some`/`None` output (the
assertion, no `MatchError`), the std and macros READMEs on when a match has no
throw, the umbrella README on markers being types, the reserved TS9702 (no
"automatic"/"explicit" modes in 1.0), and core's prelude, resolution-scope and
`ResolutionConfig` comments (the mode and prelude are not read).
