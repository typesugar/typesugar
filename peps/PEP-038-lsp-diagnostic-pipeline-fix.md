# PEP-038: LSP Diagnostic Pipeline Fix

## Status: Waves 1+2A+2B+2C Implemented, Waves 2D–2G In Design

## Problem

The VS Code extension's LSP server had unreliable diagnostics — errors came and went,
appeared at wrong positions, or were missing entirely. Multiple root causes:

### Root Cause 1: Extension Activation Failure

`vscode-languageclient` was externalized by tsup (because it was in `dependencies`) but
never included in the VSIX, so `require("vscode-languageclient/node.js")` failed at
runtime, leaving the extension stuck on "Activating...".

### Root Cause 2: Pipeline Recreation Storm

`getTransformResult()` called `ensureFileInPipeline()` for every file.
`ensureFileInPipeline()` added the file to `projectFileNames` and **recreated the entire
pipeline**. When the TS language service read 60+ lib.d.ts files, each triggered a full
pipeline recreation that cleared all transform caches, re-transformed all project files,
and invalidated all position mappers.

### Root Cause 3: Stale AST on Edit

`onDidChangeContent` called `pipeline.invalidate(fileName)` which only cleared the
expansion cache — it did NOT reset the TS program or the cached transformer factory.
The macro transformer kept using a stale AST with old source code, so edits had no
effect on diagnostics.

### Root Cause 4: SFINAE Over-Suppression

The MacroGenerated SFINAE rule used `errorCodes: []` (wildcard) and suppressed ANY
diagnostic where `toOriginal()` returned null — including real user errors after macro
expansions.

### Root Cause 5: staticAssert Cache

The disk-backed `MacroExpansionCache` cached staticAssert results without re-emitting
diagnostics on re-transform.

## Changes

### packages/vscode/tsup.config.ts

- Added `noExternal: ["vscode-languageclient"]` — inlines the client library into the
  extension bundle.

### packages/vscode/src/extension.ts

- Changed from `module`/`TransportKind.ipc` (fork, hangs with ESM) to
  `command: "node", args: [serverModule, "--stdio"]` (spawn).
- Removed manual `registerCommand` for LSP commands — used `middleware.executeCommand`
  instead to avoid "command already exists" conflict with vscode-languageclient's
  ExecuteCommandFeature.
- Added auto-disable of `typescript.validate.enable` to prevent duplicate diagnostics.
- Added `resolveServerPath()` preferring bundled `server-bundled.cjs`.

### packages/lsp-server/src/server.ts

- **Removed `ensureFileInPipeline`** and `pipelineFileSet` entirely — the pipeline is
  created once with all project files at initialization.
- **New file handling in `onDidOpen`**: adds file to project and recreates pipeline ONCE
  only for new transformable files.
- **Guarded `getScriptSnapshot`**: early return for `.d.ts` and `node_modules` files —
  avoids calling `getTransformResult` for untransformable files.
- **Changed `invalidate` → `invalidateContent`** in `onDidChangeContent` — resets the
  TS program and transformer factory so edits produce fresh diagnostics.
- Added `pipelineGeneration` counter for TS language service cache busting.
- Pre-transforms all project files in `createPipeline` for deterministic macro registry state.

### packages/transformer/src/pipeline.ts

- Fixed `invalidateContent()` to also null `cachedTransformerFactory` — the factory
  captures a reference to the program at creation time, so it must be recreated when
  the program changes.

### packages/core/src/sfinae-rules.ts

- Changed MacroGenerated rule from `errorCodes: []` (wildcard) to specific list
  `[2451, 2304, 2339, 6133, 6196]`.

### packages/macros/src/static-assert.ts

- Added `cacheable: false` to staticAssertMacro, compileErrorMacro, compileWarningMacro.

### packages/macros/src/typeclass.ts

- Fixed @derive TS2451: skip companion `const` when namespace already exists.
- Fixed Show shadowing: hoist implementation to module scope when it references
  primitive companions (e.g., `Show.string`).

### packages/transformer/src/index.ts

- Applied @derive companion const fix in the transformer call site.

### packages/lsp-server/tsup.config.ts

