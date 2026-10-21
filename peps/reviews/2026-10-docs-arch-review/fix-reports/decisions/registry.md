## Result

Two packages' same-named macros now coexist. Validate's `assert<T>()` and testing's `assert(cond)` both load in either order, and the user's import decides which one expands. Validate also exports `assertType<T>()`. `is<T>(value)` and the other value-argument forms now check the value immediately. The playground preloads validate. Every test run listed below passes.

## Design

**Keys** (`packages/core/src/registry.ts`, `MacroRegistryImpl`, documented in its class comment):

- **Macro with a `module`:** identified by kind + `module` + `exportName ?? name`.
- **Legacy macro (no `module`):** identified by kind + name. It also claims its `exportName`.
- **Labeled-block label:** belongs to exactly one macro. I kept labels globally unique because a label is syntax and there is no import to tell two macros apart.
- **Name index:** each name (and `exportName`) maps to its candidates in registration order. `getAll()` now lists each macro once; before, exportName aliases and multi-label macros appeared more than once.

**Re-registration and conflicts:**

- Same object, or a copy with the same kind/name/module/exportName/labels/description (an ESM/CJS or src/dist copy): idempotent, first registration kept.
- A different definition under a taken identity throws a loud error naming both modules. This applies to the same (module, name), to two different legacy macros with one name, and to two macros claiming one label.
- **Decision for Dean:** I removed the old rule in `isSameMacro` that treated all `typesugar`/`@typesugar/*` modules as one. It is what silently dropped testing's `assert` once validate had a module.
- **Decision for Dean:** a legacy macro and module-qualified macros may share a name. The bare-name getters return the legacy one; module-qualified resolution is never shadowed by it.
- **Risk:** "same definition" compares descriptions. A stale dist whose description differs from src would now throw instead of being silently ignored.

**New API:** `getCandidates(name, kind)` and an optional `kind` argument on `getByModuleExport` (`types.ts`).

**Every by-name lookup site and how it resolves now:**

- **Bare-name getters** (`getExpression`/`getAttribute`/`getDerive`/`getTaggedTemplate`/`getType`): return the legacy macro of that name, else the only provider, else `undefined` when several modules provide it. They never fall back to load order.
- **`resolveSymbolToMacro`** (import-resolution.ts): looks up the declaring module + export name for the kind first. It also collects the declaring modules, which break ties in the fallback.
- **`fallbackNameLookupWithImports`** (used for synthetic/detached nodes and as the fallback), in order:
  1. Exact identity from the import's module and imported name (aliases now work here too).
  2. A candidate whose module equals the import's module.
  3. The `typesugar` family wildcard, unchanged, if exactly one candidate matches. If several match, the one in a declaring module wins; otherwise the call is left unexpanded with a `console.warn`.
  4. A legacy macro.
- **`fallbackNameLookup`:** legacy macros only.
- **New `lookupMacroByName(sourceFile, name, kind)`:** one candidate gives that macro (same as before). Several are narrowed by the file's imports (exact, then wildcard), then a legacy macro, otherwise a warning and `undefined`. These sites in macro-helpers.ts now use it:
  - JSDoc tag name and dispatch
  - `sortDecoratorsByDependency`
  - `sortDeriveArgsByDependency`
  - `expandDeriveDecorator` (derive and `${name}TC`)
- **Unchanged:**
  - `getLabeledBlock` (label-activation.ts and pipeline.ts `let`/`par`): labels are unique.
  - `getAttributeByTriggerLabel` (transformer.ts:476/1957): first registered, gated by activation.
  - `isMacroModuleSpecifier` / `getAll`.
  - The transformer.ts:1808 decorator fallback `getAttribute`, which follows the bare-name rule. I did not edit transformer.ts because of the concurrent agent.
- **Also fixed:** `resolveModuleSpecifier` now reads the last `node_modules/` segment, so pnpm store paths map to the package instead of `.pnpm`.
- **Loader:** a `__typesugar_macros__` package with one conflicting macro still registers the rest, and the conflict appears as a load warning.

## Validate

- All validate macros declare `module: "@typesugar/validate"`.
- `assertType<T>()` added (macro, overloaded runtime stub and types), sharing `assert`'s expand.
- `is`/`assert`/`assertType`/`validate` with one argument apply the generated function to it on the spot. The argument is evaluated once and the output type-checks; this follows typia's `is<T>(input)`. More than one argument is a compile-time error.

## Tests (each failed before the fix for the stated reason, except where noted)

