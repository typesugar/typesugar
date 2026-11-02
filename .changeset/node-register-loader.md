---
"@typesugar/transformer": minor
"typesugar": minor
---

New: `node --import typesugar/register` (also `@typesugar/transformer/register`), Node module hooks that run TypeScript through typesugar's macro expansion, for scripts, tsx, `node --test`, tape and benchmarks run from source.

- Each `.ts`/`.mts`/`.cts`/`.tsx` module outside `node_modules` is expanded with the nearest `tsconfig.json`. A module the expansion does not change goes to the rest of the loader chain untouched (Node's type stripping, or tsx), so a project with no macros runs exactly as before. A changed module is compiled to JavaScript for the running Node (no downlevelling; class-field semantics follow the tsconfig `target`) with an inline source map. A macro error fails the import.
- Works alone on Node 22.18+ / 23.6+ and with tsx registered before or after it, since it reads sources from disk rather than from the next loader. Also via `NODE_OPTIONS` (or pnpm's `node-options`).
- The resolve hook maps a missing relative `./x.js` imported from TypeScript to `./x.ts` (`.mjs`/`.cjs`/`.jsx` likewise), as TypeScript and tsx do.
- Uses `module.registerHooks()` where available (Node 22.15+ / 23.5+, covers `require()`), else `module.register()` (Node 20.6+, `import` only).
- The hook module imports only Node builtins; TypeScript and the pipeline load on the first TypeScript module.
- `@typesugar/transformer`: `transpileExpanded()` takes a `module` option, and `TransformationPipeline` has `getCompilerOptions()`.

See docs/getting-started/environments/node.md.
