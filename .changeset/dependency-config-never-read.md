---
"@typesugar/core": patch
"@typesugar/transformer": patch
---

Security: a dependency's config is never read, and the editor ignores a dependency's own
project. Opening a file inside `node_modules/evil` in VS Code gave it the project
`node_modules/evil/tsconfig.json`; the language-service plugin attached to it and loaded
config from `node_modules/evil`, which ran evil's `typesugar.config.cjs` in the editor and let
a `"typesugar": { "security": { "allowedMacroPackages": ["evil"] } }` block in evil's
package.json approve evil's macros for your own project. Now:

- no host reads a config file or a package.json `"typesugar"` block inside a `node_modules`
  directory (by real path); a search starting inside one walks past it to the project's
  config;
- the language-service plugin does nothing in a project whose tsconfig is inside
  `node_modules`;
- config is kept per project: a `TransformationPipeline` given `config` (`config.capture()`
  after `config.load()`; `createPipeline`, the editor and the ts-patch entry do this) makes
  that project's config current around its work (`config.runWith()`), so one editor or Node
  process serving two projects applies each project's config to its own files only.
