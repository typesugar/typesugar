---
"@typesugar/macros": patch
"@typesugar/transformer-core": patch
---

An import used only through extension calls (`import { clamp }` for `n.clamp(0, 100)`, or a
`/** @extension */` object import) is no longer reported unused under `noUnusedLocals` (new
ExtensionImport suppression rule; a declaration split between a JSDoc `@derive` tag and
extension calls is covered too). An `@extension` tag on an import that enables nothing gets a
warning (PEP-064 Wave 2).
