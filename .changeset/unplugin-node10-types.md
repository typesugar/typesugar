---
"unplugin-typesugar": patch
---

The bundler subpaths (`unplugin-typesugar/vite`, `/webpack`, `/esbuild`, `/rollup`, `/rolldown`, `/tsup`) now have types under `moduleResolution: node10`, which ignores `exports` (it is still the default with `module: commonjs`). A config file importing one failed to type-check with TS2307 in such a project; `typesVersions` now maps each subpath to its declarations.