- Added second config for `server-bundled.cjs` with `noExternal: [/.*/]` and
  `external: ["typescript"]`.

### packages/lsp-server/tests/lsp-integration.test.ts

- Fixed LspClient: changed from string-based to Buffer-based LSP message parsing —
  `Content-Length` is bytes but string `.length` counts characters, causing parse
  failures on multi-byte characters (e.g., `✓` in log messages).
- Added test: "staticAssert error clears when condition is fixed (false → true)".
- Added test: "@derive error updates when derives are added/removed".

### Fixture fixes

- `integration/fixtures/basic-project/src/macros.ts`: removed Show from @derive
  (not imported), changed staticAssert to `false` for error testing.
- `integration/fixtures/basic-project/src/pipe-chain.ts`: renamed `const bad` to
  `const pipeBad` to avoid TS2451 with macros.ts in same project.

### packages/vscode/test/vsix-smoke.test.ts

- Added tests for: vscode-languageclient inlining, extension size, external requires,
  lsp-server bundling, middleware usage, icon.

### tests/emit-pipeline.test.ts

- Added tests for: @derive(Eq) companion const, namespace merging, multi-interface,
  full pipeline integration.

## Problem: Derive Instance Resolution

`@derive(Ord)` on `interface Point { x: number; y: number }` generates
`Ord.number.compare(a.x, b.x)`. But the user's `import { Ord } from "typesugar"`
brings in a `unique symbol` (from derive.ts), not the primitives namespace object
(from primitives.ts). So `Ord.number` fails: "Property 'number' does not exist on
type 'unique symbol'".

This affects all typeclasses whose `deriveProduct` uses `companionAccess(tc, primitiveType)`
for primitive fields: Ord, Show, Hash, Semigroup, Monoid. Eq avoids it only because its
`deriveProduct` has a hard-coded special case inlining `===` for primitives.

### Root cause

The derive system resolves instances through hardcoded companion paths (`Ord.number`)
and a central `instanceRegistry` populated by `primitives.ts` on module load. This is
fragile and non-extensible:

- Companion paths assume the typeclass name in scope refers to the namespace, not the
  derive symbol.
- The `instanceRegistry` is a central list that third-party packages can't extend
  without importing `@typesugar/macros` internals.
- The Eq `===` special case is a one-off hack, not a generalizable pattern.
- `PRIMITIVE_TYPES` is a hardcoded list — custom types can never be "primitive".

### Design goal: Scala 3-style implicit resolution

In Scala 3, `case class Point(x: Int, y: Int) derives Ord` works because:

1. The compiler calls `Ord.derived`, which uses `Mirror.ProductOf[Point]` to inspect
   fields.
2. For each field, it resolves the instance via `summon[Ord[Int]]` — implicit search
   finds the `given Ord[Int]` wherever it's defined.
3. The search is type-based, not name-based. Any `given` with the right type works,
   regardless of its name or which module defines it.
4. The search scope follows well-defined rules: local scope > explicit imports >
   companion objects of the typeclass and type argument.

typesugar should follow the same model: resolve instances by **type matching** against
`@impl`-annotated values in scope, not by hardcoded companion paths or name conventions.

## Wave 2: Type-Based Instance Resolution (TODO)

### Overview

Replace the hardcoded `companionAccess` / `instanceRegistry` system with a Scala 3-style
instance resolver that finds instances by scanning imports and local declarations for
`@impl`-annotated values with matching types. The registry becomes a cache, not the
source of truth.

### Wave 2A: Instance Scanner Infrastructure

**Goal**: Build the machinery to scan a module's exports for typeclass instances by type.

#### Instance scanning

Create an `InstanceScanner` that, given a module (resolved via the TypeChecker), finds
all exported values that are typeclass instances. An exported value is a typeclass
instance if:

1. It has an `@impl` JSDoc tag or decorator, AND
2. Its type annotation matches `TC<ForType>` (e.g., `Ord<number>`), OR
3. Its type is structurally compatible with a known typeclass interface (duck typing
   fallback for untagged instances like the current `primitives.ts` exports).

The scanner returns `ScannedInstance` records:

