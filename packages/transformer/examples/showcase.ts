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
  DecodedSegment,
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

// ============================================================================
// 1. TRANSFORMER CONFIGURATION - ts-patch Entry Point
// ============================================================================

// MacroTransformerConfig controls the transformer's behavior
// This is what you put in tsconfig.json under compilerOptions.plugins
const basicConfig: MacroTransformerConfig = {};
typeAssert<Equal<typeof basicConfig, MacroTransformerConfig>>();

const verboseConfig: MacroTransformerConfig = {
  verbose: true,
  macroModules: ["./src/custom-macros.ts"],
};

assert(verboseConfig.verbose === true);
assert(verboseConfig.macroModules!.length === 1);

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

// TransformResult is what you get back from any transformation
typeAssert<
  Extends<
    { code: string; changed: boolean; diagnostics: TransformDiagnostic[]; sourceMap?: unknown },
    TransformResult
  >
>();

// TransformDiagnostic carries error info from the macro system
typeAssert<
  Extends<
    { message: string; severity: "error" | "warning" | "info" },
    TransformDiagnostic
  >
>();

// PipelineOptions configures the full preprocessing + transform pipeline
const pipelineOpts: PipelineOptions = {
  verbose: false,
  extensions: ["hkt", "pipeline", "cons"],
};

assert(pipelineOpts.extensions!.length === 3);

// transformCode is the simplest API — give it code, get back transformed code
// (requires a tsconfig.json path for type checker access)
typeAssert<
  Extends<
    typeof transformCode,
    (tsconfig: string, code: string, fileName?: string) => TransformResult
  >
>();

// ============================================================================
// 3. VIRTUAL COMPILER HOST - In-Memory TypeScript Compilation
// ============================================================================

// VirtualCompilerHost lets you create a TS program with virtual files
// Useful for testing transformers without touching the filesystem
const hostOpts: VirtualCompilerHostOptions = {
  files: {
    "virtual.ts": 'const x: number = 42; export { x };',
  },
};

typeAssert<Equal<typeof hostOpts, VirtualCompilerHostOptions>>();

// PreprocessedFile tracks which files have been preprocessed
const preprocessed: PreprocessedFile = {
  originalCode: 'const x = data |> filter;',
  processedCode: 'const x = __binop__(data, "|>", filter);',
  sourceMap: undefined,
};

assert(preprocessed.originalCode.includes("|>"));
assert(preprocessed.processedCode.includes("__binop__"));

// ============================================================================
// 4. POSITION MAPPING - Navigate Between Original and Transformed Code
// ============================================================================

// IdentityPositionMapper is used when there's no transformation
const identity = new IdentityPositionMapper();
const pos = identity.toOriginal(42);
assert(pos === 42);
assert(identity.toGenerated(42) === 42);

// createPositionMapper picks the right mapper based on source map availability
const identityMapper = createPositionMapper(undefined);
assert(identityMapper.toOriginal(10) === 10);

// SourceMapPositionMapper uses a decoded source map for accurate mapping
// (Used internally when preprocessor transforms custom syntax)
typeAssert<Extends<SourceMapPositionMapper, PositionMapper>>();
typeAssert<Extends<IdentityPositionMapper, PositionMapper>>();

// TextRange represents a span in source code
const range: TextRange = { start: 0, end: 42 };
typeAssert<Equal<typeof range, TextRange>>();

// ============================================================================
// 5. SOURCE MAP COMPOSITION - Chain Multiple Transformations
// ============================================================================

// Source maps can be composed: preprocessor map + transformer map = final map
// This is essential for accurate error locations through the pipeline

// composeSourceMaps chains two maps together
typeAssert<
  Extends<
    typeof composeSourceMaps,
    (first: RawSourceMap, second: RawSourceMap) => RawSourceMap
  >
>();

// findOriginalPosition traces back from generated code to original source
typeAssert<
  Extends<
    typeof findOriginalPosition,
    (map: DecodedSourceMap, line: number, column: number) => SourcePosition | undefined
  >
>();

// findGeneratedPosition goes the other direction
typeAssert<
  Extends<
    typeof findGeneratedPosition,
    (map: DecodedSourceMap, line: number, column: number) => SourcePosition | undefined
  >
>();

// A decoded source map has segments per line
const emptyDecoded: DecodedSourceMap = {
  sources: ["input.ts"],
  names: [],
  segments: [],
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

deps.addDependency("app.ts", "utils.ts");
deps.addDependency("app.ts", "types.ts");
deps.addDependency("utils.ts", "types.ts");

// When types.ts changes, both app.ts and utils.ts need re-processing
const affected = deps.getAffectedFiles("types.ts");
assert(affected.has("app.ts"));
assert(affected.has("utils.ts"));

// Direct dependents only
const directDeps = deps.getDependencies("app.ts");
assert(directDeps.has("utils.ts"));
assert(directDeps.has("types.ts"));

deps.removeDependency("app.ts", "types.ts");
const updatedDeps = deps.getDependencies("app.ts");
assert(!updatedDeps.has("types.ts"));

// TransformCache wraps the dependency graph with content-addressed storage
const cache = createTransformCache();
typeAssert<Extends<typeof cache, TransformCache>>();

// Cache entries for preprocessed and transformed files
typeAssert<
  Extends<
    { hash: string; code: string },
    PreprocessedCacheEntry
  >
>();

typeAssert<
  Extends<
    { hash: string; code: string },
    TransformCacheEntry
  >
>();

console.log("✓ All @typesugar/transformer showcase assertions passed");
