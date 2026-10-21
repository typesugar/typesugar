---
"@typesugar/transformer": patch
"@typesugar/lsp-common": patch
"@typesugar/transformer-core": patch
---

Editor position fixes in the TypeScript plugin, for files whose macros expand:

- Go-to-definition (and go-to-implementation) lands on the right line after a `@derive` or other
  expansion that adds lines above the target. tsserver converts the result to line/column with
  the language service's `toLineColumnOffset`, which read the expanded code; the plugin now
  converts on the source text.
- TypeScript's quick fixes are offered in expanded files, with their edits on the source text.
  The error's span is mapped into the expanded code, and a fix that would edit generated code is
  not offered. "Fix all" (combined code fixes) is mapped the same way.
- TypeScript's own inlay hints are shown when the requested span starts or ends in a comment
  (as a whole-file request always does): the span is mapped as a range.
- Rename, find-references and document highlights no longer return locations in generated code.
  A `@derive` companion's references to the type were mapped onto the `@derive` tag, so renaming
  the type would have edited "@de" of the comment five times. A location is kept only when it is
  the same text in the source.
- A file the transform leaves unchanged maps positions by identity.

`@typesugar/lsp-common` adds `mapSourceSpanToOriginal` (a span that must be the user's own text)
and `mapTextSpanToTransformed` (a request span mapped as a range). Position-to-line lookups in
the `@typesugar/transformer-core` position mapper are now a binary search.
