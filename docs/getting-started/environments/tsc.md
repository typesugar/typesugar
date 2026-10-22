# tsc (TypeScript Compiler) Setup

This guide covers tsc-style builds, where the TypeScript compiler (not a bundler) writes
your `.js` and `.d.ts` files.

## Overview

The TypeScript compiler (`tsc`) doesn't run transformer plugins, so a plain `tsc`
does not expand macros. Build with the typesugar CLI instead: `typesugar build` is a
drop-in for `tsc` that reads the same `tsconfig.json`, expands macros, type-checks your
source (with the errors that only the unexpanded source has filtered out) and emits the
expanded code and declarations from it. `typesugar build --strict` also type-checks the
expanded code. No patching is needed.

[ts-patch](#alternative-a-ts-patched-tsc) is an alternative if you want `tsc` itself to
expand macros, with the caveats listed there.

## Installation

```bash
npm install --save-dev @typesugar/transformer typescript
```

(The `typesugar` umbrella package also provides the `typesugar` command.)

## Step 1: Add Scripts

```json
{
  "scripts": {
    "build": "typesugar build",
    "check": "typesugar check"
  }
}
```

## Step 2: Configure tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "declaration": true,
    "plugins": [
      { "name": "@typesugar/transformer/language-service" },
      { "transform": "@typesugar/transformer", "type": "program" }
    ]
  },
  "include": ["src/**/*"]
}
```

The `language-service` entry gives your editor the expanded types. The `transform`
entry is what a ts-patched `tsc` runs; `typesugar build` doesn't need it, but
`typesugar doctor` checks for it and plain `tsc` ignores it, so keeping it does no harm.

### Plugin Configuration

Under a [ts-patched `tsc`](#alternative-a-ts-patched-tsc), the `transform` entry
accepts options (`typesugar build` doesn't read them; set `cfg()` conditions for it
with `TYPESUGAR_CFG_*` variables):

```json
{
  "plugins": [
    {
      "transform": "@typesugar/transformer",
      "type": "program",
      "verbose": false,
      "cfgConfig": {}
    }
  ]
}
```

See [Configuration](../../reference/config.md#transformer-plugin) for every option.

### Typechecking

A [ts-patched `tsc`](#alternative-a-ts-patched-tsc) runs the transformer at **emit**
time, after TypeScript has already type-checked the file. So a patched `tsc`:

- type-checks the **original, unexpanded** source. Code that is valid only after
  expansion produces phantom errors — for example `@derive(Eq) interface P {…}`
  reports `TS1206: Decorators are not valid here`, and method sugar or `let:` labels
  are checked as written;
- reports macro errors (they are added to the emit diagnostics, so `tsc` exits
  non-zero on them);
- with `--noEmit`, never runs the transformer at all, so it is not a useful check.

For type-checking, and as your CI gate, use the typesugar CLI: `typesugar check`
(no output) or `typesugar build` (emits). They expand macros first and filter out
the phantom errors the unexpanded source produces, including TypeScript's errors on a
do-notation comprehension's own syntax (see [Do-Notation](../../guides/do-notation.md#type-checking)),
and on a typeclass operator that is rewritten (`a * b` on two `Rational`s) and on passing or
assigning its value. A use the filter can't see through is still reported: TypeScript
types `const p = a * b` as `number`, so `p.num` is an error until you annotate
`const p: Rational = a * b` (see [Operators](../../guides/operators.md)). To also
type-check the expanded output, add `--strict` (experimental).

### Declarations

TypeScript emits `.d.ts` files from the program it type-checked, so a patched `tsc`
declares the **unexpanded** types: an exported function that returns a fluent
`match()` is declared `: any`. `typesugar build` emits declarations from the expanded
program instead. Build a library with it:

```json
{
  "scripts": {
    "build": "typesugar build"
  }
}
```

With `declaration: true` in the tsconfig, `typesugar build` writes both the `.js` and the
`.d.ts` files. To write only the declarations (the JavaScript comes from a bundler), run
`typesugar build --emitDeclarationOnly`.

## Using the typesugar CLI

The typesugar CLI is built on the TypeScript API (recommended over a patched `tsc`;
see [Typechecking](#typechecking)):

```bash
# Build with macro expansion
npx typesugar build

# Watch mode
npx typesugar watch

# Type-check only
npx typesugar check

# See expanded output
npx typesugar expand src/main.ts

# Run a file directly (with macro expansion)
npx typesugar run src/main.ts
```

## Verification

1. Create a test file:

```typescript
// src/test.ts
import { comptime } from "typesugar";

export const buildTime = comptime(new Date().toISOString());
```

2. Build:

```bash
npx typesugar build
```

3. Check `dist/test.js` for the expanded timestamp.

## Multiple tsconfig Files

For different build configurations:

```bash
# Development build
npx typesugar build --project tsconfig.dev.json

# Production build
npx typesugar build --project tsconfig.prod.json
```

Each config can have its own compiler options (`outDir`, `target`, `include`, …).

## Troubleshooting

### Macros Not Expanding

1. Build with `typesugar build`: a plain `tsc` doesn't expand macros
2. Verify the file is included in `include`
3. Run `npx typesugar expand src/file.ts` to see what the macros produce

### IDE Shows Errors

1. Add the language service plugin
2. Restart your editor/TypeScript server
3. Ensure your editor is using the workspace TypeScript

## CI/CD Considerations

```yaml
# GitHub Actions example
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
  - run: npm ci
  - run: npx typesugar check
  - run: npm run build
```

## Alternative: a ts-patched tsc

[ts-patch](https://github.com/nonara/ts-patch) modifies the installed TypeScript so
that `tsc` runs the `transform` plugins in `tsconfig.json`. Use it only if you need
`tsc` itself to expand macros; read [Typechecking](#typechecking) and
[Declarations](#declarations) first, since a patched `tsc` checks and declares the
unexpanded source.

```bash
npm install --save-dev ts-patch
npx ts-patch install
```

`ts-patch install` patches `node_modules/typescript`, and a reinstall undoes it, so add
it to your `prepare` script (`-s` makes it silent on success):

```json
{
  "scripts": {
    "prepare": "ts-patch install -s"
  }
}
```

ts-patch also provides `tspc`, a patched `tsc` that doesn't modify
`node_modules/typescript`:

```json
{
  "scripts": {
    "build": "tspc"
  }
}
```

If a patched build reports "Transform not found", check with `npx ts-patch check`,
re-run `npx ts-patch install`, and make sure `@typesugar/transformer` is in
`node_modules`.

## Next Steps

- [Editor Setup](../editor-setup.md)
- [Vitest Setup](./vitest.md) for testing
- [Monorepo Setup](./monorepo.md) for workspace configurations
