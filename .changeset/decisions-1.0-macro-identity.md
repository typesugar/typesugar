---
"@typesugar/core": minor
"@typesugar/transformer-core": minor
"@typesugar/transformer": patch
"@typesugar/validate": minor
---

Macro identity is (module, export name); validate's `assertType<T>()`; `is<T>(value)`

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
