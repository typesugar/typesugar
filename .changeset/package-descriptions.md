---
"typesugar": patch
"@typesugar/typeclass": patch
"@typesugar/derive": patch
"@typesugar/lsp-common": patch
---

Package descriptions: the umbrella package uses the project tagline;
`@typesugar/typeclass` no longer claims auto-derivation (instances come from
`@derive` and `derived()`); `@typesugar/derive` says it is the `@derive` macros;
`@typesugar/lsp-common` describes the language-service helpers it holds, not the
removed LSP server.