```typescript
interface ScannedInstance {
  typeclassName: string; // "Ord"
  forType: string; // "number"
  symbolName: string; // "ordNumber"
  sourceModule: string; // "@typesugar/macros" or "./my-instances"
}
```

#### Instance cache

The scanner results are cached per module per pipeline run. The cache is keyed by
resolved module path. `pipeline.invalidateContent()` clears relevant cache entries.

The existing `instanceRegistry` is retained for backward compatibility but becomes a
secondary source — scanned instances take precedence.

#### Annotate primitive instances

Update `packages/macros/src/primitives.ts` to add `@impl` annotations and explicit
type declarations to all primitive instances:

```typescript
/** @impl("Ord<number>") */
export const ordNumber: Ord<number> = {
  compare: (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0),
};
```

This makes them discoverable by the scanner without relying on naming conventions or
the hardcoded `primitiveInstances` array.

#### Key files

- **NEW: packages/macros/src/instance-scanner.ts** — `InstanceScanner` class
- **packages/macros/src/primitives.ts** — add `@impl` annotations + type declarations
- **packages/macros/src/typeclass.ts** — `InstanceInfo` gains `sourceModule` field

#### Tests

- Unit tests for `InstanceScanner`: scans a module, finds annotated instances, ignores
  non-instances.
- Test that primitives.ts instances are discoverable by the scanner.
- Test that the scanner handles re-exports (e.g., `typesugar` re-exporting from
  `@typesugar/macros`).

### Wave 2B: Instance Resolver

**Goal**: Implement the resolution algorithm that, given `(typeclass, forType)`, finds
the best instance in scope — mirroring Scala 3's implicit search.

#### Resolution algorithm

```typescript
function resolveInstance(
  ctx: MacroContext,
  tcName: string,
  forType: ts.Type, // actual TS type, not a string
  scanner?: InstanceScanner
): ResolutionResult;
```

Where `ResolutionResult = ResolvedInstance | AmbiguousInstances | undefined`.

**Type-based matching**: The resolver takes the actual `ts.Type` of the field being
derived and compares it against each candidate instance's type parameter using
`typeChecker.isTypeAssignableTo()`. This handles type aliases (`type MyNum = number`
matches `@impl("Ord<number>")`), subtypes, and complex types that string comparison
would miss. Each candidate's `forType` string (from `@impl` tag) is resolved to a
`ts.Type` for comparison.

Search order (highest priority first):

1. **Local scope**: Scan current file with `InstanceScanner`, filter candidates where
   the field type is assignable to the instance's type parameter.
2. **Explicit imports**: For each named import, resolve its module, scan it, check if
   any scanned instance both type-matches and has `exportName` matching the import.
3. **Module-level search**: For each imported module, scan all exports and filter for
   type-compatible instances. (`import { Ord } from "typesugar"` makes `ordNumber`
   available because both are exported from `"typesugar"`.)
4. **Registry fallback**: Call existing `findInstance()` for backward compat.

At each stage: 0 → next stage. 1 → return. 2+ at same priority → `AmbiguousInstances`.

```typescript
type ResolutionSource = "local-scope" | "explicit-import" | "module-scan" | "registry";

interface ResolvedInstance {
  kind: "resolved";
  typeclassName: string;
  forType: ts.Type; // actual TS type
  forTypeString: string; // display string for diagnostics
  exportName: string; // "ordNumber"
  sourceModule: string; // resolved file path
  source: ResolutionSource;
  importSpecifier?: string; // original import string for injection
}

interface AmbiguousInstances {
  kind: "ambiguous";
  typeclassName: string;
  forType: ts.Type;
  candidates: ResolvedInstance[];
}
```

#### Key files

- **NEW: packages/macros/src/instance-resolver.ts** — `resolveInstance()`, types,
  type matching, import map helper, cache management
- **packages/macros/src/index.ts** — export resolver + types

#### Tests

- Local scope: `@impl` in same file found with `source: "local-scope"`.
- Explicit import: `import { ordNumber }` found with `source: "explicit-import"`.
- Module-level scan: `import { Ord }` from module that also exports `ordNumber`.
- Registry fallback: manually pushed `instanceRegistry` entry found.
- Precedence: local beats explicit import beats module scan beats registry.
- Ambiguity: two modules export matching instance at same priority → `kind: "ambiguous"`.
- Type alias matching: `type MyNum = number` matches `@impl("Ord<number>")`.
- No match → `undefined`.
- Unresolvable module → gracefully skipped.
- `clearResolverCache()` forces fresh resolution.

