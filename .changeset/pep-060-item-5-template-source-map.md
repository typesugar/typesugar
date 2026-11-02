---
"@typesugar/transformer": patch
---

The source map of an expanded file now maps every token after a template literal with
substitutions (`` `#${n}` ``) or a regular expression containing a quote or backtick. The map
generator found the output's tokens with a bare scanner, which read the `}` that ends a
substitution as a brace and the next backtick as the start of a new template, so the rest of the
file had no mappings: in the editor, diagnostics after such a template were dropped and
go-to-definition, references and rename lost every position after it. It now collects the
output's tokens by parsing it.
