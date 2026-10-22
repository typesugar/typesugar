/**
 * @typesugar/transformer Showcase
 *
 * Self-documenting examples of the TypeScript transformer that powers
 * all macro expansion. This package provides the ts-patch transformer
 * factory, the unified TransformationPipeline, source map composition,
 * caching, and virtual compiler host utilities.
 *
 * Since the transformer is a build-time tool (not a runtime library),
 * this showcase demonstrates the configuration patterns and public APIs
 * rather than executing transformations directly.
 *
 * Type assertions used:
 *   typeAssert<Equal<A, B>>()        - A and B are the same type
 *   typeAssert<Extends<A, B>>()      - A is assignable to B
 *   typeAssert<Not<Equal<A, B>>>()   - A and B are DIFFERENT
 *   typeAssert<Not<Extends<A, B>>>() - A is NOT assignable to B
 *
 * Run:   typesugar run examples/showcase.ts
 * Build: npx tspc && node dist/examples/showcase.js
 */

import { assert, typeAssert, type Equal, type Extends, type Not } from "@typesugar/testing";

import type {
  // Transformer factory and config
  MacroTransformerConfig,

  // Pipeline types
  TransformResult,
  TransformDiagnostic,
  PipelineOptions,

  // Virtual host types
  VirtualCompilerHostOptions,
  PreprocessedFile,

  // Position mapping
  PositionMapper,
  TextRange,

  // Source map composition
  RawSourceMap,
  DecodedSourceMap,
  SourcePosition,

  // Caching
  PreprocessedCacheEntry,
  TransformCacheEntry,
} from "../src/index.js";

import {
  // Pipeline
  TransformationPipeline,
  transformCode,

  // Virtual host
  VirtualCompilerHost,

  // Position mapping
  SourceMapPositionMapper,
  IdentityPositionMapper,
  createPositionMapper,

  // Source map utilities
  composeSourceMaps,
  decodeMappings,
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,

  // Caching
  TransformCache,
  DependencyGraph,
  createTransformCache,
  hashContent,
} from "../src/index.js";

// Re-export for documentation purposes - these are the main entry points
// but require a full TS program context to use, so we just verify they exist
void TransformationPipeline;
void VirtualCompilerHost;
void decodeMappings;
void decodeSourceMap;

// ============================================================================
// 1. TRANSFORMER CONFIGURATION - ts-patch Entry Point
// ============================================================================

// MacroTransformerConfig controls the transformer's behavior
// This is what you put in tsconfig.json under compilerOptions.plugins
const basicConfig: MacroTransformerConfig = {};
typeAssert<Equal<typeof basicConfig, MacroTransformerConfig>>();

const verboseConfig: MacroTransformerConfig = {
  verbose: true,
  cfgConfig: { debug: true },
};

assert(verboseConfig.verbose === true);
assert(verboseConfig.cfgConfig!.debug === true);

// Typical tsconfig.json setup:
// {
//   "compilerOptions": {
//     "plugins": [{
//       "transform": "@typesugar/transformer",
//       "verbose": false
//     }]
//   }
// }

// ============================================================================
// 2. TRANSFORMATION PIPELINE - Unified Preprocessing + Macro Expansion
// ============================================================================

// TransformResult is what you get back from any transformation: the
// original and transformed code, whether anything changed, the diagnostics,
// a source map and a position mapper
typeAssert<
  Extends<
    TransformResult,
    { original: string; code: string; changed: boolean; diagnostics: TransformDiagnostic[] }
  >
>();

// TransformDiagnostic carries error info from the macro system, with the
// position in the original file
typeAssert<
  Extends<
    TransformDiagnostic,
    { file: string; start: number; length: number; message: string; severity: "error" | "warning" }
  >
>();

// PipelineOptions configures the full preprocessing + transform pipeline:
// logging, the macro transformer's own config, file access and caching
const pipelineOpts: PipelineOptions = {
  verbose: false,
  maxCacheSize: 100,
  diskCache: false,
};

assert(pipelineOpts.maxCacheSize === 100);

// transformCode is the simplest API — give it code (and optionally a file
// name and pipeline options), get back the transformed code
typeAssert<
  Extends<typeof transformCode, (code: string, options?: { fileName?: string }) => TransformResult>
>();

// ============================================================================
// 3. VIRTUAL COMPILER HOST - In-Memory TypeScript Compilation
// ============================================================================

// VirtualCompilerHost serves the type checker preprocessed file contents;
// readFile/fileExists can supply virtual files without touching the
// filesystem
const virtualFiles: Record<string, string> = {
  "virtual.ts": "const x: number = 42; export { x };",
};
const hostOpts: VirtualCompilerHostOptions = {
  compilerOptions: { strict: true },
  readFile: (fileName) => virtualFiles[fileName],
  fileExists: (fileName) => fileName in virtualFiles,
};
assert(hostOpts.readFile!("virtual.ts")!.includes("42"));

typeAssert<Equal<typeof hostOpts, VirtualCompilerHostOptions>>();