### Wave 2C: Wire Resolver into Derive Codegen ✅

**Status**: Implemented

**What was done** (differs from original plan — simpler approach):

- `resolveFieldInstance(ctx, tcName, typeName, fieldType?)` — new public API exported
  from `@typesugar/macros`. Any derivation (builtin or external) calls this to resolve
  field-level instances. Tries the Scala 3-style resolver, falls back to companion-path
  convention.
- `companionAccess` uses an ambient `MacroContext` (set via `withDerivationContext`) to
  call `resolveFieldInstance` transparently inside builtins. Builtins pass `field.type`
  where available for type-based matching.
- `@derive` dispatch now falls through to `GenericDerivation` strategies — any typeclass
  that calls `registerGenericDerivation` works with both `summon` AND `@derive`.
- `tryExpandGenericDerive` — shared function that both transformers call. Builds
  companion namespaces directly as AST (no string manipulation).
- Integration test: standalone "Pretty" typeclass registered via
  `registerGenericDerivation`, verified with `@derive(Pretty)`.

**Import injection** — deferred. The resolver finds instances but import injection for
cross-file resolved instances is not yet implemented (Wave 2E work).

**Special case removal** — deferred. `PRIMITIVE_TYPES`, Eq `===` inlining, and
`hasPrimitiveSelfRef` hoisting are still in place. These will be cleaned up as part
of the AST codegen migration (Wave 2G).

#### Key files changed

- `packages/macros/src/typeclass.ts` — `resolveFieldInstance`, `companionAccess`,
  `withDerivationContext`, `tryExpandGenericDerive`, `companionPathFallback`
- `packages/macros/src/index.ts` — new exports
- `packages/transformer/src/index.ts` — GenericDerivation fallback in `@derive`
- `packages/transformer-core/src/macro-helpers.ts` — same
- `tests/custom-typeclass-derive.test.ts` — new test file

### Wave 2D: Remove Runtime Instance Registry

**Goal**: Remove the runtime `registerInstance` / `TC.summon("typename")` pattern.
Companion namespaces and compile-time `summon<TC<Type>>()` make it redundant.

#### What to remove

1. **`@typeclass` macro output**: Remove the `Map<string, TC<any>>` registry, the
   `registerInstance` method, the runtime `summon` method, `hasInstance`, and
   `registeredTypes` from generated typeclass objects.

2. **`builtinDerivations` output**: Remove all ~50 `/*#__PURE__*/ TC.registerInstance<Type>(...)`
   calls from derivation code strings (Show, Eq, Ord, Hash, Functor, Semigroup, Monoid,
   Clone, Debug, Default, Json, TypeGuard).

3. **Primitive registrations**: Remove `registerInstance` calls from the inline
   primitive instance code in `generateStandardTypeclasses` (~15 calls).

4. **`stripRuntimeRegistration`**: Delete this function — no longer needed since
   `convertToCompanionAssignment` won't have registration calls to strip.

5. **`@instance` handler**: Remove the `if (tcInfo?.isExported)` block that emits
   `registerInstance` calls (line ~2260).

6. **Callers of runtime `.summon()`**: Update `packages/sql/examples/typeclasses-example.ts`
   to use compile-time `summon<TC<Type>>()` instead. Check
   `packages/transformer-core/src/import-resolution.ts` for any references.

#### What to keep

- Compile-time `instanceRegistry` — still needed for `summon` macro resolution.
- `registerInstanceWithMeta` — still needed for compile-time registration.
- Companion namespaces — these ARE the runtime access pattern (`Point.Eq.equals(...)`).
- `__typesugar_companions` global — used by runtime tooling.

#### Tests

- All existing tests pass (the runtime registry is populated but never read in tests).
- Generated typeclass objects are smaller (no Map, no methods).
- `@derive` output has no `registerInstance` calls.
- The `summon<TC<Type>>()` macro still works (uses compile-time registry, not runtime).

