# Plan: Post-Migration Cleanup

> **STATUS: PENDING**

Follow-up from the `src/` → `packages/` migration. Four areas need attention.

## Phase 1: Fix Root `tsconfig.json` (Critical)

**Problem:** The root `tsconfig.json` still references the deleted `src/` directory:

```json
{
  "rootDir": "./src", // deleted!
  "include": ["src/**/*"], // matches nothing!
  "outDir": "./dist" // not used (noEmit: true)
}
```

This breaks IDE language services for any file opened at the root level (e.g., root `tests/`).

**Context:** There's already a `tsconfig.base.json` that all packages properly extend.
No packages use `composite` or project references.

**Fix:** Update `tsconfig.json` to cover the root `tests/` directory (the only
TypeScript code left at root level). Remove stale `rootDir`/`outDir` since `noEmit: true`.

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Not doing:** TypeScript Project References (`composite: true`). The packages already
use `tsup` for builds with independent `tsconfig.json` files extending the base.
Project references add complexity with no benefit when all packages use external
bundlers. Revisit if/when we need cross-package `tsc --build`.

## Phase 2: Clean Up Legacy Test Exclusions (Medium)

**Problem:** `vitest.workspace.ts` excludes 12 test patterns, but investigation
shows only 4 files actually exist:

| Excluded Pattern               | Exists? | Status                                                                               |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------ |
| `tests/react/**`               | No      | Remove from exclusion list                                                           |
| `tests/cats.test.ts`           | No      | Remove from exclusion list                                                           |
| `tests/comprehensions.test.ts` | Yes     | Has stale `../src/use-cases/` imports; `@typesugar/std` already has equivalent tests |
| `tests/specialize.test.ts`     | No      | Remove from exclusion list                                                           |
| `tests/sql.test.ts`            | No      | Remove from exclusion list                                                           |
| `tests/testing.test.ts`        | No      | Remove from exclusion list                                                           |
| `tests/type-system.test.ts`    | No      | Remove from exclusion list                                                           |
| `tests/typeclass.test.ts`      | No      | Remove from exclusion list                                                           |
| `tests/units.test.ts`          | No      | Remove from exclusion list                                                           |
| `tests/contracts.test.ts`      | Yes     | Has stale `../src/core/` imports                                                     |
| `tests/contracts-coq.test.ts`  | Yes     | Uses `@typesugar/contracts` (new paths)                                              |
| `tests/contracts-z3.test.ts`   | Yes     | Uses `../packages/` paths (new)                                                      |

**Fix:**

1. Remove 8 non-existent entries from the workspace exclusion list.
2. For the 4 existing files:
   - `comprehensions.test.ts` → Delete. `packages/std/tests/yield-syntax.test.ts` already covers this.
   - `contracts.test.ts` → Move to `packages/contracts/tests/`, fix `../src/core/` imports.
   - `contracts-coq.test.ts` → Move to `packages/contracts/tests/`.
   - `contracts-z3.test.ts` → Move to `packages/contracts-z3/tests/`.
3. Remove the `exclude` block entirely from `vitest.workspace.ts` (no more exclusions needed).

## Phase 3: Fix `vitest.config.ts` Coverage Paths (Low)

**Problem:** The root `vitest.config.ts` still has coverage pointing at deleted `src/`:

```ts
coverage: {
  include: ["src/**/*.ts"],      // deleted!
  exclude: ["src/**/*.d.ts"],    // deleted!
}
```

**Fix:** Update to `packages/*/src/**/*.ts` or remove coverage config from root
(let individual packages handle their own coverage).

## Phase 4: Decouple Transformer Path Mappings (Low)

**Problem:** `packages/transformer/src/index.ts` has hardcoded path-to-package
mappings in `resolveModuleSpecifier()` (~lines 508-525):

```ts
if (normalized.includes("/packages/units/")) return "@typesugar/units";
if (normalized.includes("/packages/sql/")) return "@typesugar/sql";
// ... 10+ more
```

Plus stale legacy mappings:

```ts
if (normalized.includes("/src/use-cases/units/")) return "@typesugar/units";
```

**Context:** This is NOT a runtime dependency — it's just string matching for
development-mode module resolution. The transformer's actual `package.json`
dependencies are clean (only `@typesugar/core`).

**Fix:**

1. Delete the legacy `/src/use-cases/` mappings (dead code).
2. Replace hardcoded list with a generic pattern:
   ```ts
   const pkgMatch = normalized.match(/\/packages\/([^/]+)\//);
   if (pkgMatch) return `@typesugar/${pkgMatch[1]}`;
   ```
3. This auto-discovers any package without hardcoded names.

## Execution Order

1. **Phase 1** — tsconfig fix (5 min, critical for IDE)
2. **Phase 2** — test cleanup (15 min, removes dead config)
3. **Phase 3** — coverage paths (2 min, trivial)
4. **Phase 4** — transformer path mappings (10 min)

Total: ~30 min of work. All changes are low-risk.
