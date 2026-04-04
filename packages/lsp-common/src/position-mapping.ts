/**
 * Shared position mapping utilities for IDE integration.
 *
 * Both the LSP server and the TS plugin language service need to map
 * positions between original and transformed source. These utilities
 * extract the identical logic from both paths.
 *
 * @see PEP-034 Wave 2
 */

import type * as ts from "typescript";

/**
 * Minimal interface for bidirectional position mapping.
 * Compatible with @typesugar/transformer-core's PositionMapper.
 */
export interface PositionMapper {
  toOriginal(transformedPos: number): number | null;
  toTransformed(originalPos: number): number | null;
}

/**
 * Identity mapper that returns positions unchanged.
 * Used when no transformation has been applied.
 */
export class IdentityPositionMapper implements PositionMapper {
  toOriginal(pos: number): number {
    return pos;
  }
  toTransformed(pos: number): number {
    return pos;
  }
}

/**
 * Map a TypeScript TextSpan from transformed coordinates back to original coordinates.
 *
 * Returns null if the span's start position cannot be mapped (e.g., it falls
 * in macro-generated code with no original source correspondence).
 */
export function mapTextSpanToOriginal(
  span: ts.TextSpan,
  mapper: PositionMapper
): ts.TextSpan | null {
  const originalStart = mapper.toOriginal(span.start);
  if (originalStart === null) return null;

  const originalEnd = mapper.toOriginal(span.start + span.length);
  const originalLength =
    originalEnd !== null ? Math.max(1, originalEnd - originalStart) : span.length;

  return { start: originalStart, length: originalLength };
}
