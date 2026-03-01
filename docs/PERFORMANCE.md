# Performance Architecture

This document describes typesugar's caching architecture, performance optimizations, and recommended configurations for development and CI.

## Overview

typesugar operates through three main execution paths:

1. **Vite/Rollup/esbuild (unplugin)** — Uses `TransformationPipeline` with per-file transforms
2. **CLI (`typesugar build/check/watch`)** — Direct TypeScript compilation with macro expansion
3. **ts-patch** — Direct integration with `tsc` via custom transformer

All paths share core infrastructure for caching and transformation.

## Caching Architecture

### Three-Layer Cache Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│ L1: In-Memory Preprocessor Cache                                │
│     • Caches preprocessed code (HKT F<_>, |>, :: syntax)        │
│     • Key: file content hash                                    │
│     • Invalidates on file content change                        │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ L2: In-Memory Transform Cache                                   │
│     • Caches full transform results with source maps            │
│     • Key: file content hash + dependency hashes                │
│     • Invalidates on file OR dependency change                  │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ L3: Disk Transform Cache (.typesugar-cache/transforms/)         │
│     • Content-addressable storage for transform results         │
│     • Persists across process restarts                          │
│     • Key: SHA256(file + deps + version)                        │
│     • Manifest file for fast startup                            │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ L4: Macro Expansion Cache (.typesugar-cache/expansions/)        │
│     • Caches individual macro expansion results                 │
│     • Key: SHA256(macro name + source + args)                   │
│     • Reused across files and builds                            │
└─────────────────────────────────────────────────────────────────┘
```

### Cache Hit Flow

```
File Changed? ──No──> L1 Hit? ──Yes──> L2 Hit? ──Yes──> Return cached
     │                  │                │
     │                  │                No
     │                  │                ▼
     │                  │         Check L3 Disk Cache
     │                  │                │
     │                  No               │
     │                  ▼                │
     │            Preprocess ◄───────────┘
     │                  │
     Yes                ▼
     └───────────> Transform
                       │
                       ▼
                  Update L1, L2, L3, L4 Caches
```

### Content Hashing

We use **xxhash64** (via `xxhash-wasm`) for fast, collision-resistant hashing:

```typescript
import { initHasher, hashContent } from "@typesugar/transformer/cache";

// Initialize at startup (async, fallback available)
await initHasher();

// Fast 64-bit hash (16 hex chars)
const hash = hashContent(fileContent);
```

The fallback DJB2 hash is automatically used if xxhash isn't initialized.

## Disk Cache Configuration

### Enabling Disk Cache

**CLI:**

```bash
# Enable with default path (.typesugar-cache/transforms/)
typesugar build --cache

# Enable with custom path
typesugar build --cache /tmp/typesugar-cache

# Disable explicitly
typesugar build --no-cache
```

**Vite (unplugin):**

```typescript
// vite.config.ts
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [
    typesugar({
      diskCache: true, // or custom path string
    }),
  ],
});
```

**TransformationPipeline API:**

```typescript
import { TransformationPipeline } from "@typesugar/transformer";

const pipeline = new TransformationPipeline(compilerOptions, fileNames, {
  diskCache: true, // or ".typesugar-cache/transforms"
});
```

**ts-patch (tsconfig.json):**

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "@typesugar/transformer",
        "cacheDir": ".typesugar-cache"
      }
    ]
  }
}
```

> **ts-patch limitations:** ts-patch supports `cacheDir` for macro expansion caching. However, full transform caching (`diskCache`) and strict mode require the CLI or unplugin.
>
> This is because `tsc` type-checks the _original_ source before transformation. To type-check _expanded_ output, use:
>
> - `typesugar build --strict` instead of `tsc`, or
> - `typesugar check --strict` as a validation step after `tsc`

### Cache Directory Structure

```
.typesugar-cache/
├── transforms/
│   ├── manifest.json          # File → cache key mapping
│   └── <hash>.json            # Transform result entries
└── expansions/
    └── <hash>.json            # Macro expansion results
```

### Gitignore Configuration

Add to `.gitignore`:

```gitignore
# typesugar caches
.typesugar-cache/
```

## Incremental Compilation

### ts.Program Reuse

The pipeline uses TypeScript's incremental compilation API:

```typescript
// When program needs recreation after invalidation:
this.program = ts.createProgram(
  fileNames,
  compilerOptions,
  host,
  this.oldProgram // Reuses unchanged ASTs
);
```

This significantly speeds up rebuilds by reusing AST structures for unchanged files.

### Factory State Reuse

The `TransformerState` class preserves expensive setup work across builds:

```typescript
import macroTransformerFactory, { TransformerState } from "@typesugar/transformer";

// Create once, reuse across rebuilds (watch mode)
const state = new TransformerState({ verbose: true });

// Each rebuild reuses cached state
const factory = macroTransformerFactory(program, { verbose }, state);
```

Components preserved across rebuilds:

- `HygieneContext` — identifier conflict tracking
- `MacroExpansionCache` — macro expansion results
- `scannedFiles` — files already scanned for registrations
- `loadedPrograms` — programs with loaded macro packages

## Strict Mode

