---
"@typesugar/transformer": patch
---

The TypeScript plugin now loads when `tsconfig.json` names it as documented
(`{ "name": "@typesugar/transformer/language-service" }`). tsserver requires the plugin module to
be the factory function, and the package's CommonJS entry exported `{ default }`, so tsserver
skipped it with "did not expose a proper factory function". Editors that load the plugin from
`tsconfig.json` (Neovim, Zed, Sublime, Helix and Emacs through typescript-language-server or
vtsls) got no typesugar support. The VS Code extension was not affected: it loads the plugin
through `@typesugar/ts-plugin`, which unwraps `default`.