- `packages/core/tests/registry-identity.test.ts` (10). Before the fix, the second `assert` was silently dropped or threw, and `getCandidates` did not exist. I also updated the existing "different modules throw" test in registry.test.ts to "coexist".
- `packages/transformer-core/tests/macro-identity.test.ts` (13): named, aliased and namespace imports in both orders, the import-literal fallback, the umbrella-import tie, declaring module winning through a re-export, `lookupMacroByName`, and the pnpm path.
- `packages/validate/src/__tests__/with-testing.test.ts` (7, executed): one file and two files, both registration orders, identical output in either order, and `assertType` next to testing's `assert`. **Caveat:** it uses `assertTypeMacro`, so it could not run before the fix. The pre-fix failure was reproduced at the registry and resolver levels.
- `macros-e2e.test.ts`: immediate form (executed and type-checked), argument evaluated once, error on more than one argument, and the `assertType` alias. These failed before the fix.
- `packages/transformer/tests/macro-loader.test.ts`: two new loader tests.
- **Runs** (all passing, one at a time, `--maxWorkers=1`):

| Suite                                | Result             | Peak memory |
| ------------------------------------ | ------------------ | ----------- |
| packages/core/tests                  | 267 passed         | ~0.37 GB    |
| packages/transformer-core/tests      | 403 passed         | ~0.86 GB    |
| packages/validate                    | 48 passed          | ~1.33 GB    |
| packages/testing, one file at a time | 44 + 13 + 4 passed | ≤0.95 GB    |
| macro-loader tests                   | 40 passed          | —           |
| 4 transformer pipeline files         | 82 passed          | ~1.3 GB     |
| 4 macros registry tests              | 88 passed          | ~1.5 GB     |

The multi-file runs went over the ~1 GB target, one at a time.

- Loading every macro dist together, the only names with several providers are `assert` and `assertType` (testing and validate).
- Doc examples run through `doc-example.mjs --run`: 0 diagnostics and correct output.

## api/compile.ts and the Vercel check

- Added `import "@typesugar/validate/macros"`, removed the exclusion comment, and added validate to `EXPECTED_MACROS`.
- The expected-macro check now matches on (module, name), with `from: "typesugar"` accepting any `@typesugar/*` module. A plain module match flagged `typeclass`, whose module is `@typesugar/typeclass`.
- **Root package.json changed:** `"@typesugar/validate": "workspace:*"` added to devDependencies. It was needed: esbuild failed with `Could not resolve "@typesugar/validate/macros"`.
- I hand-added the matching `pnpm-lock.yaml` importer entry (3 lines) and created the symlink `node_modules/@typesugar/validate -> ../../packages/validate` instead of running `pnpm install`. The orchestrator should run `pnpm install` to confirm it is a no-op.
- `build-vercel-output.mjs --functions-only --out …/scratchpad/fix3/registry/vercel-out` reports "All 3 Vercel functions load and respond" and "All 22 expected macros registered OK". A probe POST mixing validate and testing code expanded both correctly. Not deployed.

## Docs (sentences changed)

- **playground.md:** validate is now in the loaded list, and the exclusion note became the coexistence note.
- **validate.md:**
  - `assertType` paragraph
  - "Checking a Value Directly" section
  - "Using validate and testing together" section
  - API table rows for the value forms
- **testing.md:** a note pointing at validate's `assert`.
- **writing-macros/index.md:** the "macro names are global, a duplicate throws" paragraph became a "Macro identity: module and export name" section.
- **expression-macros.md:** the "`check` because `assert` is taken" sentence.
- What docs should now say: both `assert`s coexist and the import picks one; `is<T>(x)` returns a boolean that narrows `x`; `assert<T>(x)` and `assertType<T>(x)` return `x` or throw; `validate<T>(x)` returns the Validated result.

## Changeset

`.changeset/decisions-1.0-macro-identity.md`: core minor, transformer-core minor, transformer patch, validate minor.

## Rebuilt dists

core, transformer-core, transformer, validate.

## Needs from other owners / deferred

- `packages/validate/package.json` should list `"@typesugar/testing": "workspace:*"` in devDependencies. The new test imports it, and today it resolves only through the root node_modules.
- transformer.ts:1808 decorator fallback could use `lookupMacroByName(this.ctx.sourceFile, macroName, "attribute")`. Not required for correctness.
- Pre-existing, not mine: the playground compile function warns "macro package '@typesugar/testing' could not be resolved … will not be expanded" even though the macros do expand there.
- PEP-060 item 8's status line is not updated.

## Files changed

- packages/core/src/registry.ts
- packages/core/src/types.ts
- packages/core/tests/registry.test.ts
- packages/core/tests/registry-identity.test.ts (new)
- packages/transformer-core/src/import-resolution.ts
- packages/transformer-core/src/macro-helpers.ts
- packages/transformer-core/tests/macro-identity.test.ts (new)
- packages/transformer/src/macro-loader.ts
- packages/transformer/tests/macro-loader.test.ts
- packages/validate/src/macros.ts
- packages/validate/src/index.ts
- packages/validate/src/**tests**/macros-e2e.test.ts
- packages/validate/src/**tests**/with-testing.test.ts (new)
- api/compile.ts
- package.json (root)
- pnpm-lock.yaml
- docs/guides/validate.md
- docs/guides/testing.md
- docs/guides/playground.md
- docs/writing-macros/index.md
- docs/writing-macros/expression-macros.md
- .changeset/decisions-1.0-macro-identity.md (new)

No git state changes. No background processes left running.
