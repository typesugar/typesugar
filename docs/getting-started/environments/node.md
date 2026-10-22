# Node.js, tsx and node:test

Run TypeScript with macros straight from source in Node: scripts, `tsx`,
`node --test`, tape, benchmarks. `typesugar/register` adds Node module hooks that expand
each TypeScript module through the same pipeline the bundler plugins use.

## Installation

```bash
npm install --save-dev typesugar typescript
```

## Usage

```bash
# Node alone (Node 22.18+ / 23.6+, which strip types themselves)
node --import typesugar/register src/main.ts

# With tsx
tsx --import typesugar/register src/main.ts
node --import typesugar/register --import tsx src/main.ts

# Node's test runner
node --import typesugar/register --test "src/**/*.test.ts"
```

To turn it on for every script in a project without editing each one, set it in
`NODE_OPTIONS`. With pnpm, put it in `.npmrc`; pnpm passes it to every script it runs:

```ini
# .npmrc
node-options=--import=typesugar/register
```

```bash
# Or for one command
NODE_OPTIONS="--import=typesugar/register" npm test
```

The hook module itself imports only Node builtins. TypeScript and the macro pipeline
load the first time a TypeScript module is imported, so processes that never import
one (the tsx CLI's parent process, lint tools, bundlers) pay almost nothing.

## How it works

For each `.ts`, `.mts`, `.cts` or `.tsx` module outside `node_modules`:

1. typesugar expands the file, using the nearest `tsconfig.json` above it, so macros
   see the same types `tsc` would.
2. **If the expansion changed nothing**, the module goes to the rest of the loader
   chain untouched: Node strips the types, or tsx compiles it. A file with no macros
   runs exactly as it would without typesugar.
3. **If it changed**, typesugar compiles the result to JavaScript itself and hands
   that to Node, with an inline source map back to your source. It emits for the
   running Node and does not downlevel, but it keeps the class-field semantics of your
   tsconfig's `target` (`useDefineForClassFields`).
4. **A macro error fails the import** with the file, line and message. The module is
   not run with raw macro calls in it.

typesugar reads each file from disk instead of taking it from the next loader, so it
works whether it is registered before or after tsx.

The resolve hook adds TypeScript's own rule for relative imports: `./lib.js` imported
from a TypeScript file resolves to `./lib.ts` when there is no `lib.js`
(`.mjs` to `.mts`, `.cjs` to `.cts`, `.jsx` to `.tsx`). tsx already does this; Node's
type stripping does not.

On Node 22.15+ / 23.5+ the hooks use `module.registerHooks()`, which covers `require()`
too. On older Node (20.6+) they fall back to `module.register()`, which runs the hooks
in a worker thread and covers `import` only.

## Limits

- Without tsx, a file typesugar does not change still goes through Node's own type
  stripping. That means Node 22.18+ / 23.6+, and only erasable syntax in your own code
  (no `enum` or `namespace`). Code that macros generate is compiled by typesugar, so it
  can use either. With tsx in the chain, tsx handles the unchanged files.
- `.tsx` needs tsx. Node cannot run JSX.
- The type checker is not run. Use `typesugar check` for type errors.
- No expansion cache is written. Each process expands the files it imports.
- The loader keeps a TypeScript program in the process: about 0.5 s of startup and
  roughly 165 MB per process. That can shift microbenchmarks on its own, so when you
  benchmark code with and without typesugar, run the loader on both sides (or on
  neither, comparing built output).

## Logging

```bash
TYPESUGAR_VERBOSE=1 node --import typesugar/register src/main.ts
```

This prints the tsconfig each pipeline uses and, for each module, whether typesugar
expanded it or left it unchanged.

## Alternatives

- [`typesugar run`](./tsc.md#using-the-typesugar-cli) bundles a file with esbuild and runs the bundle.
  Paths such as `import.meta.url` and `__dirname` then point at the bundle, not your
  source, so tests that read fixtures next to themselves should use the loader.
- For Vitest, use the Vite plugin: [Vitest Setup](./vitest.md).
