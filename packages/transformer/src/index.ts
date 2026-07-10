/**
 * @typesugar/transformer - Main entry point
 *
 * PEP-056: this package's own duplicate macro-dispatch engine has been
 * deleted. The dispatch logic now lives in a single place --
 * @typesugar/transformer-core's MacroTransformer class -- used identically
 * by the CLI (pipeline.ts/cli.ts), the language service, and the browser
 * playground. This file is now a thin barrel re-exporting the package's
 * public surface from wherever each piece actually lives.
 */

import { macroTransformerFactory } from "./pipeline.js";

// The Node-host macro transformer factory (config/state/cache plumbing
// around transformer-core's shared MacroTransformer) now lives in
// pipeline.ts -- see its doc comment for what it reconstructs that
// transformer-core's browser-safe createTransformerFactory can't.
export {
  macroTransformerFactory,
  type MacroTransformerConfig,
  TransformerState,
  saveExpansionCache,
  getExpansionCacheStats,
} from "./pipeline.js";

export default macroTransformerFactory;

// The single shared macro-dispatch engine (PEP-056).
export { MacroTransformer } from "@typesugar/transformer-core";

// Lazy macro loading utilities
export {
  loadMacroPackages,
  loadMacroPackage,
  resetLoadedPackages,
  classifyManifestPackages,
  UnapprovedMacroPackagesError,
} from "./macro-loader.js";

// Re-export unified pipeline components
export {
  TransformationPipeline,
  createPipeline,
  transformCode,
  restoreBlankLines,
  formatExpansions,
  type TransformResult,
  type TransformDiagnostic,
  type PipelineOptions,
} from "./pipeline.js";

export {
  VirtualCompilerHost,
  type VirtualCompilerHostOptions,
  type PreprocessedFile,
} from "./virtual-host.js";

export { rewriteHKTTypeReferences, hasHKTPatterns } from "./hkt-rewriter.js";

export {
  type PositionMapper,
  SourceMapPositionMapper,
  IdentityPositionMapper,
  createPositionMapper,
  type TextRange,
} from "./position-mapper.js";

export {
  composeSourceMaps,
  decodeMappings,
  decodeSourceMap,
  findOriginalPosition,
  findGeneratedPosition,
  type RawSourceMap,
  type DecodedSourceMap,
  type DecodedSegment,
  type SourcePosition,
} from "./source-map-utils.js";

export {
  TransformCache,
  DependencyGraph,
  createTransformCache,
  hashContent,
  type PreprocessedCacheEntry,
  type TransformCacheEntry,
} from "./cache.js";

export { generateManifest, createDefaultManifest, type MacroManifest } from "./manifest.js";
