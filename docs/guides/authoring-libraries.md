# Authoring & Shipping a typesugar Library

This guide shows how to build and publish a library with typesugar so that it works
for consumers **standalone** (plain `tsc`, no setup) _and_ offers extra ergonomics
(dot-syntax, operator overloading, compile-time macros) when the consumer runs the
typesugar transformer.

> Reference PEPs: [PEP-050](../../peps/PEP-050-shipping-typesugar-libraries.md)
> (this split), [PEP-055](../../peps/PEP-055-macro-package-discovery.md) (how a
> `./macros` entry gets **discovered** — required reading if you're shipping
> macros from outside the `@typesugar/` npm scope).
> Worked examples in this repo: **`@typesugar/fp`** (runtime library with zero-cost
> `@opaque` types) and **`@typesugar/strings`** (a macro package).

## The mental model: three kinds of artifact

A typesugar package can ship up to three things, and they have **opposite**
distribution requirements:

| Part                 | Runs…                                                    | Build deps                      | In the app's runtime bundle? | Entry         |
| -------------------- | -------------------------------------------------------- | ------------------------------- | ---------------------------- | ------------- |
| **Macros**           | at the consumer's **build** time, inside the transformer | `typescript`, `@typesugar/core` | **No**                       | `./macros`    |
| **Runtime**          | at the app's **run** time                                | none                            | Yes                          | `.`           |
| **`.d.ts` metadata** | consumer build time (read, not executed)                 | —                               | n/a                          | alongside `.` |

There are two cases, and most real packages are one or the other (some are both).

---

## Case 1 — Shipping macros (a compiler extension)

A macro is a function that runs **inside the consumer's transformer** and rewrites
their code (e.g. `regex\`...\``→`new RegExp("...")`). Macros import `typescript`.

### Rules

1. **Put macro definitions in a dedicated `./macros` entry**, never in `.`.
   `typescript` is multi-MB and must not reach the app bundle.
2. **Register on import.** The transformer loads your `./macros` entry for its side
   effects; call `globalRegistry.register(...)` at module scope.
3. **Declare `typesugar.macros` in your `package.json`** so the compiler can
   actually **find** that entry ([PEP-055](../../peps/PEP-055-macro-package-discovery.md)):
   ```jsonc
   { "typesugar": { "macros": "./macros" } }
   ```
   Without this field your `./macros` entry exists but is never `require()`'d —
   nothing discovers it. See "Getting discovered" below for what happens next,
   which differs depending on whether you publish under the `@typesugar/` scope.
4. **Keep `typescript`/`@typesugar/core` as peer/dev deps**, not runtime deps.
5. **Emit references to runtime symbols, don't inline them.** If your macro needs a
   helper at runtime, put the helper in the `.` runtime entry and have the macro emit
   an import to it (use `ctx.ensureImport(symbol, "your-pkg")`, or emit a bare
   identifier the consumer imports).

### Getting discovered

The compiler only ever `require()`s a package's `./macros` entry if that
package's own `package.json` declares `typesugar.macros` — there is no other
discovery path (no name list to get added to, no prefix convention to match).
What happens after it's declared depends on your package's npm scope:

- **Published under `@typesugar/`**: auto-discovered, unconditionally, the
  moment a consumer imports anything from your package. No action required on
  the consumer's part. (This scope is reserved for the typesugar project's own
  packages.)
- **Published under any other name or scope** (the common case for a
  third-party macro package): the first time a consumer's build encounters
  your package declaring `typesugar.macros`, the build **fails** with a
  diagnostic naming your package and pointing at
  `typesugar approve-macros`. Running that command once lists what's new,
  prompts for confirmation, and writes the approval into the consumer's own
  `typesugar.config.ts` (committed to their repo, so every subsequent build —
  local or CI — proceeds without re-prompting). This is by design, not a bug
  to work around: compiling code that imports your package means running your
  package's code at build time, and typesugar requires the consumer to
  explicitly consent to that for anything outside its own first-party scope —
  see [`docs/SECURITY.md`](../SECURITY.md) for the full rationale. Mention this
  one-time step in your own package's README so consumers aren't surprised by
  it.

### Worked example: `@typesugar/strings`

`strings` is split into two source files:

```
src/index.ts    →  the `.` runtime entry: regex/html/fmt/raw STUBS (typed, throw if
                   the transformer didn't run) + __typesugar_escapeHtml (the helper
                   the html macro emits calls to). No `typescript` import.
src/macros.ts   →  the `./macros` entry: regexMacro/htmlMacro/fmtMacro/rawMacro +
                   register(); register();  // imports `typescript`
```

`package.json`:

```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
    },
    "./macros": {
      "types": "./dist/macros.d.ts",
      "import": "./dist/macros.js",
      "require": "./dist/macros.cjs",
    },
  },
  // Required for the compiler to find the ./macros entry above — see
  // "Getting discovered" (PEP-055).
  "typesugar": {
    "macros": "./macros",
  },
}
```

`tsup.config.ts`: `entry: ["src/index.ts", "src/macros.ts"]`.

The transformer's macro-loader `require()`s exactly the specifier your
`typesugar.macros` field names — `"./macros"` resolves to `your-pkg/macros`
through your own `exports` map, so the split above is what actually gets
loaded, no guessing involved. Verify with
`node scripts/check-runtime-purity.mjs` — it fails if a runtime `.` entry
imports `typescript`.

---

## Case 2 — Shipping runtime library code

This is plain, **post-transform** TypeScript: companion functions, zero-cost types,
derived instances as plain objects. It works under plain `tsc` with no typesugar
setup. The `.d.ts` carries `@opaque`/`@derive` annotations that an _optional_
consumer-side transformer reads to enable dot-syntax.

### Rules

1. **Emit per-module declarations, never a bundled `.d.ts`.** Bundlers
   (rollup-plugin-dts) collapse modules into chunks and rename colliding symbols
   (`map` → `map$1`), which destroys consumer-side discovery and stable import names.
   Use `tsc --emitDeclarationOnly`; for JS, prefer `tsup` `bundle:false` so every
   module is a real importable file.
2. **Companions must be importable and collision-free.** Same-named companions for
   different types (Option's `map` vs Either's `map`) can't be one top-level export —
   give each type its own subpath (`@your-pkg/data/option`) or namespace.
3. **Use `.js` extensions on relative imports in your source.** TypeScript copies
   import specifiers verbatim into the emitted `.d.ts`; under NodeNext, extensionless
   relative imports are invalid and the types collapse to `any` for consumers.
4. **Don't leak host globals.** e.g. use `ReturnType<typeof setInterval>` instead of
   `NodeJS.Timer` so the public `.d.ts` doesn't force `@types/node`.

### Worked example: `@typesugar/fp` Option

`Option<A>` is an `@opaque A | null` interface in `src/data/option.ts`, with companion
functions co-located:

```ts
/** @opaque A | null */
export interface Option<A> {
  map<B>(f: (a: A) => B): Option<B>; /* … */
}
export function map<A, B>(opt: Option<A>, f: (a: A) => B): Option<B> {
  /* … */
}
```

`tsup` emits per-module JS (`bundle:false`), `tsc -p tsconfig.build.json` emits
per-module `.d.ts`, and `package.json` exposes every module via a `"./*"` wildcard
export. A consumer can then:

```ts
// Standalone (plain tsc, no transformer): call the companion directly.
import { Some, Option } from "@typesugar/fp";
import { map } from "@typesugar/fp/data/option";
const r: Option<number> = map(Some(42), (x) => x + 1);

// With the transformer: dot-syntax, rewritten to the same companion.
const r2 = Some(42).map((x) => x + 1); // → map(42, (x) => x + 1)
```

---

## Consumer tiers (what your users get)

|                                                             | Standalone (plain `tsc`)                                    | With the typesugar transformer |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| Companion functions (`map(opt, f)`, `Type.Eq.equals(a, b)`) | ✅ works                                                    | ✅ works                       |
| Dot-syntax (`opt.map(f)`, `a.equals(b)`)                    | ❌ (types check, but throws at runtime for zero-cost types) | ✅ rewritten to companions     |
| Tagged-template / attribute macros                          | ❌ stubs throw                                              | ✅ expanded                    |

**Honest limit:** a _zero-cost_ type can't offer working dot-syntax standalone —
`Some(42)` is literally `42` and has no methods. Make the companion API first-class
and document that dot-syntax requires the transformer.

## Checklist

- [ ] Macros (if any) live in `./macros`; the `.` entry never imports `typescript`
      (run `scripts/check-runtime-purity.mjs`).
- [ ] `package.json` declares `typesugar.macros` pointing at that entry — without
      it, the compiler never discovers your macros at all (PEP-055).
- [ ] If publishing outside the `@typesugar/` scope, your README mentions the
      one-time `typesugar approve-macros` step consumers will hit.
- [ ] `typescript`/`@typesugar/core` are peer/dev deps, not runtime deps.
- [ ] Declarations are emitted per-module (`tsc --emitDeclarationOnly`), not bundled.
- [ ] Relative imports in source use `.js` extensions (NodeNext-safe `.d.ts`).
- [ ] Companions are importable from a collision-free subpath/namespace.
- [ ] No host-global types (`NodeJS.*`) leak into the public `.d.ts`.
- [ ] Verified both tiers: a plain-`tsc` consumer (companions) and a typesugar
      consumer (sugar) both compile and run.
