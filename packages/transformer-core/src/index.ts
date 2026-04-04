/**
 * @typesugar/transformer-core
 *
 * Browser-compatible transformation core for typesugar macro expansion.
 * This package has ZERO Node.js dependencies and can run in any JavaScript environment.
 *
 * Provides:
 * - Core transformation types (TransformResult, TransformDiagnostic)
 * - Source map composition and decoding
 * - Position mapping between original and transformed code
 *
 * Re-exports from @typesugar/core:
 * - ExpansionTracker and globalExpansionTracker
 * - RawSourceMap type
 * - preserveSourceMap utility
 */

// Core types
export { type TransformDiagnostic, type TransformResult, type TransformOptions } from "./types.js";

// Source map utilities
export {
  composeSourceMaps,
  composeSourceMapChain,
  decodeSourceMap,
  decodeMappings,
  findOriginalPosition,
  findGeneratedPosition,
  type DecodedSourceMap,
  type DecodedSegment,
  type DecodedLine,
  type SourcePosition,
} from "./source-map-utils.js";

// Position mapping — core (no TypeScript dependency, browser-safe)
export {
  createPositionMapperCore,
  SourceMapPositionMapperCore,
  IdentityPositionMapperCore,
  type PositionMapperCore,
  type TextRange,
  type LineIndex,
  buildLineIndex,
  offsetToLineColumn,
  lineColumnToOffset,
} from "./position-mapping-core.js";

// Position mapping — full (extends core with ts.Diagnostic mapping)
export {
  createPositionMapper,
  SourceMapPositionMapper,
  IdentityPositionMapper,
  type PositionMapper,
} from "./position-mapper.js";

// Re-export from @typesugar/core for convenience
export {
  // Expansion tracking
  ExpansionTracker,
  globalExpansionTracker,
  preserveSourceMap,
  type RawSourceMap,
  type ExpansionRecord,
} from "@typesugar/core";

// MacroTransformer class - the core transformation engine
export { MacroTransformer } from "./transformer.js";

// Browser-compatible transform function
export { transformCode, type TransformCodeOptions, type TransformCodeResult } from "./transform.js";
