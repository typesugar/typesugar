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
  decodeSourceMap,
  decodeMappings,
  findOriginalPosition,
  findGeneratedPosition,
  type DecodedSourceMap,
  type DecodedSegment,
  type DecodedLine,
  type SourcePosition,
} from "./source-map-utils.js";

// Position mapping
export {
  createPositionMapper,
  SourceMapPositionMapper,
  IdentityPositionMapper,
  type PositionMapper,
  type TextRange,
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
