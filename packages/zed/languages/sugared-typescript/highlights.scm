; Sugared TypeScript highlight queries
; Inherits from tree-sitter-typescript, with macro-specific additions.
;
; Since we use the standard TypeScript grammar, custom syntax like |> and ::
; won't get specialized highlighting yet. The LSP server provides semantic
; tokens which editors can overlay for macro-aware highlighting.

; Re-export TypeScript highlights (Zed loads these from the grammar automatically)
