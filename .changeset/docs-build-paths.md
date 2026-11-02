---
"@typesugar/transformer": patch
"@typesugar/transformer-core": patch
---

Docs: the recommended build paths are a bundler plugin (`unplugin-typesugar`, or
`withTypesugar()` from `typesugar/tsup`), `typesugar build` in place of `tsc`, and
`node --import typesugar/register` for running files. ts-patch is documented as an
alternative for a plain `tsc`, not as a required step. The transformer README and
the AI-assistant context `typesugar init` installs (`ai/AGENTS.md`, the typesugar
skill) say so; the transformer-core README no longer calls the transformer a
ts-patch plugin.
