# Rebrand: ttfx → typesugar

**Syntactic Sugar for TypeScript** - Compile-time macros for TypeScript.

## Phase 1: Claim Namespaces

- [ ] **npm**: Claim `typesugar` package name (publish placeholder)
- [ ] **npm**: Claim `@typesugar` org scope (create org at npmjs.com)
- [x] **GitHub**: Create `typesugar/typesugar` repo under `typesugar` org
- [ ] **Domain**: Register `typesugar.dev`

## Phase 2: Rename Directory & Migrate Cursor

- [x] Rename `~/src/ttfx` → `~/src/typesugar`
- [x] Rename Cursor internal project directory to preserve chats
- [x] Update Git remote origin

## Phase 3: Bulk Replace

- [x] Renamed `packages/ttfx` to `packages/typesugar`
- [x] Renamed `unplugin-ttfx` to `unplugin-typesugar`
- [x] Bulk replaced `ttfx` to `typesugar` across codebase
- [x] Fixed circular TSConfig plugins dependency issue

---

# Rebrand: typemacro → ttfx

**"TypeScript that F\*cks!"** - Compile-time macros for TypeScript.

> In good company: `thefuck` has 95k+ GitHub stars, `feh` = "Fucking Fast Image Viewer"

## Phase 1: Claim Namespaces

- [ ] **npm**: Claim `ttfx` package name (publish placeholder)
- [ ] **npm**: Claim `@ttfx` org scope (create org at npmjs.com)
- [x] **GitHub**: Create `ttfx` repo under `dpovey` account
- [ ] **Domain**: Register `ttfx.dev` (~$13/year first year, ~$21/year renewal)

## Phase 2: Rename Directory & Init Git ✅

- [x] Rename `~/src/macrots` → `~/src/ttfx`
- [x] `git init` in the new directory
- [x] Set up `.gitignore` (node_modules, dist, etc.)
- [x] Initial commit

## Phase 3: Update Package Names (20 packages) ✅

### Root monorepo

- [x] `typemacro-monorepo` → `ttfx-monorepo`

### Main package

- [x] `typemacro` → `ttfx`
- [x] Renamed folder `packages/typemacro` → `packages/ttfx`

### Scoped packages (@typemacro/_ → @ttfx/_)

- [x] `@typemacro/core` → `@ttfx/core`
- [x] `@typemacro/transformer` → `@ttfx/transformer`
- [x] `@typemacro/comptime` → `@ttfx/comptime`
- [x] `@typemacro/derive` → `@ttfx/derive`
- [x] `@typemacro/operators` → `@ttfx/operators`
- [x] `@typemacro/reflect` → `@ttfx/reflect`
- [x] `@typemacro/typeclass` → `@ttfx/typeclass`
- [x] `@typemacro/specialize` → `@ttfx/specialize`
- [x] `@typemacro/integrations` → `@ttfx/integrations`
- [x] `@typemacro/vscode` → `@ttfx/vscode`
- [x] `@typemacro/strings` → `@ttfx/strings`
- [x] `@typemacro/units` → `@ttfx/units`
- [x] `@typemacro/sql` → `@ttfx/sql`
- [x] `@typemacro/zero-cost` → `@ttfx/zero-cost`
- [x] `@typemacro/type-system` → `@ttfx/type-system`
- [x] `@typemacro/cats` → `@ttfx/fp`
- [x] `@typemacro/adapter-kysely` → `@ttfx/kysely`
- [x] `@typemacro/adapter-effect` → `@ttfx/effect`
- [x] `@typemacro/effect-do` → `@ttfx/effect-do`

### Example

- [x] `typemacro-example-basic` → `ttfx-example-basic`

## Phase 4: Update References ✅

### Config files

- [x] Root `tsconfig.json` - plugin transform path (`typemacro/transformer` → `ttfx/transformer`)
- [x] `examples/basic/tsconfig.json` - plugin references
- [x] All internal `workspace:*` dependencies in package.json files

### VSCode extension

- [x] Rename folder `packages/vscode-typemacro` → `packages/vscode-ttfx`
- [x] Update `displayName`, `publisher` in package.json
- [x] Update activation events (`typemacro.manifest.json` → `ttfx.manifest.json`)
- [x] Update command IDs (`typemacro.*` → `ttfx.*`)
- [x] Update configuration keys (`typemacro.enableCodeLens` → `ttfx.enableCodeLens`)
- [x] Rename syntax files (`typemacro.tmLanguage.json` → `ttfx.tmLanguage.json`)

### Documentation

- [x] Update README.md with new name/branding
- [x] Update import examples (`from "typemacro"` → `from "ttfx"`)
- [x] Update tsconfig examples in docs

### Source code

- [x] Search/replace all import paths referencing old package names
- [x] Update any hardcoded package name references

## Phase 5: Push to GitHub ✅

- [x] Add remote: `git remote add origin git@github.com:dpovey/ttfx.git`
- [x] Push: `git push -u origin main`

## Phase 6: Monorepo Reorganization ✅

- [x] Create READMEs for all 21 packages with documentation
- [x] Add examples/ directory to each package with self-contained demos
- [x] Promote src/use-cases/react to @ttfx/react package
- [x] Promote src/use-cases/testing to @ttfx/testing package
- [x] Remove redundant src/use-cases/ directories
- [x] Create docs/ directory with microsite skeleton
- [x] Update root README.md with package index

## Phase 7: Publish to npm (when ready)

- [ ] Verify all packages build (`pnpm build`)
- [ ] Run tests (`pnpm test`)
- [ ] Publish `ttfx` main package
- [ ] Publish all `@ttfx/*` scoped packages