// PreprocessedFile tracks which files have been preprocessed. The remaining
// preprocessing step is HKT syntax: `F<A>` (F a type parameter) → `Kind<F, A>`.
const preprocessed: PreprocessedFile = {
  original: "type Lifted = F<A>;",
  code: "type Lifted = Kind<F, A>;",
  map: null,
  hash: "example",
};

assert(preprocessed.original.includes("F<A>"));
assert(preprocessed.code.includes("Kind<F, A>"));

// ============================================================================
// 4. POSITION MAPPING - Navigate Between Original and Transformed Code
// ============================================================================

// IdentityPositionMapper is used when there's no transformation
const identity = new IdentityPositionMapper();
const pos = identity.toOriginal(42);
assert(pos === 42);
assert(identity.toTransformed(42) === 42);

// createPositionMapper picks the right mapper based on source map availability
// (no source map: the identity mapper)
const identityMapper = createPositionMapper(null, "const x = 1;", "const x = 1;");
assert(identityMapper.toOriginal(10) === 10);

// SourceMapPositionMapper uses a decoded source map for accurate mapping
// (Used internally when preprocessor transforms custom syntax)
typeAssert<Extends<SourceMapPositionMapper, PositionMapper>>();
typeAssert<Extends<IdentityPositionMapper, PositionMapper>>();

// TextRange represents a span in source code
const range: TextRange = { start: 0, length: 42 };
typeAssert<Equal<typeof range, TextRange>>();

// ============================================================================
// 5. SOURCE MAP COMPOSITION - Chain Multiple Transformations
// ============================================================================

// Source maps can be composed: preprocessor map + transformer map = final map
// This is essential for accurate error locations through the pipeline

// composeSourceMaps chains two maps together (either may be absent)
typeAssert<
  Extends<
    typeof composeSourceMaps,
    (first: RawSourceMap | null, second: RawSourceMap | null) => RawSourceMap | null
  >
>();

// findOriginalPosition traces back from generated code to original source
typeAssert<
  Extends<
    typeof findOriginalPosition,
    (map: DecodedSourceMap, line: number, column: number) => SourcePosition | null
  >
>();

// findGeneratedPosition goes the other direction
typeAssert<
  Extends<
    typeof findGeneratedPosition,
    (map: DecodedSourceMap, line: number, column: number) => SourcePosition | null
  >
>();

// A decoded source map has segments per line
const emptyDecoded: DecodedSourceMap = {
  version: 3,
  sources: ["input.ts"],
  names: [],
  mappings: [],
};
typeAssert<Equal<typeof emptyDecoded, DecodedSourceMap>>();

// ============================================================================
// 6. CACHING - Incremental Builds via Content Hashing
// ============================================================================

// hashContent produces a deterministic hash for cache keys
const hash1 = hashContent("const x = 1;");
const hash2 = hashContent("const x = 2;");
const hash3 = hashContent("const x = 1;");

assert(hash1 === hash3, "Same content produces same hash");
assert(hash1 !== hash2, "Different content produces different hash");
assert(typeof hash1 === "string");

// DependencyGraph tracks file dependencies for cache invalidation
const deps = new DependencyGraph();

// setDependencies sets all deps for a file at once
deps.setDependencies("app.ts", new Set(["utils.ts", "types.ts"]));
deps.setDependencies("utils.ts", new Set(["types.ts"]));

// When types.ts changes, we need to find files that depend on it
const dependents = deps.getDependents("types.ts");
assert(dependents.has("app.ts"));
assert(dependents.has("utils.ts"));

// For transitive dependents (all files affected by a change)
const transitive = deps.getTransitiveDependents("types.ts");
assert(transitive.has("app.ts"));
assert(transitive.has("utils.ts"));

// getDependencies gets what a file imports
const appDeps = deps.getDependencies("app.ts");
assert(appDeps.has("utils.ts"));
assert(appDeps.has("types.ts"));

// Update dependencies by setting again (replaces old deps)
deps.setDependencies("app.ts", new Set(["utils.ts"]));
const updatedDeps = deps.getDependencies("app.ts");
assert(!updatedDeps.has("types.ts"));
assert(updatedDeps.has("utils.ts"));

// TransformCache wraps the dependency graph with content-addressed storage
const cache = createTransformCache();
typeAssert<Extends<typeof cache, TransformCache>>();

// Cache entries for preprocessed and transformed files, keyed by content hash
// PreprocessedCacheEntry: { code, map, original, contentHash }
typeAssert<
  Extends<
    PreprocessedCacheEntry,
    { code: string; map: RawSourceMap | null; original: string; contentHash: string }
  >
>();

// TransformCacheEntry: { result, contentHash, dependencies, dependencyHashes }
typeAssert<
  Extends<
    TransformCacheEntry,
    { result: TransformResult; contentHash: string; dependencies: Set<string> }
  >
>();

console.log("✓ All @typesugar/transformer showcase assertions passed");
