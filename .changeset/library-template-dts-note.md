---
"@typesugar/transformer": patch
---

The `typesugar create library` template's `tsup.config.ts` says when its bundled
declarations stop being enough: instances, derives and `Destructure` extractors
work for consumers through tsup's one-`.d.ts`-per-entry output, but a library
that ships `@opaque` types needs per-module declarations and JavaScript, because
consumers find an opaque type's companions as `export`ed functions in the
`.d.ts` module that declares it.
