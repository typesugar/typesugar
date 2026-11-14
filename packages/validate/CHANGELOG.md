# @typesugar/validate

## 0.2.0

### Minor Changes

- 3709f72: Macro identity is (module, export name); validate's `assertType<T>()`; `is<T>(value)`
  - **`@typesugar/core`** (behaviour change, PEP-060 item 8): a macro that declares a `module`
    is now identified in the registry by its kind, `module` and `exportName ?? name`, not by
    its bare name. Two packages can register macros with the same name and both stay loaded.
    Before, the second registration threw "… is already registered" (or, between two
    `@typesugar/*` modules, was silently dropped), so whichever package loaded second lost
    that macro and every macro it registered after it. Registering the same definition again
    (an ESM/CJS or src/dist copy) is still a no-op. A different definition under one identity
    still throws, and so do two different module-less macros of one name and two macros
    claiming one labeled-block label. The bare-name getters (`getExpression(name)` and the
    others) return the module-less macro of that name, else the only macro of that name,
    else `undefined` when several modules provide it. They no longer return whichever loaded
    first. New: `getCandidates(name, kind)` and an optional `kind` argument on
    `getByModuleExport`. `getAll()` lists each macro once.
  - **`@typesugar/transformer-core`**: a call resolves to the macro of the module its import is
    declared in (named, aliased and namespace imports). The import-literal fallback for
    synthetic or detached nodes now picks by the import's module and imported name, and an
    import from `typesugar` that matches two packages' macros is left unexpanded with a
    warning rather than picking one. `@derive` names, JSDoc tags and decorator expand-order
    lookups use the file's imports when several modules provide a name
    (`lookupMacroByName`). `resolveModuleSpecifier` reads the package from the last
    `node_modules/` segment, so pnpm store paths (`node_modules/.pnpm/…/node_modules/@scope/pkg`)
    map to the package and not to `.pnpm`.
  - **`@typesugar/transformer`**: a `__typesugar_macros__` package with one conflicting macro
    still registers the rest and reports the conflict as a load warning.
  - **`@typesugar/validate`**: its macros now declare `module: "@typesugar/validate"`, so
    `assert<T>()` coexists with `@typesugar/testing`'s `assert(cond)` (also on the
    playground, which now preloads validate). New `assertType<T>()`, an alias of
    `assert<T>()` (the typescript-is and typia name), for files that import testing's
    `assert` as well. `is<T>(value)`, `assert<T>(value)`, `assertType<T>(value)` and
    `validate<T>(value)` now check `value` immediately (typia's form). Before, the argument
    was silently dropped and the call returned the checker function, so `if (is<T>(x))` was
    always true. More than one argument is a compile-time error.

### Patch Changes

- 76672a0: PEP-053 Waves 4–5: the compiler's hard-coded builtin instance table is gone.
  The ~28 static `registerInstanceMethods(...)` registrations (source-code-as-
  strings copies of the fp/std/effect instances), the deprecated
  `registerInstanceMethods` function, and the internal-registration machinery
  are deleted from `@typesugar/macros`. Instance method bodies now come
  exclusively from source extraction — the same rules for std/fp/effect
  instances as for user instances, no builtin magic. The 16 primitive
  intrinsics (`eqNumber` → `a === b`, …) and the per-program AST registry
  (`registerInstanceMethodsFromAST`) remain. `eitherBifunctor` and
  `flatMapStream` (registrations with no corresponding source instance) are
  dropped. Residual `specialize()`-as-API comment mentions in std/effect/
  collections/validate sources are rewritten for the always-on model.
- ab72bde: PEP-058 Wave 1: declare `engines.node >=20` on all published packages and enable npm provenance attestations in the release pipeline.
- 93ea406: PEP-060 item 1: support TypeScript 6, reject TypeScript 7 with one clear error
  - **Peer range is now `typescript >=5.9.0 <7.0.0`** on every package (was
    `>=5.0.0 <6.0.0`). TypeScript 6.0.x still has the JavaScript compiler API typesugar
    is built on; TypeScript 7 (`typescript@latest` since 7.0) does not. The floor
    moved up from 5.0 because older releases were measured to break: before 5.5,
    Node's ESM loader sees none of TypeScript's named exports, so the CLI and the
    Vite plugin crash on their first `ts.*` access (5.0–5.3 also lack
    `checker.isTypeAssignableTo` and other APIs typesugar calls); 5.5–5.8 lack
    `checker.getNonPrimitiveType()`, so `@impl X<object>` instances never resolve.
    5.9.3 and 6.0.3 build, type-check and pass the core, transformer-core, macros,
    transformer, std and fp suites. The `library` and `macro-plugin` templates that
    `typesugar create` copies peer the same range, and all three templates now
    install `typescript ^5.9.3`.
  - **`typescript` is now an optional peer** of the packages whose runtime `.` entry
    never loads it: codec, collections, contracts, erased, fp, fusion, mapper, parser,
    strings, testing, units, validate and the `typesugar` umbrella. Their `./macros`
    entries still need TypeScript at build time. `check:runtime-purity` now fails if a
    package with an optional peer loads `typescript` from its `.` entry, directly or
    through a dependency.
  - **TypeScript version guard.** `@typesugar/core` exports `assertSupportedTypeScript`,
    `getUnsupportedTypeScriptReason`, `UnsupportedTypeScriptError`,
    `SUPPORTED_TYPESCRIPT_RANGE` and `TYPESCRIPT_SUPPORT_URL`. `@typesugar/macros` runs
    it first thing at load, and the transformer (pipeline, ts-patch factory, and the
    language-service plugin, which checks tsserver's own TypeScript), `transformCode`,
    unplugin, the LSP server and the ESLint processors call it before their first
    compiler-API access. On TypeScript 7 they all stop with
    `[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed the JavaScript
compiler API that typesugar's transformer needs. Install typescript@6 (or 5.9+) as a
devDependency for typesugar (npm i -D typescript@6); see
https://typesugar.org/getting-started/troubleshooting#typescript-7` instead of an
    opaque `Cannot read properties of undefined (reading 'ES2022')`. TypeScript older
    than 5.9, or a module missing `ts.factory` / `ts.createProgram`, is rejected the
    same way.

- Updated dependencies [e92220f]
- Updated dependencies [612112b]
- Updated dependencies [de93aa3]
- Updated dependencies [e3065ec]
- Updated dependencies [4d4ce68]
- Updated dependencies [f8dcade]
- Updated dependencies [3709f72]
- Updated dependencies [2543157]
- Updated dependencies [c5ebf64]
- Updated dependencies [d79d995]
- Updated dependencies [0b5bcf8]
- Updated dependencies [a070a0c]
- Updated dependencies [01a547c]
- Updated dependencies [d3243f9]
- Updated dependencies [2694138]
- Updated dependencies [3ae83a6]
- Updated dependencies [7d84596]
- Updated dependencies [3460709]
- Updated dependencies [810833a]
- Updated dependencies [0435dc6]
- Updated dependencies [459807a]
- Updated dependencies [95602ac]
- Updated dependencies [a39fa2d]
- Updated dependencies [8b4060d]
- Updated dependencies [a6584d7]
- Updated dependencies [c9a1e3e]
- Updated dependencies [4b0d84d]
- Updated dependencies [977888e]
- Updated dependencies [283fe78]
- Updated dependencies [d7d6236]
- Updated dependencies [eb6e5a8]
- Updated dependencies [0780883]
- Updated dependencies [2252df8]
- Updated dependencies [851809b]
- Updated dependencies [8b0526f]
- Updated dependencies [6f70351]
- Updated dependencies [a591082]
- Updated dependencies [2b2fda8]
- Updated dependencies [c30101d]
- Updated dependencies [4f6ad83]
- Updated dependencies [d8f810b]
- Updated dependencies [63bf193]
- Updated dependencies [98adbea]
- Updated dependencies [48b621b]
- Updated dependencies [563e46b]
- Updated dependencies [053978c]
- Updated dependencies [8aaf40f]
- Updated dependencies [c56886c]
- Updated dependencies [ab72bde]
- Updated dependencies [a252187]
- Updated dependencies [93ea406]
- Updated dependencies [c3ad41c]
- Updated dependencies [51a72ca]
- Updated dependencies [cf7c08b]
- Updated dependencies [2f1744b]
- Updated dependencies [5d86014]
  - @typesugar/core@0.2.0
  - @typesugar/fp@0.2.0
  - @typesugar/type-system@0.1.2

## 0.1.1

### Patch Changes

- e2cbd69: Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- First stable patch release. Fixes build crash, LSP server stability, Zed extension, and adds pipeline/position-mapper exports to transformer.
- Updated dependencies [e2cbd69]
- Updated dependencies
  - @typesugar/core@0.1.1
  - @typesugar/fp@0.1.1
  - @typesugar/type-system@0.1.1

## 0.1.1-rc.0

### Patch Changes

- Initial release candidate. Fixes build crash (start < 0), LSP server stability, Zed extension npm integration, and typesugar run/expand improvements.
- Updated dependencies
  - @typesugar/core@0.1.1-rc.0
  - @typesugar/fp@0.1.1-rc.0
  - @typesugar/type-system@0.1.1-rc.0