Strict mode type-checks the **expanded** output (after macro transformation) to catch bugs in macro-generated code.

### Why Strict Mode?

Normal `tsc` type-checks the **original** source code before macro expansion. This means:

| Check                      | Original Source | Expanded Output |
| -------------------------- | --------------- | --------------- |
| `tsc` (with ts-patch)      | ✅              | ❌              |
| `typesugar build`          | ✅              | ❌              |
| `typesugar build --strict` | ✅              | ✅              |

If a macro generates invalid TypeScript, you won't know until runtime—unless you use strict mode.

### CLI Usage

```bash
# Typecheck expanded output
typesugar build --strict

# Combine with verbose for details
typesugar build --strict --verbose

# For ts-patch users: run as separate validation
tsc && typesugar check --strict
```

### Vite Usage

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [
    typesugar({
      strict: true,
    }),
  ],
});
```

### API Usage

```typescript
const pipeline = new TransformationPipeline(compilerOptions, fileNames, {
  strict: true,
});

// Manually run strict typecheck
const diagnostics = pipeline.strictTypecheck();
```

### What Strict Mode Catches

- Invalid macro expansions that produce malformed TypeScript
- Type errors in generated code (e.g., derive macros)
- Missing imports in macro-generated code
- Incorrect type inference in expanded code

## Performance Profiling

### Enabling Profiling

```bash
# Enable detailed timing output
TYPESUGAR_PROFILE=1 typesugar build
```

### Profile Output

```
=== typesugar Transform Profile ===

Per-operation timing (aggregated):
  cli.build.total       : 12,456.3ms (1 calls, avg 12,456.3ms)
  cli.build.preprocess  :    234.5ms (1 calls, avg 234.5ms)
  cli.build.createProgram:  1,234.5ms (1 calls, avg 1,234.5ms)
  cli.build.emit        :  9,876.5ms (1 calls, avg 9,876.5ms)

Per-file timing (top 10 by total):
  src/app.ts            :    56.3ms (read: 0.1ms, hash: 0.0ms, transform: 45.2ms)
  src/utils.ts          :    34.2ms (read: 0.1ms, hash: 0.0ms, transform: 23.1ms)
  ...
```

### Key Metrics

- `readMs` — File read time
- `hashMs` — Content hash computation
- `cacheCheckMs` — Cache lookup time
- `preprocessMs` — Custom syntax preprocessing
- `transformMs` — Macro transformation
- `printMs` — AST printing (skipped if unchanged)

## Recommended Configurations

### Development (Fast Feedback)

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [
    typesugar({
      diskCache: true, // Persist cache across restarts
      verbose: false, // Quiet unless debugging
    }),
  ],
});
```

### CI (Correctness First)

```yaml
# .github/workflows/ci.yml
- name: Build with strict mode
  run: typesugar build --strict --cache

- name: Run tests
  run: pnpm test
```

```typescript
// vite.config.ts (CI override)
export default defineConfig({
  plugins: [
    typesugar({
      strict: process.env.CI === "true",
      diskCache: true, // CI caches can be restored
    }),
  ],
});
```

### Production Build

```bash
# Full clean build with strict checking
rm -rf .typesugar-cache
typesugar build --strict
```

### Watch Mode (Maximum Speed)

```bash
# Watch mode automatically reuses state
typesugar watch --verbose
```

The watch mode:

- Reuses `TransformerState` across rebuilds
- Uses TypeScript's `BuilderProgram` for change detection
- Only processes changed files

## Performance Quick Wins

### Already Implemented

1. **Identifier caching in safeRef** — Avoids repeated `ts.factory.createIdentifier()` allocations
2. **Skip printFile for unchanged AST** — Reference equality check skips unnecessary printing
3. **String-based fast-skip for registration scans** — Checks `includes("instance(")` before AST walk
4. **xxhash64 content hashing** — 64-bit collision-resistant hashing
5. **TransformerState reuse** — Preserves expensive setup across rebuilds
6. **Disk transform cache** — Persists transform results across process restarts
7. **Incremental program creation** — Reuses unchanged ASTs

### Profiling Tips

1. **Large projects**: Enable disk cache to avoid cold start penalty
2. **Many small files**: Factory reuse gives biggest wins
3. **Complex macros**: Expansion cache amortizes macro cost
4. **CI pipelines**: Cache `.typesugar-cache/` between runs

## Troubleshooting

### Slow First Build

The first build is slower because:

- xxhash-wasm needs initialization
- Disk cache is empty
- No `oldProgram` to reuse

Solutions:

- Pre-warm with `typesugar check`
- Restore CI cache from previous run

### Cache Invalidation Issues

If the cache seems stale:

```bash
# Clear all caches
rm -rf .typesugar-cache

# Rebuild
typesugar build --cache
```

### Memory Usage

For very large projects, consider:

- Reducing `maxCacheSize` option (default: 1000)
- Using `--no-cache` for one-off builds

### Debugging Cache Behavior

```bash
# Verbose logging shows cache hits/misses
typesugar build --cache --verbose

# Output includes:
# [typesugar] Disk cache hit for src/app.ts
# [typesugar] Transform cache miss for src/changed.ts
```
