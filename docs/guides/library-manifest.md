# Library Manifest

> **Planned — not in 1.0.** Nothing on this page works yet. The transformer does not read
> `typesugar.manifest.json` or a `typesugar` instances/extensions block in `package.json`, there
> is no `manifest` plugin option, and there is no `typesugar manifest` CLI command.

## What was planned

A library would declare its typeclasses, instances, extension methods and operators in a
`typesugar.manifest.json` file (or a `typesugar` field in `package.json`). The transformer would
then discover those declarations in dependencies and use them for `summon`, implicit resolution
and extension-method rewriting, without the library's own code going through typesugar.

`@typesugar/core` exports the building blocks for this (`loadManifest`, `validateManifest`,
`discoverManifests`, `createManifestRegistry`, `mergeManifestIntoRegistry`,
`getManifestRegistry`), but nothing in the compiler calls them, so a manifest has no effect on a
build. Treat these exports as unstable.

## What to use today

- To ship macros, declare `typesugar.macros` in your `package.json`; the compiler loads macro
  packages from that field only. See [Authoring Libraries](./authoring-libraries.md).
- To ship typeclass instances and extension functions, export them as ordinary values. Users
  import them by name. A named import of an extension function enables method syntax on the
  receiver (see [Extension Methods](./extension-methods.md)); for instances, see
  [Typeclasses](./typeclasses.md).