### Wave 2E: Third-Party Package Support & Integration Tests

**Goal**: Verify that third-party packages can provide typeclass instances that
`@derive` and `summon` find automatically.

#### End-to-end scenario

A third-party package `my-tc-package` exports:

```typescript
// my-tc-package/index.ts
export interface Serialize<A> {
  serialize(a: A): string;
}

/** @impl("Serialize<number>") */
export const serializeNumber: Serialize<number> = {
  serialize: (a) => String(a),
};
```

User code:

```typescript
import { Serialize } from "my-tc-package";

/** @derive(Serialize) */
interface Point {
  x: number;
  y: number;
}
```

The derive system:

1. Sees `@derive(Serialize)` — checks for a `GenericDerivation` strategy.
2. For each field, the derivation calls `resolveFieldInstance(ctx, "Serialize", "number")`.
3. The resolver scans `"my-tc-package"` (the module that `Serialize` was imported from)
   and finds `serializeNumber`.
4. Generated code references `serializeNumber.serialize(a.x)`.
5. Transformer injects `import { serializeNumber } from "my-tc-package"`.

#### Import injection

After processing all `@derive` for a file, the transformer collects all resolved
instances that are not local and injects import declarations. The transformer already
has infrastructure for this (`pendingTypeRewriteImports`). Add a parallel
`pendingInstanceImports` set.

#### Integration test

- Add a fixture with a mock third-party package.
- Test `@derive` finding instances from it.
- Test `summon` finding instances from it.

### Wave 2F: Migrate Builtins to AST-Based Codegen

**Goal**: Replace string-based code generation in `builtinDerivations` with direct AST
construction (`ts.factory.create*`). This eliminates `convertToCompanionAssignment`
(regex rewriting) and the fragile string→parse round-trip.

See `CLAUDE.md` rule: "prefer AST over string manipulation."

#### Scope

- Each entry in `builtinDerivations` (Show, Eq, Ord, Hash, Functor, Semigroup, Monoid,
  Clone, Debug, Default, Json, TypeGuard) currently returns a code string.
- Change `BuiltinTypeclassDerivation.deriveProduct` / `deriveSum` to return
  `ts.Statement[]` instead of `string`.
- Remove `convertToCompanionAssignment`, `stripRuntimeRegistration`,
  `ensureDataTypeCompanionConst` — the AST builders produce companion namespaces directly.
- Remove the `withDerivationContext` ambient pattern — builtins receive `ctx` directly
  in the new interface and call `resolveFieldInstance` explicitly.

#### Migration strategy

Migrate one typeclass at a time with tests between each. Start with a simple one (Clone
or Debug), then tackle the complex ones (Eq with `===` inlining, Show with template
literals).

### Wave 2G: Documentation

**Goal**: Document the instance resolution system and how to create custom typeclasses
with instances that `@derive` and `summon` discover automatically.

#### User-facing documentation

- Add a "Custom Typeclasses" guide showing how to define a typeclass + primitive
  instances + derive support.
- Document `@impl` annotation requirements (JSDoc tag format, type annotation).
- Document resolution precedence rules (local > explicit import > module search).
- Add examples for third-party typeclass packages.

#### API documentation

- Document `InstanceScanner` and `ScannedInstance` for library authors.
- Document `resolveInstance()` for macro authors building custom derive strategies.

## Verification

Each wave has its own test suite. The full verification after all waves:

```bash
# Unit tests
npx vitest run packages/macros
npx vitest run tests/emit-pipeline.test.ts

# LSP integration
npx vitest run packages/lsp-server/tests/lsp-integration.test.ts

# Build
pnpm --filter @typesugar/macros build
pnpm --filter @typesugar/transformer build
pnpm --filter @typesugar/lsp-server build

# VS Code extension
cd packages/vscode && pnpm run package
code --install-extension typesugar-vscode-*.vsix --force

# Manual verification:
# - @derive(Ord) with `import { Ord } from "typesugar"` — no errors
# - @derive(Show) with string fields — no "Property 'string' does not exist"
# - Third-party @impl instances resolve in @derive and summon
```
