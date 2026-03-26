/**
 * PositionMapper — Bidirectional position translation using source maps
 *
 * Extends PositionMapperCore with TypeScript-specific `mapDiagnostic` support
 * for use in VS Code plugin and other TS server contexts.
 *
 * For browser/worker use where `typescript` is not available, use
 * PositionMapperCore from `./position-mapping-core.js` instead.
 */

import * as ts from "typescript";
import type { RawSourceMap } from "@typesugar/core";
import {
  SourceMapPositionMapperCore,
  IdentityPositionMapperCore,
  type PositionMapperCore,
  type TextRange,
} from "./position-mapping-core.js";

// Re-export core types for backward compatibility
export type { TextRange, PositionMapperCore };

/**
 * Full position mapper interface including TypeScript diagnostic mapping.
 */
export interface PositionMapper extends PositionMapperCore {
  /** Map a diagnostic's position back to original */
  mapDiagnostic(diag: ts.Diagnostic): ts.Diagnostic;
}

/**
 * Source map position mapper with TypeScript diagnostic support.
 */
export class SourceMapPositionMapper extends SourceMapPositionMapperCore implements PositionMapper {
  mapDiagnostic(diag: ts.Diagnostic): ts.Diagnostic {
    if (diag.start === undefined) return diag;

    const originalStart = this.toOriginal(diag.start);
    if (originalStart === null) return diag;

    // Also map the end position for accurate spans
    let originalLength = diag.length;
    if (diag.length !== undefined) {
      const originalEnd = this.toOriginal(diag.start + diag.length);
      if (originalEnd !== null) {
        originalLength = originalEnd - originalStart;
      }
    }

    return {
      ...diag,
      start: originalStart,
      length: originalLength,
    };
  }
}

/**
 * Identity mapper for files that weren't transformed.
 */
export class IdentityPositionMapper extends IdentityPositionMapperCore implements PositionMapper {
  mapDiagnostic(diag: ts.Diagnostic): ts.Diagnostic {
    return diag;
  }
}

/**
 * Create a position mapper for a file.
 *
 * Returns an IdentityPositionMapper if no source map is available.
 */
export function createPositionMapper(
  sourceMap: RawSourceMap | null,
  originalContent: string,
  transformedContent: string
): PositionMapper {
  if (!sourceMap || originalContent === transformedContent) {
    return new IdentityPositionMapper();
  }

  return new SourceMapPositionMapper(sourceMap, originalContent, transformedContent);
}
